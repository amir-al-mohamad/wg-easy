import { sql, relations } from 'drizzle-orm';
import { int, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { gateway } from '../gateway/schema';
import { client } from '../client/schema';

/**
 * One entry in the ordered match list. The first enabled rule whose patterns or
 * addresses match a packet's destination decides where it goes; traffic that
 * matches nothing falls through to `routingConfig.defaultAction`.
 */
export const routingRule = sqliteTable('routing_rules_table', {
  id: int().primaryKey({ autoIncrement: true }),

  name: text().notNull(),
  description: text().notNull().default(''),
  enabled: int({ mode: 'boolean' }).notNull().default(true),

  /** Position in the match order; lowest wins. */
  sortOrder: int('sort_order').notNull(),

  /** What to do with matching traffic. */
  action: text({ enum: ['gateway', 'direct', 'block'] }).notNull(),

  /**
   * Set when `action` is `gateway`. `restrict` on delete so a gateway still in
   * use cannot disappear out from under its rules; the UI reports which rules
   * hold it instead.
   */
  gatewayId: int('gateway_id').references(() => gateway.id, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),

  /** Domain patterns, see `#shared/utils/pattern`. */
  patterns: text({ mode: 'json' }).$type<string[]>().notNull(),

  /** Literal addresses and CIDRs, v4 and v6, entered by hand. */
  addresses: text({ mode: 'json' }).$type<string[]>().notNull(),

  /** Re-resolve `patterns` on a schedule instead of only on demand. */
  autoResolve: int('auto_resolve', { mode: 'boolean' })
    .notNull()
    .default(false),

  createdAt: text('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
});

/**
 * Scopes a rule to specific clients; no rows means every client. Cascades on
 * the client side, so a deleted client leaves no stale ids behind.
 */
export const routingRuleClient = sqliteTable(
  'routing_rule_clients_table',
  {
    ruleId: int('rule_id')
      .notNull()
      .references(() => routingRule.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    clientId: int('client_id')
      .notNull()
      .references(() => client.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
  },
  (table) => [primaryKey({ columns: [table.ruleId, table.clientId] })]
);

export const routingRuleRelations = relations(routingRule, ({ one, many }) => ({
  gateway: one(gateway, {
    fields: [routingRule.gatewayId],
    references: [gateway.id],
  }),
  clients: many(routingRuleClient),
}));

export const routingRuleClientRelations = relations(
  routingRuleClient,
  ({ one }) => ({
    rule: one(routingRule, {
      fields: [routingRuleClient.ruleId],
      references: [routingRule.id],
    }),
    client: one(client, {
      fields: [routingRuleClient.clientId],
      references: [client.id],
    }),
  })
);
