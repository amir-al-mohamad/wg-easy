import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { RoutingConfigUpdateSchema } from '#shared/contracts/routingConfig';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const data = await readValidatedBody(
    event,
    validateZod(RoutingConfigUpdateSchema, event)
  );

  await routing.updateConfig(user, data);
  return { success: true };
});
