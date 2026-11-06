import type { InferSelectModel } from 'drizzle-orm';

import type { routingConfig } from './schema';

export type RoutingConfigType = InferSelectModel<typeof routingConfig>;
