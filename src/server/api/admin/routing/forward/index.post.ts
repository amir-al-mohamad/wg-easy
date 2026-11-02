import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { PortForwardCreateSchema } from '#db/repositories/portForward/types';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const data = await readValidatedBody(
    event,
    validateZod(PortForwardCreateSchema, event)
  );

  await routing.createForward(user, data);
  return { success: true };
});
