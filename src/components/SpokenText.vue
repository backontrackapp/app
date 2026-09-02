<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { flashcardSpeechTextParts, pinyinTextParts, pinyinTone } from '@/services/spokenText'
import { reviewSetBluetoothAudioActive } from '@/services/reviewSetAudioFocus'
import type { FlashcardSpeechTextPart } from '@/services/spokenText'
import type { FlashcardSpeechWord } from '@/types/domain'

const PUNCTUATION_CHARACTER = /^\p{P}$/u

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
  if (part.wordIndex !== undefined) return [part]

  const splitParts: FlashcardSpeechTextPart[] = []
  let chunkStart = 0
  let chunkIsPunctuation: boolean | undefined

  for (let index = 0; index < part.value.length;) {
    const character = String.fromCodePoint(part.value.codePointAt(index) || 0)
    const isPunctuation = PUNCTUATION_CHARACTER.test(character)
    if (chunkIsPunctuation !== undefined && chunkIsPunctuation !== isPunctuation) {
      splitParts.push({
        ...part,
        value: part.value.slice(chunkStart, index),
        start: part.start + chunkStart,
        end: part.start + index,
      })
      chunkStart = index
    }
    chunkIsPunctuation = isPunctuation
    index += character.length
  }

  if (chunkIsPunctuation !== undefined) {
    splitParts.push({
      ...part,
      value: part.value.slice(chunkStart),
      start: part.start + chunkStart,
    })
  }
  return splitParts
}))

function isPunctuationPart(part: FlashcardSpeechTextPart) {
  return part.wordIndex === undefined
    && [...part.value].every(character => PUNCTUATION_CHARACTER.test(character))
}

const partGroups = computed(() => {
  const groups: Array<{
    parts: FlashcardSpeechTextPart[]
    unbroken: boolean
  }> = []

  renderedParts.value.forEach((part) => {
    const previousGroup = groups.at(-1)
    const previousPart = previousGroup?.parts.at(-1)
    const isPunctuation = isPunctuationPart(part)
    const directlyFollowsPreviousPart = previousPart?.end === part.start
    if (
      isPunctuation
      && directlyFollowsPreviousPart
      && previousGroup
      && (previousGroup.parts.some(previous => previous.wordIndex !== undefined)
        || previousGroup.parts.every(isPunctuationPart))
    ) {
      previousGroup.parts.push(part)
      previousGroup.unbroken = true
      return
    }
    if (
      part.wordIndex !== undefined
      && directlyFollowsPreviousPart
      && previousGroup?.parts.every(isPunctuationPart)
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
const WORD_PULSE_ZOOM_OUT_DURATION_MS = 240
const BLUETOOTH_WORD_PULSE_DELAY_MS = 350
const pulsingPartStarts = ref(new Set<number>())
const returningPartStarts = ref(new Set<number>())
const wordPulseTimers = new Map<number, {
  zoomInTimer?: ReturnType<typeof setTimeout>
  zoomOutTimer?: ReturnType<typeof setTimeout>
  completeTimer?: ReturnType<typeof setTimeout>
}>()

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

function clearWordPulses() {
  wordPulseTimers.forEach(({ zoomInTimer, zoomOutTimer, completeTimer }) => {
    if (zoomInTimer) clearTimeout(zoomInTimer)
    if (zoomOutTimer) clearTimeout(zoomOutTimer)
    if (completeTimer) clearTimeout(completeTimer)
  })
  wordPulseTimers.clear()
  pulsingPartStarts.value = new Set()
  returningPartStarts.value = new Set()
}

function beginWordZoom(partStart: number) {
  const timers = wordPulseTimers.get(partStart)
  if (!timers) return
  pulsingPartStarts.value = new Set(pulsingPartStarts.value).add(partStart)
  const nextReturningParts = new Set(returningPartStarts.value)
  nextReturningParts.delete(partStart)
  returningPartStarts.value = nextReturningParts
  wordPulseTimers.set(partStart, { ...timers, zoomInTimer: undefined })
}

function finishWordZoom(partStart: number) {
  const timers = wordPulseTimers.get(partStart)
  if (!timers || timers.zoomOutTimer || timers.completeTimer) return
  const zoomOutTimer = setTimeout(() => {
    const nextPulsingParts = new Set(pulsingPartStarts.value)
    nextPulsingParts.delete(partStart)
    pulsingPartStarts.value = nextPulsingParts
    returningPartStarts.value = new Set(returningPartStarts.value).add(partStart)
    const completeTimer = setTimeout(() => {
      wordPulseTimers.delete(partStart)
      const nextReturningParts = new Set(returningPartStarts.value)
      nextReturningParts.delete(partStart)
      returningPartStarts.value = nextReturningParts
    }, WORD_PULSE_ZOOM_OUT_DURATION_MS)
    wordPulseTimers.set(partStart, { zoomOutTimer, completeTimer })
  }, reviewSetBluetoothAudioActive.value ? BLUETOOTH_WORD_PULSE_DELAY_MS : 0)
  wordPulseTimers.set(partStart, { ...timers, zoomOutTimer })
}

function startWordZoom(part: (typeof parts.value)[number]) {
  const zoomInTimer = reviewSetBluetoothAudioActive.value
    ? setTimeout(() => beginWordZoom(part.start), BLUETOOTH_WORD_PULSE_DELAY_MS)
    : undefined
  wordPulseTimers.set(part.start, { zoomInTimer })
  if (!zoomInTimer) beginWordZoom(part.start)
}

function pulseActiveParts() {
  const activeParts = parts.value.filter(partIsActive)
  const activePartStarts = new Set(activeParts.map(part => part.start))
  Array.from(wordPulseTimers.keys()).forEach((partStart) => {
    if (!activePartStarts.has(partStart)) finishWordZoom(partStart)
  })

  activeParts.forEach((part) => {
    if (wordPulseTimers.has(part.start)) return
    startWordZoom(part)
  })
}

function partIsPulsing(part: (typeof parts.value)[number]) {
  return part.wordIndex !== undefined && pulsingPartStarts.value.has(part.start)
}

function partIsReturning(part: (typeof parts.value)[number]) {
  return part.wordIndex !== undefined && returningPartStarts.value.has(part.start)
}

watch(
  [
    () => props.activeStart,
    () => props.activeEnd,
    () => props.activeWordStart,
    () => props.activeWordEnd,
  ],
  pulseActiveParts,
)
watch(parts, clearWordPulses)
onBeforeUnmount(clearWordPulses)

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
  <span
    :class="[
      'spoken-text',
      { 'spoken-text--emphasizing': pulsingPartStarts.size > 0 },
    ]"
    :aria-label="text"
  >
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
            'spoken-text__part--active': partIsPulsing(part),
            'spoken-text__part--returning': partIsReturning(part),
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
  text-shadow: none;
  display: inline-block;
  position: relative;
  transform: scale(1);
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1), color 160ms ease, opacity 160ms ease, text-shadow 160ms ease;
}

.spoken-text--emphasizing .spoken-text__part {
  opacity: .33;
}

.spoken-text__part--pressable {
  cursor: pointer;
  pointer-events: auto;
}

.spoken-text--emphasizing .spoken-text__part--active {
  z-index: 1;
  opacity: 1;
  transform: scale(1.15);
  text-shadow: 2px 2px 3px rgba(0, 0, 0, 1);
}

.spoken-text__part--returning {
  z-index: 1;
  transition: transform 240ms cubic-bezier(.22, 1, .36, 1), color 160ms ease;
}

.spoken-text__part--tone-1 { color: rgb(var(--v-theme-info)); }
.spoken-text__part--tone-2 { color: rgb(var(--v-theme-success)); }
.spoken-text__part--tone-3 { color: rgb(var(--v-theme-warning)); }
.spoken-text__part--tone-4 { color: rgb(var(--v-theme-error)); }
.spoken-text__part--tone-5,
.spoken-text__part--punctuation { color: rgba(var(--v-theme-on-surface), .72); }

@media (prefers-reduced-motion: reduce) {
  .spoken-text__part--word { transition: color 160ms ease; }
  .spoken-text__part--active,
  .spoken-text__part--returning {
    transform: none;
    text-decoration: underline;
    text-decoration-thickness: .12em;
    text-underline-offset: .16em;
  }
}
</style>
