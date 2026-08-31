<script setup lang="ts">
import { ref, toRef } from 'vue'
import SpokenText from '@/components/SpokenText.vue'
import { useFitLargestWord } from '@/composables/useFitLargestWord'
import type { FlashcardSpeechWord } from '@/types/domain'

const props = defineProps<{
  text: string
  language?: string
  spokenWord?: FlashcardSpeechWord
  colorizePinyin?: boolean
  toneSource?: string
  pinyin?: boolean
  wordsPressable?: boolean
}>()

const emit = defineEmits<{
  pressWord: [word: string, spokenWord: FlashcardSpeechWord]
}>()

const contentElement = ref<HTMLElement>()
const textElement = ref<HTMLElement>()
const measurementElement = ref<HTMLElement>()

useFitLargestWord(
  () => contentElement.value,
  () => measurementElement.value,
  () => textElement.value ? [textElement.value] : [],
  toRef(props, 'text'),
  { maxLines: 3, fitHeight: true, fontSizeProperty: '--fit-review-content-size' },
)
</script>

<template>
  <span ref="contentElement" class="review-card__content fit-review-content">
    <strong ref="textElement">
      <SpokenText
        :text="text"
        :language="language"
        :active-start="spokenWord?.start"
        :active-end="spokenWord?.end"
        :colorize-pinyin="colorizePinyin"
        :tone-source="toneSource"
        :pinyin="pinyin"
        :words-pressable="wordsPressable"
        @press-word="(word, spokenWord) => emit('pressWord', word, spokenWord)"
      />
    </strong>
    <span
      ref="measurementElement"
      class="fit-review-content__measurement"
      data-fit-largest-word-measurement
      aria-hidden="true"
    />
  </span>
</template>

<style scoped>
.fit-review-content {
  position: relative;
  font-size: var(--fit-review-content-size, 3.6rem);
}

.fit-review-content > strong {
  font-size: inherit;
}

.fit-review-content__measurement {
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
