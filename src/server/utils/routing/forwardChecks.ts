import { createError } from 'h3';

import Database from '#server/utils/Database';
import { WG_ENV } from '#server/utils/config';

/**
 * Refuse a forward that the schema alone cannot rule out.
 *
 * The client id is a foreign key, and letting the insert discover that it is
 * dangling turns a bad request into an opaque 500. And nothing in the schema
 * knows which ports this server itself listens on: a forward on the admin UI
 * or the WireGuard port would DNAT them into a client, locking the operator
 * out with no way back through the UI.
 */
export async function assertForwardTarget(forward: {
  clientId: number;
  externalPort: number;
}) {
  const client = await Database.clients.get(forward.clientId);
  if (!client) {
    throw createError({ statusCode: 400, statusMessage: 'Client not found' });
  }

  const wgInterface = await Database.interfaces.get();
  const reserved = [Number(WG_ENV.PORT), wgInterface.port];
  if (reserved.includes(forward.externalPort)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Port ${forward.externalPort} is used by this server`,
    });
  }
}
