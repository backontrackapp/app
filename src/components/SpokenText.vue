<script setup lang="ts">
import { computed } from 'vue'
import { flashcardSpeechTextParts, pinyinTextParts, pinyinTone } from '@/services/spokenText'

const props = withDefaults(defineProps<{
  text: string
  language?: string
  activeStart?: number
  activeEnd?: number
  activeWordStart?: number
  activeWordEnd?: number
  colorizePinyin?: boolean
  toneSource?: string
  pinyin?: boolean
}>(), {
  language: '',
  activeStart: -1,
  activeEnd: -1,
  activeWordStart: -1,
  activeWordEnd: -1,
  colorizePinyin: false,
  toneSource: '',
  pinyin: false,
})

const parts = computed(() => props.pinyin
  ? pinyinTextParts(props.text)
  : flashcardSpeechTextParts(props.text, props.language))
const toneSourceWords = computed(() => pinyinTextParts(props.toneSource)
  .filter(part => part.wordIndex !== undefined))

function partTone(part: (typeof parts.value)[number]) {
  if (!props.colorizePinyin || part.wordIndex === undefined) return undefined
  return pinyinTone(toneSourceWords.value[part.wordIndex]?.value || part.value)
}

function partIsActive(part: (typeof parts.value)[number]) {
  if (part.wordIndex === undefined) return false
  if (props.activeStart >= 0 && props.activeEnd > props.activeStart) {
    return part.end > props.activeStart && part.start < props.activeEnd
  }
  return props.activeWordStart >= 0
    && props.activeWordEnd > props.activeWordStart
    && part.wordIndex >= props.activeWordStart
    && part.wordIndex < props.activeWordEnd
}
</script>

<template>
  <span class="spoken-text" :aria-label="text">
    <span
      v-for="part in parts"
      :key="part.start"
      :class="[
        'spoken-text__part',
        {
          'spoken-text__part--word': part.wordIndex !== undefined,
          'spoken-text__part--active': partIsActive(part),
          [`spoken-text__part--tone-${partTone(part)}`]: partTone(part) !== undefined,
        },
      ]"
      aria-hidden="true"
    >{{ part.value }}</span>
  </span>
</template>

<style scoped>
.spoken-text {
  white-space: inherit;
}

.spoken-text__part--word {
  display: inline-block;
  position: relative;
  transform: scale(1);
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1), color 160ms ease;
}

.spoken-text__part--active {
  z-index: 1;
  transform: scale(1.16);
}

.spoken-text__part--tone-1 { color: rgb(var(--v-theme-info)); }
.spoken-text__part--tone-2 { color: rgb(var(--v-theme-success)); }
.spoken-text__part--tone-3 { color: rgb(var(--v-theme-warning)); }
.spoken-text__part--tone-4 { color: rgb(var(--v-theme-error)); }
.spoken-text__part--tone-5 { color: rgba(var(--v-theme-on-surface), .72); }

@media (prefers-reduced-motion: reduce) {
  .spoken-text__part--word { transition: color 160ms ease; }
  .spoken-text__part--active {
    transform: none;
    text-decoration: underline;
    text-decoration-thickness: .12em;
    text-underline-offset: .16em;
  }
}
</style>
