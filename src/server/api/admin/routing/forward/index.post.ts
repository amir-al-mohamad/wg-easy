import { createError, readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { assertForwardTarget } from '#server/utils/routing/forwardChecks';
import { validateZod } from '#server/utils/types';
import { PortForwardCreateSchema } from '#db/repositories/portForward/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(PortForwardCreateSchema, event)
    );

    await assertForwardTarget(data);

    const result = await Database.portForwards.create(data);
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
