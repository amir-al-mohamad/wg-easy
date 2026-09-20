<template>
  <BaseSwitch
    :id="id"
    :model-value="enabled"
    :title="title"
    @update:model-value="toggle"
  />
</template>

<script lang="ts" setup>
/**
 * A switch that moves the moment it is clicked, like `ClientCard/Switch.vue`:
 * the routing page refetches after every toggle, and a switch waiting for
 * that reads as broken. The parent's refresh puts it back on failure.
 */
const props = defineProps<{
  id: string;
  modelValue: boolean;
  title: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const enabled = ref(props.modelValue);

watch(
  () => props.modelValue,
  (value) => {
    enabled.value = value;
  }
);

function toggle(next: boolean | undefined) {
  if (next === undefined) return;
  enabled.value = next;
  emit('update:modelValue', next);
}
</script>
