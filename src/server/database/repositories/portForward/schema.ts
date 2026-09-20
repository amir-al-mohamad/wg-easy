import { sql, relations } from 'drizzle-orm';
import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { client } from '../client/schema';

/**
 * Inbound DNAT: a port published on the host is forwarded to one client.
 *
 * `externalPort` must be among the ports the container actually publishes
 * (`ROUTER_FORWARD_PORTS`, which has to match the compose file); a port
 * outside them never reaches the container in the first place.
 */
export const portForward = sqliteTable(
  'port_forwards_table',
  {
    id: int().primaryKey({ autoIncrement: true }),

    name: text().notNull(),
    description: text().notNull().default(''),
    enabled: int({ mode: 'boolean' }).notNull().default(true),

    clientId: int('client_id')
      .notNull()
      .references(() => client.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),

    externalPort: int('external_port').notNull(),
    internalPort: int('internal_port').notNull(),

    /** `both` expands to one rule per protocol when applied. */
    protocol: text({ enum: ['tcp', 'udp', 'both'] }).notNull(),

    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`)
      .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    // Catches exact duplicates. It cannot express that `both` also collides
    // with `tcp` and with `udp` on the same port, so the service layer checks
    // that case explicitly before writing.
    uniqueIndex('external_port_protocol_unique').on(
      table.externalPort,
      table.protocol
    ),
  ]
);

export const portForwardRelations = relations(portForward, ({ one }) => ({
  client: one(client, {
    fields: [portForward.clientId],
    references: [client.id],
  }),
}));
