import { parseCidr } from 'cidr-tools';
import { stringifyIp } from 'ip-bigint';
import { isIP } from 'is-ip';
import isCidr from 'is-cidr';
import { createDebug } from 'obug';

import { setName } from './marks';

import { exec } from '#server/utils/cmd';
import type { ID } from '#server/utils/types';

const ROUTER_DEBUG = createDebug('Router');

/**
 * Members a set may hold. The ipset default is 65536, which a rule matching
 * `*` or a broad wildcard reaches through ordinary browsing; past it, adds are
 * refused.
 */
const MAX_ELEMENTS = 262144;

/**
 * `ipset list` prints one line per member, counters included, so a large set
 * runs past Node's default 1 MiB child-process buffer and the read fails as
 * though the set were empty. Sized for {@link MAX_ELEMENTS} at ~64 bytes each.
 */
const LIST_BUFFER = 32 * 1024 * 1024;

export type Canonical = {
  address: string;
  family: 4 | 6;
  /** `true` for `0.0.0.0/0` and `::/0` in any spelling. */
  catchAll: boolean;
};

/**
 * Write an address the way ipset prints it back: host prefix dropped
 * (`1.2.3.4/32` to `1.2.3.4`), host bits cleared (`10.0.0.1/8` to
 * `10.0.0.0/8`), IPv6 compressed. A value typed into a rule then compares
 * equal to the same value read back from the kernel.
 */
export function canonical(entry: string): Canonical | null {
  const value = entry.trim();
  if (!isIP(value) && isCidr(value) === 0) return null;

  const cidr = parseCidr(value);
  const family = cidr.version;
  const prefix = Number(cidr.prefix);
  const network = stringifyIp({ number: cidr.start, version: family });
  const full = family === 4 ? 32 : 128;

  return {
    address: prefix === full ? network : `${network}/${prefix}`,
    family,
    catchAll: prefix === 0,
  };
}

/** Idempotent teardown: nothing to remove is the normal case, not a failure. */
async function quiet(command: string) {
  await exec(`${command} 2>/dev/null || true`, { log: false });
}

/**
 * Create both of a rule's sets if missing. `counters` is what makes expiry
 * traffic-aware: the traffic pass reads per-entry packet counts.
 */
export async function ensureSets(ruleId: ID) {
  for (const [family, inet] of [
    [4, 'inet'],
    [6, 'inet6'],
  ] as const) {
    await quiet(
      `ipset create ${setName(ruleId, family)} hash:net family ${inet} counters timeout 0 maxelem ${MAX_ELEMENTS}`
    );
  }
}

/**
 * @param timeout seconds until the address expires; 0 never expires, which is
 * what hand-entered addresses get
 */
export async function addAddress(ruleId: ID, address: string, timeout = 0) {
  const entry = canonical(address);
  if (!entry) {
    ROUTER_DEBUG(`Rule ${ruleId}: ignoring unparsable address ${address}`);
    return;
  }
  // Catch-alls are matched without a set: `hash:net` rejects a zero-length
  // prefix on many kernels.
  if (entry.catchAll) return;

  const expiry = timeout > 0 ? ` timeout ${timeout}` : '';
  try {
    // Not quieted: a refused add (set full, bad timeout) is a real failure that
    // leaves the rule matching less than it claims to.
    await exec(
      `ipset add ${setName(ruleId, entry.family)} ${entry.address}${expiry} -exist`,
      { log: false }
    );
  } catch (error) {
    ROUTER_DEBUG(`Rule ${ruleId}: could not add ${entry.address}:`, error);
  }
}

export async function removeAddress(ruleId: ID, address: string) {
  const entry = canonical(address);
  if (!entry || entry.catchAll) return;

  await quiet(
    `ipset del ${setName(ruleId, entry.family)} ${entry.address} -exist`
  );
}

/** Drop every address a rule has learned, keeping the sets themselves. */
export async function flushSets(ruleId: ID) {
  for (const family of [4, 6] as const) {
    await quiet(`ipset flush ${setName(ruleId, family)}`);
  }
}

export async function destroySets(ruleId: ID) {
  for (const family of [4, 6] as const) {
    await quiet(`ipset destroy ${setName(ruleId, family)}`);
  }
}

export type SetEntry = {
  address: string;
  /**
   * Seconds left before the entry expires; zero marks a permanent entry, one
   * typed into a rule rather than learned from DNS.
   */
  timeout: number;
  /** Packets matched since the entry was added; drives traffic-aware expiry. */
  packets: number;
};

// `10.0.0.0/8 timeout 280 packets 145 bytes 12840`
const ENTRY = /^(\S+)(?:\s+timeout\s+(\d+))?(?:\s+packets\s+(\d+))?/;

async function listSet(name: string): Promise<SetEntry[]> {
  let output: string;
  try {
    output = await exec(`ipset list ${name}`, {
      log: false,
      maxBuffer: LIST_BUFFER,
    });
  } catch {
    return []; // set not created yet
  }

  const lines = output.split('\n').map((line) => line.trim());
  const start = lines.indexOf('Members:');
  if (start === -1) return [];

  const entries: SetEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) continue;
    const match = ENTRY.exec(line);
    if (!match?.[1]) continue;
    entries.push({
      address: match[1],
      timeout: Number(match[2] ?? 0),
      packets: Number(match[3] ?? 0),
    });
  }
  return entries;
}

/** Everything a rule currently matches, across both families. */
export async function listAddresses(ruleId: ID): Promise<SetEntry[]> {
  const [v4, v6] = await Promise.all([
    listSet(setName(ruleId, 4)),
    listSet(setName(ruleId, 6)),
  ]);
  return [...v4, ...v6];
}

export async function countAddresses(ruleId: ID) {
  return (await listAddresses(ruleId)).length;
}

const OWNED_SET = /^wgr[46]_(\d+)$/;

/**
 * Destroy sets left behind by rules that no longer exist, e.g. deleted while
 * the app was down. Only sets matching our naming scheme are touched. Must
 * run after the chains referencing the sets have been rebuilt, since the
 * kernel refuses to destroy a set still in use.
 */
export async function destroyOrphanSets(liveRuleIds: readonly ID[]) {
  let output: string;
  try {
    output = await exec('ipset list -name', { log: false });
  } catch {
    return;
  }

  const live = new Set(liveRuleIds);

  for (const name of output.split('\n').map((line) => line.trim())) {
    const match = OWNED_SET.exec(name);
    if (!match?.[1]) continue;
    if (live.has(Number(match[1]))) continue;

    ROUTER_DEBUG(`Destroying orphaned set ${name}`);
    await quiet(`ipset destroy ${name}`);
  }
}
