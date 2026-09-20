import Database from '#server/utils/Database';
import { WG_ENV } from '#server/utils/config';
import { definePermissionEventHandler } from '#server/utils/handler';
import { applyStatus, resolveChain } from '#server/utils/routing/apply';
import { dnsStatus } from '#server/utils/routing/dnsStatus';
import {
  formatForwardPorts,
  isForwardPortPublished,
  ROUTER_ENV,
} from '#server/utils/routing/env';
import {
  handshakeAge,
  handshakeStale,
  hasGlobalIpv6,
  listInterfaces,
  wireguardPeers,
} from '#server/utils/routing/interfaces';
import { countAddresses } from '#server/utils/routing/ipset';

/**
 * Everything the routing page renders, in one request: the sections reference
 * each other, and fetching them separately would let the UI briefly render a
 * rule pointing at a gateway it has not loaded.
 */
export default definePermissionEventHandler('admin', 'any', async () => {
  const wgInterface = await Database.interfaces.get();

  const [config, gateways, rules, forwards, interfaces, userConfig, clients] =
    await Promise.all([
      Database.routingConfig.get(),
      Database.gateways.getAll(),
      Database.routingRules.getAll(),
      Database.portForwards.getAll(),
      listInterfaces([wgInterface.name]),
      Database.userConfigs.get(),
      Database.clients.getAll(),
    ]);

  const up = new Map(interfaces.map((entry) => [entry.name, entry.up]));
  const byId = new Map(gateways.map((gateway) => [gateway.id, gateway]));
  const registered = new Set(gateways.map((gateway) => gateway.interfaceName));

  return {
    /** Whether the last apply worked, and whether applying is possible at all. */
    status: applyStatus(),

    config: {
      defaultAction: config.defaultAction,
      defaultGatewayId: config.defaultGatewayId,
      dnsUpstreams: config.dnsUpstreams,
      dnsInterceptEnabled: config.dnsInterceptEnabled,
    },

    /** So the UI knows whether a gateway's missing IPv6 is worth mentioning. */
    ipv6Enabled: !WG_ENV.DISABLE_IPV6,

    gateways: await Promise.all(
      gateways.map(async (gateway) => {
        // What the chain the operator configured actually amounts to: the
        // engine resolves it the same way, so the UI never claims traffic is
        // going through a fallback the engine decided to drop instead.
        const chain = resolveChain(gateway, byId);

        // The same verdict the apply engine reaches: a WireGuard link whose
        // self-keeping peer has gone quiet is as good as down, and shown so
        // rather than as carrying traffic it is not.
        const peers = await wireguardPeers(gateway.interfaceName);
        const age = handshakeAge(peers);
        // Judged only while the link is up: a down link has an old handshake
        // too, but "down" is the fact worth reporting about it.
        const stale =
          (up.get(gateway.interfaceName) ?? false) && handshakeStale(age);

        return {
          ...gateway,
          // Distinguishes "switched off" from "the container is gone", which
          // the UI has to tell apart: both stop traffic, only one is
          // intentional. Up rather than merely existing, the same test the
          // apply engine uses.
          present: (up.get(gateway.interfaceName) ?? false) && !stale,
          wireguard: peers !== null,
          stale,
          handshakeAge: age === null || !Number.isFinite(age) ? null : age,
          // A gateway with no routable IPv6 carries no IPv6 at all; that
          // traffic is discarded rather than sent down a tunnel that cannot
          // deliver it.
          hasIpv6: await hasGlobalIpv6(gateway.interfaceName),
          unavailableOutcome:
            chain.fallbacks.length > 0
              ? ('gateway' as const)
              : chain.failClosed
                ? ('block' as const)
                : ('direct' as const),
        };
      })
    ),

    rules: await Promise.all(
      rules.map(async (rule) => ({
        ...rule,
        clients: rule.clients.map((link) => link.client).filter(Boolean),
        // How many destinations the rule currently matches, including the ones
        // learned from DNS since the page was last open.
        addressCount: await countAddresses(rule.id),
      }))
    ),

    forwards: forwards.map((forward) => ({
      ...forward,
      // Whether the container publishes the outside port at all. A forward
      // outside the published ports is kept but not installed, and shown so.
      published: isForwardPortPublished(forward.externalPort),
    })),

    /**
     * Whether clients will actually reach the DNS proxy. Domain rules are
     * inert for any client resolving elsewhere, and nothing about that is
     * visible from the rule list itself.
     */
    dns: dnsStatus(wgInterface, userConfig, clients),

    /** Every client, for the rule and forward pickers. */
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      ipv4Address: client.ipv4Address,
      enabled: client.enabled,
    })),

    /** Interfaces that could still be registered as a gateway. */
    availableInterfaces: interfaces.filter(
      (entry) => !registered.has(entry.name)
    ),

    forwardPorts: {
      specs: ROUTER_ENV.FORWARD_PORTS,
      text: formatForwardPorts(ROUTER_ENV.FORWARD_PORTS),
    },
  };
});
