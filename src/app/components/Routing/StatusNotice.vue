<template>
  <div
    v-if="!status.available"
    class="mb-6 rounded-lg border-2 border-red-800 bg-red-50 p-4 dark:bg-red-900/20"
  >
    <h4 class="font-semibold text-red-900 dark:text-red-200">
      {{ $t('routing.unavailable.title') }}
    </h4>
    <p class="mt-1 max-w-prose text-sm text-red-900/80 dark:text-red-200/80">
      {{ $t('routing.unavailable.explanation') }}
    </p>
  </div>

  <div
    v-else-if="status.failures !== 0"
    class="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-500/10"
  >
    <h4 class="font-semibold text-amber-900 dark:text-amber-200">
      {{ $t('routing.applyFailed.title') }}
    </h4>
    <p
      class="mt-1 max-w-prose text-sm text-amber-900/80 dark:text-amber-200/80"
    >
      {{ $t('routing.applyFailed.explanation') }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import type { ApplyStatus } from '#shared/utils/routingTypes';

/**
 * Every routing endpoint returns success once its database write lands, so
 * whether the rules actually installed has to be said here.
 */
defineProps<{ status: ApplyStatus }>();
</script>
