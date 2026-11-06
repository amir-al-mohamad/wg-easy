import { readValidatedBody } from 'nuxt/server';

import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import {
  RoutingRuleGetSchema,
  RoutingRuleSchema,
} from '#shared/contracts/routingRule';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { ruleId } = await getValidatedRouterParams(
    event,
    validateZod(RoutingRuleGetSchema, event)
  );

  const data = await readValidatedBody(
    event,
    validateZod(RoutingRuleSchema, event)
  );

  await routing.updateRule(user, ruleId, data);
  return { success: true };
});
