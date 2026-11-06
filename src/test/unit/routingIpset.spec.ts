import { describe, expect, test } from 'vitest';

import { parseCounts, setLines } from '#server/utils/routing/ipset';
import { canonical } from '#shared/utils/address';

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

describe('setLines', () => {
  test('puts each address in the set of its family, in canonical form', () => {
    expect(
      setLines([
        { op: 'add', ruleId: 3, address: '1.2.3.4/32', timeout: 300 },
        { op: 'add', ruleId: 3, address: '2001:DB8::1' },
        { op: 'del', ruleId: 4, address: '10.0.0.1/8' },
      ])
    ).toEqual([
      'add wgr4_3 1.2.3.4 timeout 300',
      'add wgr6_3 2001:db8::1',
      'del wgr4_4 10.0.0.0/8',
    ]);
  });

  test('leaves out catch-alls and anything unparsable', () => {
    // `hash:net` rejects a zero-length prefix; catch-alls match without a set.
    expect(
      setLines([
        { op: 'add', ruleId: 1, address: '0.0.0.0/0' },
        { op: 'add', ruleId: 1, address: 'not an address' },
      ])
    ).toEqual([]);
  });

  test('adds without a timeout when none is wanted, which makes it permanent', () => {
    expect(
      setLines([{ op: 'add', ruleId: 1, address: '1.2.3.4', timeout: 0 }])
    ).toEqual(['add wgr4_1 1.2.3.4']);
  });
});

describe('parseCounts', () => {
  test('adds up both families of each rule from the headers alone', () => {
    const output = [
      'Name: wgr4_1',
      'Type: hash:net',
      'Header: family inet hashsize 1024 maxelem 262144 timeout 0 counters',
      'Number of entries: 12',
      '',
      'Name: wgr6_1',
      'Number of entries: 3',
      '',
      'Name: someone_elses',
      'Number of entries: 99',
      '',
      'Name: wgr4_2',
      'Number of entries: 0',
    ].join('\n');

    expect(parseCounts(output)).toEqual(
      new Map([
        [1, 15],
        [2, 0],
      ])
    );
  });
});
