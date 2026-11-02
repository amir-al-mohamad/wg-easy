import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import { RoutingRuleGetSchema } from '#db/repositories/routingRule/types';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { ruleId } = await getValidatedRouterParams(
    event,
    validateZod(RoutingRuleGetSchema, event)
  );

  await routing.clearRule(user, ruleId);
  return { success: true };
});
