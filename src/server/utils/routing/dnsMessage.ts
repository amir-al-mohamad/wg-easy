import { stringifyIp } from 'ip-bigint';

/**
 * Just enough DNS wire format to watch lookups go by.
 *
 * The proxy needs two things: the name a client asked about, and the addresses
 * that came back with their TTLs. It never builds a message beyond flipping a
 * query into a failure response, so this stays a read-only parser rather than a
 * dependency on a full DNS library.
 */

const HEADER_LENGTH = 12;

/** Two high bits set marks a compression pointer instead of a label length. */
const POINTER_MASK = 0xc0;

const TYPE_A = 1;
const TYPE_AAAA = 28;

const RDLENGTH_A = 4;
const RDLENGTH_AAAA = 16;

export type DnsRecord = {
  address: string;
  /** Seconds the answer may be cached, as the upstream reported it. */
  ttl: number;
};

/**
 * The name from the first question, lowercased and without a trailing dot.
 * Questions never use compression, as there is nothing earlier in the
 * message to point at.
 *
 * @returns the name, or null if the message is malformed or asks nothing
 */
export function readQuestionName(message: Buffer): string | null {
  if (message.length < HEADER_LENGTH) return null;
  if (message.readUInt16BE(4) === 0) return null; // QDCOUNT

  const labels: string[] = [];
  let offset = HEADER_LENGTH;

  while (offset < message.length) {
    const length = message[offset]!;
    if (length === 0) {
      return labels.length > 0 ? labels.join('.').toLowerCase() : null;
    }
    if ((length & POINTER_MASK) === POINTER_MASK) return null;

    offset++;
    if (offset + length > message.length) return null;

    labels.push(message.toString('ascii', offset, offset + length));
    offset += length;
  }

  return null; // ran off the end before the name terminated
}

/**
 * Advance past a name without decoding it.
 *
 * @returns the offset just after the name, or null if it runs off the end
 */
function skipName(message: Buffer, start: number): number | null {
  let offset = start;

  while (offset < message.length) {
    const length = message[offset]!;

    // A pointer is the whole name: two bytes, and the name ends there.
    if ((length & POINTER_MASK) === POINTER_MASK) {
      return offset + 2 <= message.length ? offset + 2 : null;
    }

    offset++;
    if (length === 0) return offset;

    offset += length;
  }

  return null;
}

/**
 * Every A and AAAA address in the answer section.
 *
 * Other record types are skipped rather than followed: a CNAME chain resolved
 * by the upstream already has its addresses in the same answer section, so
 * collecting those is enough.
 *
 * @returns the records found, or an empty array for anything unparsable: a
 * malformed reply should cost the client nothing but an unrouted lookup
 */
export function readAnswerRecords(message: Buffer): DnsRecord[] {
  if (message.length < HEADER_LENGTH) return [];

  const questions = message.readUInt16BE(4);
  const answers = message.readUInt16BE(6);
  if (answers === 0) return [];

  let offset = HEADER_LENGTH;

  // Step over the question section: a name, then QTYPE and QCLASS.
  for (let index = 0; index < questions; index++) {
    const next = skipName(message, offset);
    if (next === null || next + 4 > message.length) return [];
    offset = next + 4;
  }

  const records: DnsRecord[] = [];

  for (let index = 0; index < answers; index++) {
    const next = skipName(message, offset);
    // NAME, then TYPE(2) CLASS(2) TTL(4) RDLENGTH(2).
    if (next === null || next + 10 > message.length) break;

    const type = message.readUInt16BE(next);
    const ttl = message.readUInt32BE(next + 4);
    const rdLength = message.readUInt16BE(next + 8);

    const rdStart = next + 10;
    const rdEnd = rdStart + rdLength;
    if (rdEnd > message.length) break;

    if (type === TYPE_A && rdLength === RDLENGTH_A) {
      records.push({
        address: Array.from(message.subarray(rdStart, rdEnd)).join('.'),
        ttl,
      });
    } else if (type === TYPE_AAAA && rdLength === RDLENGTH_AAAA) {
      // Compressed the way every other tool writes IPv6, so the address matches
      // what ipset prints back and what the UI shows elsewhere.
      const number = BigInt(`0x${message.toString('hex', rdStart, rdEnd)}`);
      records.push({ address: stringifyIp({ number, version: 6 }), ttl });
    }

    offset = rdEnd;
  }

  return records;
}

/**
 * Turn a query into a SERVFAIL response to the same question.
 *
 * Sent when no upstream answered. Without it the client waits out its own
 * timeout, which turns a momentary upstream problem into a visible stall.
 */
export function toServFail(query: Buffer): Buffer | null {
  if (query.length < HEADER_LENGTH) return null;

  const response = Buffer.from(query);
  response[2] = response[2]! | 0x80; // QR: this is a response
  response[3] = (response[3]! & 0xf0) | 0x02; // RCODE: server failure
  return response;
}
