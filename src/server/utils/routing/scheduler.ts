import { createDebug } from 'obug';

import { applyRouting, presenceChanged } from './apply';
import { addAddress, listAddresses } from './ipset';
import { withRoutingLock } from './lock';
import { resolveRule } from './resolve';

import Database from '#server/utils/Database';
import type { ID } from '#server/utils/types';
import { setIntervalImmediately } from '#shared/utils/time';

const ROUTER_DEBUG = createDebug('Router');

/** How often the re-resolve pass looks for rules about to go stale. */
const RESOLVE_TICK_MS = 30_000;

/** How often per-address packet counters are compared. */
const TRAFFIC_TICK_MS = 60_000;

/** Re-resolve once an address is this close to expiring, so the replacement is in place first. */
const REFRESH_WINDOW_SECONDS = 60;

/** Never re-resolve the same rule more often than this; addresses are floored at five minutes anyway. */
const MIN_GAP_SECONDS = 240;

/** Life an address is guaranteed while it is still carrying traffic. */
const EXTEND_SECONDS = 300;

const lastResolveAt = new Map<ID, number>();
const lastPacketCount = new Map<ID, Map<string, number>>();

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Whether a rule needs resolving again, read from the sets themselves: the
 * kernel is the truth, and it survives a restart of this process.
 */
async function needsResolve(ruleId: ID) {
  const since = now() - (lastResolveAt.get(ruleId) ?? 0);
  if (since < MIN_GAP_SECONDS) return false;

  const entries = await listAddresses(ruleId);
  const learned = entries.filter((entry) => entry.timeout > 0);

  // Nothing learned yet: either brand new, or everything already expired.
  if (learned.length === 0) return true;

  const soonest = learned.reduce(
    (min, entry) => Math.min(min, entry.timeout),
    Number.POSITIVE_INFINITY
  );
  return soonest <= REFRESH_WINDOW_SECONDS;
}

async function resolvePass() {
  const [rules, config] = await Promise.all([
    Database.routingRules.getAll(),
    Database.routingConfig.get(),
  ]);

  for (const rule of rules) {
    if (!rule.enabled || !rule.autoResolve) continue;
    if (rule.patterns.length === 0) continue;
    if (!(await needsResolve(rule.id))) continue;

    lastResolveAt.set(rule.id, now());
    const result = await resolveRule(
      rule.id,
      rule.patterns,
      config.dnsUpstreams
    );

    if (result.added > 0) {
      ROUTER_DEBUG(
        `Rule ${rule.id} (${rule.name}): refreshed ${result.added} address(es)`
      );
    }
  }

  for (const id of lastResolveAt.keys()) {
    if (!rules.some((rule) => rule.id === id)) lastResolveAt.delete(id);
  }
}

/**
 * Keep addresses still in use from expiring mid-connection. An entry whose
 * packet counter moved since the last pass is guaranteed at least
 * {@link EXTEND_SECONDS} more, never less than it had (`ipset add -exist`
 * replaces the timeout rather than adding to it).
 */
async function trafficPass() {
  const rules = await Database.routingRules.getAll();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const entries = await listAddresses(rule.id);
    const previous = lastPacketCount.get(rule.id);
    lastPacketCount.set(
      rule.id,
      new Map(entries.map((entry) => [entry.address, entry.packets]))
    );

    // Nothing to compare against on the first pass after a restart.
    if (!previous) continue;

    for (const entry of entries) {
      if (entry.timeout === 0) continue; // permanent already
      if (entry.packets <= (previous.get(entry.address) ?? 0)) continue;

      await addAddress(
        rule.id,
        entry.address,
        Math.max(entry.timeout, EXTEND_SECONDS)
      );
    }
  }

  for (const id of lastPacketCount.keys()) {
    if (!rules.some((rule) => rule.id === id)) lastPacketCount.delete(id);
  }
}

/** How often gateway interfaces are checked for having come or gone. */
const PRESENCE_TICK_MS = 30_000;

/** Re-apply routing when a gateway's link or route changed since the last apply; nothing else notices. */
async function presencePass() {
  if (!(await presenceChanged())) return;

  ROUTER_DEBUG(
    'A gateway link or route changed since the last apply; re-applying'
  );
  await applyRouting();
}

let timers: NodeJS.Timeout[] = [];

/**
 * Run `task` every `interval`, starting now, never overlapping itself. Passes
 * that write to the address sets take the routing lock so they never overlap
 * an apply; a pass that itself applies must not, as the lock is not
 * re-entrant.
 */
function schedule(
  name: string,
  task: () => Promise<void>,
  interval: number,
  { locked = true } = {}
) {
  let running = false;

  const timer = setIntervalImmediately(() => {
    if (running) return;
    running = true;

    (locked ? withRoutingLock(task) : task())
      .catch((error) => ROUTER_DEBUG(`${name} failed:`, error))
      .finally(() => {
        running = false;
      });
  }, interval);

  timers.push(timer);
}

export function startScheduler() {
  if (timers.length > 0) return;

  schedule('Re-resolve pass', resolvePass, RESOLVE_TICK_MS);
  schedule('Traffic pass', trafficPass, TRAFFIC_TICK_MS);
  schedule('Presence pass', presencePass, PRESENCE_TICK_MS, { locked: false });
}

export function stopScheduler() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  lastResolveAt.clear();
  lastPacketCount.clear();
}
