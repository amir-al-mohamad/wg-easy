import { createError, getValidatedRouterParams } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { ensureSets } from '#server/utils/routing/ipset';
import { validateZod } from '#server/utils/types';
import { RoutingRuleGetSchema } from '#db/repositories/routingRule/types';

/**
 * Resolve the rule's domains now. Returns what happened rather than
 * `{ success: true }`: a rule whose domains all failed to resolve would
 * otherwise look like one that worked.
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

    const config = await Database.routingConfig.get();

    await ensureSets(ruleId);
    // No apply afterwards: the sets are already referenced by the live chain,
    // so new members take effect immediately.
    return await router.resolve(ruleId, rule.patterns, config.dnsUpstreams);
  }
);
