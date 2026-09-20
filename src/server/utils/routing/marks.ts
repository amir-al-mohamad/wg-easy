/**
 * Packet marks and routing tables owned by the policy router.
 *
 * Everything here ends up in `ip rule` and iptables state that is rebuilt on
 * each change, so the numbers only have to avoid colliding with whatever else
 * lives in this network namespace:
 *
 * - wg-quick allocates a mark and table only for a peer carrying a default
 *   route in `AllowedIPs`, which never happens server-side, and its rules sit
 *   at priority 32764+.
 * - The tunnel clients this feature is built around (sing-box, mihomo, xray
 *   with a TUN, tun2socks) either do no policy routing at all, or default to
 *   table and mark 2022 with `auto_route`. Nothing here overlaps that.
 *
 * A sidecar configured to use a table in 100–251 or a rule priority in 100–252
 * will be trampled by every apply. That is the one assumption this file makes.
 */

/** Marks steering traffic into a gateway's routing table. */
export const GATEWAY_MARK_MIN = 0x100;
export const GATEWAY_MARK_MAX = 0x1ff;

/** Routing tables owned by gateways, one default route each. */
export const GATEWAY_TABLE_MIN = 100;
export const GATEWAY_TABLE_MAX = 250;

/** Explicitly routed around every gateway, through the main table. */
export const MARK_DIRECT = '0xddd';

/**
 * Discarded traffic, steered into {@link BLOCK_TABLE} (a single blackhole
 * route) rather than dropped in FORWARD: the client firewall inserts its own
 * jump at the head of FORWARD on every rebuild and ACCEPTs inside it, so an
 * appended DROP would never run.
 */
export const MARK_BLOCK = '0xbbb';
export const BLOCK_TABLE = 251;

/**
 * Only the low sixteen bits of the packet mark are ours. Matching and setting
 * through this mask leaves anything another subsystem keeps in the high bits
 * untouched.
 */
export const MARK_MASK = '0xffff';

/**
 * The `ip rule` priorities this feature may install: one per possible
 * gateway, then direct and block. A gateway's rule sits at the priority equal
 * to its table number, so it reads the same on every apply and can be left
 * untouched. Every apply sweeps this whole band.
 */
export const RULE_PRIORITY_MIN = GATEWAY_TABLE_MIN;
export const RULE_PRIORITY_DIRECT = GATEWAY_TABLE_MAX + 1;
export const RULE_PRIORITY_BLOCK = GATEWAY_TABLE_MAX + 2;
export const RULE_PRIORITY_MAX = RULE_PRIORITY_BLOCK;

/**
 * Connection mark on inbound DNAT'd connections, so their replies bypass
 * policy; see the forwards section of the plan.
 */
export const FORWARD_CONNMARK = '0xfff';

/**
 * Name of the address set holding one rule's destinations for one family.
 * ipset caps names at 31 characters; `wgr4_` plus an id stays well inside.
 */
export function setName(ruleId: number, family: 4 | 6) {
  return `wgr${family}_${ruleId}`;
}

export type Allocation = { fwmark: string; routeTable: number };

function firstFree(min: number, max: number, used: Set<number>) {
  for (let candidate = min; candidate <= max; candidate++) {
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Pick the lowest free mark and routing table. Gaps left by deleted gateways
 * are reused, or an install that churns gateways would exhaust the range.
 *
 * @throws when either range is full
 */
export function allocate(taken: readonly Allocation[]): Allocation {
  const usedMarks = new Set(
    taken.map((entry) => Number.parseInt(entry.fwmark, 16))
  );
  const usedTables = new Set(taken.map((entry) => entry.routeTable));

  const mark = firstFree(GATEWAY_MARK_MIN, GATEWAY_MARK_MAX, usedMarks);
  if (mark === null) {
    throw new Error('No free packet mark available for a new gateway');
  }

  const table = firstFree(GATEWAY_TABLE_MIN, GATEWAY_TABLE_MAX, usedTables);
  if (table === null) {
    throw new Error('No free routing table available for a new gateway');
  }

  return { fwmark: `0x${mark.toString(16)}`, routeTable: table };
}

/** Whether another gateway can still be allocated. */
export function hasCapacity(taken: readonly Allocation[]) {
  return taken.length < GATEWAY_TABLE_MAX - GATEWAY_TABLE_MIN + 1;
}
