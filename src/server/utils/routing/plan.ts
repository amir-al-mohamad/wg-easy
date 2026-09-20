import {
  BLOCK_TABLE,
  FORWARD_CONNMARK,
  GATEWAY_TABLE_MAX,
  GATEWAY_TABLE_MIN,
  MARK_BLOCK,
  MARK_DIRECT,
  MARK_MASK,
  RULE_PRIORITY_BLOCK,
  RULE_PRIORITY_DIRECT,
  setName,
} from './marks';

/**
 * Turns routing state into the list of commands that realizes it. Kept free
 * of I/O so the commands and their order can be asserted in tests.
 */

/** Chains this feature owns. Torn down and rebuilt whole on every change. */
export const CHAIN_MANGLE = 'WG_ROUTER';
export const CHAIN_MSS = 'WG_ROUTER_MSS';
export const CHAIN_NAT = 'WG_ROUTER_NAT';
export const CHAIN_FORWARD = 'WG_ROUTER_FWD';

export type PlanForward = {
  externalPort: number;
  internalPort: number;
  /** `both` is expanded by the caller into the two concrete protocols. */
  protocols: readonly ('tcp' | 'udp')[];
  clientIpv4: string | null;
  clientIpv6: string | null;
};

export type PlanGateway = {
  interfaceName: string;
  fwmark: string;
  routeTable: number;
  /** The interface is up. Without it the table falls back to its standing route. */
  present: boolean;
  /**
   * The interface has a routable IPv6 address. The kernel accepts an IPv6
   * default route through an interface without one and then sources the
   * packets from its link-local address, which the far end silently drops.
   */
  hasIpv6: boolean;
  /** Gateways to fall through to, in order, at the metrics after the device route. */
  fallbacks: PlanHop[];
  /**
   * Whether the standing route behind the chain is a blackhole (drop) or a
   * throw (continue in the main table, i.e. go direct).
   */
  failClosed: boolean;
  /**
   * Metrics of the default routes the table currently holds, per family, so
   * slots a shorter chain no longer uses can be cleared.
   */
  installedMetrics: { v4: number[]; v6: number[] };
};

/** One link in a gateway's chain: the gateway itself, or a fallback. */
export type PlanHop = Pick<
  PlanGateway,
  'interfaceName' | 'present' | 'hasIpv6'
>;

// Hop k of a chain sits at metric HOP_METRIC + k, the standing route that ends
// the chain at TERMINAL_METRIC.
const HOP_METRIC = 100;
const TERMINAL_METRIC = 200;
export const MAX_FALLBACKS = 8;

export type PlanClient = { ipv4: string | null; ipv6: string | null };

export type PlanRule = {
  id: number;
  /** Mark applied to traffic this rule matches. */
  fwmark: string;
  /** Clients the rule is scoped to; empty means every client. */
  clients: PlanClient[];
  /** Rule carries `0.0.0.0/0`: match every v4 destination, with no set lookup. */
  matchAllV4: boolean;
  /** Rule carries `::/0`. */
  matchAllV6: boolean;
};

/** An `ip rule` of ours found installed, identified well enough to delete it. */
export type InstalledRule = {
  priority: number;
  fwmark: string;
  table: string;
};

export type Plan = {
  /** The interface wg-easy's own clients connect on. */
  wgInterface: string;
  enableIpv6: boolean;
  /** Subnets local to {@link Plan.wgInterface}; client-to-client traffic stays here. */
  localSubnets: { v4: string[]; v6: string[] };
  gateways: PlanGateway[];
  /** In match order. */
  rules: PlanRule[];
  /** Inbound port forwards, enabled ones only. */
  forwards: PlanForward[];
  /**
   * Forwards an earlier apply installed and this one does not, or not the
   * same way. Their tracked connections are ended; the kernel would otherwise
   * keep translating them whatever the rules now say.
   */
  staleForwards: PlanForward[];
  /** Mark for traffic no rule matched, or null to leave it to the main table. */
  defaultFwmark: string | null;
  /** Our rules found installed. Those still wanted are kept, the rest removed last. */
  installedRules: { v4: InstalledRule[]; v6: InstalledRule[] };
};

type Family = {
  iptables: 'iptables' | 'ip6tables';
  ip: 'ip -4' | 'ip -6';
  v6: boolean;
};

const V4: Family = { iptables: 'iptables', ip: 'ip -4', v6: false };
const V6: Family = { iptables: 'ip6tables', ip: 'ip -6', v6: true };

/** Commands allowed to fail: there was nothing to remove. */
export function isTeardown(command: string) {
  return command.endsWith('|| true');
}

function quiet(command: string) {
  return `${command} 2>/dev/null || true`;
}

/**
 * Remove every instance of a rule. `iptables -D` and `ip rule del` remove a
 * single match, and duplicates left by an interrupted apply would otherwise
 * never be caught up with.
 */
function removeAll(command: string) {
  return quiet(`while ${command} 2>/dev/null; do :; done`);
}

/**
 * Tear a chain down and put it back, attached to `parent` at `match`. The
 * detach uses the exact jump specification of the attach: `iptables -D` only
 * removes an exact match, and a drifted detach would leave a new jump appended
 * on every apply.
 */
function rebuildChain(
  out: string[],
  family: Family,
  table: string,
  chain: string,
  parent: string,
  match = ''
) {
  const ipt = `${family.iptables} -t ${table}`;
  const jump = `${parent}${match} -j ${chain}`;
  out.push(removeAll(`${ipt} -D ${jump}`));
  out.push(quiet(`${ipt} -F ${chain}`));
  out.push(quiet(`${ipt} -X ${chain}`));
  out.push(`${ipt} -N ${chain}`);
  out.push(`${ipt} -A ${jump}`);
}

function removeChain(
  out: string[],
  family: Family,
  table: string,
  chain: string,
  parent: string,
  match = ''
) {
  const ipt = `${family.iptables} -t ${table}`;
  out.push(removeAll(`${ipt} -D ${parent}${match} -j ${chain}`));
  out.push(quiet(`${ipt} -F ${chain}`));
  out.push(quiet(`${ipt} -X ${chain}`));
}

/** The rule steering one mark into one table, as `ip rule list` prints it. */
function wanted(priority: number, mark: string, table: string): InstalledRule {
  return { priority, fwmark: `${mark}/${MARK_MASK}`, table };
}

/** Every rule the plan needs installed. The same for both families. */
function wantedRules(plan: Plan): InstalledRule[] {
  return [
    ...plan.gateways.map((gateway) =>
      wanted(gateway.routeTable, gateway.fwmark, String(gateway.routeTable))
    ),
    wanted(RULE_PRIORITY_DIRECT, MARK_DIRECT, 'main'),
    wanted(RULE_PRIORITY_BLOCK, MARK_BLOCK, String(BLOCK_TABLE)),
  ];
}

function ruleKey(rule: InstalledRule) {
  return `${rule.priority} ${rule.fwmark} ${rule.table}`;
}

function ruleAdd(family: Family, rule: InstalledRule) {
  return `${family.ip} rule add fwmark ${rule.fwmark} priority ${rule.priority} table ${rule.table}`;
}

/** Whether a table is one of the gateway tables, and so ours to empty. */
function isGatewayTable(table: string) {
  const number = Number(table);
  return (
    Number.isInteger(number) &&
    number >= GATEWAY_TABLE_MIN &&
    number <= GATEWAY_TABLE_MAX
  );
}

/**
 * Remove installed rules not in `keep`, and empty the gateway tables nothing
 * kept points at. Deleted by full specification, never by bare priority, since
 * another process may own a rule at the same preference. A table is emptied
 * only after its rule is gone, or traffic would briefly fall through to main.
 */
function removeStaleRules(
  out: string[],
  plan: Plan,
  families: Family[],
  keep: readonly InstalledRule[]
) {
  const kept = new Set(keep.map(ruleKey));
  const keptTables = new Set(keep.map((rule) => rule.table));

  for (const family of families) {
    const installed = family.v6
      ? plan.installedRules.v6
      : plan.installedRules.v4;
    for (const rule of installed) {
      if (kept.has(ruleKey(rule))) continue;

      out.push(
        removeAll(
          `${family.ip} rule del priority ${rule.priority} fwmark ${rule.fwmark} table ${rule.table}`
        )
      );
      if (isGatewayTable(rule.table) && !keptTables.has(rule.table)) {
        out.push(quiet(`${family.ip} route flush table ${rule.table}`));
      }
    }
  }
}

/** Nothing to route: the feature is configured but unused. */
export function isEmpty(plan: Plan) {
  return (
    plan.gateways.length === 0 &&
    plan.rules.length === 0 &&
    plan.forwards.length === 0 &&
    plan.defaultFwmark === null
  );
}

/**
 * Remove everything this feature installs, so an install that never uses it
 * carries none of its chains, rules or tables.
 */
function buildTeardown(plan: Plan): string[] {
  const out: string[] = [];
  const families: Family[] = plan.enableIpv6 ? [V4, V6] : [V4];

  // Chains first, so nothing is still being marked when the rules those marks
  // selected go away.
  for (const family of families) {
    removeChain(
      out,
      family,
      'mangle',
      CHAIN_MANGLE,
      'PREROUTING',
      ` -i ${plan.wgInterface}`
    );
    removeChain(out, family, 'mangle', CHAIN_MSS, 'FORWARD');
    removeChain(out, family, 'nat', CHAIN_NAT, 'POSTROUTING');
    removeChain(out, family, 'nat', CHAIN_FORWARD, 'PREROUTING');
  }

  // Which gateway tables were in use is known only from the rules found
  // installed: the gateways themselves are gone from the plan by now.
  removeStaleRules(out, plan, families, []);

  for (const family of families) {
    out.push(quiet(`${family.ip} route flush table ${BLOCK_TABLE}`));
    endForwardConnections(out, family, plan.staleForwards);
  }

  return out;
}

/**
 * Build the command list that makes the kernel match `plan`.
 *
 * 1. Routing tables and `ip rule`s first, in place: routes are replaced
 *    rather than flushed, and rules already installed as wanted are left
 *    alone, so traffic keeps flowing throughout. Rules no longer wanted go
 *    last, once the chains stop producing their marks.
 * 2. Chains are recreated rather than edited, the same brief window
 *    `firewall.ts` accepts for its own rebuilds.
 * 3. In the mangle chain, traffic that must never be redirected returns
 *    first: replies to forwarded connections, then client-to-client traffic.
 * 4. Rules are emitted in match order, each guarded by `--mark 0x0`, so the
 *    first match wins; without the guard a later `-j MARK` overwrites it.
 */
export function buildPlan(plan: Plan): string[] {
  if (isEmpty(plan)) return buildTeardown(plan);

  const out: string[] = [];
  const families: Family[] = plan.enableIpv6 ? [V4, V6] : [V4];

  /** Can this link actually carry traffic of this family right now? */
  const usable = (link: PlanHop, family: Family) =>
    link.present && (family.v6 ? link.hasIpv6 : true);

  const keep = wantedRules(plan);

  // 1. Routing tables, and the rules into them
  for (const family of families) {
    const installed = new Set(
      (family.v6 ? plan.installedRules.v6 : plan.installedRules.v4).map(ruleKey)
    );

    for (const gateway of plan.gateways) {
      const table = gateway.routeTable;
      const installedMetrics = family.v6
        ? gateway.installedMetrics.v6
        : gateway.installedMetrics.v4;

      // Behind the route through the interface sit the fallback gateways and
      // then a standing route that ends the chain, each at a worse metric.
      // When the kernel drops the route along with the interface, the next
      // in line takes over, so what happens between applies is a choice and
      // not an accidental fall-through to main. The chain ends in a blackhole
      // by default: a rule saying "through the VPN" must not leak onto the
      // open internet. A gateway set to "send direct" gets a throw instead,
      // which continues the lookup in main. Routes are replaced in place so
      // the table is never empty, not even briefly.
      out.push(
        `${family.ip} route replace ${gateway.failClosed ? 'blackhole' : 'throw'} default table ${table} metric ${TERMINAL_METRIC}`
      );

      const chain: PlanHop[] = [gateway, ...gateway.fallbacks];
      const wantedMetrics = new Set([TERMINAL_METRIC]);
      chain.forEach((link, index) => {
        const metric = HOP_METRIC + index;
        wantedMetrics.add(metric);
        out.push(
          usable(link, family)
            ? `${family.ip} route replace default dev ${link.interfaceName} table ${table} metric ${metric}`
            : quiet(
                `${family.ip} route del default table ${table} metric ${metric}`
              )
        );
      });

      // Slots a shorter chain no longer uses, deleted by metric alone.
      for (const metric of installedMetrics) {
        if (wantedMetrics.has(metric)) continue;
        out.push(
          quiet(
            `${family.ip} route del default table ${table} metric ${metric}`
          )
        );
      }
    }

    // Blocking is a blackhole route rather than a FORWARD drop: the client
    // firewall inserts its own jump at the head of FORWARD on every rebuild
    // and ACCEPTs inside it, so an appended DROP would never run.
    out.push(
      `${family.ip} route replace blackhole default table ${BLOCK_TABLE}`
    );

    for (const rule of keep) {
      if (!installed.has(ruleKey(rule))) out.push(ruleAdd(family, rule));
    }
  }

  // 2. Mangle chain: classify client traffic
  for (const family of families) {
    const ipt = `${family.iptables} -t mangle`;
    rebuildChain(
      out,
      family,
      'mangle',
      CHAIN_MANGLE,
      'PREROUTING',
      ` -i ${plan.wgInterface}`
    );

    // Replies to an inbound forward carry its connection mark and have to go
    // back the way the request came, not out a gateway.
    out.push(
      `${ipt} -A ${CHAIN_MANGLE} -m connmark --mark ${FORWARD_CONNMARK}/${FORWARD_CONNMARK} -j RETURN`
    );

    // Client-to-client traffic never leaves the interface it arrived on;
    // without this a default action of `block` would sever clients from
    // each other.
    const subnets = family.v6 ? plan.localSubnets.v6 : plan.localSubnets.v4;
    for (const subnet of subnets) {
      out.push(`${ipt} -A ${CHAIN_MANGLE} -d ${subnet} -j RETURN`);
    }

    for (const rule of plan.rules) {
      const matchAll = family.v6 ? rule.matchAllV6 : rule.matchAllV4;
      const destination = matchAll
        ? ''
        : ` -m set --match-set ${setName(rule.id, family.v6 ? 6 : 4)} dst`;

      const sources = rule.clients.length
        ? rule.clients
            .map((client) => (family.v6 ? client.ipv6 : client.ipv4))
            .filter((address): address is string => Boolean(address))
            .map((address) => ` -s ${address}`)
        : [''];

      for (const source of sources) {
        out.push(
          `${ipt} -A ${CHAIN_MANGLE} -m mark --mark 0x0/${MARK_MASK}${source}${destination} -j MARK --set-xmark ${rule.fwmark}/${MARK_MASK}`
        );
      }
    }

    if (plan.defaultFwmark) {
      out.push(
        `${ipt} -A ${CHAIN_MANGLE} -m mark --mark 0x0/${MARK_MASK} -j MARK --set-xmark ${plan.defaultFwmark}/${MARK_MASK}`
      );
    }
  }

  // 3. Clamp MSS on every gateway. A tunnel inside a tunnel leaves little
  // room for payload; without clamping, full-size TCP segments are dropped
  // and transfers stall.
  for (const family of families) {
    const ipt = `${family.iptables} -t mangle`;
    rebuildChain(out, family, 'mangle', CHAIN_MSS, 'FORWARD');

    for (const gateway of plan.gateways) {
      if (!usable(gateway, family)) continue;
      out.push(
        `${ipt} -A ${CHAIN_MSS} -o ${gateway.interfaceName} -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu`
      );
    }
  }

  // 4. Masquerade out of every gateway. The PostUp hook only masquerades
  // traffic leaving by the host uplink; packets redirected into a gateway
  // would otherwise carry a client's tunnel address and get no reply.
  for (const family of families) {
    const ipt = `${family.iptables} -t nat`;
    rebuildChain(out, family, 'nat', CHAIN_NAT, 'POSTROUTING');

    for (const gateway of plan.gateways) {
      if (!usable(gateway, family)) continue;
      out.push(
        `${ipt} -A ${CHAIN_NAT} -o ${gateway.interfaceName} -j MASQUERADE`
      );
    }
  }

  // 5. Inbound port forwards
  for (const family of families) {
    const ipt = `${family.iptables} -t nat`;
    rebuildChain(out, family, 'nat', CHAIN_FORWARD, 'PREROUTING');

    // Only traffic that arrived from outside is eligible. Without these guards
    // a client connecting to any host on a forwarded port would be DNAT'd to
    // the forward's target, and packets arriving through a gateway would reach
    // client ports the published list was meant to gate.
    out.push(`${ipt} -A ${CHAIN_FORWARD} -i ${plan.wgInterface} -j RETURN`);
    for (const gateway of plan.gateways) {
      out.push(
        `${ipt} -A ${CHAIN_FORWARD} -i ${gateway.interfaceName} -j RETURN`
      );
    }

    // Two rules per protocol. The CONNMARK comes first and is what lets the
    // mangle chain recognise the replies; without it a default action of
    // "through a gateway" would send them out the tunnel.
    for (const forward of plan.forwards) {
      const address = family.v6 ? forward.clientIpv6 : forward.clientIpv4;
      if (!address) continue;

      const destination = family.v6
        ? `[${address}]:${forward.internalPort}`
        : `${address}:${forward.internalPort}`;

      for (const protocol of forward.protocols) {
        const match = ` -p ${protocol} --dport ${forward.externalPort}`;
        out.push(
          `${ipt} -A ${CHAIN_FORWARD}${match} -j CONNMARK --set-xmark ${FORWARD_CONNMARK}/${FORWARD_CONNMARK}`
        );
        out.push(
          `${ipt} -A ${CHAIN_FORWARD}${match} -j DNAT --to-destination ${destination}`
        );
      }
    }
  }

  // 6. Connections through forwards this apply no longer has. After the chain
  // rebuild, so the old rule cannot re-create them on the next packet.
  for (const family of families) {
    endForwardConnections(out, family, plan.staleForwards);
  }

  // 7. Rules an earlier apply installed that this one no longer wants. Only
  // now, once the chains no longer produce the marks these matched.
  removeStaleRules(out, plan, families, keep);

  return out;
}

/**
 * The parts of `before` that `after` does not repeat, per protocol. Any
 * change counts, not just removal: a forward pointed at a new client would
 * otherwise keep translating the old client's sessions until they end.
 */
export function staleForwards(
  before: readonly PlanForward[],
  after: readonly PlanForward[]
): PlanForward[] {
  const key = (forward: PlanForward, protocol: string) =>
    `${protocol}:${forward.externalPort}>${forward.clientIpv4}|${forward.clientIpv6}:${forward.internalPort}`;

  const kept = new Set(
    after.flatMap((forward) =>
      forward.protocols.map((protocol) => key(forward, protocol))
    )
  );

  return before
    .map((forward) => ({
      ...forward,
      protocols: forward.protocols.filter(
        (protocol) => !kept.has(key(forward, protocol))
      ),
    }))
    .filter((forward) => forward.protocols.length > 0);
}

/**
 * End the tracked connections a forward created. Only those: the connection
 * mark set alongside the DNAT tells them from a client's own connection to
 * the same port elsewhere, whose NAT mapping must not be broken. Quiet,
 * because there is usually nothing to delete and the tool may be missing on
 * an older image.
 */
function endForwardConnections(
  out: string[],
  family: Family,
  forwards: readonly PlanForward[]
) {
  const conntrack = `conntrack -f ${family.v6 ? 'ipv6' : 'ipv4'} -D`;

  for (const forward of forwards) {
    if (!(family.v6 ? forward.clientIpv6 : forward.clientIpv4)) continue;

    for (const protocol of forward.protocols) {
      out.push(
        quiet(
          `${conntrack} -p ${protocol} --orig-port-dst ${forward.externalPort} -m ${FORWARD_CONNMARK}/${FORWARD_CONNMARK}`
        )
      );
    }
  }
}
