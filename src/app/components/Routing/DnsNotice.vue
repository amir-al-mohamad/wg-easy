<template>
  <div v-if="problem" role="alert" class="surface border-warning/40 p-4 sm:p-5">
    <h4 class="font-semibold text-warning">
      {{ $t('admin.routing.dns.title') }}
    </h4>
    <p class="mt-1 max-w-prose text-sm text-muted">
      {{ $t('admin.routing.dns.explanation') }}
    </p>

    <p v-if="problem === 'off'" class="mt-3 text-sm text-foreground">
      {{ $t('admin.routing.dns.proxyOff') }}
    </p>

    <p
      v-else-if="problem === 'notListening'"
      class="mt-3 text-sm text-foreground"
    >
      {{ $t('admin.routing.dns.notListening') }}
    </p>

    <template v-else>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-subtle">
          {{ $t('admin.routing.dns.current') }}
        </dt>
        <dd class="font-mono text-foreground">
          {{ dns.currentDefault.join(', ') || $t('admin.routing.dns.none') }}
        </dd>
        <dt class="text-subtle">
          {{ $t('admin.routing.dns.shouldBe') }}
        </dt>
        <dd class="font-mono text-foreground">
          {{ dns.serverAddresses.ipv4 }}
        </dd>
      </dl>

      <p class="mt-3 text-sm text-muted">
        {{ $t('admin.routing.dns.afterFix') }}
      </p>

      <BasePrimaryButton class="mt-3" @click="emit('fix')">
        {{ $t('admin.routing.dns.fix') }}
      </BasePrimaryButton>
    </template>
  </div>

  <div
    v-if="hasDomainRules && dns.clientsBypassing.length > 0"
    class="surface p-4 sm:p-5"
  >
    <h4 class="font-semibold text-foreground">
      {{ $t('admin.routing.dns.bypassTitle') }}
    </h4>
    <p class="mt-1 max-w-prose text-sm text-subtle">
      {{ $t('admin.routing.dns.bypassExplanation') }}
    </p>
    <ul class="mt-2 flex flex-wrap gap-2">
      <li
        v-for="client in dns.clientsBypassing"
        :key="client.id"
        class="rounded-md bg-surface-raised px-2 py-1 text-sm text-foreground"
      >
        {{ client.name }}
        <span class="font-mono text-subtle">
          {{ client.dns.join(', ') }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  dns: DnsStatus;
  proxyEnabled: boolean;
  /** Whether any enabled rule actually matches on domains. */
  hasDomainRules: boolean;
}>();

const emit = defineEmits<{ fix: [] }>();

/**
 * Whichever link in the chain is broken first. Only worth saying once a rule
 * depends on DNS: a permanent warning about an unused feature is the kind of
 * noise people learn to scroll past.
 */
const problem = computed(() => {
  if (!props.hasDomainRules) {
    return null;
  }
  if (!props.proxyEnabled) {
    return 'off';
  }
  if (!props.dns.listening) {
    return 'notListening';
  }
  if (!props.dns.defaultUsesProxy) {
    return 'default';
  }
  return null;
});
</script>
