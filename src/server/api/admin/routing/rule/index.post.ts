import { readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { assertRuleReferences } from '#server/utils/routing/ruleChecks';
import { validateZod } from '#server/utils/types';
import { RoutingRuleCreateSchema } from '#db/repositories/routingRule/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(RoutingRuleCreateSchema, event)
    );

    await assertRuleReferences(data);

    const rule = await Database.routingRules.create(data);
    await router.apply();

    // Resolve straight away rather than leave the rule empty until the
    // scheduler's next pass; a rule that matches nothing for the first half
    // minute reads as broken.
    if (rule.enabled && rule.autoResolve && rule.patterns.length > 0) {
      const config = await Database.routingConfig.get();
      await router.resolve(rule.id, rule.patterns, config.dnsUpstreams);
    }

    return { success: true };
  }
);
