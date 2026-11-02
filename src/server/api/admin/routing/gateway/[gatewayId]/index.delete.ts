import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import { GatewayGetSchema } from '#db/repositories/gateway/types';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { gatewayId } = await getValidatedRouterParams(
    event,
    validateZod(GatewayGetSchema, event)
  );

  await routing.deleteGateway(user, gatewayId);
  return { success: true };
});
