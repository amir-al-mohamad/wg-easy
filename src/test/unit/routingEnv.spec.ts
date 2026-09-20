import { describe, expect, test } from 'vitest';

import {
  formatForwardPorts,
  isForwardPortPublished,
  parseForwardPorts,
  readForwardPorts,
} from '#server/utils/routing/env';

describe('parseForwardPorts', () => {
  test('accepts ports and ranges in one list', () => {
    expect(parseForwardPorts('34000-34100, 25565,8443')).toEqual([
      { start: 34000, end: 34100 },
      { start: 25565, end: 25565 },
      { start: 8443, end: 8443 },
    ]);
  });

  test('ignores empty entries and stray whitespace', () => {
    expect(parseForwardPorts(' 34000 - 34100 ,, ')).toEqual([
      { start: 34000, end: 34100 },
    ]);
  });

  test('refuses anything that is not a port', () => {
    // Refused rather than defaulted: a forward the UI accepts and the wire
    // never delivers is the harder problem to find.
    for (const bad of ['abc', '0', '65536', '34100-34000', '80/tcp', '1-2-3']) {
      expect(() => parseForwardPorts(bad), bad).toThrow();
    }
  });
});

describe('isForwardPortPublished', () => {
  const specs = parseForwardPorts('34000-34100, 25565');

  test('matches inside any range, inclusive', () => {
    for (const port of [34000, 34050, 34100, 25565]) {
      expect(isForwardPortPublished(port, specs), `${port}`).toBe(true);
    }
  });

  test('rejects everything else', () => {
    for (const port of [33999, 34101, 25564, 25566, 1, 65535]) {
      expect(isForwardPortPublished(port, specs), `${port}`).toBe(false);
    }
  });
});

describe('readForwardPorts', () => {
  test('assumes the default range when nothing is declared', () => {
    expect(readForwardPorts({})).toEqual([{ start: 34000, end: 34100 }]);
  });

  test('a list that is set and empty publishes nothing', () => {
    // The operator has spoken: no port lines in the compose file, no
    // forwards offered. Not the default range, which would go nowhere.
    expect(readForwardPorts({ ROUTER_FORWARD_PORTS: '' })).toEqual([]);
    expect(readForwardPorts({ ROUTER_FORWARD_PORTS: '  ' })).toEqual([]);
    expect(isForwardPortPublished(34000, [])).toBe(false);
  });

  test('the legacy pair adds to the list, empty or not', () => {
    expect(
      readForwardPorts({
        ROUTER_FORWARD_PORTS: '',
        ROUTER_FORWARD_PORT_START: '40000',
        ROUTER_FORWARD_PORT_END: '40010',
      })
    ).toEqual([{ start: 40000, end: 40010 }]);
    expect(
      readForwardPorts({
        ROUTER_FORWARD_PORTS: '25565',
        ROUTER_FORWARD_PORT_START: '40000',
        ROUTER_FORWARD_PORT_END: '40010',
      })
    ).toEqual([
      { start: 25565, end: 25565 },
      { start: 40000, end: 40010 },
    ]);
  });

  test('half a pair takes the default for the missing end', () => {
    expect(readForwardPorts({ ROUTER_FORWARD_PORT_START: '34050' })).toEqual([
      { start: 34050, end: 34100 },
    ]);
  });

  test('refuses a pair that runs backwards', () => {
    expect(() =>
      readForwardPorts({
        ROUTER_FORWARD_PORT_START: '34100',
        ROUTER_FORWARD_PORT_END: '34000',
      })
    ).toThrow();
  });
});

describe('formatForwardPorts', () => {
  test('prints a single port without a range', () => {
    expect(formatForwardPorts(parseForwardPorts('34000-34100,25565'))).toBe(
      '34000-34100, 25565'
    );
  });
});
