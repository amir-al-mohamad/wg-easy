import { Resolver } from 'node:dns/promises';

import { createDebug } from 'obug';

import { addAddress } from './ipset';

import type { ID } from '#server/utils/types';
import { resolvableDomains } from '#shared/utils/pattern';

const ROUTER_DEBUG = createDebug('Router');

/**
 * Shortest time an address stays in a rule's set. CDNs hand out thirty-second
 * TTLs, and honouring them literally would churn the set while connections
 * are still open.
 */
export const MIN_TTL = 300;

/**
 * Longest time an address stays in a rule's set without being seen again. A
 * record may advertise days; ipset refuses timeouts past about 2^31 seconds,
 * and a day is more than any client caches.
 */
export const MAX_TTL = 86400;

/**
 * How long a resolved address stays matchable: twice the record's TTL, so it
 * outlives the client's cache and a connection opened just before expiry does
 * not change route halfway. The top bit of the wire TTL is treated as zero
 * per RFC 2181 section 8; without the mask a broken answer yields a timeout
 * ipset rejects.
 */
export function setTtl(recordTtl: number) {
  const ttl = recordTtl & 0x7fffffff;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, ttl * 2));
}

export type ResolveResult = {
  /** Addresses written into the rule's sets. */
  added: number;
  /** Names that produced no answer at all. */
  failed: string[];
};

/**
 * Resolve a rule's patterns and load the answers into its address sets. Only
 * patterns naming a literal domain can be resolved; a glob has no finite
 * expansion. This warms a rule before use and covers clients that bypass the
 * DNS proxy; exact matching happens when the proxy sees a real lookup.
 *
 * @param upstreams resolvers to ask, falling back to the system ones when empty
 */
export async function resolveRule(
  ruleId: ID,
  patterns: readonly string[],
  upstreams: readonly string[] = []
): Promise<ResolveResult> {
  const resolver = new Resolver();
  if (upstreams.length > 0) {
    resolver.setServers([...upstreams]);
  }

  const domains = new Set(
    patterns.flatMap((pattern) => resolvableDomains(pattern))
  );

  const failed: string[] = [];
  let added = 0;

  for (const domain of domains) {
    const [v4, v6] = await Promise.all([
      resolver.resolve4(domain, { ttl: true }).catch(() => []),
      resolver.resolve6(domain, { ttl: true }).catch(() => []),
    ]);

    const records = [...v4, ...v6];
    if (records.length === 0) {
      failed.push(domain);
      continue;
    }

    for (const record of records) {
      await addAddress(ruleId, record.address, setTtl(record.ttl));
      added++;
    }
  }

  if (failed.length > 0) {
    ROUTER_DEBUG(`Rule ${ruleId}: could not resolve ${failed.join(', ')}`);
  }

  return { added, failed };
}
