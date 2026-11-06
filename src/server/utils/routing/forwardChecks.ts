import { createError } from 'nuxt/server';

import { isForwardPortPublished } from './env';

import { getDatabase } from '#db';
import { WG_ENV } from '#server/utils/config';
import { PortForwardSchema } from '#shared/contracts/portForward';
import { t } from '#shared/contracts/validation';

/**
 * The forward contract, plus the one check only the server can make: whether
 * the container publishes the external port. A forward outside the published
 * ports would be accepted and then never receive a packet.
 */
export const PublishedForwardSchema = PortForwardSchema.refine(
  (forward) => isForwardPortPublished(forward.externalPort),
  {
    message: t('validation.portForward.externalPortRange'),
    path: ['externalPort'],
  }
);

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
  const client = await getDatabase().clients.get(forward.clientId);
  if (!client) {
    throw createError({ status: 400, statusText: 'Client not found' });
  }

  const wgInterface = await getDatabase().interfaces.get();
  const reserved = [Number(WG_ENV.PORT), wgInterface.port];
  if (reserved.includes(forward.externalPort)) {
    throw createError({
      status: 400,
      statusText: `Port ${forward.externalPort} is used by this server`,
    });
  }
}
