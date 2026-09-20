<template>
  <div>
    <ul v-if="gateways.length" class="flex flex-col gap-2">
      <li
        v-for="gateway in gateways"
        :key="gateway.id"
        class="flex flex-wrap items-center gap-3 rounded-lg border-2 border-gray-100 p-3 dark:border-neutral-600"
      >
        <BaseTooltip :text="statusText(gateway)">
          <span
            class="block size-2.5 shrink-0 rounded-full"
            :class="statusColor(gateway)"
          />
        </BaseTooltip>

        <BaseInput
          :id="`gateway-name-${gateway.id}`"
          :model-value="gateway.name"
          class="min-w-32 flex-1 py-1 text-sm"
          :aria-label="$t('routing.gateways.name')"
          @change="rename(gateway, $event)"
        />

        <code
          class="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-neutral-600"
          >{{ gateway.interfaceName }}</code
        >

        <span
          v-if="ipv6Enabled && gateway.present && !gateway.hasIpv6"
          class="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          :title="$t('routing.gateways.noIpv6Title')"
        >
          {{ $t('routing.gateways.noIpv6') }}
        </span>

        <span
          class="font-mono text-xs text-gray-400 dark:text-neutral-400"
          :title="$t('routing.gateways.markTitle')"
        >
          {{ gateway.fwmark }} · {{ gateway.routeTable }}
        </span>

        <label
          class="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400"
          :title="$t('routing.gateways.unavailableTitle')"
        >
          {{ $t('routing.gateways.unavailable') }}
          <RoutingSelect
            :id="`gateway-unavailable-${gateway.id}`"
            :model-value="gateway.unavailableAction"
            :options="unavailableOptions"
            class="py-1 text-xs"
            @update:model-value="
              setUnavailable(gateway, $event as GatewayUnavailableAction)
            "
          />
          <RoutingSelect
            v-if="gateway.unavailableAction === 'gateway'"
            :id="`gateway-fallback-${gateway.id}`"
            :model-value="gateway.fallbackGatewayId"
            :options="fallbackOptions(gateway)"
            class="py-1 text-xs"
            :aria-label="$t('routing.gateways.fallback')"
            @update:model-value="setFallback(gateway, Number($event))"
          />
        </label>

        <RoutingToggleSwitch
          :id="`gateway-enabled-${gateway.id}`"
          :model-value="gateway.enabled"
          :title="
            gateway.enabled
              ? $t('routing.gateways.disable')
              : $t('routing.gateways.enable')
          "
          @update:model-value="toggle(gateway, $event)"
        />

        <BaseSecondaryButton
          v-if="gateway.wireguard"
          class="px-2 py-1 text-sm"
          :title="$t('routing.gateways.reconnectTitle')"
          @click="reconnect(gateway)"
          >{{ $t('routing.gateways.reconnect') }}</BaseSecondaryButton
        >

        <BaseSecondaryButton
          class="px-2 py-1 text-sm"
          @click="remove(gateway)"
          >{{ $t('routing.remove') }}</BaseSecondaryButton
        >
      </li>
    </ul>

    <p v-else class="text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('routing.gateways.empty') }}
    </p>

    <div
      v-if="available.length"
      class="mt-4 rounded-lg border-2 border-dashed border-gray-100 p-3 dark:border-neutral-600"
    >
      <p class="mb-2 text-sm text-gray-500 dark:text-neutral-400">
        {{ $t('routing.gateways.available') }}
      </p>
      <ul class="flex flex-wrap gap-2">
        <li v-for="entry in available" :key="entry.name">
          <BaseSecondaryButton
            class="px-3 py-1 text-sm"
            :class="{ 'opacity-60': !entry.suggested }"
            :title="
              entry.suggested ? undefined : $t('routing.gateways.notSuggested')
            "
            @click="add(entry.name)"
          >
            + {{ entry.name }}
          </BaseSecondaryButton>
        </li>
      </ul>
    </div>

    <p v-else class="mt-4 text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('routing.gateways.noneAvailable') }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import type {
  GatewayUnavailableAction,
  RoutingGateway,
} from '#shared/utils/routingTypes';

const props = defineProps<{
  ipv6Enabled: boolean;
  gateways: RoutingGateway[];
  available: { name: string; up: boolean; suggested: boolean }[];
}>();

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();

/** Every gateway but this one: the candidates to fall back to. */
function others(gateway: RoutingGateway) {
  return props.gateways.filter((entry) => entry.id !== gateway.id);
}

// "Through another gateway" is only offered once there is another gateway.
const unavailableOptions = computed(() => [
  { value: 'block', label: t('routing.gateways.unavailableBlock') },
  { value: 'direct', label: t('routing.gateways.unavailableDirect') },
  ...(props.gateways.length > 1
    ? [{ value: 'gateway', label: t('routing.gateways.unavailableGateway') }]
    : []),
]);

// A switched-off gateway ends a chain in dropping, so it is not offered; one
// already chosen and since switched off stays visible rather than vanishing.
function fallbackOptions(gateway: RoutingGateway) {
  return others(gateway)
    .filter((entry) => entry.enabled || entry.id === gateway.fallbackGatewayId)
    .map((entry) => ({ value: entry.id, label: entry.name }));
}

function fallbackName(gateway: RoutingGateway) {
  return (
    props.gateways.find((entry) => entry.id === gateway.fallbackGatewayId)
      ?.name ?? '?'
  );
}

// Off, unavailable and dropping, unavailable but flowing: only the first is
// on purpose and only the second stops traffic, so each gets its own colour.
function statusColor(gateway: RoutingGateway) {
  if (!gateway.enabled) return 'bg-gray-300 dark:bg-neutral-500';
  if (gateway.present) return 'bg-green-500';
  return gateway.unavailableOutcome === 'block' ? 'bg-red-500' : 'bg-amber-500';
}

// Why the gateway is unavailable, then what happens to its traffic, judged by
// what the chain amounts to rather than the setting alone: "through another
// gateway" whose chain ends in dropping is reported as dropping.
function statusText(gateway: RoutingGateway) {
  if (!gateway.enabled) return t('routing.gateways.statusOff');
  if (gateway.present) return t('routing.gateways.statusUp');

  const reason = gateway.stale
    ? gateway.handshakeAge === null
      ? t('routing.gateways.statusNeverAnswered')
      : t('routing.gateways.statusStale', {
          minutes: Math.floor(gateway.handshakeAge / 60),
        })
    : t('routing.gateways.statusDown');

  switch (gateway.unavailableOutcome) {
    case 'block':
      return `${reason} ${t('routing.gateways.statusBlock')}`;
    case 'direct':
      return `${reason} ${t('routing.gateways.statusDirect')}`;
    case 'gateway':
      return `${reason} ${t('routing.gateways.statusFallback', {
        name: fallbackName(gateway),
      })}`;
  }
}

const refresh = async () => emit('changed');

const toast = useToast();

// The reconnect itself always happens; whether the far end answered within
// the wait is what the reader needs to hear, so the toast is chosen here.
const bounce = useSubmit(
  (data) =>
    $fetch(
      `/api/admin/routing/gateway/${(data as { id: number }).id}/reconnect`,
      { method: 'post' }
    ),
  {
    noSuccessToast: true,
    revert: async (success, data) => {
      if (success) {
        toast.showToast(
          data?.answered
            ? { type: 'success', message: t('routing.gateways.reconnected') }
            : {
                type: 'error',
                message: t('routing.gateways.reconnectNoAnswer'),
              }
        );
      }
      await refresh();
    },
  }
);

function reconnect(gateway: RoutingGateway) {
  return bounce({ id: gateway.id });
}

const save = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/gateway/${(data as { id: number }).id}`, {
      method: 'post',
      body: data,
    }),
  { revert: refresh, noSuccessToast: true }
);

/** The endpoint takes the whole editable state, so send it with one change. */
function update(
  gateway: RoutingGateway,
  changes: Partial<
    Pick<
      RoutingGateway,
      'name' | 'enabled' | 'unavailableAction' | 'fallbackGatewayId'
    >
  >
) {
  return save({
    id: gateway.id,
    name: gateway.name,
    enabled: gateway.enabled,
    unavailableAction: gateway.unavailableAction,
    fallbackGatewayId: gateway.fallbackGatewayId,
    ...changes,
  });
}

function toggle(gateway: RoutingGateway, enabled: boolean) {
  return update(gateway, { enabled });
}

function setUnavailable(
  gateway: RoutingGateway,
  unavailableAction: GatewayUnavailableAction
) {
  if (unavailableAction === gateway.unavailableAction) return;
  // "Through another gateway" needs one named to be saved at all; start with
  // the first other one, which the second select then lets the reader change.
  const fallbackGatewayId =
    unavailableAction === 'gateway'
      ? (gateway.fallbackGatewayId ?? others(gateway)[0]?.id ?? null)
      : null;
  return update(gateway, { unavailableAction, fallbackGatewayId });
}

function setFallback(gateway: RoutingGateway, fallbackGatewayId: number) {
  if (fallbackGatewayId === gateway.fallbackGatewayId) return;
  return update(gateway, { fallbackGatewayId });
}

function rename(gateway: RoutingGateway, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (!name || name === gateway.name) return;
  return update(gateway, { name });
}

const create = useSubmit(
  (data) =>
    $fetch('/api/admin/routing/gateway', { method: 'post', body: data }),
  { revert: refresh, successMsg: t('routing.gateways.added') }
);

function add(interfaceName: string) {
  return create({ interfaceName });
}

const destroy = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/gateway/${(data as { id: number }).id}`, {
      method: 'delete',
    }),
  { revert: refresh, successMsg: t('routing.gateways.removed') }
);

function remove(gateway: RoutingGateway) {
  // No confirmation here: a gateway carries only a name, and the server
  // refuses to remove one that any rule still points at.
  return destroy({ id: gateway.id });
}
</script>
