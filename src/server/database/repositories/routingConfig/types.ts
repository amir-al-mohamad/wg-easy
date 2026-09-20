import type { InferSelectModel } from 'drizzle-orm';
import { isIP } from 'is-ip';
import z from 'zod';

import type { routingConfig } from './schema';

import { EnabledSchema, t } from '#server/utils/types';
import { RoutingActionSchema } from '#db/repositories/routingRule/types';

export type RoutingConfigType = InferSelectModel<typeof routingConfig>;

/**
 * Plain addresses only: the proxy talks to these over UDP itself, so a hostname
 * here would need resolving by something, and that something would be us.
 */
const DnsUpstreamsSchema = z
  .array(
    z
      .string({ message: t('zod.routingConfig.dnsUpstreams') })
      .trim()
      .refine((value) => isIP(value), {
        message: t('zod.routingConfig.dnsUpstreamsInvalid'),
      }),
    { message: t('zod.routingConfig.dnsUpstreams') }
  )
  .min(1, { message: t('zod.routingConfig.dnsUpstreams') });

export const RoutingConfigUpdateSchema = z
  .object({
    defaultAction: RoutingActionSchema,
    defaultGatewayId: z.number().int().positive().nullable().default(null),
    dnsUpstreams: DnsUpstreamsSchema,
    dnsInterceptEnabled: EnabledSchema,
  })
  .refine(
    (config) =>
      config.defaultAction !== 'gateway' || config.defaultGatewayId !== null,
    {
      message: t('zod.routingConfig.gatewayRequired'),
      path: ['defaultGatewayId'],
    }
  );

export type RoutingConfigUpdateType = z.infer<typeof RoutingConfigUpdateSchema>;
