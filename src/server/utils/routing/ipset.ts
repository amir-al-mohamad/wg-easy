import { createDebug } from 'obug';

import { setName } from './marks';

import { exec } from '#server/utils/cmd';
import type { ID } from '#shared/contracts/validation';
import { canonical } from '#shared/utils/address';

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

/** Idempotent teardown: nothing to remove is the normal case, not a failure. */
async function quiet(command: string) {
  await exec(`${command} 2>/dev/null || true`, { log: false });
}

/**
 * Feed lines to `ipset restore` in one process. It stops at the first line it
 * refuses (a full set, a timeout out of range), so on failure the lines are
 * applied one by one, and a refused entry costs only itself.
 */
async function restore(lines: readonly string[]) {
  if (lines.length === 0) {
    return;
  }
  try {
    await exec('ipset -exist restore', {
      log: false,
      input: `${lines.join('\n')}\n`,
    });
  } catch {
    for (const line of lines) {
      try {
        await exec(`ipset -exist ${line}`, { log: false });
      } catch (error) {
        // Not quieted: a refused add leaves the rule matching less than it
        // claims to.
        ROUTER_DEBUG(`ipset refused "${line}":`, error);
      }
    }
  }
}

/**
 * Create the sets of these rules if missing. `counters` is what makes expiry
 * traffic-aware: the traffic pass reads per-entry packet counts.
 */
export async function ensureSets(ruleIds: readonly ID[]) {
  await restore(
    ruleIds.flatMap((ruleId) =>
      (
        [
          [4, 'inet'],
          [6, 'inet6'],
        ] as const
      ).map(
        ([family, inet]) =>
          `create ${setName(ruleId, family)} hash:net family ${inet} counters timeout 0 maxelem ${MAX_ELEMENTS}`
      )
    )
  );
}

/**
 * A change to one rule's sets. A `timeout` in seconds makes the address
 * expire; 0 or none keeps it, which is what hand-entered addresses get.
 */
export type SetChange =
  | { op: 'add'; ruleId: ID; address: string; timeout?: number }
  | { op: 'del'; ruleId: ID; address: string };

/**
 * The `ipset restore` lines for a batch of changes, each in the set of its
 * family. Catch-alls are left out: they are matched without a set, because
 * `hash:net` rejects a zero-length prefix on many kernels.
 */
export function setLines(changes: readonly SetChange[]) {
  const lines: string[] = [];
  for (const change of changes) {
    const entry = canonical(change.address);
    if (!entry) {
      ROUTER_DEBUG(
        `Rule ${change.ruleId}: ignoring unparsable address ${change.address}`
      );
      continue;
    }
    if (entry.catchAll) {
      continue;
    }

    const set = setName(change.ruleId, entry.family);
    if (change.op === 'del') {
      lines.push(`del ${set} ${entry.address}`);
    } else {
      const timeout = change.timeout ?? 0;
      lines.push(
        `add ${set} ${entry.address}${timeout > 0 ? ` timeout ${timeout}` : ''}`
      );
    }
  }
  return lines;
}

/** Apply a batch of changes, across any number of rules, in one process. */
export async function changeSets(changes: readonly SetChange[]) {
  await restore(setLines(changes));
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
  if (start === -1) {
    return [];
  }

  const entries: SetEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) {
      continue;
    }
    const match = ENTRY.exec(line);
    if (!match?.[1]) {
      continue;
    }
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

const OWNED_SET = /^wgr[46]_(\d+)$/;

/**
 * Entries per rule, both families together, from the headers `ipset list -t`
 * prints: the count without the members.
 */
export function parseCounts(output: string) {
  const counts = new Map<ID, number>();
  let rule: ID | null = null;

  for (const line of output.split('\n').map((entry) => entry.trim())) {
    if (line.startsWith('Name: ')) {
      const match = OWNED_SET.exec(line.slice('Name: '.length));
      rule = match ? Number(match[1]) : null;
    } else if (rule !== null && line.startsWith('Number of entries: ')) {
      const count = Number(line.slice('Number of entries: '.length));
      counts.set(rule, (counts.get(rule) ?? 0) + count);
    }
  }
  return counts;
}

/** How many destinations each rule currently matches, in one read. */
export async function countAddresses() {
  try {
    return parseCounts(await exec('ipset list -t', { log: false }));
  } catch {
    return new Map<ID, number>();
  }
}

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
    if (!match?.[1]) {
      continue;
    }
    if (live.has(Number(match[1]))) {
      continue;
    }

    ROUTER_DEBUG(`Destroying orphaned set ${name}`);
    await quiet(`ipset destroy ${name}`);
  }
}
