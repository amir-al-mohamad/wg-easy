import type { InferSelectModel } from 'drizzle-orm';

import type { gateway } from './schema';

export type GatewayType = InferSelectModel<typeof gateway>;
