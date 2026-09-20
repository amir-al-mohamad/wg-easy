import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { destroySets } from '#server/utils/routing/ipset';
import { validateZod } from '#server/utils/types';
import { RoutingRuleGetSchema } from '#db/repositories/routingRule/types';

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

    await Database.routingRules.delete(ruleId);
    // Apply first: the sets are still referenced by iptables until the chain is
    // rebuilt, and ipset refuses to destroy a set that is in use.
    await router.apply();
    await destroySets(ruleId);

    return { success: true };
  }
);
