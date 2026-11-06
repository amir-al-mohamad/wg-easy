<template>
  <form
    class="mb-4 rounded-lg border border-accent/40 bg-surface p-4 sm:p-5"
    @submit.prevent="submit"
  >
    <h4 class="mb-4 font-semibold text-foreground">
      {{
        forward
          ? $t('admin.routing.forwards.editTitle')
          : $t('admin.routing.forwards.newTitle')
      }}
    </h4>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <RoutingLabel for="forward-name">
          {{ $t('admin.routing.forwards.name') }}
        </RoutingLabel>
        <BaseInput id="forward-name" v-model="form.name" required />
      </div>

      <div class="flex flex-col gap-1">
        <RoutingLabel for="forward-client">
          {{ $t('admin.routing.forwards.client') }}
        </RoutingLabel>
        <BaseSelect
          id="forward-client"
          v-model="form.clientId"
          :options="clientOptions"
          :label="$t('admin.routing.forwards.client')"
          :show-value="false"
        />
      </div>

      <div class="flex flex-wrap gap-3">
        <div class="flex flex-col gap-1">
          <RoutingLabel for="forward-external">
            {{ $t('admin.routing.forwards.externalPort') }}
          </RoutingLabel>
          <BaseInput
            id="forward-external"
            v-model.number="form.externalPort"
            type="number"
            :min="bounds.min"
            :max="bounds.max"
            required
          />
          <p class="text-xs text-subtle">
            {{ $t('admin.routing.forwards.rangeHelp', { ports: ports.text }) }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <RoutingLabel for="forward-internal">
            {{ $t('admin.routing.forwards.internalPort') }}
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
            {{ $t('admin.routing.forwards.protocol') }}
          </RoutingLabel>
          <BaseSelect
            id="forward-protocol"
            v-model="form.protocol"
            :options="protocolOptions"
            :label="$t('admin.routing.forwards.protocol')"
            :show-value="false"
          />
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <BasePrimaryButton type="submit">
        {{ forward ? $t('common.actions.save') : $t('common.actions.add') }}
      </BasePrimaryButton>
      <BaseSecondaryButton type="button" @click="emit('cancel')">
        {{ $t('admin.routing.cancel') }}
      </BaseSecondaryButton>
    </div>
  </form>
</template>

<script lang="ts" setup>
import {
  forwardProtocolLabels,
  forwardProtocols,
  type ForwardProtocol,
} from '#shared/utils/routing';

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

const newForwardProtocol: ForwardProtocol = 'tcp';

const form = reactive({
  name: props.forward?.name ?? '',
  description: props.forward?.description ?? '',
  clientId: props.forward?.clientId ?? props.clients[0]?.id ?? 0,
  externalPort: props.forward?.externalPort ?? props.ports.specs[0]?.start ?? 0,
  internalPort: props.forward?.internalPort ?? 80,
  protocol: props.forward?.protocol ?? newForwardProtocol,
});

const clientOptions = computed(() =>
  props.clients.map((client) => ({
    label: `${client.name} (${client.ipv4Address})`,
    value: client.id,
  }))
);

const protocolOptions = forwardProtocols.map((value) => ({
  value,
  label: forwardProtocolLabels[value],
}));

const save = useSubmit(
  (data) =>
    $fetch(
      props.forward
        ? `/api/admin/routing/forward/${props.forward.id}`
        : '/api/admin/routing/forward',
      { method: 'post', body: data }
    ),
  {
    successMsg: t('admin.routing.forwards.saved'),
    revert: async (success) => {
      if (success) {
        emit('saved');
      }
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
