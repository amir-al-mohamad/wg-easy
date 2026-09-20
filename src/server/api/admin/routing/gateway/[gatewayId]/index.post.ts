import { createError, getValidatedRouterParams, readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import {
  GatewayGetSchema,
  GatewayUpdateSchema,
} from '#db/repositories/gateway/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { gatewayId } = await getValidatedRouterParams(
      event,
      validateZod(GatewayGetSchema, event)
    );

    const data = await readValidatedBody(
      event,
      validateZod(GatewayUpdateSchema, event)
    );

    const gateway = await Database.gateways.get(gatewayId);
    if (!gateway) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Gateway not found',
      });
    }

    // The foreign key only guarantees the fallback exists. Pointing a gateway
    // at itself is a loop of length one, which the plan would tolerate by
    // dropping; better refused.
    if (data.fallbackGatewayId !== null) {
      if (data.fallbackGatewayId === gatewayId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'A gateway cannot fall back to itself',
        });
      }
      if (!(await Database.gateways.get(data.fallbackGatewayId))) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fallback gateway not found',
        });
      }
    }

    await Database.gateways.update(gatewayId, data);
    await router.apply();

    return { success: true };
  }
);
