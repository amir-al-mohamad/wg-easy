import { createError, getValidatedRouterParams, readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { assertForwardTarget } from '#server/utils/routing/forwardChecks';
import { validateZod } from '#server/utils/types';
import {
  PortForwardGetSchema,
  PortForwardUpdateSchema,
} from '#db/repositories/portForward/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { forwardId } = await getValidatedRouterParams(
      event,
      validateZod(PortForwardGetSchema, event)
    );

    const data = await readValidatedBody(
      event,
      validateZod(PortForwardUpdateSchema, event)
    );

    const forward = await Database.portForwards.get(forwardId);
    if (!forward) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Forward not found',
      });
    }

    await assertForwardTarget(data);

    const result = await Database.portForwards.update(forwardId, data);
    if (result.conflict) {
      throw createError({
        statusCode: 409,
        statusMessage: `Port ${data.externalPort}/${result.conflict.protocol} is already forwarded by "${result.conflict.name}"`,
      });
    }

    await router.apply();
    return { success: true };
  }
);
