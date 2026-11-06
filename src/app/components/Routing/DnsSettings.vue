<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <RoutingToggleSwitch
        id="dns-proxy"
        :model-value="config.dnsProxyEnabled"
        :title="$t('admin.routing.dnsSettings.proxy')"
        @update:model-value="setProxy"
      />
      <RoutingLabel for="dns-proxy">
        {{ $t('admin.routing.dnsSettings.proxy') }}
      </RoutingLabel>
    </div>

    <p class="max-w-prose text-xs text-subtle">
      {{ $t('admin.routing.dnsSettings.proxyHelp') }}
    </p>

    <div v-if="config.dnsProxyEnabled" class="flex flex-col gap-1">
      <RoutingLabel for="dns-upstreams">
        {{ $t('admin.routing.dnsSettings.upstreams') }}
      </RoutingLabel>
      <div class="flex flex-wrap items-center gap-2">
        <BaseInput
          id="dns-upstreams"
          v-model="upstreamsText"
          class="min-w-64 flex-1"
          placeholder="1.1.1.1, 8.8.8.8"
        />
        <BasePrimaryButton
          v-if="upstreamsChanged"
          type="button"
          @click="saveUpstreams"
        >
          {{ $t('common.actions.save') }}
        </BasePrimaryButton>
      </div>
      <p class="max-w-prose text-xs text-subtle">
        {{ $t('admin.routing.dnsSettings.upstreamsHelp') }}
      </p>
    </div>

    <div v-if="config.dnsProxyEnabled" class="flex flex-col gap-1">
      <span class="text-sm font-medium text-muted">
        {{ $t('admin.routing.dnsSettings.handedOut') }}
      </span>
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-mono text-sm text-foreground">
          {{ dns.currentDefault.join(', ') || $t('admin.routing.dns.none') }}
        </span>
        <span v-if="dns.defaultUsesProxy" class="text-sm text-success">
          {{ $t('admin.routing.dnsSettings.handedOutOk') }}
        </span>
        <BasePrimaryButton v-else type="button" @click="emit('useProxy')">
          {{ $t('admin.routing.dns.fix') }}
        </BasePrimaryButton>
      </div>
      <p class="max-w-prose text-xs text-subtle">
        {{ $t('admin.routing.dnsSettings.handedOutHelp') }}
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{ config: RoutingConfig; dns: DnsStatus }>();

const emit = defineEmits<{ changed: []; useProxy: [] }>();

const { t } = useI18n();

const upstreamsText = ref(props.config.dnsUpstreams.join(', '));

// Reset the field when the page reloads its data, so an edit that was rejected
// does not linger looking like it was saved.
watch(
  () => props.config.dnsUpstreams,
  (upstreams) => {
    upstreamsText.value = upstreams.join(', ');
  }
);

function parseUpstreams(text: string) {
  return text
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const upstreamsChanged = computed(
  () =>
    parseUpstreams(upstreamsText.value).join(',') !==
    props.config.dnsUpstreams.join(',')
);

const save = useSubmit(
  (body) => $fetch('/api/admin/routing/config', { method: 'post', body }),
  {
    revert: async () => emit('changed'),
    successMsg: t('admin.routing.dnsSettings.saved'),
  }
);

function saveConfig(changes: Partial<RoutingConfig>) {
  // The endpoint takes the whole config, so send what is there with the one
  // field replaced rather than adding a partial-update path for each toggle.
  return save({ ...props.config, ...changes });
}

function setProxy(enabled: boolean) {
  return saveConfig({ dnsProxyEnabled: enabled });
}

function saveUpstreams() {
  return saveConfig({ dnsUpstreams: parseUpstreams(upstreamsText.value) });
}
</script>
