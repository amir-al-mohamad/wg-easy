import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import { GatewayGetSchema } from '#db/repositories/gateway/types';

/**
 * Make a WireGuard gateway handshake anew, with the link left as it is and
 * the routes through it re-applied in the same step. Any other interface is
 * refused.
 */
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

    let answered: boolean;
    try {
      answered = await router.reconnect(gateway.interfaceName);
    } catch {
      throw createError({
        statusCode: 409,
        statusMessage: 'Interface is not a WireGuard link, or is gone',
      });
    }

    // The reconnect happened either way; whether the far end took it up is
    // the caller's to show, not an error of the request.
    return { success: true, answered };
  }
);
