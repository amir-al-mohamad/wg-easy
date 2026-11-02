<template>
  <section class="surface p-5 sm:p-6">
    <div
      class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4"
    >
      <div class="min-w-0">
        <h2 class="text-base font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>
        <p v-if="description" class="mt-1 max-w-prose text-sm text-subtle">
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
