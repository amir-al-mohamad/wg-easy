import { describe, expect, test } from 'vitest';

import { MAX_TTL, MIN_TTL, setTtl } from '#server/utils/routing/resolve';

describe('setTtl', () => {
  test('doubles the record TTL so an address outlives the client cache', () => {
    expect(setTtl(600)).toBe(1200);
  });

  test('floors short TTLs to avoid churning the set', () => {
    expect(setTtl(0)).toBe(MIN_TTL);
    expect(setTtl(30)).toBe(MIN_TTL);
  });

  test('caps long TTLs so a moved service is not routed for days', () => {
    expect(setTtl(7 * 86400)).toBe(MAX_TTL);
  });

  test('treats the wire field top bit as zero, per RFC 2181', () => {
    // A hostile or broken answer can carry any 32-bit value; doubling it
    // unclamped would produce a timeout ipset rejects, and the address would
    // silently never be added.
    expect(setTtl(0xffffffff)).toBe(MAX_TTL);
    expect(setTtl(0x80000000 | 100)).toBe(MIN_TTL);
  });
});
