import { asc, eq, sql } from 'drizzle-orm';

import { gateway } from './schema';
import type { GatewayCreateType, GatewayUpdateType } from './types';

import { allocate, hasCapacity } from '#server/utils/routing/marks';
import type { ID } from '#server/utils/types';
import { routingConfig } from '#db/repositories/routingConfig/schema';
import { routingRule } from '#db/repositories/routingRule/schema';
import type { DBType } from '#db/sqlite';

function createPreparedStatement(db: DBType) {
  return {
    findAll: db.query.gateway.findMany({ orderBy: asc(gateway.id) }).prepare(),
    get: db.query.gateway
      .findFirst({ where: eq(gateway.id, sql.placeholder('id')) })
      .prepare(),
    getByInterface: db.query.gateway
      .findFirst({
        where: eq(gateway.interfaceName, sql.placeholder('interfaceName')),
      })
      .prepare(),
  };
}

export class GatewayService {
  #db: DBType;
  #statements: ReturnType<typeof createPreparedStatement>;

  constructor(db: DBType) {
    this.#db = db;
    this.#statements = createPreparedStatement(db);
  }

  getAll() {
    return this.#statements.findAll.execute();
  }

  get(id: ID) {
    return this.#statements.get.execute({ id });
  }

  getByInterface(interfaceName: string) {
    return this.#statements.getByInterface.execute({ interfaceName });
  }

  /**
   * Register an interface as a gateway, allocating it a permanent mark and
   * routing table.
   *
   * @returns the created gateway, or the reason it could not be
   */
  create({ interfaceName, name }: GatewayCreateType) {
    return this.#db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: gateway.id })
        .from(gateway)
        .where(eq(gateway.interfaceName, interfaceName));
      if (existing) return { error: 'exists' as const };

      const taken = await tx
        .select({ fwmark: gateway.fwmark, routeTable: gateway.routeTable })
        .from(gateway);
      if (!hasCapacity(taken)) return { error: 'full' as const };

      const [created] = await tx
        .insert(gateway)
        .values({
          interfaceName,
          name: name ?? interfaceName,
          ...allocate(taken),
        })
        .returning();

      return { created: created! };
    });
  }

  update(id: ID, data: GatewayUpdateType) {
    return this.#db
      .update(gateway)
      .set(data)
      .where(eq(gateway.id, id))
      .execute();
  }

  /**
   * Rules and the default action hold a `restrict` reference, so deleting a
   * gateway still in use raises a foreign-key error. Look the holders up first
   * so the caller can name them instead of surfacing a bare constraint failure.
   */
  async getUsage(id: ID) {
    const rules = await this.#db
      .select({ id: routingRule.id, name: routingRule.name })
      .from(routingRule)
      .where(eq(routingRule.gatewayId, id));

    const [config] = await this.#db
      .select({ id: routingConfig.id })
      .from(routingConfig)
      .where(eq(routingConfig.defaultGatewayId, id));

    const fallbackOf = await this.#db
      .select({ id: gateway.id, name: gateway.name })
      .from(gateway)
      .where(eq(gateway.fallbackGatewayId, id));

    return { rules, isDefault: config !== undefined, fallbackOf };
  }

  delete(id: ID) {
    return this.#db.delete(gateway).where(eq(gateway.id, id)).execute();
  }
}
