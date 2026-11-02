<template>
  <div>
    <ul v-if="forwards.length" class="flex flex-col gap-2">
      <li
        v-for="forward in forwards"
        :key="forward.id"
        class="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
        :class="{ 'opacity-60': !forward.enabled }"
      >
        <span class="flex-1 font-medium">{{ forward.name }}</span>

        <span class="font-mono text-sm text-subtle">
          :{{ forward.externalPort }} →
          {{ forward.client?.ipv4Address ?? '?' }}:{{ forward.internalPort }}
        </span>

        <span
          class="rounded-md bg-surface-raised px-2 py-0.5 text-xs font-medium text-muted"
        >
          {{ PROTOCOL_LABELS[forward.protocol] }}
        </span>

        <span
          v-if="!forward.published"
          class="rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
          :title="$t('admin.routing.forwards.unpublishedTitle')"
        >
          {{ $t('admin.routing.forwards.unpublished') }}
        </span>

        <span class="text-sm text-subtle">
          {{ forward.client?.name ?? $t('admin.routing.forwards.noClient') }}
        </span>

        <RoutingToggleSwitch
          :id="`forward-enabled-${forward.id}`"
          :model-value="forward.enabled"
          :title="
            forward.enabled
              ? $t('admin.routing.forwards.disable')
              : $t('admin.routing.forwards.enable')
          "
          @update:model-value="toggle(forward, $event)"
        />

        <BaseSecondaryButton
          class="min-h-9 px-3 py-1.5 text-xs"
          @click="emit('edit', forward)"
        >
          {{ $t('admin.routing.edit') }}
        </BaseSecondaryButton>
        <RoutingDeleteDialog
          :title="$t('admin.routing.forwards.deleteTitle')"
          @delete="remove(forward)"
        >
          <i18n-t keypath="admin.routing.forwards.deleteDialog">
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

    <p v-else class="text-sm text-subtle">
      {{ $t('admin.routing.forwards.empty') }}
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
  { revert: refresh, successMsg: t('admin.routing.forwards.removed') }
);

function remove(forward: PortForward) {
  return destroy({ id: forward.id });
}
</script>
