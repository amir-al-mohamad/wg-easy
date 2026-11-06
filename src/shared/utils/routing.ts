/** What a rule, or the default, does with matching traffic. */
export const routingActions = ['gateway', 'direct', 'block'] as const;
export type RoutingAction = (typeof routingActions)[number];

/** What a gateway does with its traffic while its interface cannot carry it. */
export const unavailableActions = ['block', 'direct', 'gateway'] as const;
export type UnavailableAction = (typeof unavailableActions)[number];

export const forwardProtocols = ['tcp', 'udp', 'both'] as const;
export type ForwardProtocol = (typeof forwardProtocols)[number];

export const forwardProtocolLabels: Record<ForwardProtocol, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  both: 'TCP + UDP',
};
