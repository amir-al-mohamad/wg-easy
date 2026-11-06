import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';
import { validateZod, getValidatedRouterParams } from '#server/http/validation';
import { RoutingRuleGetSchema } from '#shared/contracts/routingRule';

export default defineAuthenticatedEventHandler(async ({ event, user }) => {
  const { ruleId } = await getValidatedRouterParams(
    event,
    validateZod(RoutingRuleGetSchema, event)
  );

  await routing.deleteRule(user, ruleId);
  return { success: true };
});
