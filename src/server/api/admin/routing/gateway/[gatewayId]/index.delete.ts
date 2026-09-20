import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import { GatewayGetSchema } from '#db/repositories/gateway/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { gatewayId } = await getValidatedRouterParams(
      event,
      validateZod(GatewayGetSchema, event)
    );

    const gateway = await Database.gateways.get(gatewayId);
    if (!gateway) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Gateway not found',
      });
    }

    // The foreign keys would refuse this anyway, but a bare constraint error
    // tells the reader nothing about which rules are in the way.
    const usage = await Database.gateways.getUsage(gatewayId);
    if (
      usage.isDefault ||
      usage.rules.length > 0 ||
      usage.fallbackOf.length > 0
    ) {
      const holders = [
        ...(usage.isDefault ? ['the default action'] : []),
        ...usage.rules.map((rule) => `rule "${rule.name}"`),
        ...usage.fallbackOf.map((other) => `gateway "${other.name}"`),
      ];

      throw createError({
        statusCode: 409,
        statusMessage: `Still used by ${holders.join(', ')}`,
        data: { rules: usage.rules, isDefault: usage.isDefault },
      });
    }

    await Database.gateways.delete(gatewayId);
    await router.apply();

    return { success: true };
  }
);
