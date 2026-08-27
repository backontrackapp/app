<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  icon?: string
  fallbackIcon?: string
  size?: string | number
}>(), {
  icon: '',
  fallbackIcon: 'mdi-shape-outline',
  size: undefined,
})

const resolvedIcon = computed(() => props.icon || props.fallbackIcon)
const isMaterialIcon = computed(() => resolvedIcon.value.startsWith('mdi-'))
const emojiSize = computed(() => {
  if (typeof props.size === 'number') return `${props.size / 16}rem`
  return props.size || '1em'
})
</script>

<template>
  <v-icon
    v-if="isMaterialIcon"
    v-bind="$attrs"
    :icon="resolvedIcon"
    :size="size"
  />
  <span
    v-else
    v-bind="$attrs"
    class="content-icon__emoji"
    :style="{ fontSize: emojiSize }"
    aria-hidden="true"
  >
    {{ resolvedIcon }}
  </span>
</template>

<style scoped>
.content-icon__emoji {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  line-height: 1;
}
</style>
