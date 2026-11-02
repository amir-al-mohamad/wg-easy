import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';

export default defineAuthenticatedEventHandler(async ({ user }) => {
  await routing.useDnsProxy(user);
  return { success: true };
});
