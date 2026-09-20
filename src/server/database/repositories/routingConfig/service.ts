import { eq } from 'drizzle-orm';

import { routingConfig } from './schema';
import type { RoutingConfigUpdateType } from './types';

import type { DBType } from '#db/sqlite';

const SINGLETON_ID = 1;

function createPreparedStatement(db: DBType) {
  return {
    get: db.query.routingConfig
      .findFirst({ where: eq(routingConfig.id, SINGLETON_ID) })
      .prepare(),
  };
}

export class RoutingConfigService {
  #db: DBType;
  #statements: ReturnType<typeof createPreparedStatement>;

  constructor(db: DBType) {
    this.#db = db;
    this.#statements = createPreparedStatement(db);
  }

  async get() {
    const config = await this.#statements.get.execute();
    if (!config) {
      throw new Error('Routing config not found');
    }
    return config;
  }

  update(data: RoutingConfigUpdateType) {
    return this.#db
      .update(routingConfig)
      .set({
        ...data,
        defaultGatewayId:
          data.defaultAction === 'gateway' ? data.defaultGatewayId : null,
      })
      .where(eq(routingConfig.id, SINGLETON_ID))
      .execute();
  }
}
