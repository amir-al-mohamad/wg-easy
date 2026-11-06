import z from 'zod';

import {
  controlStringRefine,
  EnabledSchema,
  safeStringRefine,
  t,
} from '#shared/contracts/validation';
import { unavailableActions } from '#shared/utils/routing';

/**
 * Kernel interface name: at most IFNAMSIZ-1 (15) bytes, restricted to the
 * portable subset. `ip` rejects anything else anyway, but catching it here
 * keeps a typo from ever reaching a command line.
 */
export const InterfaceNameSchema = z
  .string({ message: t('validation.gateway.interfaceName') })
  .min(1, { message: t('validation.gateway.interfaceName') })
  .max(15, { message: t('validation.gateway.interfaceName') })
  .regex(/^[a-zA-Z0-9_.-]+$/, {
    message: t('validation.gateway.interfaceNameInvalid'),
  })
  .pipe(safeStringRefine)
  .pipe(controlStringRefine);

const GatewayNameSchema = z
  .string({ message: t('validation.gateway.name') })
  .min(1, { message: t('validation.gateway.name') })
  .max(128, { message: t('validation.gateway.name') })
  .pipe(safeStringRefine)
  .pipe(controlStringRefine);

export const GatewayCreateSchema = z.object({
  interfaceName: InterfaceNameSchema,
  /** Defaults to the interface name when omitted. */
  name: GatewayNameSchema.optional(),
});

/** See the `unavailableAction` column for what each value means. */
export const UnavailableActionSchema = z.enum(unavailableActions, {
  message: t('validation.gateway.unavailableAction'),
});

export const GatewayUpdateSchema = z
  .object({
    name: GatewayNameSchema,
    enabled: EnabledSchema,
    unavailableAction: UnavailableActionSchema,
    fallbackGatewayId: z
      .number({ message: t('validation.gateway.fallbackGatewayId') })
      .int()
      .positive()
      .nullable()
      .default(null),
  })
  .refine(
    (data) =>
      data.unavailableAction !== 'gateway' || data.fallbackGatewayId !== null,
    { message: t('validation.gateway.fallbackGatewayIdInvalid') }
  )
  // A fallback only means anything with the matching action; drop a stale one
  // rather than carry it around until it silently takes effect later.
  .transform((data) => ({
    ...data,
    fallbackGatewayId:
      data.unavailableAction === 'gateway' ? data.fallbackGatewayId : null,
  }));

export type GatewayCreateType = z.infer<typeof GatewayCreateSchema>;
export type GatewayUpdateType = z.infer<typeof GatewayUpdateSchema>;

const gatewayId = z.coerce.number({ message: t('validation.gateway.id') });

export const GatewayGetSchema = z.object({ gatewayId });
