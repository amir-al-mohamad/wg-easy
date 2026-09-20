import { describe, expect, test } from 'vitest';

import {
  readAnswerRecords,
  readQuestionName,
  toServFail,
} from '#server/utils/routing/dnsMessage';

/** Encode a domain as DNS labels. */
function name(domain: string) {
  const labels = domain
    .split('.')
    .map((label) =>
      Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')])
    );
  return Buffer.concat([...labels, Buffer.from([0])]);
}

function header(counts: { questions: number; answers: number }) {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt16BE(0x1234, 0); // id
  buffer.writeUInt16BE(0x8180, 2); // response, recursion available
  buffer.writeUInt16BE(counts.questions, 4);
  buffer.writeUInt16BE(counts.answers, 6);
  return buffer;
}

type Answer = {
  type: number;
  ttl: number;
  rdata: Buffer;
  /** Real replies point back at the question rather than repeating the name. */
  pointer?: boolean;
};

function answer({ type, ttl, rdata, pointer = true }: Answer) {
  const owner = pointer
    ? Buffer.from([0xc0, 0x0c]) // points at offset 12, the question's name
    : name('example.com');

  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(1, 2); // class IN
  fixed.writeUInt32BE(ttl, 4);
  fixed.writeUInt16BE(rdata.length, 8);

  return Buffer.concat([owner, fixed, rdata]);
}

function message(domain: string, answers: Answer[] = []) {
  const question = Buffer.concat([
    name(domain),
    Buffer.from([0x00, 0x01, 0x00, 0x01]), // A, IN
  ]);

  return Buffer.concat([
    header({ questions: 1, answers: answers.length }),
    question,
    ...answers.map(answer),
  ]);
}

const A = 1;
const AAAA = 28;
const CNAME = 5;

const ipv4 = (address: string) => Buffer.from(address.split('.').map(Number));

const ipv6 = (groups: number[]) => {
  const buffer = Buffer.alloc(16);
  groups.forEach((group, index) => buffer.writeUInt16BE(group, index * 2));
  return buffer;
};

describe('readQuestionName', () => {
  test('reads the name being asked about', () => {
    expect(readQuestionName(message('example.com'))).toBe('example.com');
    expect(readQuestionName(message('a.b.example.com'))).toBe(
      'a.b.example.com'
    );
  });

  test('lowercases, because DNS names are case-insensitive but patterns are not', () => {
    expect(readQuestionName(message('WWW.Example.COM'))).toBe(
      'www.example.com'
    );
  });

  test('returns null rather than throwing on malformed input', () => {
    expect(readQuestionName(Buffer.alloc(0))).toBeNull();
    expect(readQuestionName(Buffer.alloc(11))).toBeNull();
    expect(readQuestionName(header({ questions: 0, answers: 0 }))).toBeNull();

    // A name that claims more bytes than the message holds.
    const truncated = Buffer.concat([
      header({ questions: 1, answers: 0 }),
      Buffer.from([0x20, 0x61]),
    ]);
    expect(readQuestionName(truncated)).toBeNull();
  });
});

describe('readAnswerRecords', () => {
  test('reads an A record behind a compression pointer', () => {
    const records = readAnswerRecords(
      message('example.com', [
        { type: A, ttl: 300, rdata: ipv4('93.184.216.34') },
      ])
    );

    expect(records).toEqual([{ address: '93.184.216.34', ttl: 300 }]);
  });

  test('reads a literal owner name just as well', () => {
    const records = readAnswerRecords(
      message('example.com', [
        { type: A, ttl: 60, rdata: ipv4('1.2.3.4'), pointer: false },
      ])
    );

    expect(records).toEqual([{ address: '1.2.3.4', ttl: 60 }]);
  });

  test('reads AAAA records in their usual compressed form', () => {
    const records = readAnswerRecords(
      message('example.com', [
        {
          type: AAAA,
          ttl: 120,
          rdata: ipv6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]),
        },
      ])
    );

    expect(records).toEqual([{ address: '2001:db8::1', ttl: 120 }]);
  });

  test('only collapses a run of zero groups, never a single one', () => {
    const read = (groups: number[]) =>
      readAnswerRecords(
        message('example.com', [{ type: AAAA, ttl: 60, rdata: ipv6(groups) }])
      )[0]?.address;

    expect(read([0, 0, 0, 0, 0, 0, 0, 1])).toBe('::1');
    expect(read([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0])).toBe('2001:db8::');
    expect(read([0x2001, 0, 1, 2, 3, 4, 5, 6])).toBe('2001:0:1:2:3:4:5:6');
  });

  test('walks past record types it does not care about', () => {
    const records = readAnswerRecords(
      message('example.com', [
        { type: CNAME, ttl: 300, rdata: name('cdn.example.net') },
        { type: A, ttl: 45, rdata: ipv4('203.0.113.7') },
      ])
    );

    // The upstream already followed the chain; the addresses are right here.
    expect(records).toEqual([{ address: '203.0.113.7', ttl: 45 }]);
  });

  test('collects every address in a multi-answer reply', () => {
    const records = readAnswerRecords(
      message('example.com', [
        { type: A, ttl: 30, rdata: ipv4('1.1.1.1') },
        { type: A, ttl: 30, rdata: ipv4('1.0.0.1') },
        {
          type: AAAA,
          ttl: 30,
          rdata: ipv6([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111]),
        },
      ])
    );

    expect(records.map((record) => record.address)).toEqual([
      '1.1.1.1',
      '1.0.0.1',
      '2606:4700::1111',
    ]);
  });

  test('gives up quietly on a truncated reply', () => {
    const full = message('example.com', [
      { type: A, ttl: 300, rdata: ipv4('93.184.216.34') },
    ]);

    // A reply cut short mid-record must not throw; the client just goes
    // unrouted for that lookup.
    expect(readAnswerRecords(full.subarray(0, full.length - 2))).toEqual([]);
    expect(readAnswerRecords(Buffer.alloc(4))).toEqual([]);
  });

  test('returns nothing when there are no answers', () => {
    expect(readAnswerRecords(message('example.com'))).toEqual([]);
  });

  test('ignores a record whose length does not match its type', () => {
    const records = readAnswerRecords(
      message('example.com', [
        { type: A, ttl: 300, rdata: Buffer.alloc(6) },
        { type: A, ttl: 300, rdata: ipv4('8.8.8.8') },
      ])
    );

    expect(records).toEqual([{ address: '8.8.8.8', ttl: 300 }]);
  });
});

describe('toServFail', () => {
  test('turns the query into a failure response to the same question', () => {
    const query = message('example.com');
    const failure = toServFail(query)!;

    expect(failure.readUInt16BE(0)).toBe(query.readUInt16BE(0)); // same id
    expect(failure[2]! & 0x80).toBe(0x80); // is a response
    expect(failure[3]! & 0x0f).toBe(2); // server failure
    expect(readQuestionName(failure)).toBe('example.com');
  });

  test('refuses to answer something too short to be a query', () => {
    expect(toServFail(Buffer.alloc(4))).toBeNull();
  });
});
