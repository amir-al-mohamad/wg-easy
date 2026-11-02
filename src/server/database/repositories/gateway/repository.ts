import { asc, eq } from 'drizzle-orm';

import { gateway } from './schema';
import type { GatewayCreateType, GatewayUpdateType } from './types';

import { allocate, hasCapacity } from '#server/utils/routing/marks';
import { routingConfig } from '#db/repositories/routingConfig/schema';
import { routingRule } from '#db/repositories/routingRule/schema';
import type { DBExecutor } from '#db/types';

export class GatewayRepository {
  constructor(private readonly db: DBExecutor) {}

  async getAll() {
    return this.db.query.gateway.findMany({ orderBy: asc(gateway.id) });
  }

  async get(id: number) {
    return this.db.query.gateway.findFirst({ where: eq(gateway.id, id) });
  }

  async getByInterface(interfaceName: string) {
    return this.db.query.gateway.findFirst({
      where: eq(gateway.interfaceName, interfaceName),
    });
  }

  /**
   * Register an interface as a gateway, allocating it a permanent mark and
   * routing table.
   *
   * @returns the created gateway, or the reason it could not be
   */
  async create({ interfaceName, name }: GatewayCreateType) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: gateway.id })
        .from(gateway)
        .where(eq(gateway.interfaceName, interfaceName));
      if (existing) {
        return { error: 'exists' as const };
      }

      const taken = await tx
        .select({ fwmark: gateway.fwmark, routeTable: gateway.routeTable })
        .from(gateway);
      if (!hasCapacity(taken)) {
        return { error: 'full' as const };
      }

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

  async update(id: number, data: GatewayUpdateType) {
    return this.db.update(gateway).set(data).where(eq(gateway.id, id));
  }

  /**
   * Rules and the default action hold a `restrict` reference, so deleting a
   * gateway still in use raises a foreign-key error. Look the holders up first
   * so the caller can name them instead of surfacing a bare constraint failure.
   */
  async getUsage(id: number) {
    const rules = await this.db
      .select({ id: routingRule.id, name: routingRule.name })
      .from(routingRule)
      .where(eq(routingRule.gatewayId, id));

    const [config] = await this.db
      .select({ id: routingConfig.id })
      .from(routingConfig)
      .where(eq(routingConfig.defaultGatewayId, id));

    const fallbackOf = await this.db
      .select({ id: gateway.id, name: gateway.name })
      .from(gateway)
      .where(eq(gateway.fallbackGatewayId, id));

    return { rules, isDefault: config !== undefined, fallbackOf };
  }

  async delete(id: number) {
    return this.db.delete(gateway).where(eq(gateway.id, id));
  }
}
