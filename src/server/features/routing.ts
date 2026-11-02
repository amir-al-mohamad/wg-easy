import { createError } from 'nuxt/server';

import { commit } from '#server/features/vpn/lifecycle';
import { authorize } from '#server/features/authorization';
import { getDatabase } from '#db';
import { WG_ENV } from '#server/utils/config';
import { router } from '#server/utils/routing';
import { applyStatus, resolveChain } from '#server/utils/routing/apply';
import { dnsStatus, serverAddresses } from '#server/utils/routing/dnsStatus';
import {
  formatForwardPorts,
  isForwardPortPublished,
  ROUTER_ENV,
} from '#server/utils/routing/env';
import { assertForwardTarget } from '#server/utils/routing/forwardChecks';
import {
  handshakeAge,
  handshakeStale,
  hasGlobalIpv6,
  listInterfaces,
  wireguardPeers,
} from '#server/utils/routing/interfaces';
import {
  countAddresses,
  destroySets,
  ensureSets,
  flushSets,
} from '#server/utils/routing/ipset';
import {
  assertDefaultGateway,
  assertRuleReferences,
} from '#server/utils/routing/ruleChecks';
import type { Actor } from '#shared/contracts/identity';
import type {
  GatewayCreateType,
  GatewayUpdateType,
} from '#db/repositories/gateway/types';
import type {
  PortForwardCreateType,
  PortForwardUpdateType,
} from '#db/repositories/portForward/types';
import type { RoutingConfigUpdateType } from '#db/repositories/routingConfig/types';
import type {
  RoutingRuleCreateType,
  RoutingRuleUpdateType,
} from '#db/repositories/routingRule/types';

function notFound(statusText: string) {
  return createError({ status: 404, statusText });
}

/**
 * Everything the routing page renders, in one request: the sections reference
 * each other, and fetching them separately would let the UI briefly render a
 * rule pointing at a gateway it has not loaded.
 */
export async function overview(actor: Actor) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  const wgInterface = await database.interfaces.get();

  const [config, gateways, rules, forwards, interfaces, userConfig, clients] =
    await Promise.all([
      database.routingConfig.get(),
      database.gateways.getAll(),
      database.routingRules.getAll(),
      database.portForwards.getAll(),
      listInterfaces([wgInterface.name]),
      database.userConfigs.get(),
      database.clients.getAll(),
    ]);

  const up = new Map(interfaces.map((entry) => [entry.name, entry.up]));
  const byId = new Map(gateways.map((gateway) => [gateway.id, gateway]));
  const registered = new Set(gateways.map((gateway) => gateway.interfaceName));

  return {
    /** Whether the last apply worked, and whether applying is possible at all. */
    status: applyStatus(),

    config: {
      defaultAction: config.defaultAction,
      defaultGatewayId: config.defaultGatewayId,
      dnsUpstreams: config.dnsUpstreams,
      dnsInterceptEnabled: config.dnsInterceptEnabled,
    },

    /** So the UI knows whether a gateway's missing IPv6 is worth mentioning. */
    ipv6Enabled: !WG_ENV.DISABLE_IPV6,

    gateways: await Promise.all(
      gateways.map(async (gateway) => {
        // What the chain the operator configured actually amounts to: the
        // engine resolves it the same way, so the UI never claims traffic is
        // going through a fallback the engine decided to drop instead.
        const chain = resolveChain(gateway, byId);

        // The same verdict the apply engine reaches: a WireGuard link whose
        // self-keeping peer has gone quiet is as good as down, and shown so
        // rather than as carrying traffic it is not.
        const peers = await wireguardPeers(gateway.interfaceName);
        const age = handshakeAge(peers);
        // Judged only while the link is up: a down link has an old handshake
        // too, but "down" is the fact worth reporting about it.
        const stale =
          (up.get(gateway.interfaceName) ?? false) && handshakeStale(age);

        return {
          ...gateway,
          // Distinguishes "switched off" from "the container is gone", which
          // the UI has to tell apart: both stop traffic, only one is
          // intentional. Up rather than merely existing, the same test the
          // apply engine uses.
          present: (up.get(gateway.interfaceName) ?? false) && !stale,
          wireguard: peers !== null,
          stale,
          handshakeAge: age === null || !Number.isFinite(age) ? null : age,
          // A gateway with no routable IPv6 carries no IPv6 at all; that
          // traffic is discarded rather than sent down a tunnel that cannot
          // deliver it.
          hasIpv6: await hasGlobalIpv6(gateway.interfaceName),
          unavailableOutcome:
            chain.fallbacks.length > 0
              ? ('gateway' as const)
              : chain.failClosed
                ? ('block' as const)
                : ('direct' as const),
        };
      })
    ),

    rules: await Promise.all(
      rules.map(async (rule) => ({
        ...rule,
        clients: rule.clients.map((link) => link.client).filter(Boolean),
        // How many destinations the rule currently matches, including the ones
        // learned from DNS since the page was last open.
        addressCount: await countAddresses(rule.id),
      }))
    ),

    forwards: forwards.map((forward) => ({
      ...forward,
      // Whether the container publishes the outside port at all. A forward
      // outside the published ports is kept but not installed, and shown so.
      published: isForwardPortPublished(forward.externalPort),
    })),

    /**
     * Whether clients will actually reach the DNS proxy. Domain rules are
     * inert for any client resolving elsewhere, and nothing about that is
     * visible from the rule list itself.
     */
    dns: dnsStatus(wgInterface, userConfig, clients),

    /** Every client, for the rule and forward pickers. */
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      ipv4Address: client.ipv4Address,
      enabled: client.enabled,
    })),

    /** Interfaces that could still be registered as a gateway. */
    availableInterfaces: interfaces.filter(
      (entry) => !registered.has(entry.name)
    ),

    forwardPorts: {
      specs: ROUTER_ENV.FORWARD_PORTS,
      text: formatForwardPorts(ROUTER_ENV.FORWARD_PORTS),
    },
  };
}

/**
 * Links visible in this network namespace, for the gateway picker. A sidecar
 * wired up with `network_mode: "service:wg-easy"` shows up as soon as it
 * starts.
 */
export async function interfaces(actor: Actor) {
  authorize(actor, 'admin', 'any');
  const wgInterface = await getDatabase().interfaces.get();
  return listInterfaces([wgInterface.name]);
}

export async function updateConfig(
  actor: Actor,
  data: RoutingConfigUpdateType
) {
  authorize(actor, 'admin', 'any');
  await assertDefaultGateway(data);
  await getDatabase().routingConfig.update(data);
  await router.apply();
}

/**
 * Point newly issued client configs at the built-in DNS proxy. Only the
 * default changes: clients with their own resolver keep it, and configs
 * already on devices pick this up when downloaded again.
 */
export async function useDnsProxy(actor: Actor) {
  authorize(actor, 'admin', 'any');
  await commit(async (tx) => {
    const addresses = serverAddresses(await tx.interfaces.get());
    const defaultDns = WG_ENV.DISABLE_IPV6
      ? [addresses.ipv4]
      : [addresses.ipv4, addresses.ipv6];
    await tx.userConfigs.update({ defaultDns });
  });
}

export async function createGateway(actor: Actor, data: GatewayCreateType) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  const wgInterface = await database.interfaces.get();
  if (data.interfaceName === wgInterface.name) {
    throw createError({
      status: 400,
      statusText: `${wgInterface.name} carries this server's own clients and cannot be a gateway`,
    });
  }

  const result = await database.gateways.create(data);
  if ('error' in result) {
    throw createError({
      status: 409,
      statusText:
        result.error === 'exists'
          ? `${data.interfaceName} is already a gateway`
          : 'No more gateways can be added',
    });
  }

  await router.apply();
}

export async function updateGateway(
  actor: Actor,
  gatewayId: number,
  data: GatewayUpdateType
) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  if (!(await database.gateways.get(gatewayId))) {
    throw notFound('Gateway not found');
  }

  // The foreign key only guarantees the fallback exists. Pointing a gateway
  // at itself is a loop of length one, which the plan would tolerate by
  // dropping; better refused.
  if (data.fallbackGatewayId !== null) {
    if (data.fallbackGatewayId === gatewayId) {
      throw createError({
        status: 400,
        statusText: 'A gateway cannot fall back to itself',
      });
    }
    if (!(await database.gateways.get(data.fallbackGatewayId))) {
      throw notFound('Fallback gateway not found');
    }
  }

  await database.gateways.update(gatewayId, data);
  await router.apply();
}

export async function deleteGateway(actor: Actor, gatewayId: number) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  if (!(await database.gateways.get(gatewayId))) {
    throw notFound('Gateway not found');
  }

  // The foreign keys would refuse this anyway, but a bare constraint error
  // tells the reader nothing about which rules are in the way.
  const usage = await database.gateways.getUsage(gatewayId);
  if (
    usage.isDefault ||
    usage.rules.length > 0 ||
    usage.fallbackOf.length > 0
  ) {
    const holders = [
      ...(usage.isDefault ? ['the default action'] : []),
      ...usage.rules.map((rule) => `rule "${rule.name}"`),
      ...usage.fallbackOf.map((other) => `gateway "${other.name}"`),
    ];

    throw createError({
      status: 409,
      statusText: `Still used by ${holders.join(', ')}`,
      data: { rules: usage.rules, isDefault: usage.isDefault },
    });
  }

  await database.gateways.delete(gatewayId);
  await router.apply();
}

/**
 * Make a WireGuard gateway handshake anew, with the link left as it is and
 * the routes through it re-applied in the same step. Any other interface is
 * refused.
 *
 * @returns whether the far end answered in time; the reconnect happened
 * either way, so a silent peer is the caller's to show, not an error
 */
export async function reconnectGateway(actor: Actor, gatewayId: number) {
  authorize(actor, 'admin', 'any');
  const gateway = await getDatabase().gateways.get(gatewayId);
  if (!gateway) {
    throw notFound('Gateway not found');
  }

  try {
    return await router.reconnect(gateway.interfaceName);
  } catch {
    throw createError({
      status: 409,
      statusText: 'Interface is not a WireGuard link, or is gone',
    });
  }
}

export async function createRule(actor: Actor, data: RoutingRuleCreateType) {
  authorize(actor, 'admin', 'any');
  await assertRuleReferences(data);

  const database = getDatabase();
  const rule = await database.routingRules.create(data);
  await router.apply();

  // Resolve straight away rather than leave the rule empty until the
  // scheduler's next pass; a rule that matches nothing for the first half
  // minute reads as broken.
  if (rule.enabled && rule.autoResolve && rule.patterns.length > 0) {
    const config = await database.routingConfig.get();
    await router.resolve(rule.id, rule.patterns, config.dnsUpstreams);
  }
}

export async function updateRule(
  actor: Actor,
  ruleId: number,
  data: RoutingRuleUpdateType
) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  const rule = await database.routingRules.get(ruleId);
  if (!rule) {
    throw notFound('Rule not found');
  }

  await assertRuleReferences(data);

  await database.routingRules.update(ruleId, data);
  // Addresses dropped from the rule are removed from its sets by the apply
  // pass, which reconciles them against what the rule now says.
  await router.apply();

  // Resolve now when auto-resolve has just been switched on, or when the
  // domains changed while it was already on. Waiting for the scheduler would
  // leave the rule matching nothing for up to half a minute, which is
  // indistinguishable from it not working.
  const patternsChanged =
    JSON.stringify(rule.patterns) !== JSON.stringify(data.patterns);
  const shouldResolve =
    data.enabled &&
    data.autoResolve &&
    data.patterns.length > 0 &&
    (!rule.autoResolve || patternsChanged);

  if (shouldResolve) {
    const config = await database.routingConfig.get();
    await router.resolve(ruleId, data.patterns, config.dnsUpstreams);
  }
}

export async function deleteRule(actor: Actor, ruleId: number) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  if (!(await database.routingRules.get(ruleId))) {
    throw notFound('Rule not found');
  }

  await database.routingRules.delete(ruleId);
  // Apply first: the sets are still referenced by iptables until the chain is
  // rebuilt, and ipset refuses to destroy a set that is in use.
  await router.apply();
  await destroySets(ruleId);
}

/** Rule ids in the order they should be matched, most specific first. */
export async function reorderRules(actor: Actor, ids: readonly number[]) {
  authorize(actor, 'admin', 'any');
  await getDatabase().routingRules.reorder(ids);
  await router.apply();
}

/**
 * Resolve the rule's domains now. Returns what happened: a rule whose domains
 * all failed to resolve would otherwise look like one that worked.
 */
export async function resolveRule(actor: Actor, ruleId: number) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  const rule = await database.routingRules.get(ruleId);
  if (!rule) {
    throw notFound('Rule not found');
  }

  const config = await database.routingConfig.get();

  await ensureSets(ruleId);
  // No apply afterwards: the sets are already referenced by the live chain,
  // so new members take effect immediately.
  return router.resolve(ruleId, rule.patterns, config.dnsUpstreams);
}

/**
 * Forget every address the rule learned, for when a service moved. The apply
 * puts back the ones typed into the rule.
 */
export async function clearRule(actor: Actor, ruleId: number) {
  authorize(actor, 'admin', 'any');
  if (!(await getDatabase().routingRules.get(ruleId))) {
    throw notFound('Rule not found');
  }

  await flushSets(ruleId);
  await router.apply();
}

function forwardConflict(
  data: PortForwardCreateType,
  conflict: { name: string; protocol: string }
) {
  return createError({
    status: 409,
    statusText: `Port ${data.externalPort}/${conflict.protocol} is already forwarded by "${conflict.name}"`,
  });
}

export async function createForward(actor: Actor, data: PortForwardCreateType) {
  authorize(actor, 'admin', 'any');
  await assertForwardTarget(data);

  const result = await getDatabase().portForwards.create(data);
  if (result.conflict) {
    throw forwardConflict(data, result.conflict);
  }

  await router.apply();
}

export async function updateForward(
  actor: Actor,
  forwardId: number,
  data: PortForwardUpdateType
) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  if (!(await database.portForwards.get(forwardId))) {
    throw notFound('Forward not found');
  }

  await assertForwardTarget(data);

  const result = await database.portForwards.update(forwardId, data);
  if (result.conflict) {
    throw forwardConflict(data, result.conflict);
  }

  await router.apply();
}

export async function deleteForward(actor: Actor, forwardId: number) {
  authorize(actor, 'admin', 'any');
  const database = getDatabase();
  if (!(await database.portForwards.get(forwardId))) {
    throw notFound('Forward not found');
  }

  await database.portForwards.delete(forwardId);
  await router.apply();
}
