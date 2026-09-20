<template>
  <RLabel :for="props.for" class="font-medium">
    <slot />
  </RLabel>
</template>

<script lang="ts" setup>
import { Label as RLabel } from 'reka-ui';

/**
 * A label for a stacked field. `FormLabel`'s tall line-height suits
 * `FormGroup`'s two-column grid, not a column layout.
 */
const props = defineProps<{ for: string }>();
</script>
