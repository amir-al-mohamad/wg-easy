import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { PublishedForwardSchema } from '#server/utils/routing/forwardChecks';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const data = await readValidatedBody(
    event,
    validateZod(PublishedForwardSchema, event)
  );

  await routing.createForward(user, data);
  return { success: true };
});
