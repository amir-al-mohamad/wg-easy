import { describe, expect, test } from 'vitest';

import { isolationRules } from '#server/utils/firewall';

const wgInterface = { ipv4Cidr: '10.8.0.0/24', ipv6Cidr: 'fdcc:ad94::/64' };

function client(
  id: number,
  overrides: Partial<Parameters<typeof isolationRules>[1][number]> = {}
) {
  return {
    id,
    name: `client ${id}`,
    ipv4Address: `10.8.0.${id + 1}`,
    ipv6Address: `fdcc:ad94::${id + 1}`,
    allowedIps: null,
    firewallIps: null,
    enabled: true,
    isolated: false,
    ...overrides,
  };
}

describe('isolationRules', () => {
  test('blocks both directions of a pair, in both families', () => {
    const { v4, v6 } = isolationRules(
      wgInterface,
      [client(1), client(2)],
      [{ clientAId: 1, clientBId: 2 }],
      true
    );

    // Symmetric on purpose: the chain only sees packets arriving from the
    // tunnel, so blocking one direction would still let the other side reach
    // this client through the replies to a connection it opened.
    expect(
      v4.some(
        (r) => r.includes('-s 10.8.0.2 -d 10.8.0.3 ') && r.endsWith('-j DROP')
      )
    ).toBe(true);
    expect(v4.some((r) => r.includes('-s 10.8.0.3 -d 10.8.0.2 '))).toBe(true);
    expect(v6.some((r) => r.includes('-s fdcc:ad94::2 -d fdcc:ad94::3 '))).toBe(
      true
    );
    expect(v6.some((r) => r.includes('-s fdcc:ad94::3 -d fdcc:ad94::2 '))).toBe(
      true
    );
    expect(v4).toHaveLength(2);
    expect(v6).toHaveLength(2);
  });

  test('cuts a client isolated from everyone off from the whole subnet', () => {
    const { v4, v6 } = isolationRules(
      wgInterface,
      [client(1, { isolated: true }), client(2)],
      [],
      true
    );

    // The subnet, not a list of clients: it covers clients added later. The
    // server's own address is not affected, as traffic to it is not forwarded.
    expect(v4).toContain(
      `-A WG_CLIENTS -s 10.8.0.2 -d 10.8.0.0/24 -m comment --comment "isolated client 1" -j DROP`
    );
    expect(v4).toContain(
      `-A WG_CLIENTS -s 10.8.0.0/24 -d 10.8.0.2 -m comment --comment "isolated client 1" -j DROP`
    );
    expect(v6.some((r) => r.includes('-d fdcc:ad94::/64'))).toBe(true);
  });

  test('skips pairs and clients that are switched off', () => {
    const { v4 } = isolationRules(
      wgInterface,
      [client(1, { enabled: false, isolated: true }), client(2), client(3)],
      [
        { clientAId: 1, clientBId: 2 },
        { clientAId: 2, clientBId: 3 },
      ],
      true
    );

    expect(v4.some((r) => r.includes('10.8.0.2'))).toBe(false);
    expect(
      v4.filter((r) => r.includes('10.8.0.3') && r.includes('10.8.0.4'))
    ).toHaveLength(2);
  });

  test('emits nothing for IPv6 when it is disabled', () => {
    const { v6 } = isolationRules(
      wgInterface,
      [client(1, { isolated: true }), client(2)],
      [{ clientAId: 1, clientBId: 2 }],
      false
    );
    expect(v6).toEqual([]);
  });

  test('ignores a pair whose client no longer exists', () => {
    const { v4 } = isolationRules(
      wgInterface,
      [client(1)],
      [{ clientAId: 1, clientBId: 9 }],
      true
    );
    expect(v4).toEqual([]);
  });
});
