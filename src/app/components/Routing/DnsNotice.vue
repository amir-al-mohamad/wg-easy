<template>
  <div
    v-if="problem"
    class="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-500/10"
  >
    <h4 class="font-semibold text-amber-900 dark:text-amber-200">
      {{ $t('routing.dns.title') }}
    </h4>
    <p
      class="mt-1 max-w-prose text-sm text-amber-900/80 dark:text-amber-200/80"
    >
      {{ $t('routing.dns.explanation') }}
    </p>

    <p
      v-if="problem === 'off'"
      class="mt-3 text-sm text-amber-900 dark:text-amber-200"
    >
      {{ $t('routing.dns.interceptOff') }}
    </p>

    <p
      v-else-if="problem === 'notListening'"
      class="mt-3 text-sm text-amber-900 dark:text-amber-200"
    >
      {{ $t('routing.dns.notListening') }}
    </p>

    <template v-else>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-amber-900/70 dark:text-amber-200/70">
          {{ $t('routing.dns.current') }}
        </dt>
        <dd class="font-mono text-amber-900 dark:text-amber-200">
          {{ dns.currentDefault.join(', ') || $t('routing.dns.none') }}
        </dd>
        <dt class="text-amber-900/70 dark:text-amber-200/70">
          {{ $t('routing.dns.shouldBe') }}
        </dt>
        <dd class="font-mono text-amber-900 dark:text-amber-200">
          {{ dns.serverAddresses.ipv4 }}
        </dd>
      </dl>

      <p class="mt-3 text-sm text-amber-900/80 dark:text-amber-200/80">
        {{ $t('routing.dns.afterFix') }}
      </p>

      <BasePrimaryButton class="mt-3" @click="emit('fix')">
        {{ $t('routing.dns.fix') }}
      </BasePrimaryButton>
    </template>
  </div>

  <div
    v-if="hasDomainRules && dns.clientsBypassing.length > 0"
    class="mb-6 rounded-lg border-2 border-gray-100 p-4 dark:border-neutral-600"
  >
    <h4 class="font-semibold">{{ $t('routing.dns.bypassTitle') }}</h4>
    <p class="mt-1 max-w-prose text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('routing.dns.bypassExplanation') }}
    </p>
    <ul class="mt-2 flex flex-wrap gap-2">
      <li
        v-for="client in dns.clientsBypassing"
        :key="client.id"
        class="rounded bg-gray-100 px-2 py-1 text-sm dark:bg-neutral-600"
      >
        {{ client.name }}
        <span class="font-mono text-gray-500 dark:text-neutral-400">
          {{ client.dns.join(', ') }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup>
import type { DnsStatus } from '#shared/utils/routingTypes';

const props = defineProps<{
  dns: DnsStatus;
  interceptEnabled: boolean;
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
  if (!props.hasDomainRules) return null;
  if (!props.interceptEnabled) return 'off';
  if (!props.dns.listening) return 'notListening';
  if (!props.dns.defaultUsesProxy) return 'default';
  return null;
});
</script>
