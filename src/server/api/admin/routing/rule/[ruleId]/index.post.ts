import { createError, getValidatedRouterParams, readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { assertRuleReferences } from '#server/utils/routing/ruleChecks';
import { validateZod } from '#server/utils/types';
import {
  RoutingRuleGetSchema,
  RoutingRuleUpdateSchema,
} from '#db/repositories/routingRule/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { ruleId } = await getValidatedRouterParams(
      event,
      validateZod(RoutingRuleGetSchema, event)
    );

    const data = await readValidatedBody(
      event,
      validateZod(RoutingRuleUpdateSchema, event)
    );

    const rule = await Database.routingRules.get(ruleId);
    if (!rule) {
      throw createError({ statusCode: 404, statusMessage: 'Rule not found' });
    }

    await assertRuleReferences(data);

    await Database.routingRules.update(ruleId, data);
    // Addresses dropped from the rule are removed from its sets by the apply
    // pass, which reconciles them against what the rule now says.
    await router.apply();

    // Resolve now when auto-resolve has just been switched on, or when the
    // domains changed while it was already on. Waiting for the scheduler would
    // leave the rule matching nothing for up to half a minute, which is
    // indistinguishable from it not working.
    const patternsChanged =
      JSON.stringify(rule.patterns) !== JSON.stringify(data.patterns);
    const shouldResolve =
      data.enabled &&
      data.autoResolve &&
      data.patterns.length > 0 &&
      (!rule.autoResolve || patternsChanged);

    if (shouldResolve) {
      const config = await Database.routingConfig.get();
      await router.resolve(ruleId, data.patterns, config.dnsUpstreams);
    }

    return { success: true };
  }
);
