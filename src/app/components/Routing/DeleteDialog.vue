<template>
  <BaseDialog trigger-class="inline-flex">
    <template #trigger>
      <BaseSecondaryButton as="span" class="px-2 py-1 text-sm">
        {{ $t('routing.remove') }}
      </BaseSecondaryButton>
    </template>
    <template #title>{{ title }}</template>
    <template #description><slot /></template>
    <template #actions>
      <DialogClose as-child>
        <BasePrimaryButton>{{ $t('dialog.cancel') }}</BasePrimaryButton>
      </DialogClose>
      <DialogClose as-child>
        <BaseSecondaryButton @click="$emit('delete')">
          {{ title }}
        </BaseSecondaryButton>
      </DialogClose>
    </template>
  </BaseDialog>
</template>

<script lang="ts" setup>
/** Confirmation before deleting a rule or forward, in the shape of `Clients/DeleteDialog.vue`. */
defineEmits(['delete']);
defineProps<{ title: string }>();
</script>
