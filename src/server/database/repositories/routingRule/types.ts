import type { InferSelectModel } from 'drizzle-orm';
import z from 'zod';

import type { routingRule } from './schema';

import { canonical } from '#server/utils/routing/ipset';
import {
  controlStringRefine,
  EnabledSchema,
  safeStringRefine,
  t,
} from '#server/utils/types';
import { parsePattern } from '#shared/utils/pattern';

export type RoutingRuleType = InferSelectModel<typeof routingRule>;

export const RoutingActionSchema = z.enum(['gateway', 'direct', 'block'], {
  message: t('zod.routingRule.action'),
});

export type RoutingAction = z.infer<typeof RoutingActionSchema>;

const NameSchema = z
  .string({ message: t('zod.routingRule.name') })
  .min(1, { message: t('zod.routingRule.name') })
  .max(128, { message: t('zod.routingRule.name') })
  .pipe(safeStringRefine)
  .pipe(controlStringRefine);

const DescriptionSchema = z
  .string({ message: t('zod.routingRule.description') })
  .max(512, { message: t('zod.routingRule.description') })
  .pipe(safeStringRefine)
  .pipe(controlStringRefine);

/**
 * Patterns are stored normalized (lowercased, trimmed, root dot removed), so
 * the same name typed two ways cannot produce two rules that look different
 * but behave identically.
 */
const PatternsSchema = z.array(
  z
    .string({ message: t('zod.routingRule.pattern') })
    .transform((value) => parsePattern(value))
    .refine((parsed) => parsed !== null, {
      message: t('zod.routingRule.patternInvalid'),
    })
    .transform((parsed) => parsed!.pattern),
  { message: t('zod.routingRule.patterns') }
);

/**
 * Addresses are stored in canonical form (host bits cleared, host prefixes
 * dropped, IPv6 compressed), so a value compares equal to what the kernel
 * prints back for it. `0.0.0.0/0` and `::/0` are accepted with their usual
 * meaning of "every destination" and matched without an address set, because
 * `hash:net` rejects a zero-length prefix on many kernels.
 */
const AddressesSchema = z.array(
  z
    .string({ message: t('zod.routingRule.address') })
    .transform((value) => canonical(value))
    .refine((entry) => entry !== null, {
      message: t('zod.routingRule.addressInvalid'),
    })
    .transform((entry) => entry!.address),
  { message: t('zod.routingRule.addresses') }
);

const ClientIdsSchema = z.array(
  z
    .number({ message: t('zod.routingRule.clients') })
    .int()
    .positive(),
  { message: t('zod.routingRule.clients') }
);

const RoutingRuleBaseSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema.default(''),
  enabled: EnabledSchema.default(true),
  action: RoutingActionSchema,
  /** Required when `action` is `gateway`, ignored otherwise. */
  gatewayId: z.number().int().positive().nullable().default(null),
  patterns: PatternsSchema.default([]),
  addresses: AddressesSchema.default([]),
  /** Empty means the rule applies to every client. */
  clientIds: ClientIdsSchema.default([]),
  autoResolve: EnabledSchema.default(false),
});

/**
 * A rule that matches nothing would sit in the list looking active while doing
 * nothing at all, so it is rejected rather than saved.
 */
function refineRule<T extends z.ZodType<z.infer<typeof RoutingRuleBaseSchema>>>(
  schema: T
) {
  return schema
    .refine((rule) => rule.action !== 'gateway' || rule.gatewayId !== null, {
      message: t('zod.routingRule.gatewayRequired'),
      path: ['gatewayId'],
    })
    .refine((rule) => rule.patterns.length > 0 || rule.addresses.length > 0, {
      message: t('zod.routingRule.empty'),
      path: ['patterns'],
    });
}

export const RoutingRuleCreateSchema = refineRule(RoutingRuleBaseSchema);
export const RoutingRuleUpdateSchema = refineRule(RoutingRuleBaseSchema);

export const RoutingRuleReorderSchema = z.array(
  z
    .number({ message: t('zod.routingRule.order') })
    .int()
    .positive(),
  { message: t('zod.routingRule.order') }
);

export type RoutingRuleCreateType = z.infer<typeof RoutingRuleCreateSchema>;
export type RoutingRuleUpdateType = z.infer<typeof RoutingRuleUpdateSchema>;

const ruleId = z.coerce.number({ message: t('zod.routingRule.id') });

export const RoutingRuleGetSchema = z.object({ ruleId });
