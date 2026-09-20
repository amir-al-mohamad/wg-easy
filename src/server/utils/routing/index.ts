import {
  applyRouting,
  reconnectGateway,
  startRouting,
  stopRouting,
} from './apply';
import { withRoutingLock } from './lock';
import { resolveRule } from './resolve';
import { startScheduler, stopScheduler } from './scheduler';

import type { ID } from '#server/utils/types';

/**
 * Policy routing's lifecycle, in the shape `WireGuard.ts` already drives the
 * client firewall with: brought up after the interface, re-applied whenever
 * the config is saved, torn down at shutdown.
 *
 * Re-applying on every save is what keeps the kernel in step with the client
 * list. Deleting a client cascades its rules and forwards in the database, and
 * the address it held is the next one handed out; without an apply in
 * between, the next client would inherit the old one's port forward.
 */
export const router = {
  async Startup() {
    await startRouting();
    startScheduler();
  },

  async Shutdown() {
    stopScheduler();
    stopRouting();
  },

  apply: applyRouting,

  /** Bounce a gateway's link and re-apply in the same step. */
  reconnect: reconnectGateway,

  /** Resolve a rule's domains now, without racing an apply for its sets. */
  resolve(
    ruleId: ID,
    patterns: readonly string[],
    upstreams: readonly string[]
  ) {
    return withRoutingLock(() => resolveRule(ruleId, patterns, upstreams));
  },
};
