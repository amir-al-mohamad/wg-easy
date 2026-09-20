import { sql, relations } from 'drizzle-orm';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { gateway } from '../gateway/schema';

/** Single row, id 1, like `general_table`. */
export const routingConfig = sqliteTable('routing_config_table', {
  id: int().primaryKey({ autoIncrement: false }).default(1),

  /** Where traffic goes when no rule matched it. */
  defaultAction: text('default_action', {
    enum: ['gateway', 'direct', 'block'],
  })
    .notNull()
    .default('direct'),

  /** Set when `defaultAction` is `gateway`. */
  defaultGatewayId: int('default_gateway_id').references(() => gateway.id, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),

  /** Resolvers the built-in DNS proxy forwards to, tried in order. */
  dnsUpstreams: text('dns_upstreams', { mode: 'json' })
    .$type<string[]>()
    .notNull(),

  /**
   * Answer clients' lookups here so domain rules can learn from them. Off by
   * default, so an install that never uses routing has no resolver bound on
   * its tunnel address.
   */
  dnsInterceptEnabled: int('dns_intercept_enabled', { mode: 'boolean' })
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

export const routingConfigRelations = relations(routingConfig, ({ one }) => ({
  defaultGateway: one(gateway, {
    fields: [routingConfig.defaultGatewayId],
    references: [gateway.id],
  }),
}));
