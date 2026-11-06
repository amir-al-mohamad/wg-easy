import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { GatewayCreateSchema } from '#shared/contracts/gateway';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const data = await readValidatedBody(
    event,
    validateZod(GatewayCreateSchema, event)
  );

  await routing.createGateway(user, data);
  return { success: true };
});
