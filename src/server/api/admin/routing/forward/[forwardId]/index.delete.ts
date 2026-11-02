import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import { PortForwardGetSchema } from '#db/repositories/portForward/types';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { forwardId } = await getValidatedRouterParams(
    event,
    validateZod(PortForwardGetSchema, event)
  );

  await routing.deleteForward(user, forwardId);
  return { success: true };
});
