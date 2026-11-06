import type { InferSelectModel } from 'drizzle-orm';

import type { portForward } from './schema';

export type PortForwardType = InferSelectModel<typeof portForward>;
