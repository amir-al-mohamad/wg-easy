<template>
  <form
    class="mb-4 rounded-lg border-2 border-red-800 p-4"
    @submit.prevent="submit"
  >
    <h4 class="mb-3 font-semibold">
      {{ rule ? $t('routing.rules.editTitle') : $t('routing.rules.newTitle') }}
    </h4>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <RoutingLabel for="rule-name">{{
          $t('routing.rules.name')
        }}</RoutingLabel>
        <BaseInput id="rule-name" v-model="form.name" required />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="rule-description">
          {{ $t('routing.rules.note') }}
        </RoutingLabel>
        <BaseInput id="rule-description" v-model="form.description" />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="rule-action">
          {{ $t('routing.rules.action') }}
        </RoutingLabel>
        <RoutingSelect
          id="rule-action"
          v-model="actionValue"
          :options="actionOptions"
        />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="rule-patterns">
          {{ $t('routing.rules.patterns') }}
        </RoutingLabel>
        <BaseTextArea
          id="rule-patterns"
          v-model="patternsText"
          :rows="4"
          placeholder="example.com&#10;*.example.com&#10;.google.com"
        />
        <p class="text-sm text-gray-500 dark:text-neutral-400">
          {{ $t('routing.rules.patternsHelp') }}
        </p>
        <RoutingPatternPreview class="mt-1" :text="patternsText" />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="rule-addresses">
          {{ $t('routing.rules.addresses') }}
        </RoutingLabel>
        <BaseTextArea
          id="rule-addresses"
          v-model="addressesText"
          :rows="2"
          placeholder="1.2.3.4&#10;10.0.0.0/8&#10;2001:db8::/32"
        />
        <p class="text-sm text-gray-500 dark:text-neutral-400">
          {{ $t('routing.rules.addressesHelp') }}
        </p>
      </div>

      <div v-if="patternsText.trim()" class="flex items-center gap-3">
        <BaseSwitch id="rule-auto-resolve" v-model="form.autoResolve" />
        <RoutingLabel for="rule-auto-resolve">
          {{ $t('routing.rules.autoResolve') }}
        </RoutingLabel>
      </div>

      <fieldset class="flex flex-col gap-1">
        <legend class="font-medium">{{ $t('routing.rules.clients') }}</legend>
        <p class="text-sm text-gray-500 dark:text-neutral-400">
          {{ $t('routing.rules.clientsHelp') }}
        </p>
        <ul
          class="max-h-40 overflow-y-auto rounded-lg border-2 border-gray-100 p-2 dark:border-neutral-600"
        >
          <li v-for="client in clients" :key="client.id">
            <label class="flex cursor-pointer items-center gap-2 py-1">
              <input
                v-model="form.clientIds"
                type="checkbox"
                :value="client.id"
                class="accent-red-800"
              />
              <span>{{ client.name }}</span>
              <span
                class="font-mono text-sm text-gray-400 dark:text-neutral-400"
              >
                {{ client.ipv4Address }}
              </span>
            </label>
          </li>
          <li
            v-if="!clients.length"
            class="py-1 text-sm text-gray-500 dark:text-neutral-400"
          >
            {{ $t('routing.rules.noClients') }}
          </li>
        </ul>
      </fieldset>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <BasePrimaryButton type="submit">
        {{ rule ? $t('form.save') : $t('form.add') }}
      </BasePrimaryButton>
      <BaseSecondaryButton type="button" @click="emit('cancel')">
        {{ $t('routing.cancel') }}
      </BaseSecondaryButton>
    </div>
  </form>
</template>

<script lang="ts" setup>
import type {
  RoutingAction,
  RoutingClient,
  RoutingGateway,
  RoutingRule,
} from '#shared/utils/routingTypes';

const props = defineProps<{
  /** Absent when creating. */
  rule: RoutingRule | null;
  gateways: RoutingGateway[];
  clients: RoutingClient[];
}>();

const emit = defineEmits<{ saved: []; cancel: [] }>();

const { t } = useI18n();

const form = reactive({
  name: props.rule?.name ?? '',
  description: props.rule?.description ?? '',
  action: (props.rule?.action ?? 'gateway') as RoutingAction,
  gatewayId: props.rule?.gatewayId ?? null,
  autoResolve: props.rule?.autoResolve ?? false,
  clientIds: props.rule?.clients.map((client) => client.id) ?? [],
});

// The textareas are the source of truth for both lists; they are split into
// arrays only on submit.
const patternsText = ref((props.rule?.patterns ?? []).join('\n'));
const addressesText = ref((props.rule?.addresses ?? []).join('\n'));

// One control for "gateway" and "which gateway", which the data models as two
// fields.
const actionValue = computed({
  get: () =>
    form.action === 'gateway' ? `gateway:${form.gatewayId ?? ''}` : form.action,
  set: (value: string | number | null) => {
    const text = String(value);
    if (text.startsWith('gateway:')) {
      form.action = 'gateway';
      form.gatewayId = Number(text.slice('gateway:'.length));
    } else {
      form.action = text as RoutingAction;
      form.gatewayId = null;
    }
  },
});

const actionOptions = computed(() => [
  ...props.gateways.map((gateway) => ({
    label: t('routing.action.viaGateway', { name: gateway.name }),
    value: `gateway:${gateway.id}`,
  })),
  { label: t('routing.action.direct'), value: 'direct' },
  { label: t('routing.action.block'), value: 'block' },
]);

function lines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const save = useSubmit(
  (data) =>
    $fetch(
      props.rule
        ? `/api/admin/routing/rule/${props.rule.id}`
        : '/api/admin/routing/rule',
      { method: 'post', body: data }
    ),
  {
    successMsg: t('routing.rules.saved'),
    // Only leave the form on success; otherwise the edits would vanish along
    // with the error explaining why they were rejected.
    revert: async (success) => {
      if (success) emit('saved');
    },
  }
);

function submit() {
  return save({
    name: form.name,
    description: form.description,
    enabled: props.rule?.enabled ?? true,
    action: form.action,
    gatewayId: form.gatewayId,
    patterns: lines(patternsText.value),
    addresses: lines(addressesText.value),
    clientIds: form.clientIds,
    autoResolve: form.autoResolve,
  });
}
</script>
