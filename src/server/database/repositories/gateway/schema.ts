import { sql, relations } from 'drizzle-orm';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { routingRule } from '../routingRule/schema';

/**
 * An upstream interface traffic can be steered into: a WireGuard, AmneziaWG or
 * TUN device brought up by a sidecar container that shares this container's
 * network namespace (`network_mode: "service:wg-easy"`).
 *
 * `fwmark` and `routeTable` are allocated once and never change: a mark that
 * shifted under an established connection would strand it.
 */
export const gateway = sqliteTable('gateways_table', {
  id: int().primaryKey({ autoIncrement: true }),

  /** Kernel interface name, e.g. `tun0`. At most one gateway per interface. */
  interfaceName: text('interface_name').notNull().unique(),

  /** Label shown in the UI. Defaults to the interface name on creation. */
  name: text().notNull(),

  /** Packet mark that steers traffic here, e.g. `0x100`. */
  fwmark: text().notNull().unique(),

  /** Routing table owned by this gateway; holds a single default route. */
  routeTable: int('route_table').notNull().unique(),

  /**
   * A disabled gateway keeps its name, mark and table but carries no traffic:
   * rules pointing at it fall through to the default action. Toggling it off
   * is how the UI "unregisters" an interface without losing its label.
   */
  enabled: int({ mode: 'boolean' }).notNull().default(true),

  /**
   * What happens to traffic steered here while the interface is missing, down
   * or unable to carry the family: dropped (the default, so a rule that
   * promised a tunnel never falls back to the open internet), sent direct, or
   * sent through another gateway.
   */
  unavailableAction: text('unavailable_action', {
    enum: ['block', 'direct', 'gateway'],
  })
    .notNull()
    .default('block'),

  /**
   * The gateway to use instead when `unavailableAction` is `gateway`. Its own
   * setting applies when it is unavailable too, so chains form; a loop or a
   * switched-off gateway ends in dropping.
   */
  fallbackGatewayId: int('fallback_gateway_id').references(
    (): AnySQLiteColumn => gateway.id,
    { onDelete: 'restrict', onUpdate: 'cascade' }
  ),

  createdAt: text('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
});

export const gatewayRelations = relations(gateway, ({ many }) => ({
  rules: many(routingRule),
}));
