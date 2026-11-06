import { asc, eq, max } from 'drizzle-orm';

import { routingRule, routingRuleClient } from './schema';

import type { RoutingRuleInputType } from '#shared/contracts/routingRule';
import type { DBExecutor } from '#db/types';

/**
 * Everything the apply engine and the UI need about a rule, in one shape:
 * the gateway it points at and the addresses of the clients it is scoped to.
 */
const withRelations = {
  gateway: true,
  clients: {
    with: {
      client: {
        columns: {
          id: true,
          name: true,
          ipv4Address: true,
          ipv6Address: true,
          enabled: true,
        },
      },
    },
  },
} as const;

/**
 * Match order. The id breaks ties so two rules created at the same instant
 * cannot swap places between one apply and the next.
 */
const matchOrder = [asc(routingRule.sortOrder), asc(routingRule.id)];

async function replaceClients(
  tx: DBExecutor,
  ruleId: number,
  clientIds: readonly number[]
) {
  await tx
    .delete(routingRuleClient)
    .where(eq(routingRuleClient.ruleId, ruleId));

  if (clientIds.length === 0) {
    return;
  }

  await tx
    .insert(routingRuleClient)
    .values(clientIds.map((clientId) => ({ ruleId, clientId })));
}

export class RoutingRuleRepository {
  constructor(private readonly db: DBExecutor) {}

  /** In match order, the order the apply engine emits them in. */
  async getAll() {
    return this.db.query.routingRule.findMany({
      orderBy: matchOrder,
      with: withRelations,
    });
  }

  async get(id: number) {
    return this.db.query.routingRule.findFirst({
      where: eq(routingRule.id, id),
      with: withRelations,
    });
  }

  async create(data: RoutingRuleInputType) {
    const { clientIds, ...rule } = data;

    return this.db.transaction(async (tx) => {
      // Read inside the transaction: the position is the rule's whole meaning,
      // and two creates reading it outside could both claim the same slot.
      const [last] = await tx
        .select({ value: max(routingRule.sortOrder) })
        .from(routingRule);

      const [created] = await tx
        .insert(routingRule)
        .values({
          ...rule,
          gatewayId: rule.action === 'gateway' ? rule.gatewayId : null,
          sortOrder: (last?.value ?? -1) + 1,
        })
        .returning();

      await replaceClients(tx, created!.id, clientIds);

      return created!;
    });
  }

  async update(id: number, data: RoutingRuleInputType) {
    const { clientIds, ...rule } = data;

    return this.db.transaction(async (tx) => {
      await tx
        .update(routingRule)
        .set({
          ...rule,
          gatewayId: rule.action === 'gateway' ? rule.gatewayId : null,
        })
        .where(eq(routingRule.id, id));

      await replaceClients(tx, id, clientIds);
    });
  }

  /**
   * Rewrite the match order from a list of ids, most specific first.
   *
   * Ids missing from the list keep their relative order after the listed ones,
   * so a stale client that posts a partial list cannot silently drop a rule out
   * of the ordering.
   */
  async reorder(ids: readonly number[]) {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: routingRule.id })
        .from(routingRule)
        .orderBy(...matchOrder);

      const ordered = [
        ...ids.filter((id) => existing.some((rule) => rule.id === id)),
        ...existing.map((rule) => rule.id).filter((id) => !ids.includes(id)),
      ];

      for (const [index, id] of ordered.entries()) {
        await tx
          .update(routingRule)
          .set({ sortOrder: index })
          .where(eq(routingRule.id, id));
      }
    });
  }

  async delete(id: number) {
    return this.db.delete(routingRule).where(eq(routingRule.id, id));
  }
}
