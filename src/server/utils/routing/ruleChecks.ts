import { createError } from 'nuxt/server';

import { getDatabase } from '#db';

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
    const gateway = await getDatabase().gateways.get(rule.gatewayId);
    if (!gateway) {
      throw createError({
        status: 400,
        statusText: 'Gateway not found',
      });
    }
  }

  if (rule.clientIds.length > 0) {
    const clients = await getDatabase().clients.getAll();
    const known = new Set(clients.map((client) => client.id));
    const missing = rule.clientIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw createError({
        status: 400,
        statusText: `Client not found: ${missing.join(', ')}`,
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
  const gateway = await getDatabase().gateways.get(config.defaultGatewayId);
  if (!gateway) {
    throw createError({ status: 400, statusText: 'Gateway not found' });
  }
}
