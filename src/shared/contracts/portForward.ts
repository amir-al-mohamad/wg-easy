import z from 'zod';

import {
  controlStringRefine,
  EnabledSchema,
  PortSchema,
  safeStringRefine,
  t,
} from '#shared/contracts/validation';
import { forwardProtocols } from '#shared/utils/routing';

export const ProtocolSchema = z.enum(forwardProtocols, {
  message: t('validation.portForward.protocol'),
});

/**
 * Whether the container publishes the external port is checked on the server,
 * which alone knows what the environment declares; see `PublishedForwardSchema`.
 */
export const PortForwardSchema = z.object({
  name: z
    .string({ message: t('validation.portForward.name') })
    .min(1, { message: t('validation.portForward.name') })
    .max(128, { message: t('validation.portForward.name') })
    .pipe(safeStringRefine)
    .pipe(controlStringRefine),
  description: z
    .string({ message: t('validation.portForward.description') })
    .max(512, { message: t('validation.portForward.description') })
    .pipe(safeStringRefine)
    .pipe(controlStringRefine)
    .default(''),
  enabled: EnabledSchema.default(true),
  clientId: z
    .number({ message: t('validation.portForward.client') })
    .int()
    .positive(),
  externalPort: PortSchema,
  internalPort: PortSchema,
  protocol: ProtocolSchema,
});

export type PortForwardInputType = z.infer<typeof PortForwardSchema>;

const forwardId = z.coerce.number({ message: t('validation.portForward.id') });

export const PortForwardGetSchema = z.object({ forwardId });
