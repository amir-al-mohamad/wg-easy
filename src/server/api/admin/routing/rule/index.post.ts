import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/http/validation';
import { RoutingRuleSchema } from '#shared/contracts/routingRule';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const data = await readValidatedBody(
    event,
    validateZod(RoutingRuleSchema, event)
  );

  await routing.createRule(user, data);
  return { success: true };
});
