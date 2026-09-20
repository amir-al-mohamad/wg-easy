import Database from '#server/utils/Database';
import { WG_ENV } from '#server/utils/config';
import { definePermissionEventHandler } from '#server/utils/handler';
import { serverAddresses } from '#server/utils/routing/dnsStatus';

/**
 * Point newly issued client configs at the built-in DNS proxy. Only the
 * default changes: clients with their own resolver keep it, and configs
 * already on devices pick this up when downloaded again.
 */
export default definePermissionEventHandler('admin', 'any', async () => {
  const wgInterface = await Database.interfaces.get();
  const addresses = serverAddresses(wgInterface);

  const defaultDns = WG_ENV.DISABLE_IPV6
    ? [addresses.ipv4]
    : [addresses.ipv4, addresses.ipv6];

  await Database.userConfigs.update({ defaultDns });

  return { success: true };
});
