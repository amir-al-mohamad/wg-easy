import { createError } from 'h3';

import Database from '#server/utils/Database';

/**
 * Refuse a rule whose references do not resolve.
 *
 * Both are foreign keys, and letting the insert discover a dangling one turns
 * a bad request into an opaque 500.
 */
export async function assertRuleReferences(rule: {
  action: string;
  gatewayId: number | null;
  clientIds: readonly number[];
}) {
  if (rule.action === 'gateway' && rule.gatewayId !== null) {
    const gateway = await Database.gateways.get(rule.gatewayId);
    if (!gateway) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Gateway not found',
      });
    }
  }

  if (rule.clientIds.length > 0) {
    const clients = await Database.clients.getAll();
    const known = new Set(clients.map((client) => client.id));
    const missing = rule.clientIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Client not found: ${missing.join(', ')}`,
      });
    }
  }
}

export async function assertDefaultGateway(config: {
  defaultAction: string;
  defaultGatewayId: number | null;
}) {
  if (config.defaultAction !== 'gateway' || config.defaultGatewayId === null) {
    return;
  }
  const gateway = await Database.gateways.get(config.defaultGatewayId);
  if (!gateway) {
    throw createError({ statusCode: 400, statusMessage: 'Gateway not found' });
  }
}
