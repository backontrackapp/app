<script setup lang="ts">
import { computed } from 'vue'
import { flashcardTextFontSize } from '@/services/flashcards'
import type { FlashcardBackDisplay } from '@/types/domain'

const props = withDefaults(defineProps<{
  back: string
  transliteration?: string
  note?: string
  backDisplay?: FlashcardBackDisplay
  showTransliteration?: boolean
  density?: 'full' | 'compact'
}>(), {
  transliteration: '',
  note: '',
  backDisplay: 'back',
  showTransliteration: false,
  density: 'full',
})

type ResponsePart = {
  kind: 'back' | 'transliteration' | 'note'
  presentation: 'primary' | 'supporting'
  value: string
}

const parts = computed<ResponsePart[]>(() => {
  const back = { kind: 'back' as const, value: props.back }
  const transliteration = { kind: 'transliteration' as const, value: props.transliteration }
  const primary = props.showTransliteration
    && props.backDisplay === 'transliteration'
    && props.transliteration
    ? transliteration
    : back
  const response: ResponsePart[] = [{ ...primary, presentation: 'primary' }]

  if (props.showTransliteration) {
    const alternate = primary.kind === 'back' ? transliteration : back
    if (alternate.value) response.push({ ...alternate, presentation: 'supporting' })
  }
  if (props.note) response.push({ kind: 'note', value: props.note, presentation: 'supporting' })
  return response
})
</script>

<template>
  <span :class="['flashcard-response-text', `flashcard-response-text--${density}`]">
    <component
      :is="part.presentation === 'primary' ? 'strong' : 'span'"
      v-for="part in parts"
      :key="part.kind"
      :class="[
        'flashcard-response-text__part',
        `flashcard-response-text__${part.presentation}`,
        { 'text-secondary': part.presentation === 'primary' },
      ]"
      :data-response-part="part.kind"
      :data-response-presentation="part.presentation"
      :style="{
        fontSize: flashcardTextFontSize(
          part.value,
          part.presentation === 'primary' ? 'face' : 'note',
          density,
        ),
      }"
    >
      {{ part.value }}
    </component>
  </span>
</template>

<style scoped>
.flashcard-response-text {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: min(22rem, 50dvh);
  flex: 0 1 auto;
  align-items: center;
  align-self: stretch;
  flex-direction: column;
  gap: .45rem;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgba(var(--v-theme-on-surface), .28) transparent;
  scrollbar-width: thin;
  touch-action: none;
  -webkit-overflow-scrolling: touch;
}

.flashcard-response-text__part {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.flashcard-response-text__primary {
  max-width: 34rem;
  font-weight: 850;
  line-height: 1.35;
}

.flashcard-response-text__supporting {
  max-width: 32rem;
  color: rgba(var(--v-theme-on-surface), .6);
  font-weight: 650;
  line-height: 1.5;
}

.flashcard-response-text--compact {
  max-height: min(8rem, 30dvh);
  gap: .65rem;
}

.flashcard-response-text--compact .flashcard-response-text__primary {
  font-weight: 700;
  line-height: 1.3;
}

.flashcard-response-text--compact .flashcard-response-text__supporting {
  color: rgba(var(--v-theme-on-surface), .58);
  line-height: 1.45;
}
</style>
