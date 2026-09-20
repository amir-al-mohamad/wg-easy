import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { flushSets } from '#server/utils/routing/ipset';
import { validateZod } from '#server/utils/types';
import { RoutingRuleGetSchema } from '#db/repositories/routingRule/types';

/**
 * Forget every address the rule learned, for when a service moved. The apply
 * puts back the ones typed into the rule.
 */
export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { ruleId } = await getValidatedRouterParams(
      event,
      validateZod(RoutingRuleGetSchema, event)
    );

    const rule = await Database.routingRules.get(ruleId);
    if (!rule) {
      throw createError({ statusCode: 404, statusMessage: 'Rule not found' });
    }

    await flushSets(ruleId);
    await router.apply();

    return { success: true };
  }
);
