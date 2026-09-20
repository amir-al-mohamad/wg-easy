import { describe, expect, test } from 'vitest';

import {
  matchesAny,
  matchesPattern,
  parsePattern,
  resolvableDomains,
} from '#shared/utils/pattern';

describe('parsePattern', () => {
  test('classifies each supported shape', () => {
    expect(parsePattern('example.com')).toEqual({
      pattern: 'example.com',
      kind: 'exact',
    });
    expect(parsePattern('*.example.com')).toEqual({
      pattern: '*.example.com',
      kind: 'subdomains',
    });
    expect(parsePattern('.example.com')).toEqual({
      pattern: '.example.com',
      kind: 'domainAndSub',
    });
    expect(parsePattern('*micro*')).toEqual({
      pattern: '*micro*',
      kind: 'contains',
    });
    expect(parsePattern('micro*')).toEqual({
      pattern: 'micro*',
      kind: 'startsWith',
    });
    expect(parsePattern('*soft')).toEqual({
      pattern: '*soft',
      kind: 'endsWith',
    });
    expect(parsePattern('*.foo.*.bar')).toEqual({
      pattern: '*.foo.*.bar',
      kind: 'glob',
    });
    expect(parsePattern('*')).toEqual({ pattern: '*', kind: 'any' });
  });

  test('normalizes case, surrounding space and the root dot', () => {
    expect(parsePattern('  ExAmPle.COM.  ')).toEqual({
      pattern: 'example.com',
      kind: 'exact',
    });
  });

  test('rejects input that cannot be a domain pattern', () => {
    expect(parsePattern('')).toBeNull();
    expect(parsePattern('   ')).toBeNull();
    expect(parsePattern('localhost')).toBeNull();
    expect(parsePattern('example.com/path')).toBeNull();
    expect(parsePattern('two words.com')).toBeNull();
    expect(parsePattern('*.localhost')).toBeNull();
    expect(parsePattern('.localhost')).toBeNull();
    expect(parsePattern('example.123')).toBeNull();
    expect(parsePattern('-bad.com')).toBeNull();
    expect(parsePattern(`${'a'.repeat(250)}.com`)).toBeNull();
  });

  test('rejects patterns made only of wildcards, which would silently match all', () => {
    expect(parsePattern('**')).toBeNull();
    expect(parsePattern('***')).toBeNull();
  });
});

describe('matchesPattern', () => {
  test('matches an exact domain and nothing around it', () => {
    expect(matchesPattern('example.com', 'example.com')).toBe(true);
    expect(matchesPattern('www.example.com', 'example.com')).toBe(false);
    expect(matchesPattern('notexample.com', 'example.com')).toBe(false);
  });

  test('excludes the apex for a subdomain pattern', () => {
    expect(matchesPattern('www.example.com', '*.example.com')).toBe(true);
    expect(matchesPattern('a.b.example.com', '*.example.com')).toBe(true);
    expect(matchesPattern('example.com', '*.example.com')).toBe(false);
    expect(matchesPattern('badexample.com', '*.example.com')).toBe(false);
  });

  test('includes the apex for a leading-dot pattern', () => {
    expect(matchesPattern('example.com', '.example.com')).toBe(true);
    expect(matchesPattern('www.example.com', '.example.com')).toBe(true);
    expect(matchesPattern('badexample.com', '.example.com')).toBe(false);
  });

  test('applies glob shapes', () => {
    expect(matchesPattern('login.microsoft.com', '*micro*')).toBe(true);
    expect(matchesPattern('example.com', '*micro*')).toBe(false);
    expect(matchesPattern('microsoft.com', 'micro*')).toBe(true);
    expect(matchesPattern('login.microsoft.com', 'micro*')).toBe(false);
    expect(matchesPattern('cdn.jsoft', '*soft')).toBe(true);
  });

  test('treats a bare star as everything', () => {
    expect(matchesPattern('anything.example.org', '*')).toBe(true);
  });

  test('does not let regex metacharacters in a pattern act as wildcards', () => {
    expect(matchesPattern('aXc.com', 'a.c.com')).toBe(false);
    expect(matchesPattern('exampleXcom', 'example.com')).toBe(false);
    expect(matchesPattern('bc.com', 'a?bc.com')).toBe(false);
  });

  test('escapes metacharacters inside a glob, where they reach a real regex', () => {
    // A glob is the only shape compiled into a RegExp, so this is the path
    // where an unescaped `.` would silently widen the pattern to any character.
    expect(matchesPattern('xxa.cyy.com', '*a.c*')).toBe(true);
    expect(matchesPattern('xxaZcyy.com', '*a.c*')).toBe(false);

    expect(matchesPattern('cdn(1).example.com', '*(1)*')).toBe(true);
    expect(matchesPattern('cdn1.example.com', '*(1)*')).toBe(false);

    expect(matchesPattern('a+b.example.com', '*a+b*')).toBe(true);
    expect(matchesPattern('aab.example.com', '*a+b*')).toBe(false);

    // `?` is not a wildcard here, only `*` is.
    expect(matchesPattern('aXb.example.com', '*a?b*')).toBe(false);
    expect(matchesPattern('a?b.example.com', '*a?b*')).toBe(true);
  });

  test('anchors a glob so it must span the whole name', () => {
    expect(matchesPattern('login.microsoft.com', 'micro*')).toBe(false);
    expect(matchesPattern('microsoft.com', 'micro*')).toBe(true);
  });

  test('compares case-insensitively and ignores the root dot', () => {
    expect(matchesPattern('WWW.Example.COM.', '*.example.com')).toBe(true);
  });

  test('matches nothing for an unparsable pattern', () => {
    expect(matchesPattern('example.com', 'example.com/path')).toBe(false);
    expect(matchesPattern('example.com', '')).toBe(false);
  });
});

describe('matchesAny', () => {
  test('is true when at least one pattern matches', () => {
    const patterns = ['example.org', '*.example.com'];
    expect(matchesAny('www.example.com', patterns)).toBe(true);
    expect(matchesAny('example.org', patterns)).toBe(true);
    expect(matchesAny('example.net', patterns)).toBe(false);
    expect(matchesAny('example.com', [])).toBe(false);
  });
});

describe('resolvableDomains', () => {
  test('returns the literal names a pattern implies', () => {
    expect(resolvableDomains('example.com')).toEqual(['example.com']);
    expect(resolvableDomains('.example.com')).toEqual(['example.com']);
    expect(resolvableDomains('*.example.com')).toEqual([
      'example.com',
      'www.example.com',
    ]);
  });

  test('returns nothing for patterns with no finite expansion', () => {
    expect(resolvableDomains('*')).toEqual([]);
    expect(resolvableDomains('*micro*')).toEqual([]);
    expect(resolvableDomains('not a pattern')).toEqual([]);
  });
});
