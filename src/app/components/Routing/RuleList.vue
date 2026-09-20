<template>
  <div>
    <ul v-if="rules.length" class="flex flex-col gap-2">
      <li
        v-for="(rule, index) in rules"
        :key="rule.id"
        draggable="true"
        class="rounded-lg border-2 p-3 transition"
        :class="[
          rule.enabled
            ? 'border-gray-100 dark:border-neutral-600'
            : 'border-gray-100 opacity-60 dark:border-neutral-600',
          dragIndex === index ? 'border-red-800' : '',
        ]"
        @dragstart="dragIndex = index"
        @dragover.prevent
        @drop.prevent="drop(index)"
        @dragend="dragIndex = null"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span
            class="cursor-grab select-none text-gray-400 active:cursor-grabbing dark:text-neutral-400"
            :title="$t('routing.rules.dragHint')"
            aria-hidden="true"
            >⣿</span
          >

          <!-- Arrows, not just dragging: this has to work on a phone and from
               a keyboard, where HTML5 drag does not. -->
          <div class="flex flex-col">
            <button
              type="button"
              class="px-1 text-xs leading-none text-gray-400 hover:text-red-800 disabled:opacity-30 dark:text-neutral-400"
              :disabled="index === 0"
              :aria-label="$t('routing.rules.moveUp')"
              @click="move(index, index - 1)"
            >
              ▲
            </button>
            <button
              type="button"
              class="px-1 text-xs leading-none text-gray-400 hover:text-red-800 disabled:opacity-30 dark:text-neutral-400"
              :disabled="index === rules.length - 1"
              :aria-label="$t('routing.rules.moveDown')"
              @click="move(index, index + 1)"
            >
              ▼
            </button>
          </div>

          <span class="flex-1 font-medium">{{ rule.name }}</span>

          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="actionClass(rule)"
          >
            {{ actionLabel(rule) }}
          </span>

          <RoutingToggleSwitch
            :id="`rule-enabled-${rule.id}`"
            :model-value="rule.enabled"
            :title="
              rule.enabled
                ? $t('routing.rules.disable')
                : $t('routing.rules.enable')
            "
            @update:model-value="toggle(rule, $event)"
          />

          <BaseSecondaryButton
            class="px-2 py-1 text-sm"
            @click="emit('edit', rule)"
            >{{ $t('routing.edit') }}</BaseSecondaryButton
          >
          <RoutingDeleteDialog
            :title="$t('routing.rules.deleteTitle')"
            @delete="remove(rule)"
          >
            <i18n-t keypath="routing.rules.deleteDialog">
              <template #name>
                <strong>{{ rule.name }}</strong>
              </template>
            </i18n-t>
          </RoutingDeleteDialog>
        </div>

        <p
          class="mt-2 flex flex-wrap gap-x-3 text-sm text-gray-500 dark:text-neutral-400"
        >
          <span v-if="rule.patterns.length">
            {{
              $t('routing.rules.patternCount', { count: rule.patterns.length })
            }}
          </span>
          <span v-if="rule.addresses.length">
            {{
              $t('routing.rules.addressCount', {
                count: rule.addresses.length,
              })
            }}
          </span>
          <span :title="$t('routing.rules.matchedTitle')">
            {{ $t('routing.rules.matched', { count: rule.addressCount }) }}
          </span>
          <span>
            {{
              rule.clients.length
                ? $t('routing.rules.someClients', {
                    count: rule.clients.length,
                  })
                : $t('routing.rules.allClients')
            }}
          </span>
        </p>

        <div v-if="rule.patterns.length" class="mt-2 flex flex-wrap gap-2">
          <BaseSecondaryButton
            class="px-2 py-1 text-sm"
            @click="resolveNow(rule)"
            >{{ $t('routing.rules.resolve') }}</BaseSecondaryButton
          >
          <BaseSecondaryButton
            class="px-2 py-1 text-sm"
            @click="clearAddresses(rule)"
            >{{ $t('routing.rules.clear') }}</BaseSecondaryButton
          >
        </div>
      </li>
    </ul>

    <p v-else class="text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('routing.rules.empty') }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import type { RoutingRule } from '#shared/utils/routingTypes';

const props = defineProps<{ rules: RoutingRule[] }>();

const emit = defineEmits<{ changed: []; edit: [rule: RoutingRule] }>();

const { t } = useI18n();

const dragIndex = ref<number | null>(null);

function actionLabel(rule: RoutingRule) {
  if (rule.action === 'direct') return t('routing.action.direct');
  if (rule.action === 'block') return t('routing.action.block');
  return rule.gateway?.name ?? t('routing.action.missingGateway');
}

function actionClass(rule: RoutingRule) {
  if (rule.action === 'direct')
    return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
  if (rule.action === 'block')
    return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  return 'bg-gray-100 text-gray-700 dark:bg-neutral-600 dark:text-neutral-200';
}

const refresh = async () => emit('changed');

const reorder = useSubmit(
  (data) =>
    $fetch('/api/admin/routing/rule/order', {
      method: 'post',
      body: (data as { ids: number[] }).ids,
    }),
  { revert: refresh, noSuccessToast: true }
);

function move(from: number, to: number) {
  if (to < 0 || to >= props.rules.length) return;

  const ids = props.rules.map((rule) => rule.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);

  return reorder({ ids });
}

function drop(index: number) {
  const from = dragIndex.value;
  dragIndex.value = null;
  if (from === null || from === index) return;
  return move(from, index);
}

const save = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/rule/${(data as { id: number }).id}`, {
      method: 'post',
      body: data,
    }),
  { revert: refresh, noSuccessToast: true }
);

function toggle(rule: RoutingRule, enabled: boolean) {
  // The update endpoint takes a whole rule, so send the current one back with
  // just this field changed rather than inventing a partial-update path.
  return save({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled,
    action: rule.action,
    gatewayId: rule.gatewayId,
    patterns: rule.patterns,
    addresses: rule.addresses,
    clientIds: rule.clients.map((client) => client.id),
    autoResolve: rule.autoResolve,
  });
}

const destroy = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/rule/${(data as { id: number }).id}`, {
      method: 'delete',
    }),
  { revert: refresh, successMsg: t('routing.rules.removed') }
);

function remove(rule: RoutingRule) {
  return destroy({ id: rule.id });
}

const toast = useToast();

const resolve = useSubmit<{ added: number; failed: string[] }>(
  (data) =>
    $fetch(`/api/admin/routing/rule/${(data as { id: number }).id}/resolve`, {
      method: 'post',
    }),
  {
    noSuccessToast: true,
    // Report what actually happened: a rule whose domains all failed to
    // resolve looks exactly like one that worked, and the difference is the
    // whole reason someone pressed the button.
    revert: async (success, result) => {
      await refresh();
      if (!success || !result) return;

      if (result.added > 0) {
        toast.showToast({
          type: 'success',
          message: t('routing.rules.resolved', { added: result.added }),
        });
      } else if (result.failed.length > 0) {
        toast.showToast({
          type: 'error',
          message: t('routing.rules.resolvedNothing', {
            domains: result.failed.join(', '),
          }),
        });
      } else {
        // Only wildcards, which have nothing literal to look up.
        toast.showToast({
          type: 'success',
          message: t('routing.rules.resolvedWildcards'),
        });
      }
    },
  }
);

function resolveNow(rule: RoutingRule) {
  return resolve({ id: rule.id });
}

const clear = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/rule/${(data as { id: number }).id}/clear`, {
      method: 'post',
    }),
  { revert: refresh, successMsg: t('routing.rules.cleared') }
);

function clearAddresses(rule: RoutingRule) {
  return clear({ id: rule.id });
}
</script>
