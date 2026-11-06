import type { TypedInternalResponse } from 'nitropack/types';

import type { RoutingAction } from '#shared/utils/routing';

/** Everything the routing page renders, as the API returns it. */
export type RoutingOverview = TypedInternalResponse<
  '/api/admin/routing',
  unknown,
  'get'
>;

export type RoutingGateway = RoutingOverview['gateways'][number];
export type RoutingRule = RoutingOverview['rules'][number];
export type RoutingClient = RoutingOverview['clients'][number];
export type PortForward = RoutingOverview['forwards'][number];
export type RoutingConfig = RoutingOverview['config'];
export type ForwardPorts = RoutingOverview['forwardPorts'];
export type DnsStatus = RoutingOverview['dns'];
export type ApplyStatus = RoutingOverview['status'];

/**
 * An action and, for `gateway`, which gateway, as one select value: the UI
 * offers "through this gateway" as a single choice where the data has two
 * fields.
 */
export type ActionChoice =
  Exclude<RoutingAction, 'gateway'> | `gateway:${number}`;

/** The choice for sending traffic through one gateway. */
export function gatewayChoice(gatewayId: number): ActionChoice {
  return `gateway:${gatewayId}`;
}

/** The choice for an action, or none for a gateway action with no gateway yet. */
export function toActionChoice(
  action: RoutingAction,
  gatewayId: number | null
): ActionChoice | undefined {
  if (action !== 'gateway') {
    return action;
  }
  return gatewayId === null ? undefined : gatewayChoice(gatewayId);
}

export function fromActionChoice(choice: ActionChoice): {
  action: RoutingAction;
  gatewayId: number | null;
} {
  if (choice === 'direct' || choice === 'block') {
    return { action: choice, gatewayId: null };
  }
  return {
    action: 'gateway',
    gatewayId: Number(choice.slice('gateway:'.length)),
  };
}
