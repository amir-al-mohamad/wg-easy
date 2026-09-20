import { createError, readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import { GatewayCreateSchema } from '#db/repositories/gateway/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(GatewayCreateSchema, event)
    );

    const wgInterface = await Database.interfaces.get();
    if (data.interfaceName === wgInterface.name) {
      throw createError({
        statusCode: 400,
        statusMessage: `${wgInterface.name} carries this server's own clients and cannot be a gateway`,
      });
    }

    const result = await Database.gateways.create(data);
    if ('error' in result) {
      throw createError({
        statusCode: 409,
        statusMessage:
          result.error === 'exists'
            ? `${data.interfaceName} is already a gateway`
            : 'No more gateways can be added',
      });
    }

    await router.apply();
    return { success: true };
  }
);
