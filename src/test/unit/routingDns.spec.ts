import dgram from 'node:dgram';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { SetChange } from '#server/utils/routing/ipset';

const learned: SetChange[][] = [];
let learnDelayMs = 0;

vi.mock('#server/utils/routing/ipset', () => ({
  changeSets: async (changes: SetChange[]) => {
    await new Promise((resolve) => setTimeout(resolve, learnDelayMs));
    learned.push(changes);
  },
}));

const { configureDns, dnsTestExports } =
  await import('#server/utils/routing/dns');
const { resolveQuery } = dnsTestExports;

const ANSWER = [93, 184, 216, 34];

function query(id: number, name: string) {
  const labels = name
    .split('.')
    .flatMap((label) => [label.length, ...Buffer.from(label)]);
  return Buffer.from([
    ...[id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0],
    ...labels,
    0,
    ...[0, 1, 0, 1],
  ]);
}

/** The question, answered with one A record: what a real upstream sends. */
function answer(question: Buffer) {
  const reply = Buffer.concat([
    question,
    Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, ...ANSWER]),
  ]);
  reply[2] = 0x81;
  reply[3] = 0x80;
  reply.writeUInt16BE(1, 6);
  return reply;
}

/** The question back with TC set and no answer: "too large, ask over TCP". */
function truncated(question: Buffer) {
  const reply = Buffer.from(question);
  reply[2] = 0x83;
  reply[3] = 0x80;
  return reply;
}

let udp: dgram.Socket;
let tcp: net.Server;
const seen = { udp: 0, tcp: 0 };

beforeAll(async () => {
  tcp = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      seen.tcp++;
      const length = chunk.readUInt16BE(0);
      const reply = answer(chunk.subarray(2, 2 + length));
      const framed = Buffer.alloc(2 + reply.length);
      framed.writeUInt16BE(reply.length, 0);
      reply.copy(framed, 2);
      socket.end(framed);
    });
  });
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const port = (tcp.address() as AddressInfo).port;

  // Over UDP the answer is always "too large", so only TCP can carry it.
  udp = dgram.createSocket('udp4');
  udp.on('message', (message, from) => {
    seen.udp++;
    udp.send(truncated(message), from.port, from.address);
  });
  await new Promise<void>((resolve) => udp.bind(port, '127.0.0.1', resolve));

  configureDns({
    rules: [{ id: 7, patterns: ['example.com'], clients: [] }],
    upstreams: ['127.0.0.1'],
    listen: [],
    clientCidrs: ['127.0.0.0/8'],
    upstreamPort: port,
  });
});

afterAll(() => {
  udp.close();
  tcp.close();
});

beforeEach(() => {
  learned.length = 0;
  learnDelayMs = 0;
  seen.udp = 0;
  seen.tcp = 0;
});

describe('DNS proxy', () => {
  test('relays a truncated UDP answer, so the client retries over TCP', async () => {
    const reply = await resolveQuery(
      '127.0.0.2',
      query(1, 'example.com'),
      'udp'
    );

    expect(reply![2]! & 0x02).toBe(0x02);
    expect(seen).toEqual({ udp: 1, tcp: 0 });
  });

  test('asks upstream over TCP when the client did, and gets the full answer', async () => {
    // Asked over UDP instead, the upstream would truncate again and the
    // lookup could never complete.
    const reply = await resolveQuery(
      '127.0.0.2',
      query(2, 'example.com'),
      'tcp'
    );

    expect(reply!.readUInt16BE(0)).toBe(2);
    expect(reply!.readUInt16BE(6)).toBe(1);
    expect([...reply!.subarray(-4)]).toEqual(ANSWER);
    expect(seen).toEqual({ udp: 0, tcp: 1 });
  });

  test('learns the answer before the client has it', async () => {
    // The client connects the moment it has the reply; a set filled later
    // would see that first connection go the wrong way for its whole life.
    learnDelayMs = 50;
    await resolveQuery('127.0.0.2', query(3, 'www.example.com'), 'tcp');

    expect(learned).toEqual([]);
    await resolveQuery('127.0.0.2', query(4, 'example.com'), 'tcp');
    expect(learned).toEqual([
      [{ op: 'add', ruleId: 7, address: '93.184.216.34', timeout: 300 }],
    ]);
  });

  test('does not hold the reply hostage to a stuck set', async () => {
    learnDelayMs = 3000;
    const started = Date.now();
    const reply = await resolveQuery(
      '127.0.0.2',
      query(5, 'example.com'),
      'tcp'
    );

    expect(reply).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('ignores anyone outside the tunnel', async () => {
    expect(
      await resolveQuery('192.0.2.1', query(6, 'example.com'), 'udp')
    ).toBeNull();
    expect(seen).toEqual({ udp: 0, tcp: 0 });
  });
});
