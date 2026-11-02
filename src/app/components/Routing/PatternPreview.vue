<template>
  <ul v-if="parsed.length" class="flex flex-wrap gap-2">
    <li
      v-for="entry in parsed"
      :key="entry.raw"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm"
      :class="
        entry.kind
          ? 'bg-surface-raised text-foreground'
          : 'bg-accent/10 text-accent'
      "
    >
      <code>{{ entry.raw }}</code>
      <span class="text-xs" :class="entry.kind ? 'text-subtle' : ''">
        {{
          entry.kind
            ? $t(`admin.routing.patternKind.${entry.kind}`)
            : $t('admin.routing.patternKind.invalid')
        }}
      </span>
    </li>
  </ul>
</template>

<script lang="ts" setup>
import { parsePattern } from '#shared/utils/pattern';

const props = defineProps<{ text: string }>();

/**
 * What each line will match, shown as it is typed: `*.example.com` and
 * `.example.com` differ by whether the apex is included, and unparsable lines
 * are flagged before submit.
 */
const parsed = computed(() =>
  props.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, kind: parsePattern(raw)?.kind ?? null }))
);
</script>
