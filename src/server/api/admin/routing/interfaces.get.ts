import Database from '#server/utils/Database';
import { definePermissionEventHandler } from '#server/utils/handler';
import { listInterfaces } from '#server/utils/routing/interfaces';

/**
 * Links visible in this network namespace, for the gateway picker. A sidecar
 * wired up with `network_mode: "service:wg-easy"` shows up as soon as it
 * starts.
 */
export default definePermissionEventHandler('admin', 'any', async () => {
  const wgInterface = await Database.interfaces.get();
  return await listInterfaces([wgInterface.name]);
});
