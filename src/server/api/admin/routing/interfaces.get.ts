import * as routing from '#server/features/routing';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';

export default defineAuthenticatedEventHandler(async ({ user }) => {
  return routing.interfaces(user);
});
