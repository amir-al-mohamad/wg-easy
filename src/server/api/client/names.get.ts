import * as clientQueries from '#server/features/vpn/queries';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';

export default defineAuthenticatedEventHandler(async ({ user }) => {
  return clientQueries.names(user);
});
