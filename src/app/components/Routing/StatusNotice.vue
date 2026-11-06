<template>
  <div
    v-if="!status.available"
    role="alert"
    class="surface border-accent/30 p-4 sm:p-5"
  >
    <h4 class="font-semibold text-accent">
      {{ $t('admin.routing.unavailable.title') }}
    </h4>
    <p class="mt-1 max-w-prose text-sm text-muted">
      {{ $t('admin.routing.unavailable.explanation') }}
    </p>
  </div>

  <div
    v-else-if="status.failures !== 0"
    role="alert"
    class="surface border-warning/40 p-4 sm:p-5"
  >
    <h4 class="font-semibold text-warning">
      {{ $t('admin.routing.applyFailed.title') }}
    </h4>
    <p class="mt-1 max-w-prose text-sm text-muted">
      {{ $t('admin.routing.applyFailed.explanation') }}
    </p>
  </div>
</template>

<script lang="ts" setup>
/**
 * Every routing endpoint returns success once its database write lands, so
 * whether the rules actually installed has to be said here.
 */
defineProps<{ status: ApplyStatus }>();
</script>
