<template>
  <div class="col-span-full">
    <FormFieldLabel
      id="isolatedFrom"
      :label="$t('clients.isolation.from')"
      :description="$t('clients.isolation.fromDescription')"
    />
    <ul
      id="isolatedFrom"
      class="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-input p-1.5"
    >
      <li v-for="client in others" :key="client.id">
        <label
          class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
        >
          <BaseCheckbox
            :label="client.name"
            :model-value="data.includes(client.id)"
            @update:model-value="toggle(client.id, $event === true)"
          />
          <span class="truncate text-foreground">{{ client.name }}</span>
          <span class="ml-auto font-mono text-xs text-subtle">
            {{ client.ipv4Address }}
          </span>
        </label>
      </li>
      <li v-if="!others.length" class="px-2 py-1.5 text-subtle">
        {{ $t('clients.isolation.empty') }}
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup>
/**
 * The clients this one is isolated from. Fetched here rather than passed in:
 * the client page has no other reason to know about other clients, and the
 * list endpoint already limits a non-admin to their own.
 */
const props = defineProps<{ clientId: number }>();

const data = defineModel<number[]>({ required: true });

// The list endpoint pages its results; isolation needs every client.
const { data: clients } = useAsyncData(
  'isolation-clients',
  async () => {
    const all = [];
    for (let page = 1; ; page++) {
      const result = await $fetch('/api/client', {
        query: { page, pageSize: 100 },
      });
      all.push(...result.clients);
      if (!result.clients.length || all.length >= result.total) {
        return all;
      }
    }
  },
  { lazy: true }
);

const others = computed(() =>
  (clients.value ?? [])
    .filter((client) => client.id !== props.clientId)
    .map((client) => ({
      id: client.id,
      name: client.name,
      ipv4Address: client.ipv4Address,
    }))
);

function toggle(id: number, checked: boolean) {
  data.value = checked
    ? [...data.value, id]
    : data.value.filter((other) => other !== id);
}
</script>
