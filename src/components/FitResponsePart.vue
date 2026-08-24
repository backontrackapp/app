<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFitLargestWord } from '@/composables/useFitLargestWord'

const props = withDefaults(defineProps<{
  tag: 'strong' | 'span'
  text: string
  defaultFontSize?: string
  minSizeRem?: number
  maxSizeRem?: number
  maxLines?: number
  fitWidth?: boolean
}>(), {
  defaultFontSize: '3.6rem',
  maxSizeRem: 3.6,
  maxLines: 2,
  fitWidth: true,
})

const partElement = ref<HTMLElement>()
const measurementElement = ref<HTMLElement>()

useFitLargestWord(
  () => partElement.value,
  () => measurementElement.value,
  () => partElement.value ? [partElement.value] : [],
  computed(() => `${props.text}:${props.minSizeRem}:${props.maxSizeRem}:${props.fitWidth}`),
  {
    maxLines: props.maxLines,
    minSizeRem: () => props.minSizeRem,
    maxSizeRem: () => props.maxSizeRem,
    fitWidth: () => props.fitWidth,
    fontSizeProperty: '--fit-response-part-size',
  },
)
</script>

<template>
  <component
    :is="tag"
    ref="partElement"
    class="fit-response-part"
    :style="{ fontSize: `var(--fit-response-part-size, ${defaultFontSize})` }"
  >
    {{ text }}
    <span
      ref="measurementElement"
      class="fit-response-part__measurement"
      data-fit-largest-word-measurement
      aria-hidden="true"
    />
  </component>
</template>

<style scoped>
.fit-response-part {
  position: relative;
}

.fit-response-part__measurement {
  position: absolute;
  top: 0;
  left: 0;
  width: auto;
  height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  visibility: hidden;
  line-height: 0;
  pointer-events: none;
  white-space: nowrap;
}
</style>
