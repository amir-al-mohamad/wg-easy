import { describe, expect, test } from 'vitest';

import { canonical } from '#server/utils/routing/ipset';

describe('canonical', () => {
  test('writes an address the way ipset prints it back', () => {
    // A host prefix is dropped and host bits are cleared, so a value typed into
    // a rule compares equal to the same value read back from the kernel;
    // otherwise every apply would delete and re-add it.
    expect(canonical('1.2.3.4')?.address).toBe('1.2.3.4');
    expect(canonical('1.2.3.4/32')?.address).toBe('1.2.3.4');
    expect(canonical('10.0.0.1/8')?.address).toBe('10.0.0.0/8');
    expect(canonical('2001:DB8:0:0::1/128')?.address).toBe('2001:db8::1');
    expect(canonical('2001:db8:0:0::/32')?.address).toBe('2001:db8::/32');
  });

  test('reports the family', () => {
    expect(canonical('1.2.3.4')?.family).toBe(4);
    expect(canonical('2001:db8::1')?.family).toBe(6);
  });

  test('recognises a catch-all in any spelling', () => {
    expect(canonical('0.0.0.0/0')?.catchAll).toBe(true);
    expect(canonical('::/0')?.catchAll).toBe(true);
    expect(canonical('0000::/0')?.catchAll).toBe(true);
    expect(canonical('10.0.0.0/8')?.catchAll).toBe(false);
  });

  test('rejects anything that is not an address or subnet', () => {
    expect(canonical('example.com')).toBeNull();
    expect(canonical('1.2.3')).toBeNull();
    expect(canonical('10.0.0.0/33')).toBeNull();
    expect(canonical('')).toBeNull();
  });
});
