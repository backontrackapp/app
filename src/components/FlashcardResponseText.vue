<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FitResponsePart from '@/components/FitResponsePart.vue'
import SpokenText from '@/components/SpokenText.vue'
import { flashcardTextFontSize } from '@/services/flashcards'
import type { FlashcardBackDisplay, FlashcardSpeechWord } from '@/types/domain'

const props = withDefaults(defineProps<{
  back: string
  transliteration?: string
  note?: string
  backDisplay?: FlashcardBackDisplay
  showTransliteration?: boolean
  density?: 'full' | 'compact'
  fitLargestWord?: boolean
  speechLanguage?: string
  spokenWord?: FlashcardSpeechWord
  colorizePinyin?: boolean
}>(), {
  transliteration: '',
  note: '',
  backDisplay: 'back',
  showTransliteration: false,
  density: 'full',
  fitLargestWord: false,
  speechLanguage: '',
  spokenWord: undefined,
  colorizePinyin: false,
})

type ResponsePart = {
  kind: 'back' | 'transliteration' | 'note'
  presentation: 'primary' | 'supporting'
  value: string
}

const parts = computed<ResponsePart[]>(() => {
  const back = { kind: 'back' as const, value: props.back }
  const usesLegacyNoteAsTransliteration = props.showTransliteration
    && props.backDisplay === 'transliteration'
    && !props.transliteration
    && Boolean(props.note)
  const transliteration = {
    kind: 'transliteration' as const,
    value: props.transliteration || (usesLegacyNoteAsTransliteration ? props.note : ''),
  }
  const primary = props.showTransliteration
    && props.backDisplay === 'transliteration'
    && transliteration.value
    ? transliteration
    : back
  const response: ResponsePart[] = [{ ...primary, presentation: 'primary' }]

  if (props.showTransliteration) {
    const alternate = primary.kind === 'back' ? transliteration : back
    if (alternate.value) response.push({ ...alternate, presentation: 'supporting' })
  }
  if (props.note && !usesLegacyNoteAsTransliteration) {
    response.push({ kind: 'note', value: props.note, presentation: 'supporting' })
  }
  return response
})

function fittedPartDefaultSize(part: ResponsePart) {
  if (part.presentation === 'primary') return 3.6
  return Number.parseFloat(flashcardTextFontSize(part.value, 'note', props.density))
}

function activeStart(part: ResponsePart) {
  return part.kind === 'back' ? props.spokenWord?.start : undefined
}

function activeEnd(part: ResponsePart) {
  return part.kind === 'back' ? props.spokenWord?.end : undefined
}

function activeWordStart(part: ResponsePart) {
  return part.kind === 'transliteration' ? props.spokenWord?.wordStart : undefined
}

function activeWordEnd(part: ResponsePart) {
  return part.kind === 'transliteration' ? props.spokenWord?.wordEnd : undefined
}

function partUsesToneColors(part: ResponsePart) {
  return props.colorizePinyin && (part.kind === 'back' || part.kind === 'transliteration')
}

function toneSource(part: ResponsePart) {
  if (part.kind !== 'back') return ''
  if (props.transliteration) return props.transliteration
  return props.showTransliteration && props.backDisplay === 'transliteration' ? props.note : ''
}

const responseElement = ref<HTMLElement>()
const responseIsFitting = ref(props.fitLargestWord)
let responseFitFrame: number | undefined
let responseResizeObserver: ResizeObserver | undefined
let responseFitIsForced = false
let lastResponseFitWidth: number | undefined
let lastResponseFitHeight: number | undefined

function fittedPartElements() {
  if (!responseElement.value) return []
  return [...responseElement.value.querySelectorAll<HTMLElement>(
    '.flashcard-response-text__part[data-fit-largest-word-size]',
  )]
}

function setPartScale(elements: HTMLElement[], scale: number) {
  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  ) || 16
  elements.forEach((element) => {
    const baseSize = Number.parseFloat(element.dataset.fitLargestWordSize || '')
    if (!Number.isFinite(baseSize)) return
    const minimumSize = 1
    element.style.setProperty(
      '--fit-response-part-size',
      `${Math.max(minimumSize, baseSize * scale) / rootFontSize}rem`,
    )
  })
}

function fitCombinedResponse(force = false) {
  const response = responseElement.value
  const elements = fittedPartElements()
  if (!props.fitLargestWord || !response || !elements.length || !response.clientHeight) return

  if (
    !force
    && lastResponseFitWidth !== undefined
    && lastResponseFitHeight !== undefined
    && Math.abs(response.clientWidth - lastResponseFitWidth) < 1
    && Math.abs(response.clientHeight - lastResponseFitHeight) < 1
  ) return

  setPartScale(elements, 1)
  if (response.scrollHeight > response.clientHeight) {
    let fittingScale = .01
    let overflowingScale = 1
    setPartScale(elements, fittingScale)

    if (response.scrollHeight <= response.clientHeight) {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const candidate = (fittingScale + overflowingScale) / 2
        setPartScale(elements, candidate)
        if (response.scrollHeight <= response.clientHeight) fittingScale = candidate
        else overflowingScale = candidate
      }
      setPartScale(elements, fittingScale)
    }
  }

  lastResponseFitWidth = response.clientWidth
  lastResponseFitHeight = response.clientHeight
}

function scheduleCombinedResponseFit(force = false) {
  responseIsFitting.value = props.fitLargestWord
  responseFitIsForced ||= force
  if (responseFitFrame !== undefined) window.cancelAnimationFrame(responseFitFrame)
  responseFitFrame = window.requestAnimationFrame(() => {
    responseFitFrame = undefined
    const shouldForce = responseFitIsForced
    responseFitIsForced = false
    void nextTick(() => {
      fitCombinedResponse(shouldForce)
      responseIsFitting.value = false
    })
  })
}

function forceCombinedResponseFit() {
  scheduleCombinedResponseFit(true)
}

watch([() => props.fitLargestWord, parts], forceCombinedResponseFit, { flush: 'post' })

onMounted(() => {
  if ('ResizeObserver' in window && responseElement.value) {
    responseResizeObserver = new ResizeObserver(scheduleCombinedResponseFit)
    responseResizeObserver.observe(responseElement.value)
  }
  forceCombinedResponseFit()
})

onBeforeUnmount(() => {
  if (responseFitFrame !== undefined) window.cancelAnimationFrame(responseFitFrame)
  responseResizeObserver?.disconnect()
})

</script>

<template>
  <span
    ref="responseElement"
    :class="[
      'flashcard-response-text',
      `flashcard-response-text--${density}`,
      { 'flashcard-response-text--fitting': responseIsFitting },
    ]"
    @fit-largest-word-complete="forceCombinedResponseFit"
  >
    <template v-if="fitLargestWord">
      <FitResponsePart
        v-if="parts[0]"
        :key="`primary-${parts[0].kind}`"
        tag="strong"
        :text="parts[0].value"
        :default-font-size="`${fittedPartDefaultSize(parts[0])}rem`"
        :max-size-rem="fittedPartDefaultSize(parts[0])"
        :max-lines="density === 'compact' ? 1 : 2"
        fit-width
        :language="speechLanguage"
        :active-start="activeStart(parts[0])"
        :active-end="activeEnd(parts[0])"
        :active-word-start="activeWordStart(parts[0])"
        :active-word-end="activeWordEnd(parts[0])"
        :colorize-pinyin="partUsesToneColors(parts[0])"
        :tone-source="toneSource(parts[0])"
        :pinyin="parts[0].kind === 'transliteration'"
        class="flashcard-response-text__part flashcard-response-text__primary text-secondary"
        :data-response-part="parts[0].kind"
        data-response-presentation="primary"
      />
      <FitResponsePart
        v-for="part in parts.slice(1)"
        :key="`supporting-${part.kind}`"
        tag="span"
        :text="part.value"
        :default-font-size="`${fittedPartDefaultSize(part)}rem`"
        :max-size-rem="fittedPartDefaultSize(part)"
        :max-lines="2"
        :fit-width="false"
        :language="speechLanguage"
        :active-start="activeStart(part)"
        :active-end="activeEnd(part)"
        :active-word-start="activeWordStart(part)"
        :active-word-end="activeWordEnd(part)"
        :colorize-pinyin="partUsesToneColors(part)"
        :tone-source="toneSource(part)"
        :pinyin="part.kind === 'transliteration'"
        class="flashcard-response-text__part flashcard-response-text__supporting"
        :data-response-part="part.kind"
        data-response-presentation="supporting"
      />
    </template>
    <template v-else>
      <FitResponsePart
        v-if="parts[0]"
        :key="parts[0].kind"
        :tag="'strong'"
        :text="parts[0].value"
        :default-font-size="flashcardTextFontSize(parts[0].value, 'face', density)"
        :max-size-rem="Number.parseFloat(flashcardTextFontSize(parts[0].value, 'face', density))"
        :max-lines="density === 'compact' ? 1 : 2"
        :language="speechLanguage"
        :active-start="activeStart(parts[0])"
        :active-end="activeEnd(parts[0])"
        :active-word-start="activeWordStart(parts[0])"
        :active-word-end="activeWordEnd(parts[0])"
        :colorize-pinyin="partUsesToneColors(parts[0])"
        :tone-source="toneSource(parts[0])"
        :pinyin="parts[0].kind === 'transliteration'"
        class="flashcard-response-text__part flashcard-response-text__primary text-secondary"
        :data-response-part="parts[0].kind"
        data-response-presentation="primary"
      />
      <component
        is="span"
        v-for="part in parts.slice(1)"
        :key="part.kind"
        :class="[
          'flashcard-response-text__part',
          'flashcard-response-text__supporting',
        ]"
        :data-response-part="part.kind"
        data-response-presentation="supporting"
        :style="{
          fontSize: flashcardTextFontSize(part.value, 'note', density),
        }"
      >
        <SpokenText
          :text="part.value"
          :language="speechLanguage"
          :active-start="activeStart(part)"
          :active-end="activeEnd(part)"
          :active-word-start="activeWordStart(part)"
          :active-word-end="activeWordEnd(part)"
          :colorize-pinyin="partUsesToneColors(part)"
          :tone-source="toneSource(part)"
          :pinyin="part.kind === 'transliteration'"
        />
      </component>
    </template>
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
  /*overflow-x: hidden;
  overflow-y: auto;*/
  overscroll-behavior: contain;
  scrollbar-color: rgba(var(--v-theme-on-surface), .28) transparent;
  scrollbar-width: thin;
  touch-action: none;
  -webkit-overflow-scrolling: touch;
}

.flashcard-response-text--fitting {
  overflow-y: hidden;
}

.flashcard-response-text__part {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  /* Preserve each row's rendered height so combined overflow remains measurable. */
  flex: 0 0 auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.flashcard-response-text__primary {
  max-width: 34rem;
  overflow-wrap: normal;
  font-weight: 850;
  line-height: 1.35;
  white-space: nowrap;
}

.flashcard-response-text__supporting {
  max-width: 32rem;
  color: rgba(var(--v-theme-on-surface), .6);
  font-weight: 650;
  line-height: 1.5;
}

.flashcard-response-text--full .flashcard-response-text__primary {
  max-height: 2.7em;
  overflow-wrap: anywhere;
  white-space: normal;
}

.flashcard-response-text--compact {
  max-height: min(8rem, 30dvh);
  justify-content: center;
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
