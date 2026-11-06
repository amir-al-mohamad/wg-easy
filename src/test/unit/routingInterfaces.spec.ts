import { describe, expect, test } from 'vitest';

import {
  dumpPeers,
  HANDSHAKE_STALE_SECONDS,
  handshakeAge,
  handshakeStale,
  hasAddress,
  parseDefaultRoutes,
  parseFwmarkRules,
  parseLinks,
  parsePeers,
  parseSubnets,
  replacePeerCommand,
} from '#server/utils/routing/interfaces';

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const KEY_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

const NOW = 1_700_000_000;

/** `wg show <if> dump`: the interface line, then one line per peer. */
function dump(
  peers: { key: string; handshake: number; keepalive: number | 'off' }[]
) {
  const head = ['<private>', '<public>', '51000', 'off'].join('\t');
  const rows = peers.map((peer) =>
    [
      peer.key,
      '(none)',
      '127.0.0.1:51001',
      '0.0.0.0/0',
      String(peer.handshake),
      '0',
      '148',
      String(peer.keepalive),
    ].join('\t')
  );
  return [head, ...rows].join('\n') + '\n';
}

describe('parsePeers', () => {
  test('reads keepalive and handshake per peer, skipping the interface line', () => {
    const peers = parsePeers(
      dump([
        { key: KEY_A, handshake: NOW - 10, keepalive: 25 },
        { key: KEY_B, handshake: 0, keepalive: 'off' },
      ])
    );

    expect([...peers.keepalive]).toEqual([[KEY_A, 25]]);
    expect(peers.handshakes.get(KEY_A)).toBe(NOW - 10);
    expect(peers.handshakes.get(KEY_B)).toBe(0);
    expect(peers.handshakes.has('<private>')).toBe(false);
  });

  test('tolerates a link with no peers, and empty output', () => {
    expect(parsePeers(dump([])).handshakes.size).toBe(0);
    expect(parsePeers('').keepalive.size).toBe(0);
  });

  test('never mistakes the interface line for a peer, however wide', () => {
    // AmneziaWG prints its obfuscation parameters after the fwmark, which
    // makes its interface line as wide as a peer's.
    const awg =
      [
        '<private>',
        '<public>',
        '51000',
        'off',
        '4',
        '40',
        '70',
        '0',
        '0',
        '1',
        '2',
        '3',
        '4',
      ].join('\t') +
      '\n' +
      [
        KEY_A,
        '(none)',
        '1.2.3.4:2408',
        '0.0.0.0/0,::/0',
        String(NOW - 3),
        '10',
        '20',
        '25',
      ].join('\t') +
      '\n';

    const peers = dumpPeers(awg);
    expect(peers.map((peer) => peer.key)).toEqual([KEY_A]);
    expect(peers[0]).toEqual({
      key: KEY_A,
      preshared: false,
      endpoint: '1.2.3.4:2408',
      allowedIps: '0.0.0.0/0,::/0',
      handshake: NOW - 3,
      keepalive: 25,
    });
  });

  test('reads unset values as absent', () => {
    const line = [KEY_B, 'psk', '(none)', '(none)', '0', '0', '0', 'off'].join(
      '\t'
    );
    const [peer] = dumpPeers(`<interface>\n${line}\n`);
    expect(peer).toEqual({
      key: KEY_B,
      preshared: true,
      endpoint: null,
      allowedIps: null,
      handshake: 0,
      keepalive: null,
    });
  });
});

describe('handshakeAge', () => {
  test('is unknown for a link that is not WireGuard', () => {
    expect(handshakeAge(null, NOW)).toBeNull();
    expect(handshakeStale(null)).toBe(false);
  });

  test('is unknown when no peer keeps itself alive', () => {
    // An idle tunnel without keepalive goes silent legitimately; judging it
    // would pull its route and keep it idle for good.
    const peers = parsePeers(
      dump([{ key: KEY_A, handshake: NOW - 3600, keepalive: 'off' }])
    );
    expect(handshakeAge(peers, NOW)).toBeNull();
  });

  test('counts from the newest handshake among keepalive peers', () => {
    const peers = parsePeers(
      dump([
        { key: KEY_A, handshake: NOW - 500, keepalive: 25 },
        { key: KEY_B, handshake: NOW - 40, keepalive: 25 },
      ])
    );
    expect(handshakeAge(peers, NOW)).toBe(40);
    expect(handshakeStale(40)).toBe(false);
  });

  test('ignores a fresh handshake on a peer without keepalive', () => {
    const peers = parsePeers(
      dump([
        { key: KEY_A, handshake: NOW - 500, keepalive: 25 },
        { key: KEY_B, handshake: NOW - 1, keepalive: 'off' },
      ])
    );
    expect(handshakeAge(peers, NOW)).toBe(500);
  });

  test('never handshaked is infinitely old, and stale', () => {
    const peers = parsePeers(
      dump([{ key: KEY_A, handshake: 0, keepalive: 25 }])
    );
    const age = handshakeAge(peers, NOW);
    expect(age).toBe(Number.POSITIVE_INFINITY);
    expect(handshakeStale(age)).toBe(true);
  });

  test('a keepalive peer is stale past the threshold, not before', () => {
    // A healthy responder can go 165 s between handshakes; the threshold
    // must sit well beyond that plus a few failed attempts.
    expect(HANDSHAKE_STALE_SECONDS).toBeGreaterThanOrEqual(165 + 90);
    expect(handshakeStale(HANDSHAKE_STALE_SECONDS)).toBe(false);
    expect(handshakeStale(HANDSHAKE_STALE_SECONDS + 1)).toBe(true);
  });

  test('a handshake from the future reads as now', () => {
    const peers = parsePeers(
      dump([{ key: KEY_A, handshake: NOW + 30, keepalive: 25 }])
    );
    expect(handshakeAge(peers, NOW)).toBe(0);
  });
});

// `ip -j` output as iproute2 prints it, captured from a container.
describe('ip -j parsing', () => {
  test('reads link names and whether they are up', () => {
    expect(
      parseLinks([
        {
          ifindex: 3,
          ifname: 'wgt',
          flags: ['POINTOPOINT', 'NOARP', 'UP', 'LOWER_UP'],
        },
        { ifindex: 4, ifname: 'veth0', link: 'eth0', flags: ['BROADCAST'] },
      ])
    ).toEqual([
      { name: 'wgt', up: true },
      { name: 'veth0', up: false },
    ]);
  });

  test('reads the default routes of a table, whatever their type', () => {
    expect(
      parseDefaultRoutes([
        { dst: 'default', dev: 'dummy0', scope: 'link', metric: 100 },
        { type: 'blackhole', dst: 'default', metric: 200 },
        { dst: '10.9.0.0/24', dev: 'wgt' },
      ])
    ).toEqual([
      { metric: 100, dev: 'dummy0' },
      { metric: 200, dev: null },
    ]);
  });

  test('finds a global address, and tolerates the empty entries iproute2 adds', () => {
    expect(
      hasAddress([
        {
          ifname: 'dummy0',
          addr_info: [{ family: 'inet6', local: '2001:db8::1' }, {}],
        },
      ])
    ).toBe(true);
    expect(hasAddress([])).toBe(false);
    expect(hasAddress([{ ifname: 'wgt', addr_info: [{}] }])).toBe(false);
  });

  test('reads subnets, leaving out host routes and link-local', () => {
    expect(
      parseSubnets([
        { dst: '10.9.0.0/24', protocol: 'kernel', scope: 'link' },
        { dst: '10.9.0.7' },
        { dst: 'fe80::/64' },
        { dst: 'fdcc::/64' },
      ])
    ).toEqual(['10.9.0.0/24', 'fdcc::/64']);
  });

  test('keeps only rules that select on a mark and nothing else', () => {
    expect(
      parseFwmarkRules([
        { priority: 0, src: 'all', table: 'local' },
        {
          priority: 150,
          src: 'all',
          fwmark: '0x100',
          fwmask: '0xffff',
          table: '150',
        },
        { priority: 251, src: 'all', fwmark: '0xddd', table: 'main' },
        // Another selector makes it someone else's rule.
        {
          priority: 160,
          src: 'all',
          iif: 'eth0',
          fwmark: '0x100',
          fwmask: '0xffff',
          table: '160',
        },
        { priority: 32766, src: 'all', table: 'main' },
      ])
    ).toEqual([
      { priority: 150, fwmark: '0x100/0xffff', table: '150' },
      { priority: 251, fwmark: '0xddd/0xffffffff', table: 'main' },
    ]);
  });
});

describe('replacePeerCommand', () => {
  const KEY = 'PuXv8yVp5nupNB9ugNm01QCLq/XFyGHOAEBvjKGselo=';
  const peer = {
    key: KEY,
    preshared: false,
    endpoint: '192.0.2.1:51820',
    allowedIps: '10.9.0.2/32,fd00::/64',
    handshake: 0,
    keepalive: 25,
  };

  test('removes and re-adds the peer in a single set', () => {
    // One netlink message, applied in order: the peer is never left missing.
    expect(replacePeerCommand('wg', 'wg1', peer).command).toBe(
      `wg set wg1 peer ${KEY} remove peer ${KEY} endpoint 192.0.2.1:51820 allowed-ips 10.9.0.2/32,fd00::/64 persistent-keepalive 25`
    );
  });

  test('pipes a preshared key from the listing, keeping it out of the log', () => {
    const { command, shown } = replacePeerCommand('awg', 'awg0', {
      ...peer,
      preshared: true,
      endpoint: '[2001:db8::1]:51820',
      keepalive: null,
    });

    expect(command).toBe(
      `awg show awg0 preshared-keys | awk -v k='${KEY}' '$1 == k { print $2 }' | awg set awg0 peer ${KEY} remove peer ${KEY} endpoint [2001:db8::1]:51820 allowed-ips 10.9.0.2/32,fd00::/64 preshared-key /dev/stdin`
    );
    expect(shown).not.toContain('awk');
    expect(shown).toContain('preshared-key <from listing>');
  });

  test('refuses values that do not look like what a dump prints', () => {
    expect(() =>
      replacePeerCommand('wg', 'wg1', {
        ...peer,
        endpoint: '1.2.3.4:1; reboot',
      })
    ).toThrow();
    expect(() =>
      replacePeerCommand('wg', 'wg1', { ...peer, key: "x' ; reboot ; '" })
    ).toThrow();
  });
});
