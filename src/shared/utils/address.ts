import { parseCidr } from 'cidr-tools';
import { stringifyIp } from 'ip-bigint';
import { isIP } from 'is-ip';
import isCidr from 'is-cidr';

export type Canonical = {
  address: string;
  family: 4 | 6;
  /** `true` for `0.0.0.0/0` and `::/0` in any spelling. */
  catchAll: boolean;
};

/**
 * Write an address the way ipset prints it back: host prefix dropped
 * (`1.2.3.4/32` to `1.2.3.4`), host bits cleared (`10.0.0.1/8` to
 * `10.0.0.0/8`), IPv6 compressed. A value typed into a rule then compares
 * equal to the same value read back from the kernel.
 */
export function canonical(entry: string): Canonical | null {
  const value = entry.trim();
  if (!isIP(value) && isCidr(value) === 0) {
    return null;
  }

  const cidr = parseCidr(value);
  const family = cidr.version;
  const prefix = Number(cidr.prefix);
  const network = stringifyIp({ number: cidr.start, version: family });
  const full = family === 4 ? 32 : 128;

  return {
    address: prefix === full ? network : `${network}/${prefix}`,
    family,
    catchAll: prefix === 0,
  };
}
