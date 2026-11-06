import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import { PublishedForwardSchema } from '#server/utils/routing/forwardChecks';
import { PortForwardGetSchema } from '#shared/contracts/portForward';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { forwardId } = await getValidatedRouterParams(
    event,
    validateZod(PortForwardGetSchema, event)
  );

  const data = await readValidatedBody(
    event,
    validateZod(PublishedForwardSchema, event)
  );

  await routing.updateForward(user, forwardId, data);
  return { success: true };
});
