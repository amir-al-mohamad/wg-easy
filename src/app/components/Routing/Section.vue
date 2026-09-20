<template>
  <section class="mb-8 last:mb-0">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 class="font-semibold text-gray-900 dark:text-neutral-100">
          {{ title }}
        </h3>
        <p
          v-if="description"
          class="mt-0.5 max-w-prose text-sm text-gray-500 dark:text-neutral-400"
        >
          {{ description }}
        </p>
      </div>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>

<script lang="ts" setup>
defineProps<{ title: string; description?: string }>();
</script>
