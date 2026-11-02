<template>
  <div>
    <ul v-if="rules.length" class="flex flex-col gap-2">
      <li
        v-for="(rule, index) in rules"
        :key="rule.id"
        draggable="true"
        class="rounded-lg border bg-surface p-3 transition"
        :class="[
          dragIndex === index ? 'border-accent' : 'border-line',
          { 'opacity-60': !rule.enabled },
        ]"
        @dragstart="dragIndex = index"
        @dragover.prevent
        @drop.prevent="drop(index)"
        @dragend="dragIndex = null"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span
            class="cursor-grab text-subtle select-none active:cursor-grabbing"
            :title="$t('admin.routing.rules.dragHint')"
            aria-hidden="true"
          >
            ⣿
          </span>

          <!-- Arrows, not just dragging: this has to work on a phone and from
               a keyboard, where HTML5 drag does not. -->
          <div class="flex flex-col">
            <button
              type="button"
              class="px-1 text-xs leading-none text-subtle hover:text-accent disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="$t('admin.routing.rules.moveUp')"
              @click="move(index, index - 1)"
            >
              ▲
            </button>
            <button
              type="button"
              class="px-1 text-xs leading-none text-subtle hover:text-accent disabled:opacity-30"
              :disabled="index === rules.length - 1"
              :aria-label="$t('admin.routing.rules.moveDown')"
              @click="move(index, index + 1)"
            >
              ▼
            </button>
          </div>

          <span class="flex-1 font-medium">{{ rule.name }}</span>

          <span
            class="rounded-md px-2 py-0.5 text-xs font-medium"
            :class="actionClass(rule)"
          >
            {{ actionLabel(rule) }}
          </span>

          <RoutingToggleSwitch
            :id="`rule-enabled-${rule.id}`"
            :model-value="rule.enabled"
            :title="
              rule.enabled
                ? $t('admin.routing.rules.disable')
                : $t('admin.routing.rules.enable')
            "
            @update:model-value="toggle(rule, $event)"
          />

          <BaseSecondaryButton
            class="min-h-9 px-3 py-1.5 text-xs"
            @click="emit('edit', rule)"
          >
            {{ $t('admin.routing.edit') }}
          </BaseSecondaryButton>
          <RoutingDeleteDialog
            :title="$t('admin.routing.rules.deleteTitle')"
            @delete="remove(rule)"
          >
            <i18n-t keypath="admin.routing.rules.deleteDialog">
              <template #name>
                <strong>{{ rule.name }}</strong>
              </template>
            </i18n-t>
          </RoutingDeleteDialog>
        </div>

        <p class="mt-2 flex flex-wrap gap-x-3 text-sm text-subtle">
          <span v-if="rule.patterns.length">
            {{
              $t('admin.routing.rules.patternCount', {
                count: rule.patterns.length,
              })
            }}
          </span>
          <span v-if="rule.addresses.length">
            {{
              $t('admin.routing.rules.addressCount', {
                count: rule.addresses.length,
              })
            }}
          </span>
          <span :title="$t('admin.routing.rules.matchedTitle')">
            {{
              $t('admin.routing.rules.matched', { count: rule.addressCount })
            }}
          </span>
          <span>
            {{
              rule.clients.length
                ? $t('admin.routing.rules.someClients', {
                    count: rule.clients.length,
                  })
                : $t('admin.routing.rules.allClients')
            }}
          </span>
        </p>

        <div v-if="rule.patterns.length" class="mt-2 flex flex-wrap gap-2">
          <BaseSecondaryButton
            class="min-h-9 px-3 py-1.5 text-xs"
            @click="resolveNow(rule)"
          >
            {{ $t('admin.routing.rules.resolve') }}
          </BaseSecondaryButton>
          <BaseSecondaryButton
            class="min-h-9 px-3 py-1.5 text-xs"
            @click="clearAddresses(rule)"
          >
            {{ $t('admin.routing.rules.clear') }}
          </BaseSecondaryButton>
        </div>
      </li>
    </ul>

    <p v-else class="text-sm text-subtle">
      {{ $t('admin.routing.rules.empty') }}
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
  if (rule.action === 'direct') {
    return t('admin.routing.action.direct');
  }
  if (rule.action === 'block') {
    return t('admin.routing.action.block');
  }
  return rule.gateway?.name ?? t('admin.routing.action.missingGateway');
}

function actionClass(rule: RoutingRule) {
  if (rule.action === 'direct') {
    return 'bg-success/10 text-success';
  }
  if (rule.action === 'block') {
    return 'bg-accent/10 text-accent';
  }
  return 'bg-surface-raised text-muted';
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
  if (to < 0 || to >= props.rules.length) {
    return;
  }

  const ids = props.rules.map((rule) => rule.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);

  return reorder({ ids });
}

function drop(index: number) {
  const from = dragIndex.value;
  dragIndex.value = null;
  if (from === null || from === index) {
    return;
  }
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
  { revert: refresh, successMsg: t('admin.routing.rules.removed') }
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
      if (!success || !result) {
        return;
      }

      if (result.added > 0) {
        toast.showToast({
          type: 'success',
          message: t('admin.routing.rules.resolved', { added: result.added }),
        });
      } else if (result.failed.length > 0) {
        toast.showToast({
          type: 'error',
          message: t('admin.routing.rules.resolvedNothing', {
            domains: result.failed.join(', '),
          }),
        });
      } else {
        // Only wildcards, which have nothing literal to look up.
        toast.showToast({
          type: 'success',
          message: t('admin.routing.rules.resolvedWildcards'),
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
  { revert: refresh, successMsg: t('admin.routing.rules.cleared') }
);

function clearAddresses(rule: RoutingRule) {
  return clear({ id: rule.id });
}
</script>
