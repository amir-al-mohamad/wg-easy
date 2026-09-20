import { readValidatedBody } from 'h3';

import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { router } from '#server/utils/routing';
import { assertDefaultGateway } from '#server/utils/routing/ruleChecks';
import { validateZod } from '#server/utils/types';
import { RoutingConfigUpdateSchema } from '#db/repositories/routingConfig/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(RoutingConfigUpdateSchema, event)
    );

    await assertDefaultGateway(data);

    await Database.routingConfig.update(data);
    await router.apply();

    return { success: true };
  }
);
