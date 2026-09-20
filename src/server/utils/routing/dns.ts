import dgram from 'node:dgram';
import net from 'node:net';

import { containsCidr } from 'cidr-tools';
import { isIPv6 } from 'is-ip';
import { createDebug } from 'obug';

import { readAnswerRecords, readQuestionName, toServFail } from './dnsMessage';
import { addAddress } from './ipset';
import { setTtl } from './resolve';

import { matchesAny } from '#shared/utils/pattern';

const ROUTER_DEBUG = createDebug('Router');

const PORT = 53;

/**
 * Total time a lookup may wait on upstreams. glibc gives up on a resolver
 * after five seconds, so a later answer, even a SERVFAIL, reaches nobody.
 */
const UPSTREAM_BUDGET_MS = 4000;

/**
 * Bounds on lookups waiting on an upstream, overall and per client, so a
 * flood cannot exhaust file descriptors and one device cannot starve the
 * rest. Over the limit a client gets SERVFAIL and retries.
 */
const MAX_IN_FLIGHT = 256;
const MAX_IN_FLIGHT_PER_CLIENT = 32;

/** Longest TCP message DNS allows: a 16-bit length prefix. */
const MAX_TCP_MESSAGE = 65535;
const TCP_IDLE_MS = 10_000;

/**
 * Answers never learned into a rule: an entry pointing at this server, the
 * tunnel subnets or private space would let one lookup, or a spoofed
 * upstream, redirect other clients' traffic.
 */
const NEVER_LEARN = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '224.0.0.0/3',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

type DnsRule = {
  id: number;
  patterns: readonly string[];
  /** Tunnel addresses of the clients the rule covers; empty means every client. */
  clients: readonly string[];
};

type DnsConfig = {
  rules: readonly DnsRule[];
  upstreams: readonly string[];
  /** Addresses to listen on: the server's own, on the client-facing interface. */
  listen: readonly string[];
  /** Subnets lookups may come from: the client-facing interface's. */
  clientCidrs: readonly string[];
};

let config: DnsConfig = {
  rules: [],
  upstreams: ['1.1.1.1', '8.8.8.8'],
  listen: [],
  clientCidrs: [],
};

let inFlight = 0;
const inFlightByClient = new Map<string, number>();

/**
 * Point the proxy at the current rules and addresses. Pushed from the apply
 * rather than read per query, since a lookup is on the client's critical
 * path.
 */
export function configureDns(next: DnsConfig) {
  const rebind =
    next.listen.join(',') !== config.listen.join(',') && sockets.length > 0;
  config = next;
  if (rebind) {
    stopDnsProxy();
    startDnsProxy();
  }
}

function isClient(address: string) {
  return (
    config.clientCidrs.length > 0 && containsCidr(config.clientCidrs, address)
  );
}

/**
 * Ask one upstream. The socket is connected so the kernel discards datagrams
 * from anyone else, and the transaction id is checked so a stale or forged
 * reply is ignored rather than relayed and learned.
 */
function askUpstream(
  query: Buffer,
  upstream: string,
  timeoutMs: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket(isIPv6(upstream) ? 'udp6' : 'udp4');
    const id = query.readUInt16BE(0);

    let settled = false;
    const finish = (reply: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(reply);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.on('message', (reply) => {
      if (reply.length >= 12 && reply.readUInt16BE(0) === id) finish(reply);
    });
    socket.once('error', () => finish(null));
    socket.connect(PORT, upstream, () => {
      socket.send(query, (error) => {
        if (error) finish(null);
      });
    });
  });
}

/** Try each upstream in turn within one overall time budget. */
async function forward(query: Buffer): Promise<Buffer | null> {
  const deadline = Date.now() + UPSTREAM_BUDGET_MS;
  const perUpstream = Math.floor(UPSTREAM_BUDGET_MS / config.upstreams.length);

  for (const upstream of config.upstreams) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const reply = await askUpstream(
      query,
      upstream,
      Math.min(perUpstream, remaining)
    );
    if (reply) return reply;
  }
  return null;
}

/**
 * Put the addresses from a reply into the set of the first rule that matches
 * the name and covers the client who asked. This is what makes a rule like
 * `*.netflix.com` work: the addresses behind such a name can only be learned
 * by watching answers go past. The client check mirrors the source match
 * iptables applies to the rule, so one device cannot fill a set scoped to
 * another.
 */
async function learn(client: string, question: string, reply: Buffer) {
  const rule = config.rules.find(
    (candidate) =>
      (candidate.clients.length === 0 || candidate.clients.includes(client)) &&
      matchesAny(question, candidate.patterns)
  );
  if (!rule) return;

  const records = readAnswerRecords(reply).filter(
    (record) => !containsCidr(NEVER_LEARN, record.address)
  );
  for (const record of records) {
    await addAddress(rule.id, record.address, setTtl(record.ttl));
  }

  if (records.length > 0) {
    ROUTER_DEBUG(
      `${question} -> rule ${rule.id} (+${records.length} address(es))`
    );
  }
}

/**
 * Handle one query and return the reply to send, if any. Forwarding and
 * learning are separate: a name that cannot be parsed (the root, which stub
 * resolvers ask about routinely) is still forwarded, just not learned from.
 */
async function resolveQuery(
  client: string,
  query: Buffer
): Promise<Buffer | null> {
  if (query.length < 12) return null;
  if (!isClient(client)) return null;

  const perClient = inFlightByClient.get(client) ?? 0;
  if (inFlight >= MAX_IN_FLIGHT || perClient >= MAX_IN_FLIGHT_PER_CLIENT) {
    return toServFail(query);
  }

  inFlight++;
  inFlightByClient.set(client, perClient + 1);
  try {
    const reply = await forward(query);
    if (!reply) {
      // Answer the failure rather than let the client wait out its own
      // timeout, which turns a brief upstream hiccup into a visible stall.
      return toServFail(query);
    }

    const question = readQuestionName(query);
    if (question) {
      // Learning happens after the reply is on its way, so routing state for
      // the next connection never delays this one.
      void learn(client, question, reply).catch((error) =>
        ROUTER_DEBUG(`Failed to learn from ${question}:`, error)
      );
    }
    return reply;
  } finally {
    inFlight--;
    const left = (inFlightByClient.get(client) ?? 1) - 1;
    if (left <= 0) inFlightByClient.delete(client);
    else inFlightByClient.set(client, left);
  }
}

let sockets: dgram.Socket[] = [];
let servers: net.Server[] = [];

function listenUdp(address: string) {
  const socket = dgram.createSocket({
    type: isIPv6(address) ? 'udp6' : 'udp4',
    reuseAddr: true,
  });

  socket.on('message', (query, from) => {
    void resolveQuery(from.address, query)
      .then((reply) => {
        if (reply) socket.send(reply, from.port, from.address);
      })
      .catch((error) => ROUTER_DEBUG('Lookup failed:', error));
  });

  socket.on('error', (error) => {
    ROUTER_DEBUG(
      `DNS proxy could not listen on ${address}:${PORT}/udp:`,
      error
    );
    socket.close();
    sockets = sockets.filter((entry) => entry !== socket);
  });

  socket.bind(PORT, address, () => {
    ROUTER_DEBUG(`DNS proxy listening on ${address}:${PORT}/udp`);
  });

  sockets.push(socket);
}

/**
 * DNS over TCP, for answers too large for a datagram. A truncated UDP reply
 * makes the client retry over TCP, and since this server is its only
 * resolver that retry has to be answered here. Messages are length-prefixed.
 */
function listenTcp(address: string) {
  const server = net.createServer((connection) => {
    const client = connection.remoteAddress ?? '';
    let buffered = Buffer.alloc(0);

    connection.setTimeout(TCP_IDLE_MS, () => connection.destroy());

    connection.on('data', (chunk: Buffer | string) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);

      while (buffered.length >= 2) {
        const length = buffered.readUInt16BE(0);
        if (length > MAX_TCP_MESSAGE || buffered.length < 2 + length) break;

        const query = buffered.subarray(2, 2 + length);
        buffered = buffered.subarray(2 + length);

        void resolveQuery(client, query)
          .then((reply) => {
            if (!reply || connection.destroyed) return;
            const framed = Buffer.alloc(2 + reply.length);
            framed.writeUInt16BE(reply.length, 0);
            reply.copy(framed, 2);
            connection.write(framed);
          })
          .catch((error) => ROUTER_DEBUG('Lookup failed:', error));
      }
    });

    connection.on('error', () => connection.destroy());
  });

  server.on('error', (error) => {
    ROUTER_DEBUG(
      `DNS proxy could not listen on ${address}:${PORT}/tcp:`,
      error
    );
    servers = servers.filter((entry) => entry !== server);
  });

  server.listen(PORT, address, () => {
    ROUTER_DEBUG(`DNS proxy listening on ${address}:${PORT}/tcp`);
  });

  servers.push(server);
}

/**
 * Listen on the server's own tunnel addresses only, so nothing else sharing
 * the namespace (the sidecar tunnels, or the host under `network_mode: host`)
 * is offered a resolver.
 */
export function startDnsProxy() {
  if (sockets.length > 0 || servers.length > 0) return;

  for (const address of config.listen) {
    listenUdp(address);
    listenTcp(address);
  }
}

export function stopDnsProxy() {
  for (const socket of sockets) socket.close();
  for (const server of servers) server.close();
  sockets = [];
  servers = [];
}

/**
 * Whether lookups are actually answered, as opposed to merely enabled: a port
 * taken by another process fails the bind.
 */
export function isDnsProxyListening() {
  return sockets.length > 0;
}
