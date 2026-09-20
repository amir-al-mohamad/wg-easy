import type { InferSelectModel } from 'drizzle-orm';
import z from 'zod';

import type { portForward } from './schema';

import {
  controlStringRefine,
  EnabledSchema,
  PortSchema,
  safeStringRefine,
  t,
} from '#server/utils/types';
import { isForwardPortPublished } from '#server/utils/routing/env';

export type PortForwardType = InferSelectModel<typeof portForward>;

export const ProtocolSchema = z.enum(['tcp', 'udp', 'both'], {
  message: t('zod.portForward.protocol'),
});

export type Protocol = z.infer<typeof ProtocolSchema>;

export const PortForwardCreateSchema = z.object({
  name: z
    .string({ message: t('zod.portForward.name') })
    .min(1, { message: t('zod.portForward.name') })
    .max(128, { message: t('zod.portForward.name') })
    .pipe(safeStringRefine)
    .pipe(controlStringRefine),
  description: z
    .string({ message: t('zod.portForward.description') })
    .max(512, { message: t('zod.portForward.description') })
    .pipe(safeStringRefine)
    .pipe(controlStringRefine)
    .default(''),
  enabled: EnabledSchema.default(true),
  clientId: z
    .number({ message: t('zod.portForward.client') })
    .int()
    .positive(),
  externalPort: PortSchema.refine((port) => isForwardPortPublished(port), {
    message: t('zod.portForward.externalPortRange'),
  }),
  internalPort: PortSchema,
  protocol: ProtocolSchema,
});

export const PortForwardUpdateSchema = PortForwardCreateSchema;

export type PortForwardCreateType = z.infer<typeof PortForwardCreateSchema>;
export type PortForwardUpdateType = z.infer<typeof PortForwardUpdateSchema>;

/**
 * Protocols that would collide with `protocol` on the same external port.
 *
 * `both` occupies TCP and UDP at once, so it clashes with either, which the
 * unique index on (port, protocol) cannot express on its own.
 */
export function conflictingProtocols(protocol: Protocol): Protocol[] {
  return protocol === 'both' ? ['tcp', 'udp', 'both'] : [protocol, 'both'];
}

const forwardId = z.coerce.number({ message: t('zod.portForward.id') });

export const PortForwardGetSchema = z.object({ forwardId });
