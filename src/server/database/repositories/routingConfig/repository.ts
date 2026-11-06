import { eq } from 'drizzle-orm';

import { routingConfig } from './schema';

import type { RoutingConfigUpdateType } from '#shared/contracts/routingConfig';
import type { DBExecutor } from '#db/types';

const SINGLETON_ID = 1;

export class RoutingConfigRepository {
  constructor(private readonly db: DBExecutor) {}

  async get() {
    const config = await this.db.query.routingConfig.findFirst({
      where: eq(routingConfig.id, SINGLETON_ID),
    });
    if (!config) {
      throw new Error('Routing config not found');
    }
    return config;
  }

  async update(data: RoutingConfigUpdateType) {
    return this.db
      .update(routingConfig)
      .set({
        ...data,
        defaultGatewayId:
          data.defaultAction === 'gateway' ? data.defaultGatewayId : null,
      })
      .where(eq(routingConfig.id, SINGLETON_ID));
  }
}
