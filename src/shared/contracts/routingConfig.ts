import { isIP } from 'is-ip';
import z from 'zod';

import { EnabledSchema, t } from '#shared/contracts/validation';
import { RoutingActionSchema } from '#shared/contracts/routingRule';

/**
 * Plain addresses only: the proxy talks to these itself, so a hostname
 * here would need resolving by something, and that something would be us.
 */
const DnsUpstreamsSchema = z
  .array(
    z
      .string({ message: t('validation.routingConfig.dnsUpstreams') })
      .trim()
      .refine((value) => isIP(value), {
        message: t('validation.routingConfig.dnsUpstreamsInvalid'),
      }),
    { message: t('validation.routingConfig.dnsUpstreams') }
  )
  .min(1, { message: t('validation.routingConfig.dnsUpstreams') });

export const RoutingConfigUpdateSchema = z
  .object({
    defaultAction: RoutingActionSchema,
    defaultGatewayId: z.number().int().positive().nullable().default(null),
    dnsUpstreams: DnsUpstreamsSchema,
    dnsProxyEnabled: EnabledSchema,
  })
  .refine(
    (config) =>
      config.defaultAction !== 'gateway' || config.defaultGatewayId !== null,
    {
      message: t('validation.routingConfig.gatewayRequired'),
      path: ['defaultGatewayId'],
    }
  );

export type RoutingConfigUpdateType = z.infer<typeof RoutingConfigUpdateSchema>;
