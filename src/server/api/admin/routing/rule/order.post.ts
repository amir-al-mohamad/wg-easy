import { readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { validateZod } from '#server/utils/types';
import { RoutingRuleReorderSchema } from '#db/repositories/routingRule/types';

/** Rule ids in the order they should be matched, most specific first. */
export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const ids = await readValidatedBody(
      event,
      validateZod(RoutingRuleReorderSchema, event)
    );

    await Database.routingRules.reorder(ids);
    await router.apply();

    return { success: true };
  }
);
