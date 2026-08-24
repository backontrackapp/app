<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FitResponsePart from '@/components/FitResponsePart.vue'
import { flashcardTextFontSize } from '@/services/flashcards'
import type { FlashcardBackDisplay } from '@/types/domain'

const props = withDefaults(defineProps<{
  back: string
  transliteration?: string
  note?: string
  backDisplay?: FlashcardBackDisplay
  showTransliteration?: boolean
  density?: 'full' | 'compact'
  fitLargestWord?: boolean
}>(), {
  transliteration: '',
  note: '',
  backDisplay: 'back',
  showTransliteration: false,
  density: 'full',
  fitLargestWord: false,
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

function fittedPartDefaultSize(part: ResponsePart) {
  if (part.presentation === 'primary') return 3.6
  return Number.parseFloat(flashcardTextFontSize(part.value, 'note', props.density))
}

const responseElement = ref<HTMLElement>()
const responseIsFitting = ref(props.fitLargestWord)
let responseFitFrame: number | undefined
let responseResizeObserver: ResizeObserver | undefined

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

function fitCombinedResponse() {
  const response = responseElement.value
  const elements = fittedPartElements()
  if (!props.fitLargestWord || !response || !elements.length || !response.clientHeight) return

  setPartScale(elements, 1)
  if (response.scrollHeight <= response.clientHeight) return

  let fittingScale = .01
  let overflowingScale = 1
  setPartScale(elements, fittingScale)
  if (response.scrollHeight > response.clientHeight) return

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const candidate = (fittingScale + overflowingScale) / 2
    setPartScale(elements, candidate)
    if (response.scrollHeight <= response.clientHeight) fittingScale = candidate
    else overflowingScale = candidate
  }
  setPartScale(elements, fittingScale)
}

function scheduleCombinedResponseFit() {
  responseIsFitting.value = props.fitLargestWord
  if (responseFitFrame !== undefined) window.cancelAnimationFrame(responseFitFrame)
  responseFitFrame = window.requestAnimationFrame(() => {
    responseFitFrame = undefined
    void nextTick(() => {
      fitCombinedResponse()
      responseIsFitting.value = false
    })
  })
}

watch([() => props.fitLargestWord, parts], scheduleCombinedResponseFit, { flush: 'post' })

onMounted(() => {
  if ('ResizeObserver' in window && responseElement.value) {
    responseResizeObserver = new ResizeObserver(scheduleCombinedResponseFit)
    responseResizeObserver.observe(responseElement.value)
  }
  scheduleCombinedResponseFit()
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
    @fit-largest-word-complete="scheduleCombinedResponseFit"
  >
    <template v-if="fitLargestWord">
      <FitResponsePart
        v-for="part in parts"
        :key="part.kind"
        :tag="part.presentation === 'primary' ? 'strong' : 'span'"
        :text="part.value"
        :default-font-size="`${fittedPartDefaultSize(part)}rem`"
        :max-size-rem="fittedPartDefaultSize(part)"
        :max-lines="part.presentation === 'primary' && density === 'compact' ? 1 : 2"
        :fit-width="part.presentation === 'primary'"
        :class="[
          'flashcard-response-text__part',
          `flashcard-response-text__${part.presentation}`,
          { 'text-secondary': part.presentation === 'primary' },
        ]"
        :data-response-part="part.kind"
        :data-response-presentation="part.presentation"
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
        {{ part.value }}
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
  overflow-x: hidden;
  overflow-y: auto;
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
  overflow: hidden;
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
