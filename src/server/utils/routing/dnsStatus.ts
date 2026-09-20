import { parseCidr } from 'cidr-tools';
import { stringifyIp } from 'ip-bigint';

import { isDnsProxyListening } from './dns';

import type { DnsStatus } from '#shared/utils/routingTypes';
import type { ClientType } from '#db/repositories/client/types';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { UserConfigType } from '#db/repositories/userConfig/types';

/**
 * Whether clients will actually send their lookups to the built-in proxy.
 *
 * Domain rules only work for lookups the proxy gets to see. A client configured
 * with a public resolver bypasses the whole mechanism, and the failure is
 * invisible: rules sit there looking active while matching nothing. So rather
 * than quietly rewriting anyone's DNS settings, the state is surfaced and the
 * fix is offered explicitly.
 */

/** The server's own address on the client-facing interface, per family. */
export function serverAddresses(wgInterface: InterfaceType) {
  const v4 = parseCidr(wgInterface.ipv4Cidr);
  const v6 = parseCidr(wgInterface.ipv6Cidr);

  return {
    // The first host address of each range, which is what the server binds,
    // derived the same way the interface config does it.
    ipv4: stringifyIp({ number: v4.start + 1n, version: 4 }),
    ipv6: stringifyIp({ number: v6.start + 1n, version: 6 }),
  };
}

type DnsClient = Pick<ClientType, 'id' | 'name' | 'dns'>;

export function dnsStatus(
  wgInterface: InterfaceType,
  userConfig: UserConfigType,
  clients: readonly DnsClient[]
): DnsStatus {
  const addresses = serverAddresses(wgInterface);
  const ours = new Set([addresses.ipv4, addresses.ipv6]);

  const usesProxy = (servers: readonly string[]) =>
    servers.length > 0 && servers.every((server) => ours.has(server));

  return {
    serverAddresses: addresses,
    defaultUsesProxy: usesProxy(userConfig.defaultDns),
    currentDefault: userConfig.defaultDns,
    listening: isDnsProxyListening(),
    clientsBypassing: clients
      .filter((client) => client.dns !== null && !usesProxy(client.dns))
      .map((client) => ({
        id: client.id,
        name: client.name,
        dns: client.dns ?? [],
      })),
  };
}
