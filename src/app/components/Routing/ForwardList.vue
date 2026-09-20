<template>
  <div>
    <ul v-if="forwards.length" class="flex flex-col gap-2">
      <li
        v-for="forward in forwards"
        :key="forward.id"
        class="flex flex-wrap items-center gap-3 rounded-lg border-2 border-gray-100 p-3 dark:border-neutral-600"
        :class="{ 'opacity-60': !forward.enabled }"
      >
        <span class="flex-1 font-medium">{{ forward.name }}</span>

        <span class="font-mono text-sm text-gray-500 dark:text-neutral-400">
          :{{ forward.externalPort }} →
          {{ forward.client?.ipv4Address ?? '?' }}:{{ forward.internalPort }}
        </span>

        <span
          class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-600"
        >
          {{ PROTOCOL_LABELS[forward.protocol] }}
        </span>

        <span
          v-if="!forward.published"
          class="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          :title="$t('routing.forwards.unpublishedTitle')"
        >
          {{ $t('routing.forwards.unpublished') }}
        </span>

        <span class="text-sm text-gray-500 dark:text-neutral-400">
          {{ forward.client?.name ?? $t('routing.forwards.noClient') }}
        </span>

        <RoutingToggleSwitch
          :id="`forward-enabled-${forward.id}`"
          :model-value="forward.enabled"
          :title="
            forward.enabled
              ? $t('routing.forwards.disable')
              : $t('routing.forwards.enable')
          "
          @update:model-value="toggle(forward, $event)"
        />

        <BaseSecondaryButton
          class="px-2 py-1 text-sm"
          @click="emit('edit', forward)"
          >{{ $t('routing.edit') }}</BaseSecondaryButton
        >
        <RoutingDeleteDialog
          :title="$t('routing.forwards.deleteTitle')"
          @delete="remove(forward)"
        >
          <i18n-t keypath="routing.forwards.deleteDialog">
            <template #name>
              <strong>{{ forward.name }}</strong>
            </template>
            <template #port>
              <strong>{{ forward.externalPort }}</strong>
            </template>
          </i18n-t>
        </RoutingDeleteDialog>
      </li>
    </ul>

    <p v-else class="text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('routing.forwards.empty') }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import { PROTOCOL_LABELS } from '#shared/utils/routingTypes';
import type { PortForward } from '#shared/utils/routingTypes';

defineProps<{ forwards: PortForward[] }>();

const emit = defineEmits<{ changed: []; edit: [forward: PortForward] }>();

const { t } = useI18n();

const refresh = async () => emit('changed');

const save = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/forward/${(data as { id: number }).id}`, {
      method: 'post',
      body: data,
    }),
  { revert: refresh, noSuccessToast: true }
);

function toggle(forward: PortForward, enabled: boolean) {
  return save({
    id: forward.id,
    name: forward.name,
    description: forward.description,
    enabled,
    clientId: forward.clientId,
    externalPort: forward.externalPort,
    internalPort: forward.internalPort,
    protocol: forward.protocol,
  });
}

const destroy = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/forward/${(data as { id: number }).id}`, {
      method: 'delete',
    }),
  { revert: refresh, successMsg: t('routing.forwards.removed') }
);

function remove(forward: PortForward) {
  return destroy({ id: forward.id });
}
</script>
