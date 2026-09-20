import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import { PortForwardGetSchema } from '#db/repositories/portForward/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { forwardId } = await getValidatedRouterParams(
      event,
      validateZod(PortForwardGetSchema, event)
    );

    const forward = await Database.portForwards.get(forwardId);
    if (!forward) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Forward not found',
      });
    }

    await Database.portForwards.delete(forwardId);
    await router.apply();

    return { success: true };
  }
);
