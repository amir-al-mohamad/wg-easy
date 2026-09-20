/**
 * Domain patterns for routing rules.
 *
 * Shared between the DNS proxy, which matches every lookup against them, and
 * the rule editor, which shows the reader what a pattern they just typed will
 * actually match. Keeping one implementation means the badge in the UI can
 * never disagree with the routing decision.
 */

export const PATTERN_KINDS = [
  /** `example.com`: that name and nothing else. */
  'exact',
  /** `*.example.com`: subdomains only, not the apex. */
  'subdomains',
  /** `.example.com`: the apex and every subdomain. */
  'domainAndSub',
  /** `*micro*` */
  'contains',
  /** `micro*` */
  'startsWith',
  /** `*soft` */
  'endsWith',
  /** Any other shape containing `*`. */
  'glob',
  /** `*`: every domain. */
  'any',
] as const;

export type PatternKind = (typeof PATTERN_KINDS)[number];

export type ParsedPattern = {
  /** The normalized pattern: trimmed, lowercased, trailing dot removed. */
  pattern: string;
  kind: PatternKind;
};

/** Longest a fully qualified domain name may be. */
const MAX_LENGTH = 253;

/**
 * Labels of 1-63 characters made of letters, digits and inner hyphens, ending
 * in an alphabetic TLD. Deliberately stricter than the DNS grammar: it rejects
 * single-label names, which are never a useful routing target.
 */
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalize(raw: string) {
  return raw.trim().toLowerCase().replace(/\.$/, '');
}

function countStars(value: string) {
  let stars = 0;
  for (const character of value) {
    if (character === '*') stars++;
  }
  return stars;
}

/**
 * Classify a pattern as the user typed it.
 *
 * @returns the normalized pattern and what it matches, or `null` if the input
 * cannot be a pattern at all.
 */
export function parsePattern(raw: string): ParsedPattern | null {
  const pattern = normalize(raw);

  if (
    pattern.length === 0 ||
    pattern.length > MAX_LENGTH ||
    pattern.includes('/') ||
    /\s/.test(pattern)
  ) {
    return null;
  }

  if (pattern === '*') {
    return { pattern, kind: 'any' };
  }

  const stars = countStars(pattern);

  if (stars === 0) {
    if (pattern.startsWith('.')) {
      return DOMAIN.test(pattern.slice(1))
        ? { pattern, kind: 'domainAndSub' }
        : null;
    }
    return DOMAIN.test(pattern) ? { pattern, kind: 'exact' } : null;
  }

  if (stars === 1 && pattern.startsWith('*.')) {
    return DOMAIN.test(pattern.slice(2))
      ? { pattern, kind: 'subdomains' }
      : null;
  }

  // A pattern of nothing but stars would match everything while looking like it
  // narrows something down.
  if (pattern.replace(/\*/g, '').length === 0) {
    return null;
  }

  if (stars === 1) {
    if (pattern.startsWith('*')) return { pattern, kind: 'endsWith' };
    if (pattern.endsWith('*')) return { pattern, kind: 'startsWith' };
  }

  if (stars === 2 && pattern.startsWith('*') && pattern.endsWith('*')) {
    return { pattern, kind: 'contains' };
  }

  return { pattern, kind: 'glob' };
}

const REGEX_SPECIALS = /[.+^${}()|[\]\\?]/g;

function globToRegExp(pattern: string) {
  const source = pattern.replace(REGEX_SPECIALS, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}

/** Whether `domain` matches `pattern`. An unparsable pattern matches nothing. */
export function matchesPattern(domain: string, pattern: string): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;

  const name = normalize(domain);
  if (name.length === 0) return false;

  switch (parsed.kind) {
    case 'any':
      return true;
    case 'exact':
      return name === parsed.pattern;
    case 'subdomains': {
      const base = parsed.pattern.slice(2);
      return name.endsWith(`.${base}`);
    }
    case 'domainAndSub': {
      const base = parsed.pattern.slice(1);
      return name === base || name.endsWith(`.${base}`);
    }
    default:
      return globToRegExp(parsed.pattern).test(name);
  }
}

/** Does any pattern in the list match? */
export function matchesAny(
  domain: string,
  patterns: readonly string[]
): boolean {
  return patterns.some((pattern) => matchesPattern(domain, pattern));
}

/**
 * Names worth resolving to warm a rule's address set before any client asks.
 * Deliberately coarse: only literal names can be resolved at all, so this is
 * a convenience, not the mechanism. For `*.example.com` the apex is included
 * even though the pattern excludes it, because apex and subdomains almost
 * always share addresses.
 */
export function resolvableDomains(pattern: string): string[] {
  const parsed = parsePattern(pattern);
  if (!parsed) return [];

  switch (parsed.kind) {
    case 'exact':
      return [parsed.pattern];
    case 'domainAndSub':
      return [parsed.pattern.slice(1)];
    case 'subdomains': {
      const base = parsed.pattern.slice(2);
      return [base, `www.${base}`];
    }
    default:
      return [];
  }
}
