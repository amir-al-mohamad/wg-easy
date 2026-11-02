<template>
  <div>
    <ul v-if="gateways.length" class="flex flex-col gap-2">
      <li
        v-for="gateway in gateways"
        :key="gateway.id"
        class="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
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
          class="min-h-9 min-w-32 flex-1 py-1.5"
          :aria-label="$t('admin.routing.gateways.name')"
          @change="rename(gateway, $event)"
        />

        <code class="rounded-md bg-surface-raised px-2 py-1 text-xs text-muted">
          {{ gateway.interfaceName }}
        </code>

        <span
          v-if="ipv6Enabled && gateway.present && !gateway.hasIpv6"
          class="rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
          :title="$t('admin.routing.gateways.noIpv6Title')"
        >
          {{ $t('admin.routing.gateways.noIpv6') }}
        </span>

        <span
          class="font-mono text-xs text-subtle"
          :title="$t('admin.routing.gateways.markTitle')"
        >
          {{ gateway.fwmark }} · {{ gateway.routeTable }}
        </span>

        <label
          class="flex items-center gap-2 text-xs text-subtle"
          :title="$t('admin.routing.gateways.unavailableTitle')"
        >
          {{ $t('admin.routing.gateways.unavailable') }}
          <BaseSelect
            :id="`gateway-unavailable-${gateway.id}`"
            :model-value="gateway.unavailableAction"
            :options="unavailableOptions"
            :label="$t('admin.routing.gateways.unavailable')"
            :show-value="false"
            compact
            @update:model-value="
              setUnavailable(gateway, $event as GatewayUnavailableAction)
            "
          />
          <BaseSelect
            v-if="gateway.unavailableAction === 'gateway'"
            :id="`gateway-fallback-${gateway.id}`"
            :model-value="gateway.fallbackGatewayId ?? undefined"
            :options="fallbackOptions(gateway)"
            :label="$t('admin.routing.gateways.fallback')"
            :show-value="false"
            compact
            @update:model-value="setFallback(gateway, Number($event))"
          />
        </label>

        <RoutingToggleSwitch
          :id="`gateway-enabled-${gateway.id}`"
          :model-value="gateway.enabled"
          :title="
            gateway.enabled
              ? $t('admin.routing.gateways.disable')
              : $t('admin.routing.gateways.enable')
          "
          @update:model-value="toggle(gateway, $event)"
        />

        <BaseSecondaryButton
          v-if="gateway.wireguard"
          class="min-h-9 px-3 py-1.5 text-xs"
          :title="$t('admin.routing.gateways.reconnectTitle')"
          @click="reconnect(gateway)"
        >
          {{ $t('admin.routing.gateways.reconnect') }}
        </BaseSecondaryButton>

        <BaseSecondaryButton
          class="min-h-9 px-3 py-1.5 text-xs"
          @click="remove(gateway)"
        >
          {{ $t('admin.routing.remove') }}
        </BaseSecondaryButton>
      </li>
    </ul>

    <p v-else class="text-sm text-subtle">
      {{ $t('admin.routing.gateways.empty') }}
    </p>

    <div
      v-if="available.length"
      class="mt-4 rounded-lg border border-dashed border-line p-3"
    >
      <p class="mb-2 text-sm text-subtle">
        {{ $t('admin.routing.gateways.available') }}
      </p>
      <ul class="flex flex-wrap gap-2">
        <li v-for="entry in available" :key="entry.name">
          <BaseSecondaryButton
            class="min-h-9 px-3 py-1.5 text-xs"
            :class="{ 'opacity-60': !entry.suggested }"
            :title="
              entry.suggested
                ? undefined
                : $t('admin.routing.gateways.notSuggested')
            "
            @click="add(entry.name)"
          >
            + {{ entry.name }}
          </BaseSecondaryButton>
        </li>
      </ul>
    </div>

    <p v-else class="mt-4 text-sm text-subtle">
      {{ $t('admin.routing.gateways.noneAvailable') }}
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
  { value: 'block', label: t('admin.routing.gateways.unavailableBlock') },
  { value: 'direct', label: t('admin.routing.gateways.unavailableDirect') },
  ...(props.gateways.length > 1
    ? [
        {
          value: 'gateway',
          label: t('admin.routing.gateways.unavailableGateway'),
        },
      ]
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
  if (!gateway.enabled) {
    return 'bg-line';
  }
  if (gateway.present) {
    return 'bg-success';
  }
  return gateway.unavailableOutcome === 'block' ? 'bg-accent' : 'bg-warning';
}

// Why the gateway is unavailable, then what happens to its traffic, judged by
// what the chain amounts to rather than the setting alone: "through another
// gateway" whose chain ends in dropping is reported as dropping.
function statusText(gateway: RoutingGateway) {
  if (!gateway.enabled) {
    return t('admin.routing.gateways.statusOff');
  }
  if (gateway.present) {
    return t('admin.routing.gateways.statusUp');
  }

  const reason = gateway.stale
    ? gateway.handshakeAge === null
      ? t('admin.routing.gateways.statusNeverAnswered')
      : t('admin.routing.gateways.statusStale', {
          minutes: Math.floor(gateway.handshakeAge / 60),
        })
    : t('admin.routing.gateways.statusDown');

  switch (gateway.unavailableOutcome) {
    case 'block':
      return `${reason} ${t('admin.routing.gateways.statusBlock')}`;
    case 'direct':
      return `${reason} ${t('admin.routing.gateways.statusDirect')}`;
    case 'gateway':
      return `${reason} ${t('admin.routing.gateways.statusFallback', {
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
            ? {
                type: 'success',
                message: t('admin.routing.gateways.reconnected'),
              }
            : {
                type: 'error',
                message: t('admin.routing.gateways.reconnectNoAnswer'),
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
  if (unavailableAction === gateway.unavailableAction) {
    return;
  }
  // "Through another gateway" needs one named to be saved at all; start with
  // the first other one, which the second select then lets the reader change.
  const fallbackGatewayId =
    unavailableAction === 'gateway'
      ? (gateway.fallbackGatewayId ?? others(gateway)[0]?.id ?? null)
      : null;
  return update(gateway, { unavailableAction, fallbackGatewayId });
}

function setFallback(gateway: RoutingGateway, fallbackGatewayId: number) {
  if (fallbackGatewayId === gateway.fallbackGatewayId) {
    return;
  }
  return update(gateway, { fallbackGatewayId });
}

function rename(gateway: RoutingGateway, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (!name || name === gateway.name) {
    return;
  }
  return update(gateway, { name });
}

const create = useSubmit(
  (data) =>
    $fetch('/api/admin/routing/gateway', { method: 'post', body: data }),
  { revert: refresh, successMsg: t('admin.routing.gateways.added') }
);

function add(interfaceName: string) {
  return create({ interfaceName });
}

const destroy = useSubmit(
  (data) =>
    $fetch(`/api/admin/routing/gateway/${(data as { id: number }).id}`, {
      method: 'delete',
    }),
  { revert: refresh, successMsg: t('admin.routing.gateways.removed') }
);

function remove(gateway: RoutingGateway) {
  // No confirmation here: a gateway carries only a name, and the server
  // refuses to remove one that any rule still points at.
  return destroy({ id: gateway.id });
}
</script>
