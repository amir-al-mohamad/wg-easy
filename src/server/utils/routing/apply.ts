import { createDebug } from 'obug';

import { configureDns, startDnsProxy, stopDnsProxy } from './dns';
import { serverAddresses } from './dnsStatus';
import { isForwardPortPublished } from './env';
import {
  awaitHandshake,
  defaultRoutes,
  fwmarkRules,
  handshakeAge,
  handshakeStale,
  hasGlobalIpv6,
  interfaceUp,
  localSubnets,
  rehandshake,
  wireguardPeers,
} from './interfaces';
import type { TableRoute } from './interfaces';
import {
  changeSets,
  destroyOrphanSets,
  ensureSets,
  listAddresses,
  type SetChange,
} from './ipset';
import { withRoutingLock } from './lock';
import {
  MARK_BLOCK,
  MARK_DIRECT,
  RULE_PRIORITY_MAX,
  RULE_PRIORITY_MIN,
} from './marks';
import {
  buildPlan,
  isEmpty,
  isTeardown,
  MAX_FALLBACKS,
  renderRestore,
  staleForwards,
} from './plan';
import type { Plan, PlanForward, PlanRule, Step } from './plan';

import { getDatabase } from '#db';
import type { Repositories } from '#db/store';
import { exec } from '#server/utils/cmd';
import { WG_ENV } from '#server/utils/config';
import { canonical } from '#shared/utils/address';

const ROUTER_DEBUG = createDebug('Router');

type RuleWithRelations = Awaited<
  ReturnType<Repositories['routingRules']['getAll']>
>[number];

/** How the last kernel apply went. */
export type ApplyStatus = {
  at: number | null;
  /** Steps that failed; -1 when the apply itself threw. */
  failures: number;
  /** Whether the tools are present, so applying is possible at all. */
  available: boolean;
};

/** How the last apply went, for the UI; the kernel is the only other place it shows. */
const status: ApplyStatus = { at: null, failures: 0, available: false };

export function applyStatus(): ApplyStatus {
  return { ...status };
}

/**
 * Whether the tools the router needs are present. A missing tool switches the
 * feature off rather than letting every command fail quietly.
 */
async function isAvailable(): Promise<boolean> {
  try {
    await exec('ipset list -name', { log: false });
    await exec('ip -j -4 rule list', { log: false });
    await exec('iptables -t mangle -L -n', { log: false });
    return true;
  } catch (error) {
    ROUTER_DEBUG('Routing tools unavailable:', error);
    return false;
  }
}

/** How often missing tools are looked for again. */
const PROBE_INTERVAL_MS = 60_000;
let probedAt = 0;

/**
 * Probe again for tools found missing, at most once a minute: the FAQ's fix
 * is loading kernel modules on the host, which should not also need a
 * container restart to take effect.
 *
 * @returns whether the tools have just become available
 */
async function reprobe() {
  if (status.available || Date.now() - probedAt < PROBE_INTERVAL_MS) {
    return false;
  }
  probedAt = Date.now();
  status.available = await isAvailable();
  if (status.available) {
    ROUTER_DEBUG('Routing tools are available now');
  }
  return status.available;
}

/**
 * Our rules currently installed, read from the kernel: a crash mid-apply or
 * a gateway count that shrank leaves rules nothing else would clean up. Only
 * fwmark rules inside our priority band count as ours.
 */
async function installedRules() {
  const ours = (rules: Awaited<ReturnType<typeof fwmarkRules>>) =>
    rules.filter(
      (rule) =>
        rule.priority >= RULE_PRIORITY_MIN && rule.priority <= RULE_PRIORITY_MAX
    );

  const [v4, v6] = await Promise.all([
    fwmarkRules('-4'),
    WG_ENV.DISABLE_IPV6 ? [] : fwmarkRules('-6'),
  ]);
  return { v4: ours(v4), v6: ours(v6) };
}

/**
 * Make each rule's address sets match its configured addresses: stale
 * permanent entries are dropped, missing ones added, and entries with a
 * timeout (learned from DNS) left to expire. Compared in canonical form,
 * since the kernel prints `1.2.3.4/32` back as `1.2.3.4`.
 */
async function syncSets(rules: readonly RuleWithRelations[]) {
  await ensureSets(rules.map((rule) => rule.id));

  const changes: SetChange[] = [];
  for (const rule of rules) {
    const configured = new Set(
      rule.addresses
        .map((address) => canonical(address))
        .filter((entry) => entry !== null && !entry.catchAll)
        .map((entry) => entry!.address)
    );
    // Only permanent entries are the rule's own; learned ones (with a
    // timeout) are left to expire. A configured address that was learned
    // first is added again without a timeout, which makes it permanent.
    const permanent = new Set(
      (await listAddresses(rule.id))
        .filter((entry) => entry.timeout === 0)
        .map((entry) => entry.address)
    );

    for (const address of permanent) {
      if (!configured.has(address)) {
        changes.push({ op: 'del', ruleId: rule.id, address });
      }
    }
    for (const address of configured) {
      if (!permanent.has(address)) {
        changes.push({ op: 'add', ruleId: rule.id, address });
      }
    }
  }
  await changeSets(changes);
}

function markFor(
  rule: RuleWithRelations,
  gatewayMarks: ReadonlyMap<number, string>
) {
  switch (rule.action) {
    case 'direct':
      return MARK_DIRECT;
    case 'block':
      return MARK_BLOCK;
    case 'gateway':
      return rule.gatewayId === null
        ? null
        : (gatewayMarks.get(rule.gatewayId) ?? null);
  }
}

function toPlanRule(rule: RuleWithRelations, fwmark: string): PlanRule | null {
  const entries = rule.addresses
    .map((address) => canonical(address))
    .filter((entry) => entry !== null);

  const clients = rule.clients
    .map((link) => link.client)
    .filter((client) => client?.enabled)
    .map((client) => ({
      ipv4: client!.ipv4Address,
      ipv6: client!.ipv6Address,
    }));

  // Every named client is disabled, so the rule currently covers nobody.
  // Emitting it with no source match would silently widen it to everyone.
  if (rule.clients.length > 0 && clients.length === 0) {
    return null;
  }

  return {
    id: rule.id,
    fwmark,
    clients,
    matchAllV4: entries.some((entry) => entry.catchAll && entry.family === 4),
    matchAllV6: entries.some((entry) => entry.catchAll && entry.family === 6),
  };
}

type Observed = {
  id: number;
  up: boolean;
  ipv6: boolean;
  alive: boolean;
  /** The table's default routes per family, as {@link describeRoutes} prints them. */
  routes4: string;
  routes6: string;
};

type Link = {
  up: boolean;
  ipv6: boolean;
  /**
   * The far end answers, as far as can be told: false only for a WireGuard
   * link whose keepalive peer has stopped handshaking.
   */
  alive: boolean;
};

/**
 * The link's state. IPv6 is only probed when enabled, so v6 address churn on
 * a tunnel cannot trigger applies that would change nothing.
 */
async function observeLink(interfaceName: string): Promise<Link> {
  const [up, ipv6, peers] = await Promise.all([
    interfaceUp(interfaceName),
    WG_ENV.DISABLE_IPV6 ? false : hasGlobalIpv6(interfaceName),
    wireguardPeers(interfaceName),
  ]);
  return { up, ipv6: up && ipv6, alive: !handshakeStale(handshakeAge(peers)) };
}

function describeRoutes(routes: readonly TableRoute[]) {
  return routes
    .map((route) => `${route.metric}=${route.dev ?? '-'}`)
    .sort()
    .join('+');
}

async function tableRoutes(routeTable: number) {
  const [v4, v6] = await Promise.all([
    defaultRoutes('-4', routeTable),
    WG_ENV.DISABLE_IPV6 ? [] : defaultRoutes('-6', routeTable),
  ]);
  return { v4, v6 };
}

/**
 * The state of each gateway's link and what its table holds, read from the
 * system, since both change behind the database's back. `links` lets the
 * apply pass in the link states it acted on.
 */
async function observe(
  gateways: readonly {
    id: number;
    interfaceName: string;
    routeTable: number;
  }[],
  links?: ReadonlyMap<number, Link>
): Promise<Observed[]> {
  return Promise.all(
    gateways.map(async ({ id, interfaceName, routeTable }) => {
      const [link, routes] = await Promise.all([
        links?.get(id) ?? observeLink(interfaceName),
        tableRoutes(routeTable),
      ]);
      return {
        id,
        ...link,
        routes4: describeRoutes(routes.v4),
        routes6: describeRoutes(routes.v6),
      };
    })
  );
}

function summarize(observed: readonly Observed[]) {
  const bit = (value: boolean) => (value ? 1 : 0);
  return observed
    .map(
      (entry) =>
        `${entry.id}=${bit(entry.up)}${bit(entry.ipv6)}${bit(entry.alive)}[${entry.routes4}][${entry.routes6}]`
    )
    .join(',');
}

type GatewayRow = Awaited<
  ReturnType<Repositories['gateways']['getAll']>
>[number];

/**
 * The gateways traffic falls through to when this one is unavailable, in
 * order, and what happens after the last of them. A setting that cannot be
 * honoured (a loop, a switched-off fallback, a chain too long for the table)
 * ends in dropping.
 */
export function resolveChain(
  gateway: GatewayRow,
  byId: ReadonlyMap<number, GatewayRow>
): { fallbacks: GatewayRow[]; failClosed: boolean } {
  const fallbacks: GatewayRow[] = [];
  const visited = new Set([gateway.id]);
  let current = gateway;

  for (;;) {
    if (current.unavailableAction === 'block') {
      return { fallbacks, failClosed: true };
    }
    if (current.unavailableAction === 'direct') {
      return { fallbacks, failClosed: false };
    }

    const next =
      current.fallbackGatewayId === null
        ? undefined
        : byId.get(current.fallbackGatewayId);
    if (
      !next ||
      !next.enabled ||
      visited.has(next.id) ||
      fallbacks.length >= MAX_FALLBACKS
    ) {
      return { fallbacks, failClosed: true };
    }

    visited.add(next.id);
    fallbacks.push(next);
    current = next;
  }
}

/** What the last apply left behind, as {@link summarize} prints it. */
let seen = '';

/**
 * Forwards the last apply installed. In memory only: the kernel's connection
 * table starts empty with the container, so there is nothing older to end.
 */
let installedForwards: PlanForward[] = [];

/**
 * Whether a gateway's link or route changed since the last apply. The kernel
 * drops a route through a link when the link goes down or away and never
 * puts it back, so the route is watched, not just the link. Compared against
 * what the last apply left behind rather than the previous probe, so an
 * apply an edit already triggered is not repeated. Tools that were missing
 * and have since appeared count as a change too.
 */
export async function presenceChanged() {
  // Without the tools nothing was ever applied, and nothing can be.
  if (!status.available) {
    return reprobe();
  }

  const gateways = await getDatabase().gateways.getAll();
  const active = gateways.filter((gateway) => gateway.enabled);
  return summarize(await observe(active)) !== seen;
}

/** Run one step, logging a restore by what it replaces rather than its input. */
async function run(step: Step) {
  if ('command' in step) {
    await exec(step.command, { log: !isTeardown(step.command) });
    return;
  }

  const { iptables, table, chains } = step.restore;
  const summary = chains
    .map((chain) => `${chain.name}(${chain.rules.length})`)
    .join(' ');
  await exec(`${iptables}-restore -w --noflush`, {
    input: renderRestore(step.restore),
    log: `${iptables}-restore -w --noflush  # ${table}: ${summary}`,
  });
}

async function rebuild() {
  // One snapshot, so a rule never points at a gateway this apply did not read.
  const { wgInterface, config, gateways, rules, forwards } =
    await getDatabase().transaction(async (tx) => ({
      wgInterface: await tx.interfaces.get(),
      config: await tx.routingConfig.get(),
      gateways: await tx.gateways.getAll(),
      rules: await tx.routingRules.getAll(),
      forwards: await tx.portForwards.getAll(),
    }));

  const enableIpv6 = !WG_ENV.DISABLE_IPV6;
  const addresses = serverAddresses(wgInterface);

  // Pushed to the DNS proxy from here rather than read per lookup, so a
  // client's name resolution never waits on the database.
  configureDns({
    rules: rules
      .filter((rule) => rule.enabled && rule.patterns.length > 0)
      .map((rule) => ({
        id: rule.id,
        patterns: rule.patterns,
        clients: rule.clients.flatMap((link) =>
          link.client ? [link.client.ipv4Address, link.client.ipv6Address] : []
        ),
      })),
    upstreams: config.dnsUpstreams,
    listen: enableIpv6 ? [addresses.ipv4, addresses.ipv6] : [addresses.ipv4],
    clientCidrs: enableIpv6
      ? [wgInterface.ipv4Cidr, wgInterface.ipv6Cidr]
      : [wgInterface.ipv4Cidr],
  });

  // Started and stopped from here rather than once at boot, so turning the
  // setting off actually releases the port.
  if (config.dnsProxyEnabled) {
    startDnsProxy();
  } else {
    stopDnsProxy();
  }

  // Only gateways that are switched on take part: a switched-off gateway has
  // no rule, table or mark, so rules pointing at it fall through to the
  // default action. One that is on but unusable keeps its rule and table,
  // and the standing route in that table decides what happens meanwhile.
  const active = gateways.filter((gateway) => gateway.enabled);
  // Every gateway, so a chain reaching a switched-off one ends there.
  const byId = new Map(gateways.map((gateway) => [gateway.id, gateway]));

  // Each link is looked at once, however many chains it appears in.
  const links = new Map(
    await Promise.all(
      active.map(
        async (gateway) =>
          [gateway.id, await observeLink(gateway.interfaceName)] as const
      )
    )
  );
  // A link whose far end has stopped answering counts as absent: its route
  // comes out and the chain moves on, until a handshake completes again.
  const hop = (gateway: GatewayRow) => {
    const { up, ipv6, alive } = links.get(gateway.id)!;
    const usable = up && alive;
    return {
      interfaceName: gateway.interfaceName,
      present: usable,
      hasIpv6: usable && ipv6,
    };
  };

  const planGateways = await Promise.all(
    active.map(async (gateway) => {
      const chain = resolveChain(gateway, byId);
      const routes = await tableRoutes(gateway.routeTable);

      return {
        ...hop(gateway),
        fwmark: gateway.fwmark,
        routeTable: gateway.routeTable,
        failClosed: chain.failClosed,
        fallbacks: chain.fallbacks.map(hop),
        installedMetrics: {
          v4: routes.v4.map((route) => route.metric),
          v6: routes.v6.map((route) => route.metric),
        },
      };
    })
  );

  const gatewayMarks = new Map(
    active.map((gateway) => [gateway.id, gateway.fwmark])
  );

  const planRules: PlanRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const fwmark = markFor(rule, gatewayMarks);
    if (!fwmark) {
      ROUTER_DEBUG(
        `Rule ${rule.id} (${rule.name}) has no usable gateway, skipping`
      );
      continue;
    }

    const planRule = toPlanRule(rule, fwmark);
    if (planRule) {
      planRules.push(planRule);
    }
  }

  const defaultFwmark =
    config.defaultAction === 'direct'
      ? null // unmarked traffic already reaches the main table
      : config.defaultAction === 'block'
        ? MARK_BLOCK
        : ((config.defaultGatewayId !== null
            ? gatewayMarks.get(config.defaultGatewayId)
            : undefined) ?? null);

  if (config.defaultAction === 'gateway' && !defaultFwmark) {
    ROUTER_DEBUG(
      'Default action points at a missing gateway, falling back to direct'
    );
  }

  // Forwards to a disabled client, or on a port the container does not
  // publish, are not installed; the second kind is kept and flagged on the
  // routing page, since the ports may come back.
  const planForwards: PlanForward[] = forwards
    .filter(
      (forward) =>
        forward.enabled &&
        forward.client?.enabled &&
        isForwardPortPublished(forward.externalPort)
    )
    .map((forward) => ({
      externalPort: forward.externalPort,
      internalPort: forward.internalPort,
      protocols:
        forward.protocol === 'both'
          ? (['tcp', 'udp'] as const)
          : ([forward.protocol] as const),
      clientIpv4: forward.client?.ipv4Address ?? null,
      clientIpv6: forward.client?.ipv6Address ?? null,
    }));

  const plan: Plan = {
    wgInterface: wgInterface.name,
    enableIpv6,
    localSubnets: await localSubnets(wgInterface.name),
    gateways: planGateways,
    rules: planRules,
    forwards: planForwards,
    staleForwards: staleForwards(installedForwards, planForwards),
    defaultFwmark,
    installedRules: await installedRules(),
  };

  // Sets are filled before the chains referencing them are rebuilt, so a rule
  // never matches an empty set; orphans go after, because the kernel refuses
  // to destroy a set a chain still references.
  if (!isEmpty(plan)) {
    await syncSets(rules);
  }

  const steps = buildPlan(plan);
  ROUTER_DEBUG(
    isEmpty(plan)
      ? `Nothing configured; removing routing state: ${steps.length} steps`
      : `Applying ${planRules.length} rule(s) across ${planGateways.length} gateway(s): ${steps.length} steps`
  );

  let failures = 0;
  let forwardsCommitted = true;
  for (const step of steps) {
    try {
      await run(step);
    } catch (error) {
      // Teardown swallows its own failures, so this is a real problem. Keep
      // going: a refused restore leaves its chains as they were, and the
      // rest of the apply still brings everything else up to date.
      failures++;
      if ('restore' in step && step.restore.table === 'nat') {
        forwardsCommitted = false;
      }
      ROUTER_DEBUG(
        'command' in step
          ? `Command failed: ${step.command}`
          : `Restore refused, ${step.restore.table} chains unchanged`,
        error
      );
    }
  }

  await destroyOrphanSets(isEmpty(plan) ? [] : rules.map((rule) => rule.id));
  // A refused NAT commit left the previous forwards in place, so they stay
  // the baseline the next apply ends stale connections against.
  if (forwardsCommitted) {
    installedForwards = planForwards;
  }

  // What this apply left behind, for the presence pass. Routes are read back
  // rather than assumed, so a failed command is not remembered as done; the
  // links are the states this apply acted on, so one that flipped meanwhile
  // still triggers a re-apply.
  seen = summarize(await observe(active, links));

  status.at = Date.now();
  status.failures = failures;
  if (failures > 0) {
    ROUTER_DEBUG(`${failures} step(s) failed; routing may be incomplete`);
  }
}

/**
 * Rebuild all kernel routing state from the database. Serialized with the
 * scheduler's passes. Failures are reported through {@link applyStatus} and
 * never thrown: the database write that prompted the apply has already
 * happened.
 */
export async function applyRouting(): Promise<void> {
  if (!status.available) {
    return;
  }
  await withRoutingLock(rebuildGuarded);
}

/** A rebuild whose failure is recorded in the status rather than thrown. */
async function rebuildGuarded() {
  try {
    await rebuild();
  } catch (error) {
    status.at = Date.now();
    status.failures = -1;
    ROUTER_DEBUG('Apply failed:', error);
  }
}

/**
 * Reconnect a WireGuard gateway and apply right after, as one locked step, so
 * a route pulled over a stale handshake comes back at once rather than at the
 * next presence pass. Resolves to whether the far end answered in time;
 * rejects when the link cannot be reconnected at all.
 */
export async function reconnectGateway(
  interfaceName: string
): Promise<boolean> {
  return withRoutingLock(async () => {
    await rehandshake(interfaceName);
    const answered = await awaitHandshake(interfaceName);
    if (status.available) {
      await rebuildGuarded();
    }
    return answered;
  });
}

/** Called once, after the WireGuard interface is up. */
export async function startRouting() {
  probedAt = Date.now();
  status.available = await isAvailable();
  if (!status.available) {
    console.warn(
      'WARNING: Policy routing needs ipset, iproute2 and the iptables mangle table, and one of them is not available. Routing rules will not be applied until they are.'
    );
    return;
  }
  await applyRouting();
}

export function stopRouting() {
  stopDnsProxy();
}
