<template>
  <main v-if="data">
    <RoutingStatusNotice :status="data.status" />

    <RoutingDnsNotice
      :dns="data.dns"
      :intercept-enabled="data.config.dnsInterceptEnabled"
      :has-domain-rules="hasDomainRules"
      @fix="() => enableProxyDns(null)"
    />

    <RoutingSection
      :title="$t('routing.default.title')"
      :description="$t('routing.default.description')"
    >
      <div class="flex flex-wrap items-center gap-3">
        <RoutingSelect
          id="default-action"
          v-model="defaultAction"
          :options="defaultOptions"
        />
        <p
          v-if="data.config.defaultAction === 'block'"
          class="text-sm text-gray-500 dark:text-neutral-400"
        >
          {{ $t('routing.default.blockWarning') }}
        </p>
      </div>
    </RoutingSection>

    <RoutingSection
      :title="$t('routing.gateways.title')"
      :description="$t('routing.gateways.description')"
    >
      <RoutingGatewayList
        :gateways="data.gateways"
        :available="data.availableInterfaces"
        :ipv6-enabled="data.ipv6Enabled"
        @changed="refresh"
      />
    </RoutingSection>

    <RoutingSection
      :title="$t('routing.dnsSettings.title')"
      :description="$t('routing.dnsSettings.description')"
    >
      <RoutingDnsSettings
        :config="data.config"
        :dns="data.dns"
        @changed="refresh"
        @use-proxy="() => enableProxyDns(null)"
      />
    </RoutingSection>

    <RoutingSection
      :title="$t('routing.rules.title')"
      :description="$t('routing.rules.description')"
    >
      <template #actions>
        <BasePrimaryButton v-if="!ruleFormOpen" @click="newRule">
          {{ $t('routing.rules.add') }}
        </BasePrimaryButton>
      </template>

      <RoutingRuleForm
        v-if="ruleFormOpen"
        :key="editingRule?.id ?? 'new'"
        :rule="editingRule"
        :gateways="data.gateways"
        :clients="data.clients"
        @saved="closeRuleForm"
        @cancel="ruleFormOpen = false"
      />

      <RoutingRuleList
        :rules="data.rules"
        @changed="refresh"
        @edit="editRule"
      />
    </RoutingSection>

    <RoutingSection
      :title="$t('routing.forwards.title')"
      :description="
        data.forwardPorts.specs.length
          ? $t('routing.forwards.description', {
              ports: data.forwardPorts.text,
            })
          : $t('routing.forwards.nonePublished')
      "
    >
      <template #actions>
        <BasePrimaryButton
          v-if="
            !forwardFormOpen &&
            data.clients.length &&
            data.forwardPorts.specs.length
          "
          @click="newForward"
        >
          {{ $t('routing.forwards.add') }}
        </BasePrimaryButton>
      </template>

      <RoutingForwardForm
        v-if="forwardFormOpen"
        :key="editingForward?.id ?? 'new'"
        :forward="editingForward"
        :clients="data.clients"
        :ports="data.forwardPorts"
        @saved="closeForwardForm"
        @cancel="forwardFormOpen = false"
      />

      <RoutingForwardList
        :forwards="data.forwards"
        @changed="refresh"
        @edit="editForward"
      />
    </RoutingSection>
  </main>
</template>

<script setup lang="ts">
import type { PortForward, RoutingRule } from '#shared/utils/routingTypes';

const { t } = useI18n();

const { data, refresh } = await useFetch('/api/admin/routing', {
  method: 'get',
});

/** Whether anything on the page actually depends on DNS. */
const hasDomainRules = computed(() =>
  (data.value?.rules ?? []).some(
    (rule) => rule.enabled && rule.patterns.length > 0
  )
);

// Default action

const saveConfig = useSubmit(
  (body) => $fetch('/api/admin/routing/config', { method: 'post', body }),
  { revert: async () => refresh(), successMsg: t('routing.default.saved') }
);

const defaultAction = computed({
  get: () => {
    const config = data.value?.config;
    if (!config) return 'direct';
    return config.defaultAction === 'gateway'
      ? `gateway:${config.defaultGatewayId ?? ''}`
      : config.defaultAction;
  },
  set: (value: string | number | null) => {
    const config = data.value?.config;
    if (!config) return;

    const text = String(value);
    const isGateway = text.startsWith('gateway:');

    saveConfig({
      ...config,
      defaultAction: isGateway ? 'gateway' : text,
      defaultGatewayId: isGateway
        ? Number(text.slice('gateway:'.length))
        : null,
    });
  },
});

const defaultOptions = computed(() => [
  ...(data.value?.gateways ?? []).map((gateway) => ({
    label: t('routing.action.viaGateway', { name: gateway.name }),
    value: `gateway:${gateway.id}`,
  })),
  { label: t('routing.action.direct'), value: 'direct' },
  { label: t('routing.action.block'), value: 'block' },
]);

// DNS

const enableProxyDns = useSubmit(
  () => $fetch('/api/admin/routing/dns/use-proxy', { method: 'post' }),
  { revert: async () => refresh(), successMsg: t('routing.dns.fixed') }
);

// Rules

const ruleFormOpen = ref(false);
const editingRule = ref<RoutingRule | null>(null);

function newRule() {
  editingRule.value = null;
  ruleFormOpen.value = true;
}

function editRule(rule: RoutingRule) {
  editingRule.value = rule;
  ruleFormOpen.value = true;
}

async function closeRuleForm() {
  ruleFormOpen.value = false;
  editingRule.value = null;
  await refresh();
}

// Forwards

const forwardFormOpen = ref(false);
const editingForward = ref<PortForward | null>(null);

function newForward() {
  editingForward.value = null;
  forwardFormOpen.value = true;
}

function editForward(forward: PortForward) {
  editingForward.value = forward;
  forwardFormOpen.value = true;
}

async function closeForwardForm() {
  forwardFormOpen.value = false;
  editingForward.value = null;
  await refresh();
}
</script>
