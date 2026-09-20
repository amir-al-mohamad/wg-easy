<template>
  <form
    class="mb-4 rounded-lg border-2 border-red-800 p-4"
    @submit.prevent="submit"
  >
    <h4 class="mb-3 font-semibold">
      {{
        forward
          ? $t('routing.forwards.editTitle')
          : $t('routing.forwards.newTitle')
      }}
    </h4>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <RoutingLabel for="forward-name">
          {{ $t('routing.forwards.name') }}
        </RoutingLabel>
        <BaseInput id="forward-name" v-model="form.name" required />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="forward-client">
          {{ $t('routing.forwards.client') }}
        </RoutingLabel>
        <RoutingSelect
          id="forward-client"
          v-model="form.clientId"
          :options="clientOptions"
        />
      </div>

      <div class="flex flex-wrap gap-3">
        <div class="flex flex-col gap-1">
          <RoutingLabel for="forward-external">
            {{ $t('routing.forwards.externalPort') }}
          </RoutingLabel>
          <BaseInput
            id="forward-external"
            v-model.number="form.externalPort"
            type="number"
            :min="bounds.min"
            :max="bounds.max"
            required
          />
          <p class="text-sm text-gray-500 dark:text-neutral-400">
            {{ $t('routing.forwards.rangeHelp', { ports: ports.text }) }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <RoutingLabel for="forward-internal">
            {{ $t('routing.forwards.internalPort') }}
          </RoutingLabel>
          <BaseInput
            id="forward-internal"
            v-model.number="form.internalPort"
            type="number"
            min="1"
            max="65535"
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <RoutingLabel for="forward-protocol">
            {{ $t('routing.forwards.protocol') }}
          </RoutingLabel>
          <RoutingSelect
            id="forward-protocol"
            v-model="form.protocol"
            :options="protocolOptions"
          />
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <BasePrimaryButton type="submit">
        {{ forward ? $t('form.save') : $t('form.add') }}
      </BasePrimaryButton>
      <BaseSecondaryButton type="button" @click="emit('cancel')">
        {{ $t('routing.cancel') }}
      </BaseSecondaryButton>
    </div>
  </form>
</template>

<script lang="ts" setup>
import { PROTOCOL_LABELS } from '#shared/utils/routingTypes';
import type {
  ForwardPorts,
  PortForward,
  PortForwardProtocol,
  RoutingClient,
} from '#shared/utils/routingTypes';

const props = defineProps<{
  /** Absent when creating. */
  forward: PortForward | null;
  clients: RoutingClient[];
  /** Ports the container actually publishes. */
  ports: ForwardPorts;
}>();

const emit = defineEmits<{ saved: []; cancel: [] }>();

const { t } = useI18n();

// The input can only bound a single span; the server checks the exact list.
// With nothing published the form only opens on an existing forward, which
// the server refuses to change, so the bounds just have to be sane.
const bounds = computed(() => ({
  min: Math.min(65535, ...props.ports.specs.map((spec) => spec.start)),
  max: Math.max(1, ...props.ports.specs.map((spec) => spec.end)),
}));

const form = reactive({
  name: props.forward?.name ?? '',
  description: props.forward?.description ?? '',
  clientId: props.forward?.clientId ?? props.clients[0]?.id ?? 0,
  externalPort: props.forward?.externalPort ?? props.ports.specs[0]?.start ?? 0,
  internalPort: props.forward?.internalPort ?? 80,
  protocol: (props.forward?.protocol ?? 'tcp') as PortForwardProtocol,
});

const clientOptions = computed(() =>
  props.clients.map((client) => ({
    label: `${client.name} (${client.ipv4Address})`,
    value: client.id,
  }))
);

const protocolOptions = (
  Object.entries(PROTOCOL_LABELS) as [PortForwardProtocol, string][]
).map(([value, label]) => ({ value, label }));

const save = useSubmit(
  (data) =>
    $fetch(
      props.forward
        ? `/api/admin/routing/forward/${props.forward.id}`
        : '/api/admin/routing/forward',
      { method: 'post', body: data }
    ),
  {
    successMsg: t('routing.forwards.saved'),
    revert: async (success) => {
      if (success) emit('saved');
    },
  }
);

function submit() {
  return save({
    name: form.name,
    description: form.description,
    enabled: props.forward?.enabled ?? true,
    clientId: form.clientId,
    externalPort: form.externalPort,
    internalPort: form.internalPort,
    protocol: form.protocol,
  });
}
</script>
