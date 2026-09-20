/**
 * The shapes the routing page works with: the single description of each
 * object, shared by the API handler that produces it and every component that
 * consumes it.
 *
 * Declared here rather than inferred from the handler because the page passes
 * them between components, and an inferred type would drag the whole server
 * module graph into the client bundle to say what a rule looks like.
 */

export type RoutingAction = 'gateway' | 'direct' | 'block';

/** What a gateway does with its traffic while its interface cannot carry it. */
export type GatewayUnavailableAction = 'block' | 'direct' | 'gateway';

export type RoutingGateway = {
  id: number;
  name: string;
  interfaceName: string;
  fwmark: string;
  routeTable: number;
  enabled: boolean;
  /** The interface is up and, as far as can be told, answering right now. */
  present: boolean;
  /** The interface carries a routable IPv6 address. */
  hasIpv6: boolean;
  /** The interface is a WireGuard link, so it can be reconnected in place. */
  wireguard: boolean;
  /**
   * The interface is up but its far end has stopped answering: a WireGuard
   * peer that keeps itself alive has not handshaked for too long.
   */
  stale: boolean;
  /** Seconds since that peer's last handshake; null when never, or not judged. */
  handshakeAge: number | null;
  /** Dropped, sent as with no gateway, or sent through another gateway. */
  unavailableAction: GatewayUnavailableAction;
  /** The other gateway, when `unavailableAction` is `gateway`. */
  fallbackGatewayId: number | null;
  /**
   * What the setting amounts to once the chain is followed: `gateway` only
   * when a usable fallback exists, else what the chain ends in.
   */
  unavailableOutcome: GatewayUnavailableAction;
};

export type RoutingClient = {
  id: number;
  name: string;
  ipv4Address: string;
  enabled: boolean;
};

export type RoutingRule = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  action: RoutingAction;
  gatewayId: number | null;
  gateway: { id: number; name: string } | null;
  patterns: string[];
  addresses: string[];
  autoResolve: boolean;
  /** Clients the rule is scoped to; empty means all of them. */
  clients: RoutingClient[];
  /** Destinations currently matched, including those learned from DNS. */
  addressCount: number;
};

export type PortForwardProtocol = 'tcp' | 'udp' | 'both';

export const PROTOCOL_LABELS: Record<PortForwardProtocol, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  both: 'TCP + UDP',
};

export type PortForward = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  clientId: number;
  externalPort: number;
  internalPort: number;
  protocol: PortForwardProtocol;
  client: { id: number; name: string; ipv4Address: string } | null;
  /** Whether the container publishes the outside port; if not, the forward is kept but not installed. */
  published: boolean;
};

/** The host ports inbound forwards may use, as the environment declares them. */
export type ForwardPorts = {
  specs: { start: number; end: number }[];
  /** `34000-34100, 25565` */
  text: string;
};

export type RoutingConfig = {
  defaultAction: RoutingAction;
  defaultGatewayId: number | null;
  dnsUpstreams: string[];
  dnsInterceptEnabled: boolean;
};

export type DnsStatus = {
  /** Addresses clients should be pointed at. */
  serverAddresses: { ipv4: string; ipv6: string };
  /** Whether the default handed to clients already points here. */
  defaultUsesProxy: boolean;
  /** What the default currently is, for showing what would change. */
  currentDefault: string[];
  /** Whether the proxy is actually bound, as opposed to merely switched on. */
  listening: boolean;
  /**
   * Clients that override the default with their own resolver. These keep
   * bypassing the proxy even after the default is fixed, so they are named
   * rather than silently rewritten.
   */
  clientsBypassing: { id: number; name: string; dns: string[] }[];
};

/** How the last kernel apply went; see `applyStatus` on the server. */
export type ApplyStatus = {
  at: number | null;
  /** Commands that failed; -1 when the apply itself threw. */
  failures: number;
  available: boolean;
};
