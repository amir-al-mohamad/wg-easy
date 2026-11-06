import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import {
  GatewayGetSchema,
  GatewayUpdateSchema,
} from '#shared/contracts/gateway';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { gatewayId } = await getValidatedRouterParams(
    event,
    validateZod(GatewayGetSchema, event)
  );

  const data = await readValidatedBody(
    event,
    validateZod(GatewayUpdateSchema, event)
  );

  await routing.updateGateway(user, gatewayId, data);
  return { success: true };
});
