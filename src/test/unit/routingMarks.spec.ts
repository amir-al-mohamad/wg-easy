import { describe, expect, test } from 'vitest';

import {
  allocate,
  GATEWAY_MARK_MAX,
  GATEWAY_MARK_MIN,
  GATEWAY_TABLE_MAX,
  GATEWAY_TABLE_MIN,
  hasCapacity,
  RULE_PRIORITY_MAX,
  RULE_PRIORITY_MIN,
} from '#server/utils/routing/marks';

describe('allocate', () => {
  test('starts at the bottom of each range', () => {
    expect(allocate([])).toEqual({
      fwmark: `0x${GATEWAY_MARK_MIN.toString(16)}`,
      routeTable: GATEWAY_TABLE_MIN,
    });
  });

  test('skips marks and tables already handed out', () => {
    expect(
      allocate([
        { fwmark: '0x100', routeTable: 100 },
        { fwmark: '0x101', routeTable: 101 },
      ])
    ).toEqual({ fwmark: '0x102', routeTable: 102 });
  });

  test('reuses a gap left by a deleted gateway', () => {
    // Allocating past the gap instead would exhaust the range on an install
    // that churns gateways, while most of it sat free.
    expect(
      allocate([
        { fwmark: '0x100', routeTable: 100 },
        { fwmark: '0x102', routeTable: 102 },
      ])
    ).toEqual({ fwmark: '0x101', routeTable: 101 });
  });

  test('allocates mark and table independently', () => {
    expect(allocate([{ fwmark: '0x105', routeTable: 100 }])).toEqual({
      fwmark: '0x100',
      routeTable: 101,
    });
  });

  test('reads existing marks as hexadecimal', () => {
    // Every mark in the range taken, each on its own table. Under a decimal
    // parse none of these would register as used and the first would be handed
    // out again; only a hex parse sees the range as full.
    const marks = Array.from(
      { length: GATEWAY_MARK_MAX - GATEWAY_MARK_MIN + 1 },
      (_, index) => ({
        fwmark: `0x${(GATEWAY_MARK_MIN + index).toString(16)}`,
        routeTable: GATEWAY_TABLE_MIN,
      })
    );

    expect(() => allocate(marks)).toThrow(/packet mark/i);
  });

  test('refuses rather than colliding once the tables are full', () => {
    const full = Array.from(
      { length: GATEWAY_TABLE_MAX - GATEWAY_TABLE_MIN + 1 },
      (_, index) => ({
        fwmark: `0x${(GATEWAY_MARK_MIN + index).toString(16)}`,
        routeTable: GATEWAY_TABLE_MIN + index,
      })
    );

    expect(hasCapacity(full)).toBe(false);
    expect(() => allocate(full)).toThrow(/routing table/i);
  });
});

describe('priority band', () => {
  test('covers every gateway plus direct and block', () => {
    // The sweep of previously installed rules is bounded by this band, so it
    // has to reach the last priority a full set of gateways would use.
    const gateways = GATEWAY_TABLE_MAX - GATEWAY_TABLE_MIN + 1;
    expect(RULE_PRIORITY_MAX).toBe(RULE_PRIORITY_MIN + gateways + 1);
  });
});
