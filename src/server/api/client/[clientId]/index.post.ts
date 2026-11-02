import { readValidatedBody } from 'nuxt/server';

import * as clients from '#server/features/vpn/clients';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import {
  ClientGetSchema,
  ClientUpdateBodySchema,
} from '#shared/contracts/client';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { clientId } = await getValidatedRouterParams(
    event,
    validateZod(ClientGetSchema, event)
  );

  const { isolatedFrom, ...data } = await readValidatedBody(
    event,
    validateZod(ClientUpdateBodySchema, event)
  );

  await clients.update(user, clientId, data, isolatedFrom);

  return { success: true };
});
