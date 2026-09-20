<template>
  <select
    :id="id"
    v-model="data"
    :name="id"
    :disabled="disabled"
    class="rounded-lg border-2 border-gray-100 bg-white py-2 pl-3 pr-8 text-gray-500 focus:border-red-800 focus:outline-0 focus:ring-0 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-700 dark:text-neutral-200"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<script lang="ts" setup>
/**
 * A plain native select. `BaseSelect` renders every option as
 * `value - label`, which suits the locale picker it was built for only.
 */
defineProps<{
  id?: string;
  options: { label: string; value: string | number }[];
  disabled?: boolean;
}>();

const data = defineModel<string | number | null>();
</script>
