import type { InferSelectModel } from 'drizzle-orm';

import type { routingRule } from './schema';

export type RoutingRuleType = InferSelectModel<typeof routingRule>;
