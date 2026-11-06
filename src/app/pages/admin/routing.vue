<template>
  <div v-if="data" class="space-y-4">
    <RoutingStatusNotice :status="data.status" />

    <RoutingDnsNotice
      :dns="data.dns"
      :proxy-enabled="data.config.dnsProxyEnabled"
      :has-domain-rules="hasDomainRules"
      @fix="() => enableProxyDns(null)"
    />

    <RoutingSection
      :title="$t('admin.routing.default.title')"
      :description="$t('admin.routing.default.description')"
    >
      <div class="flex flex-wrap items-center gap-3">
        <BaseSelect
          id="default-action"
          v-model="defaultAction"
          :options="defaultOptions"
          :label="$t('admin.routing.default.title')"
          :show-value="false"
          class="max-w-xs"
        />
        <p
          v-if="data.config.defaultAction === 'block'"
          class="text-sm text-warning"
        >
          {{ $t('admin.routing.default.blockWarning') }}
        </p>
      </div>
    </RoutingSection>

    <RoutingSection
      :title="$t('admin.routing.gateways.title')"
      :description="$t('admin.routing.gateways.description')"
    >
      <RoutingGatewayList
        :gateways="data.gateways"
        :available="data.availableInterfaces"
        :ipv6-enabled="data.ipv6Enabled"
        @changed="refresh"
      />
    </RoutingSection>

    <RoutingSection
      :title="$t('admin.routing.dnsSettings.title')"
      :description="$t('admin.routing.dnsSettings.description')"
    >
      <RoutingDnsSettings
        :config="data.config"
        :dns="data.dns"
        @changed="refresh"
        @use-proxy="() => enableProxyDns(null)"
      />
    </RoutingSection>

    <RoutingSection
      :title="$t('admin.routing.rules.title')"
      :description="$t('admin.routing.rules.description')"
    >
      <template #actions>
        <BasePrimaryButton v-if="!ruleFormOpen" @click="newRule">
          {{ $t('admin.routing.rules.add') }}
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
      :title="$t('admin.routing.forwards.title')"
      :description="
        data.forwardPorts.specs.length
          ? $t('admin.routing.forwards.description', {
              ports: data.forwardPorts.text,
            })
          : $t('admin.routing.forwards.nonePublished')
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
          {{ $t('admin.routing.forwards.add') }}
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
  </div>
</template>

<script setup lang="ts">
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
  {
    revert: async () => refresh(),
    successMsg: t('admin.routing.default.saved'),
  }
);

const defaultAction = computed({
  get: () => {
    const config = data.value?.config;
    return config
      ? toActionChoice(config.defaultAction, config.defaultGatewayId)
      : undefined;
  },
  set: (choice: ActionChoice | undefined) => {
    const config = data.value?.config;
    if (!config || !choice) {
      return;
    }

    const { action, gatewayId } = fromActionChoice(choice);
    saveConfig({
      ...config,
      defaultAction: action,
      defaultGatewayId: gatewayId,
    });
  },
});

const defaultOptions = computed<{ label: string; value: ActionChoice }[]>(
  () => [
    ...(data.value?.gateways ?? []).map((gateway) => ({
      label: t('admin.routing.action.viaGateway', { name: gateway.name }),
      value: gatewayChoice(gateway.id),
    })),
    { label: t('admin.routing.action.direct'), value: 'direct' },
    { label: t('admin.routing.action.block'), value: 'block' },
  ]
);

// DNS

const enableProxyDns = useSubmit(
  () => $fetch('/api/admin/routing/dns/use-proxy', { method: 'post' }),
  { revert: async () => refresh(), successMsg: t('admin.routing.dns.fixed') }
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
