<template>
  <div class="col-span-2">
    <FormLabel for="isolatedFrom">{{ $t('client.isolatedFrom') }}</FormLabel>
    <p class="mb-1 text-sm text-gray-500 dark:text-neutral-400">
      {{ $t('client.isolatedFromDesc') }}
    </p>
    <ul
      id="isolatedFrom"
      class="max-h-40 overflow-y-auto rounded-lg border-2 border-gray-100 p-2 dark:border-neutral-600"
    >
      <li v-for="client in others" :key="client.id">
        <label class="flex cursor-pointer items-center gap-2 py-1">
          <input
            v-model="data"
            type="checkbox"
            :value="client.id"
            class="accent-red-800"
          />
          <span>{{ client.name }}</span>
          <span class="font-mono text-sm text-gray-400 dark:text-neutral-400">
            {{ client.ipv4Address }}
          </span>
        </label>
      </li>
      <li
        v-if="!others.length"
        class="py-1 text-sm text-gray-500 dark:text-neutral-400"
      >
        {{ $t('client.isolatedFromEmpty') }}
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

const { data: clients } = useFetch('/api/client', {
  method: 'get',
  lazy: true,
});

const others = computed(() =>
  (clients.value ?? [])
    .filter((client) => client.id !== props.clientId)
    .map((client) => ({
      id: client.id,
      name: client.name,
      ipv4Address: client.ipv4Address,
    }))
);
</script>
