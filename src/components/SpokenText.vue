<script setup lang="ts">
import { computed } from 'vue'
import { flashcardSpeechTextParts, pinyinTextParts, pinyinTone } from '@/services/spokenText'
import type { FlashcardSpeechTextPart } from '@/services/spokenText'
import type { FlashcardSpeechWord } from '@/types/domain'

const COMMA_CHARACTER = /^[,\u060c\u07f8\u1363\u1802\u1808\u2e32\u2e34\u2e41\u2e49\u2e4c\u3001\ua4fe\ua60d\ua6f5\ufe10\ufe11\ufe50\ufe51\uff0c\uff64]/u

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
  wordsPressable?: boolean
}>(), {
  language: '',
  activeStart: -1,
  activeEnd: -1,
  activeWordStart: -1,
  activeWordEnd: -1,
  colorizePinyin: false,
  toneSource: '',
  pinyin: false,
  wordsPressable: false,
})

const emit = defineEmits<{
  pressWord: [word: string, spokenWord: FlashcardSpeechWord]
}>()

const parts = computed(() => props.pinyin
  ? pinyinTextParts(props.text)
  : flashcardSpeechTextParts(props.text, props.language))
const renderedParts = computed(() => parts.value.flatMap((part) => {
  if (part.wordIndex !== undefined || !COMMA_CHARACTER.test(part.value)) return [part]
  const commaLength = [...part.value][0]?.length || 0
  if (!commaLength || commaLength === part.value.length) return [part]
  return [
    { ...part, value: part.value.slice(0, commaLength), end: part.start + commaLength },
    { ...part, value: part.value.slice(commaLength), start: part.start + commaLength },
  ]
}))
const partGroups = computed(() => {
  const groups: Array<{
    parts: FlashcardSpeechTextPart[]
    unbroken: boolean
  }> = []

  renderedParts.value.forEach((part) => {
    const previousGroup = groups.at(-1)
    const previousPart = previousGroup?.parts.at(-1)
    if (
      part.wordIndex === undefined
      && COMMA_CHARACTER.test(part.value)
      && previousPart?.wordIndex !== undefined
    ) {
      previousGroup.parts.push(part)
      previousGroup.unbroken = true
      return
    }
    const unbroken = props.pinyin && part.wordIndex !== undefined
    if (
      unbroken
      && previousGroup?.unbroken
      && previousGroup.parts.at(-1)?.wordIndex !== undefined
    ) previousGroup.parts.push(part)
    else groups.push({ parts: [part], unbroken })
  })

  return groups
})
const toneSourceWords = computed(() => pinyinTextParts(props.toneSource)
  .filter(part => part.wordIndex !== undefined))

function partTone(part: (typeof parts.value)[number]) {
  if (!props.colorizePinyin || part.wordIndex === undefined) return undefined
  return pinyinTone(toneSourceWords.value[part.wordIndex]?.value || part.value)
}

function partIsPunctuation(part: (typeof parts.value)[number]) {
  return props.colorizePinyin
    && part.wordIndex === undefined
    && /\p{P}/u.test(part.value)
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

function pressWord(event: MouseEvent, part: (typeof parts.value)[number]) {
  if (!props.wordsPressable || part.wordIndex === undefined) return
  event.stopPropagation()
  emit('pressWord', part.value, {
    start: part.start,
    end: part.end,
    wordStart: part.wordIndex,
    wordEnd: part.wordIndex + 1,
  })
}
</script>

<template>
  <span class="spoken-text" :aria-label="text">
    <span
      v-for="group in partGroups"
      :key="group.parts[0]?.start"
      :class="{ 'spoken-text__unbroken': group.unbroken }"
    >
      <span
        v-for="part in group.parts"
        :key="part.start"
        :class="[
          'spoken-text__part',
          {
            'spoken-text__part--word': part.wordIndex !== undefined,
            'spoken-text__part--pressable': wordsPressable && part.wordIndex !== undefined,
            'spoken-text__part--punctuation': partIsPunctuation(part),
            'spoken-text__part--active': partIsActive(part),
            [`spoken-text__part--tone-${partTone(part)}`]: partTone(part) !== undefined,
          },
        ]"
        aria-hidden="true"
        @click="pressWord($event, part)"
      >{{ part.value }}</span>
    </span>
  </span>
</template>

<style scoped>
.spoken-text {
  white-space: inherit;
}

.spoken-text__unbroken {
  white-space: nowrap;
}

.spoken-text__part--word {
  display: inline-block;
  position: relative;
  transform: scale(1);
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1), color 160ms ease;
}

.spoken-text__part--pressable {
  cursor: pointer;
  pointer-events: auto;
}

.spoken-text__part--active {
  z-index: 1;
  transform: scale(1.16);
}

.spoken-text__part--tone-1 { color: rgb(var(--v-theme-info)); }
.spoken-text__part--tone-2 { color: rgb(var(--v-theme-success)); }
.spoken-text__part--tone-3 { color: rgb(var(--v-theme-warning)); }
.spoken-text__part--tone-4 { color: rgb(var(--v-theme-error)); }
.spoken-text__part--tone-5,
.spoken-text__part--punctuation { color: rgba(var(--v-theme-on-surface), .72); }

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
