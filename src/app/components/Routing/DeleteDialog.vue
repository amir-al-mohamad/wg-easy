<template>
  <BaseDialog trigger-class="inline-flex">
    <template #trigger>
      <BaseSecondaryButton as="span" class="min-h-9 px-3 py-1.5 text-xs">
        {{ $t('admin.routing.remove') }}
      </BaseSecondaryButton>
    </template>
    <template #title>{{ title }}</template>
    <template #description><slot /></template>
    <template #actions>
      <DialogClose as-child>
        <BaseSecondaryButton>
          {{ $t('common.actions.cancel') }}
        </BaseSecondaryButton>
      </DialogClose>
      <DialogClose as-child>
        <BaseSecondaryButton class="ui-button-danger" @click="$emit('delete')">
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
