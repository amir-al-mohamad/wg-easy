import { createDebug } from 'obug';

import { exec } from '#server/utils/cmd';

const ROUTER_DEBUG = createDebug('Router');

export type SystemInterface = {
  name: string;
  /** The link is administratively up. */
  up: boolean;
  /** Looks like a usable upstream rather than plumbing. A hint for the UI, not a restriction. */
  suggested: boolean;
};

// Never a sensible upstream: the host's own uplink (what the `direct` action
// already uses), bridges, container and loopback plumbing.
const PLUMBING = [
  'lo',
  'eth',
  'ens',
  'eno',
  'enp',
  'enx',
  'docker',
  'br-',
  'veth',
  'bond',
  'dummy',
  'virbr',
];

const LINK_LINE = /^\d+:\s+([^:@\s]+)(?:@\S+)?:\s+<([^>]*)>/;

function isPlumbing(name: string) {
  return PLUMBING.some((prefix) => name === prefix || name.startsWith(prefix));
}

/**
 * Every link in this network namespace, which includes the sidecar tunnels
 * that join it with `network_mode: "service:wg-easy"`. `reserved` names are
 * never offered: the one wg-easy's own clients connect to.
 */
export async function listInterfaces(
  reserved: readonly string[] = []
): Promise<SystemInterface[]> {
  let output: string;
  try {
    output = await exec('ip -o link show', { log: false });
  } catch (error) {
    ROUTER_DEBUG('Failed to list interfaces:', error);
    return [];
  }

  const interfaces: SystemInterface[] = [];

  for (const line of output.split('\n')) {
    const match = LINK_LINE.exec(line.trim());
    if (!match) continue;

    const [, name, flags] = match;
    if (!name || reserved.includes(name)) continue;

    interfaces.push({
      name,
      up: (flags ?? '').split(',').includes('UP'),
      suggested: !isPlumbing(name),
    });
  }

  return interfaces.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether the link is present and administratively up. Up, not merely
 * present: the kernel refuses a route through a link that is down.
 */
export async function interfaceUp(name: string): Promise<boolean> {
  try {
    const output = await exec(`ip -o link show ${name}`, { log: false });
    const match = LINK_LINE.exec(output.trim());
    return (match?.[2] ?? '').split(',').includes('UP');
  } catch {
    return false;
  }
}

/** A default route in a gateway's table: its metric, and the link it leaves by. */
export type TableRoute = { metric: number; dev: string | null };

/**
 * The default routes a table currently holds, read back: the kernel removes
 * a route through a link that went away or down and never restores it.
 */
export async function defaultRoutes(
  family: '-4' | '-6',
  table: number
): Promise<TableRoute[]> {
  try {
    const output = await exec(`ip ${family} route show table ${table}`, {
      log: false,
    });
    const routes: TableRoute[] = [];

    // `default dev tun0 scope link metric 100`, `blackhole default metric 200`
    // and `throw default metric 200` are the only shapes we ever put there.
    for (const line of output.split('\n')) {
      const tokens = line.trim().split(/\s+/);
      if (!tokens.includes('default')) continue;

      const dev = tokens.indexOf('dev');
      const metric = tokens.indexOf('metric');
      routes.push({
        metric: metric >= 0 ? Number(tokens[metric + 1]) : 0,
        dev: dev >= 0 ? (tokens[dev + 1] ?? null) : null,
      });
    }
    return routes;
  } catch {
    return [];
  }
}

/**
 * Whether the link has a routable IPv6 address. Link-local does not count:
 * the kernel would use it as the source of an IPv6 default route and the far
 * end would silently drop the packets.
 */
export async function hasGlobalIpv6(name: string): Promise<boolean> {
  try {
    const output = await exec(`ip -6 -o addr show dev ${name} scope global`, {
      log: false,
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The subnets wg-easy's own interface is attached to. Client-to-client
 * traffic must reach the main table untouched; see the RETURN rules in the
 * plan.
 */
export async function localSubnets(
  interfaceName: string
): Promise<{ v4: string[]; v6: string[] }> {
  const read = async (family: '-4' | '-6') => {
    try {
      const output = await exec(
        `ip ${family} route show dev ${interfaceName}`,
        { log: false }
      );

      return (
        output
          .split('\n')
          .map((line) => line.trim().split(/\s+/)[0] ?? '')
          .filter((prefix) => prefix.includes('/'))
          // Link-local is never a routing target worth preserving.
          .filter((prefix) => !prefix.toLowerCase().startsWith('fe80:'))
      );
    } catch {
      return [];
    }
  };

  const [v4, v6] = await Promise.all([read('-4'), read('-6')]);
  return { v4, v6 };
}

/** What a WireGuard link reports about its peers. */
export type WireGuardPeers = {
  /** Keepalive interval, in seconds, of each peer configured to keep the tunnel alive by itself. */
  keepalive: Map<string, number>;
  /** Newest completed handshake per peer, in epoch seconds; 0 for never. */
  handshakes: Map<string, number>;
};

type WireGuardTool = 'wg' | 'awg';

// Which toolset answers for each link: an AmneziaWG interface answers `awg`
// and refuses `wg`, a plain one the other way round.
const toolFor = new Map<string, WireGuardTool>();

/** `show <link> dump`, or null when neither toolset knows the link. */
async function dump(
  name: string
): Promise<{ tool: WireGuardTool; output: string } | null> {
  const known = toolFor.get(name);
  const order: WireGuardTool[] = known
    ? [known, known === 'wg' ? 'awg' : 'wg']
    : ['wg', 'awg'];

  for (const tool of order) {
    try {
      // Not logged: the first line of a dump is the private key.
      const output = await exec(`${tool} show ${name} dump`, { log: false });
      toolFor.set(name, tool);
      return { tool, output };
    } catch {
      continue;
    }
  }
  toolFor.delete(name);
  return null;
}

/** The peers of a WireGuard link, or null when the link is not one. */
export async function wireguardPeers(
  name: string
): Promise<WireGuardPeers | null> {
  const found = await dump(name);
  return found && parsePeers(found.output);
}

/** A peer as the dump describes it: enough to put it back as it was. */
export type DumpPeer = {
  key: string;
  /** A preshared key is set; its value is never read into memory here. */
  preshared: boolean;
  endpoint: string | null;
  /** Comma-separated, as `set … allowed-ips` takes it. */
  allowedIps: string | null;
  /** Epoch seconds; 0 for never. */
  handshake: number;
  /** Seconds, or null when off. */
  keepalive: number | null;
};

/**
 * The dump is tab-separated: first the interface line (private key, public
 * key, listen port, fwmark, plus AmneziaWG's obfuscation parameters), then
 * one line per peer: public key, preshared key, endpoint, allowed IPs,
 * latest handshake, bytes received, bytes sent, persistent keepalive. Unset
 * values print as `(none)` or `off`. The interface line is skipped by
 * position, as its width differs between the two implementations.
 */
export function dumpPeers(dumpOutput: string): DumpPeer[] {
  const none = (value: string | undefined) =>
    !value || value === '(none)' ? null : value;

  return dumpOutput
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length >= 8 && fields[0])
    .map((fields) => ({
      key: fields[0]!,
      preshared: none(fields[1]) !== null,
      endpoint: none(fields[2]),
      allowedIps: none(fields[3]),
      handshake: Number(fields[4]),
      keepalive: !fields[7] || fields[7] === 'off' ? null : Number(fields[7]),
    }));
}

export function parsePeers(dumpOutput: string): WireGuardPeers {
  const keepalive = new Map<string, number>();
  const handshakes = new Map<string, number>();

  for (const peer of dumpPeers(dumpOutput)) {
    handshakes.set(peer.key, peer.handshake);
    if (peer.keepalive !== null) keepalive.set(peer.key, peer.keepalive);
  }

  return { keepalive, handshakes };
}

/**
 * A keepalive peer renews its handshake at least every three minutes while
 * the far end answers (two on the initiating side, up to 165 s on the other),
 * so one this old means the far end has stopped. Generous on purpose: a route
 * pulled from a healthy tunnel costs more than a dead one noticed a minute
 * later.
 */
export const HANDSHAKE_STALE_SECONDS = 300;

/**
 * Seconds since the newest handshake among the peers with persistent
 * keepalive; `Infinity` when none ever completed one, null when there is no
 * such peer. Only those peers are judged: WireGuard handshakes when it has
 * something to send, so a peer without keepalive goes silent when idle, and
 * a route pulled over that silence would keep the tunnel idle for good.
 */
export function handshakeAge(
  peers: WireGuardPeers | null,
  now = Math.floor(Date.now() / 1000)
): number | null {
  if (!peers) return null;

  let newest: number | null = null;
  for (const key of peers.keepalive.keys()) {
    const epoch = peers.handshakes.get(key) ?? 0;
    if (newest === null || epoch > newest) newest = epoch;
  }

  if (newest === null) return null;
  return newest === 0 ? Number.POSITIVE_INFINITY : Math.max(0, now - newest);
}

export function handshakeStale(age: number | null) {
  return age !== null && age > HANDSHAKE_STALE_SECONDS;
}

/**
 * Make a WireGuard link handshake anew without taking it down: each peer is
 * removed and put back as it was. A removed peer takes its sessions with it,
 * and the new one handshakes at once if it has keepalive (WireGuard sends one
 * when keepalive is set on a fresh peer) or with its next packet otherwise.
 * The link's addresses, socket and routes are untouched. Setting the private
 * key to its own value, the obvious alternative, is a no-op in the kernel.
 *
 * A preshared key goes through a file the tool reads, never a command line.
 * Rejects when the link is not WireGuard, is gone, or a peer could not be
 * put back (tried twice, since that is worse than a stuck session).
 */
export async function rehandshake(name: string): Promise<void> {
  const found = await dump(name);
  if (!found) throw new Error(`${name} is not a WireGuard link`);
  const { tool } = found;

  for (const peer of dumpPeers(found.output)) {
    const settings = [
      peer.endpoint && `endpoint ${peer.endpoint}`,
      peer.allowedIps && `allowed-ips ${peer.allowedIps}`,
      peer.keepalive !== null && `persistent-keepalive ${peer.keepalive}`,
    ]
      .filter(Boolean)
      .join(' ');

    // The preshared key is read out before the peer goes, into a file only
    // this process can read.
    const readd = peer.preshared
      ? `umask 077 && psk=$(mktemp) && ${tool} show ${name} preshared-keys | awk -v k='${peer.key}' '$1 == k { print $2 }' > "$psk" && ${tool} set ${name} peer ${peer.key} remove && ${tool} set ${name} peer ${peer.key} ${settings} preshared-key "$psk"; status=$?; rm -f "$psk"; exit $status`
      : `${tool} set ${name} peer ${peer.key} remove && ${tool} set ${name} peer ${peer.key} ${settings}`;
    const shown = `${tool} set ${name} peer ${peer.key} remove && ${tool} set ${name} peer ${peer.key} ${settings}${peer.preshared ? ' preshared-key <file>' : ''}`;

    try {
      await exec(readd, { log: shown });
    } catch {
      // The removal may have gone through and the re-add not; a second
      // attempt re-adds an absent peer just the same.
      try {
        await exec(readd, { log: shown });
      } catch (error) {
        throw new Error(`peer ${peer.key} could not be put back on ${name}`, {
          cause: error,
        });
      }
    }
  }
}

/**
 * Wait briefly for a fresh handshake, so the apply after a reconnect sees a
 * live link rather than the stale handshake it was reconnected over. True
 * once a handshake is seen, or at once when there is no peer to judge; false
 * when the far end has not answered by the deadline.
 */
export async function awaitHandshake(
  name: string,
  timeoutMs = 5000
): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const age = handshakeAge(await wireguardPeers(name));
    if (age === null || age <= 5) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
