import { describe, expect, test } from 'vitest';

import {
  dumpPeers,
  HANDSHAKE_STALE_SECONDS,
  handshakeAge,
  handshakeStale,
  parsePeers,
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
