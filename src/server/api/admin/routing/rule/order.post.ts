import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { RoutingRuleReorderSchema } from '#db/repositories/routingRule/types';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const ids = await readValidatedBody(
    event,
    validateZod(RoutingRuleReorderSchema, event)
  );

  await routing.reorderRules(user, ids);
  return { success: true };
});
