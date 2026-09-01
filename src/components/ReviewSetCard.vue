<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import FlashcardReviewFace from '@/components/FlashcardReviewFace.vue'
import { REFIT_TEXT_CONTENT_EVENT } from '@/composables/useFitLargestWord'
import { flashcardReviewFaceValue } from '@/services/flashcards'
import { REVIEW_SET_CARD_SWIPE_HINT } from '@/services/swipeHints'
import type {
  FlashcardReviewCardQuickTag,
  FlashcardReviewFaceValue,
  FlashcardReviewMode,
  FlashcardReviewQueueCard,
  FlashcardReviewSide,
  FlashcardSpeechWord,
} from '@/types/domain'

type ReviewCardTransitionDirection = 'previous' | 'next' | 'front' | 'back'
type ReviewCardBufferPhase = 'idle' | 'preparing' | 'moving'

interface ReviewCardBuffer {
  card: FlashcardReviewQueueCard
  side: FlashcardReviewSide
  frontDisplay: FlashcardReviewFaceValue
  backDisplay: FlashcardReviewFaceValue
  revealed: boolean
  speechLanguage: string
  spokenWord?: FlashcardSpeechWord
  cardPosition: number
}

const props = withDefaults(defineProps<{
  card: FlashcardReviewQueueCard
  side: FlashcardReviewSide
  mode?: FlashcardReviewMode
  frontDisplay?: FlashcardReviewFaceValue
  backDisplay?: FlashcardReviewFaceValue
  dense?: boolean
  disabled?: boolean
  revealed?: boolean
  speechEnabled?: boolean
  speechLanguage?: string
  spokenWord?: FlashcardSpeechWord
  canReplay?: boolean
  transitionDirection?: ReviewCardTransitionDirection
  setName?: string
  cardPosition?: number
  cardCount?: number
  paused?: boolean
  progress?: number
  progressColor?: string
  progressAriaLabel?: string
  progressTickCount?: number
  showTagActions?: boolean
  quickTags?: FlashcardReviewCardQuickTag[]
  canTag?: boolean
  ejectable?: boolean
  ejecting?: boolean
  ejectDisabled?: boolean
}>(), {
  mode: 'passive',
  frontDisplay: 'front',
  backDisplay: 'back',
  dense: false,
  disabled: false,
  revealed: false,
  speechEnabled: false,
  speechLanguage: '',
  spokenWord: undefined,
  canReplay: false,
  transitionDirection: undefined,
  setName: '',
  cardPosition: 1,
  cardCount: 1,
  paused: false,
  progress: 0,
  progressColor: 'secondary',
  progressAriaLabel: '',
  progressTickCount: 1,
  showTagActions: false,
  quickTags: () => [],
  canTag: false,
  ejectable: false,
  ejecting: false,
  ejectDisabled: false,
})

const emit = defineEmits<{
  activate: [event: Event]
  replay: []
  speakWord: [word: string, spokenWord: FlashcardSpeechWord]
  pointerDown: [event: PointerEvent]
  pointerMove: [event: PointerEvent]
  pointerUp: [event: PointerEvent]
  pointerCancel: [event: PointerEvent]
  lostPointerCapture: [event: PointerEvent]
  afterEnter: []
  toggleTag: [name: string]
  eject: []
  previous: [transitionDirection: ReviewCardTransitionDirection]
  next: [transitionDirection: ReviewCardTransitionDirection]
  flip: [side: FlashcardReviewSide, transitionDirection: ReviewCardTransitionDirection]
  togglePlayback: []
}>()

const progressTickPositions = computed(() => {
  const count = Math.max(1, Math.round(props.progressTickCount))
  return Array.from({ length: count - 1 }, (_, index) => (index + 1) / count * 100)
})

const root = ref<HTMLElement>()
const activeBufferIndex = ref<0 | 1>(0)
const incomingBufferIndex = ref<0 | 1>()
const bufferPhase = ref<ReviewCardBufferPhase>('idle')
const bufferedTransitionDirection = ref<ReviewCardTransitionDirection>()
const bufferedCardIsChanging = ref(false)
let bufferTransitionFrame: number | undefined
let bufferTransitionTimer: number | undefined

function snapshotBuffer(): ReviewCardBuffer {
  return {
    card: { ...props.card, tags: [...props.card.tags] },
    side: props.side,
    frontDisplay: props.frontDisplay,
    backDisplay: props.backDisplay,
    revealed: props.revealed,
    speechLanguage: props.speechLanguage,
    spokenWord: props.spokenWord ? { ...props.spokenWord } : undefined,
    cardPosition: props.cardPosition,
  }
}

const initialBuffer = snapshotBuffer()
const cardBuffers = shallowRef<[ReviewCardBuffer, ReviewCardBuffer]>([
  initialBuffer,
  snapshotBuffer(),
])
const displayedBuffer = computed(() => cardBuffers.value[activeBufferIndex.value])
const bufferTarget = computed(snapshotBuffer)

function bufferKey(buffer: ReviewCardBuffer) {
  return `${buffer.card.id}:${buffer.side}`
}

function replaceBuffer(index: 0 | 1, buffer: ReviewCardBuffer) {
  const next: [ReviewCardBuffer, ReviewCardBuffer] = [...cardBuffers.value]
  next[index] = buffer
  cardBuffers.value = next
}

function cloneBuffer(buffer: ReviewCardBuffer): ReviewCardBuffer {
  return {
    ...buffer,
    card: { ...buffer.card, tags: [...buffer.card.tags] },
    spokenWord: buffer.spokenWord ? { ...buffer.spokenWord } : undefined,
  }
}

function clearBufferedSpokenWords() {
  const [first, second] = cardBuffers.value
  if (!first.spokenWord && !second.spokenWord) return
  cardBuffers.value = [
    { ...first, spokenWord: undefined },
    { ...second, spokenWord: undefined },
  ]
}

function copyBufferToBoth(buffer: ReviewCardBuffer, active = activeBufferIndex.value) {
  const background = active === 0 ? 1 : 0
  const next: [ReviewCardBuffer, ReviewCardBuffer] = [...cardBuffers.value]
  next[active] = buffer
  next[background] = cloneBuffer(buffer)
  cardBuffers.value = next
  activeBufferIndex.value = active
  incomingBufferIndex.value = undefined
}

function clearBufferTransitionSchedule() {
  if (bufferTransitionFrame !== undefined) window.cancelAnimationFrame(bufferTransitionFrame)
  if (bufferTransitionTimer !== undefined) window.clearTimeout(bufferTransitionTimer)
  bufferTransitionFrame = undefined
  bufferTransitionTimer = undefined
}

function finishBufferTransition(notify = true) {
  const incoming = incomingBufferIndex.value
  if (incoming === undefined || bufferPhase.value === 'idle') return
  clearBufferTransitionSchedule()
  const promoted = cardBuffers.value[incoming]
  bufferPhase.value = 'idle'
  bufferedTransitionDirection.value = undefined
  bufferedCardIsChanging.value = false
  copyBufferToBoth(promoted, incoming)
  if (notify) emit('afterEnter')
}

function movePreparedBuffer() {
  if (bufferPhase.value !== 'preparing') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    finishBufferTransition()
    return
  }
  bufferPhase.value = 'moving'
  bufferTransitionTimer = window.setTimeout(() => finishBufferTransition(), 260)
}

function prepareBufferTransition(buffer: ReviewCardBuffer) {
  clearBufferTransitionSchedule()
  const incoming = activeBufferIndex.value === 0 ? 1 : 0
  bufferedCardIsChanging.value = buffer.card.id !== displayedBuffer.value.card.id
  replaceBuffer(incoming, buffer)
  incomingBufferIndex.value = incoming
  bufferedTransitionDirection.value = props.transitionDirection
  bufferPhase.value = 'preparing'

  void nextTick(() => {
    refitContent()
    bufferTransitionFrame = window.requestAnimationFrame(() => {
      bufferTransitionFrame = window.requestAnimationFrame(movePreparedBuffer)
    })
  })
}

watch(bufferTarget, (nextTarget, previousTarget) => {
  const target = bufferKey(previousTarget) === bufferKey(nextTarget)
    ? nextTarget
    : { ...nextTarget, spokenWord: undefined }
  if (target !== nextTarget) clearBufferedSpokenWords()

  const incoming = incomingBufferIndex.value
  if (bufferPhase.value !== 'idle' && incoming !== undefined) {
    if (bufferKey(cardBuffers.value[incoming]) === bufferKey(target)) {
      replaceBuffer(incoming, target)
      return
    }
    finishBufferTransition(false)
  }

  if (bufferKey(displayedBuffer.value) === bufferKey(target)) {
    copyBufferToBoth(target)
    return
  }
  if (!props.transitionDirection) {
    copyBufferToBoth(target)
    return
  }
  prepareBufferTransition(target)
}, { deep: true, flush: 'post' })

function bufferClasses(index: number) {
  const active = activeBufferIndex.value
  const incoming = incomingBufferIndex.value
  return {
    'review-card-buffer--current': bufferPhase.value === 'idle' && index === active,
    'review-card-buffer--background': bufferPhase.value === 'idle' && index !== active,
    'review-card-buffer--preparing': bufferPhase.value === 'preparing' && index === incoming,
    'review-card-buffer--incoming': bufferPhase.value === 'moving' && index === incoming,
    'review-card-buffer--outgoing': bufferPhase.value === 'moving' && index === active,
    [`review-card-buffer--${bufferedTransitionDirection.value}`]: Boolean(
      bufferedTransitionDirection.value && bufferPhase.value !== 'idle',
    ),
  }
}

function imageBufferClasses(index: number) {
  if (bufferPhase.value === 'idle' || bufferedCardIsChanging.value) return bufferClasses(index)
  return {
    'review-card-buffer--current': index === activeBufferIndex.value,
    'review-card-buffer--background': index !== activeBufferIndex.value,
  }
}

function bufferIsHidden(index: number) {
  return index !== activeBufferIndex.value
}

function bufferFaceValue(buffer: ReviewCardBuffer) {
  return flashcardReviewFaceValue(buffer, buffer.side)
}

const standaloneAriaLabel = computed(() => {
  if (props.speechEnabled) return `Replay ${displayedBuffer.value.side} speech`
  if (props.mode === 'manual' && !displayedBuffer.value.revealed) {
    return 'Show answer'
  }
  return `${displayedBuffer.value.side} shown`
})

function refitContent() {
  root.value
    ?.querySelectorAll<HTMLElement>('.fit-review-content, .fit-response-part')
    .forEach(element => element.dispatchEvent(new Event(REFIT_TEXT_CONTENT_EVENT)))
}

function handleReviewSetKeydown(event: KeyboardEvent) {
  const target = event.target
  if (
    event.defaultPrevented
    || event.isComposing
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || (target instanceof Element && target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ))
  ) return

  const key = event.code === 'Space' || event.key === 'Spacebar' ? ' ' : event.key
  if (key === 'ArrowUp') {
    if (!props.disabled) emit('previous', 'back')
  } else if (key === 'ArrowDown') {
    if (!props.disabled) emit('next', 'front')
  } else if (key === 'ArrowLeft') {
    if (!props.disabled) emit('flip', props.side === 'front' ? 'back' : 'front', 'next')
  } else if (key === 'ArrowRight') {
    if (!props.disabled) emit('flip', props.side === 'front' ? 'back' : 'front', 'previous')
  } else if (key === 'Backspace') {
    if (!props.disabled && !props.ejectDisabled) emit('eject')
  } else if (key === ' ') {
    if (!props.disabled) emit('togglePlayback')
  } else return

  event.preventDefault()
  event.stopPropagation()
}

onMounted(() => document.addEventListener('keydown', handleReviewSetKeydown, true))

onBeforeUnmount(() => {
  clearBufferTransitionSchedule()
  document.removeEventListener('keydown', handleReviewSetKeydown, true)
})

defineExpose({ refitContent })
</script>

<template>
  <div
    v-if="dense"
    v-swipe-hint="REVIEW_SET_CARD_SWIPE_HINT"
    ref="root"
    class="review-set-card review-set-card--dense interval-review-card"
    :class="{
      'interval-review-card--playback-paused': paused,
      'interval-review-card--disabled': disabled,
    }"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled"
    :aria-label="`${setName} ${paused ? 'paused' : 'playing'}, ${displayedBuffer.side}, card ${displayedBuffer.cardPosition} of ${cardCount}`"
    @pointerdown.capture="emit('pointerDown', $event)"
    @pointermove.capture="emit('pointerMove', $event)"
    @pointerup.capture="emit('pointerUp', $event)"
    @pointercancel.capture="emit('pointerCancel', $event)"
    @lostpointercapture.capture="emit('lostPointerCapture', $event)"
    @click="emit('activate', $event)"
    @keydown.enter.self="emit('activate', $event)"
    @keydown.space.self.prevent="emit('activate', $event)"
  >
    <span
      v-for="(buffer, index) in cardBuffers"
      :key="`dense-image-${index}`"
      class="review-card-buffer review-card__image-buffer"
      :class="imageBufferClasses(index)"
      :aria-hidden="bufferIsHidden(index)"
    >
      <img
        v-if="buffer.card.image && bufferFaceValue(buffer) !== 'image'"
        :src="buffer.card.image"
        alt=""
        class="interval-review-card__image"
      >
    </span>
    <div class="interval-review-card__main">
      <div class="interval-review-card__content">
        <div class="interval-review-card__heading">
          <span class="interval-review-card__set">
            <v-icon icon="mdi-cards-outline" size="1.0625rem" />
            <span class="text-truncate">{{ setName }}</span>
            <span class="interval-review-card__count">({{ displayedBuffer.cardPosition }} of {{ cardCount }})</span>
          </span>
          <small class="interval-review-card__side">
            {{ displayedBuffer.side === 'front' ? 'Front' : 'Back' }}
          </small>
        </div>
        <div class="interval-review-card__face-window">
          <div
            v-for="(buffer, index) in cardBuffers"
            :key="`dense-content-${index}`"
            class="review-card-buffer interval-review-card__faces"
            :class="[
              bufferClasses(index),
              { 'review-card__value-buffer--front': buffer.side === 'front' },
            ]"
            :aria-hidden="bufferIsHidden(index)"
          >
              <FlashcardReviewFace
                :card="buffer.card"
                :value="bufferFaceValue(buffer)"
                :language="buffer.speechLanguage"
                :spoken-word="buffer.spokenWord"
                :words-pressable="speechEnabled && canReplay"
                dense
                @press-word="(word, spokenWord) => emit('speakWord', word, spokenWord)"
              />
          </div>
        </div>
      </div>
    </div>
    <footer v-if="showTagActions" class="interval-review-card__tag-actions" aria-label="Flashcard actions and playback status">
      <v-btn
        v-if="ejectable"
        class="interval-review-card__tag-control interval-review-card__eject-button"
        size="x-small"
        variant="text"
        icon="mdi-eject-outline"
        aria-label="Eject current flashcard"
        title="Eject current flashcard"
        :loading="ejecting"
        :disabled="ejectDisabled || ejecting"
        @click.stop="emit('eject')"
      />
      <div class="interval-review-card__quick-tags">
        <v-chip
          v-for="tag in quickTags"
          :key="tag.name"
          class="interval-review-card__tag-control interval-review-card__quick-tag"
          :data-tag-name="tag.name"
          size="x-small"
          label
          :color="tag.selected ? tag.color : undefined"
          :variant="tag.selected ? 'flat' : 'outlined'"
          prepend-icon="mdi-tag-outline"
          :disabled="!canTag"
          :aria-pressed="tag.selected"
          :aria-label="`${tag.selected ? 'Remove' : 'Add'} ${tag.name} tag`"
          @click.stop="emit('toggleTag', tag.name)"
        >
          {{ tag.name }}
        </v-chip>
      </div>
      <div class="interval-review-card__meta">
        <small>
          <v-icon :icon="paused ? 'mdi-pause-circle-outline' : 'mdi-play-circle-outline'" size=".875rem" />
          {{ paused ? 'Paused' : 'Playing' }}
        </small>
      </div>
    </footer>
    <div class="review-set-card__progress interval-review-card__progress">
      <v-progress-linear
        class="review-set-card__progress-track"
        :model-value="progress"
        :color="progressColor"
        bg-color="white"
        :bg-opacity="0.14"
        height="5"
        rounded
        :aria-label="progressAriaLabel"
      />
      <span
        v-for="position in progressTickPositions"
        :key="position"
        class="review-set-card__progress-tick"
        :style="{ '--progress-tick-position': `${position}%` }"
        aria-hidden="true"
      />
    </div>
  </div>

  <div
    v-else
    v-swipe-hint="REVIEW_SET_CARD_SWIPE_HINT"
    ref="root"
    class="review-set-card review-card-pane"
  >
    <div
      class="review-card-stack"
      @pointerdown="emit('pointerDown', $event)"
      @pointermove="emit('pointerMove', $event)"
      @pointerup="emit('pointerUp', $event)"
      @pointercancel="emit('pointerCancel', $event)"
      @lostpointercapture="emit('lostPointerCapture', $event)"
      @click="emit('activate', $event)"
    >
      <div class="review-card-window">
        <button
          v-if="mode === 'manual'"
          v-ripple
          type="button"
          class="review-card"
          :class="{ 'review-card--back': displayedBuffer.side === 'back' }"
          :aria-label="standaloneAriaLabel"
          :disabled="disabled"
        >
          <span
            v-for="(buffer, index) in cardBuffers"
            :key="`manual-image-${index}`"
            class="review-card-buffer review-card__image-buffer"
            :class="imageBufferClasses(index)"
            :aria-hidden="bufferIsHidden(index)"
          >
            <img
              v-if="buffer.card.image && bufferFaceValue(buffer) !== 'image'"
              :src="buffer.card.image"
              alt=""
              class="review-card__image"
            >
          </span>
          <small>{{ displayedBuffer.side === 'back' ? 'Back' : 'Front' }}</small>
          <span class="review-card__content-window">
            <span
              v-for="(buffer, index) in cardBuffers"
              :key="`manual-content-${index}`"
              class="review-card-buffer review-card__value-buffer"
              :class="[
                bufferClasses(index),
                { 'review-card__value-buffer--front': buffer.side === 'front' },
              ]"
              :aria-hidden="bufferIsHidden(index)"
            >
              <FlashcardReviewFace
                :card="buffer.card"
                :value="bufferFaceValue(buffer)"
                :language="buffer.speechLanguage"
                :spoken-word="buffer.spokenWord"
                :words-pressable="speechEnabled && canReplay"
                @press-word="(word, spokenWord) => emit('speakWord', word, spokenWord)"
              />
            </span>
          </span>
          <span v-if="speechEnabled" class="review-card__hint">
            <v-icon icon="mdi-volume-high" size="1.125rem" /> Tap to replay
          </span>
          <span v-else class="review-card__hint" :class="{ 'text-disabled': displayedBuffer.revealed }">
            <v-icon icon="mdi-gesture-tap" size="1.125rem" /> Tap to reveal
          </span>
        </button>

        <div
          v-else
          v-ripple="canReplay"
          class="passive-card"
          :class="{ 'passive-card--interactive': canReplay }"
          :role="speechEnabled ? 'button' : undefined"
          :tabindex="canReplay ? 0 : undefined"
          :aria-label="speechEnabled ? `Replay ${displayedBuffer.side} speech` : undefined"
          :aria-disabled="speechEnabled ? !canReplay : undefined"
          @keydown.enter="emit('replay')"
          @keydown.space.prevent="emit('replay')"
        >
          <span
            v-for="(buffer, index) in cardBuffers"
            :key="`passive-image-${index}`"
            class="review-card-buffer review-card__image-buffer"
            :class="imageBufferClasses(index)"
            :aria-hidden="bufferIsHidden(index)"
          >
            <img
              v-if="buffer.card.image && bufferFaceValue(buffer) !== 'image'"
              :src="buffer.card.image"
              alt=""
              class="review-card__image"
            >
          </span>
          <div class="passive-card__content">
            <small>{{ displayedBuffer.side === 'front' ? 'Front' : 'Back' }}</small>
            <span class="review-card__content-window">
              <span
                v-for="(buffer, index) in cardBuffers"
                :key="`passive-content-${index}`"
                class="review-card-buffer review-card__value-buffer"
                :class="[
                  bufferClasses(index),
                  { 'review-card__value-buffer--front': buffer.side === 'front' },
                ]"
                :aria-hidden="bufferIsHidden(index)"
              >
                <FlashcardReviewFace
                  :card="buffer.card"
                  :value="bufferFaceValue(buffer)"
                  :language="buffer.speechLanguage"
                  :spoken-word="buffer.spokenWord"
                  :words-pressable="speechEnabled && canReplay"
                  @press-word="(word, spokenWord) => emit('speakWord', word, spokenWord)"
                />
              </span>
            </span>
            <span v-if="speechEnabled" class="review-card__hint">
              <v-icon icon="mdi-volume-high" size="1.125rem" /> Tap to replay
            </span>
          </div>
          <div class="review-set-card__progress review-progress">
            <v-progress-linear
              class="review-set-card__progress-track"
              :model-value="progress"
              :color="progressColor"
              bg-color="white"
              :bg-opacity="0.14"
              height="6"
              rounded
            />
            <span
              v-for="position in progressTickPositions"
              :key="position"
              class="review-set-card__progress-tick"
              :style="{ '--progress-tick-position': `${position}%` }"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </div>

    <footer
      v-if="showTagActions || ejectable"
      class="review-card__tag-actions"
      aria-label="Flashcard actions"
      @click.stop
    >
      <v-btn
        v-if="ejectable"
        class="review-card__tag-control review-card__eject-button"
        variant="tonal"
        color="warning"
        prepend-icon="mdi-eject-outline"
        aria-label="Eject current card"
        :loading="ejecting"
        :disabled="ejectDisabled || ejecting"
        @click.stop="emit('eject')"
      >
        Eject
      </v-btn>
      <div v-if="showTagActions" class="review-card__quick-tags">
        <v-chip
          v-for="tag in quickTags"
          :key="tag.name"
          class="review-card__tag-control review-card__quick-tag"
          :data-tag-name="tag.name"
          label
          :color="tag.selected ? tag.color : undefined"
          :variant="tag.selected ? 'flat' : undefined"
          prepend-icon="mdi-tag-outline"
          :disabled="!canTag"
          :aria-pressed="tag.selected"
          :aria-label="`${tag.selected ? 'Remove' : 'Add'} ${tag.name} tag`"
          @click.stop="emit('toggleTag', tag.name)"
        >
          {{ tag.name }}
        </v-chip>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.review-card-pane { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); flex: 1 1 auto; flex-direction: column; }
.review-card-stack { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); flex: 1 1 auto; flex-direction: column; touch-action: none; }
.review-card-window { display: grid; width: 100%; min-height: min(38dvh, 22rem); flex: 1 1 auto; overflow: hidden; border-radius: 1.5rem; }
.review-card-window,
.review-card-window * { pointer-events: none; }
.review-card-window > .review-card,
.review-card-window > .passive-card { pointer-events: auto; }
.review-card-window :deep(.flashcard-response-text) { pointer-events: auto; }
.review-card-window :deep(.spoken-text__part--pressable) { pointer-events: auto; }
.review-card-window > * { width: 100%; min-height: inherit; grid-area: 1 / 1; }
.review-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; cursor: pointer; font: inherit; text-align: center; touch-action: none; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.review-card > :not(.review-card__image-buffer), .passive-card > :not(.review-card__image-buffer) { position: relative; z-index: 1; }
.review-card__image-buffer { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
.review-card__image { width: 100%; height: 100%; object-fit: cover; opacity: .58; pointer-events: none; filter: brightness(.42) saturate(.82); }
.review-card--back { border-color: rgba(var(--v-theme-secondary), .34); }
.review-card :deep(.v-ripple__container),
.passive-card :deep(.v-ripple__container) { position: absolute; z-index: 2; inset: 0; width: 100%; height: 100%; flex: none; }
.review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
.review-card small,
.passive-card small { color: rgba(var(--v-theme-on-surface), .48); font-size: .68rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.review-card strong,
.passive-card strong { max-width: 34rem; overflow-wrap: anywhere; font-size: clamp(1.3rem, 5vw, 2.1rem); font-weight: 850; line-height: 1.35; white-space: pre-wrap; }
.review-card__content-window { position: relative; width: 100%; height: 0; min-height: 0; flex: 1 1 0; }
.review-card__value-buffer { position: absolute; display: grid; inset: 0; width: 100%; height: 100%; min-height: 0; }
.review-card__value-buffer > * { grid-area: 1 / 1; }
.review-card__value-buffer--front :deep(.spoken-text__part--active) { transform: none; }
.review-card__content { position: absolute; display: flex; inset: 0; width: 100%; height: 100%; min-height: 0; max-height: 100%; align-items: center; align-self: stretch; justify-content: center; flex-direction: column; font-size: var(--fit-review-content-size, 3.6rem); }
.review-card__hint { display: flex; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .48); font-size: .72rem; font-weight: 800; transition: opacity 200ms ease; }
.review-card__hint.text-disabled { opacity: .2; }
.passive-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-secondary), .28); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; text-align: center; touch-action: none; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.passive-card--interactive { cursor: pointer; }
.passive-card__content { display: flex; width: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; }
.review-set-card__progress { position: relative; z-index: 5; flex: 0 0 auto; transition: none; }
.review-set-card__progress :deep(.v-progress-linear__determinate) { transition: none; }
.passive-card .review-set-card__progress { width: min(20rem, 100%); }
.review-set-card__progress-tick { position: absolute; z-index: 1; top: 50%; left: var(--progress-tick-position); height: calc(100% + .1875rem); aspect-ratio: 1; border-radius: 50%; background: rgb(var(--v-theme-secondary)); pointer-events: none; transform: translate(-50%, -50%); }
.review-card__tag-actions { position: absolute; z-index: 3; right: 1.5rem; bottom: 1.25rem; left: 1.5rem; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .5rem; }
.review-card__tag-control { min-height: 2.75rem; }
.review-card__eject-button { min-width: 0; grid-column: 1; justify-self: start; }
.review-card__quick-tags { display: flex; width: 100%; min-width: 0; grid-column: 2; justify-self: stretch; gap: .5rem; }
.review-card__quick-tag { flex: 1 1 0; justify-content: center; }
.review-card__quick-tag.v-chip--variant-outlined { border-color: rgba(var(--v-theme-on-surface), .18); }

.interval-review-card { position: relative; width: min(100%, 34rem); overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .055); box-shadow: none; color: inherit; cursor: pointer; font: inherit; text-align: left; touch-action: none; }
.interval-review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.1875rem; }
.interval-review-card--disabled { cursor: default; }
.interval-review-card__image { width: 100%; height: 100%; object-fit: cover; opacity: .52; pointer-events: none; filter: brightness(.38) saturate(.8); }
.interval-review-card__main { display: block; width: 100%; color: inherit; font: inherit; text-align: left; touch-action: none; }
.interval-review-card--playback-paused { border-style: dashed; background: rgba(var(--v-theme-on-surface), .025); opacity: .72; }
.interval-review-card :deep(.v-ripple__container) { z-index: 2; }
.interval-review-card__content { position: relative; z-index: 1; display: flex; box-sizing: border-box; min-height: 8.5rem; padding: 1rem; align-items: center; justify-content: flex-start; flex-direction: column; gap: .65rem; text-align: center; }
.interval-review-card__heading { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: .75rem; }
.interval-review-card__side { flex: 0 0 auto; }
.interval-review-card__meta { display: flex; min-width: 0; align-items: center; justify-content: flex-end; grid-column: 3; justify-self: end; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__meta small { display: inline-flex; align-items: center; gap: .25rem; }
.interval-review-card__set { display: flex; min-width: 0; max-width: 75%; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-align: left; text-transform: uppercase; }
.interval-review-card__set > .text-truncate { min-width: 0; flex: 1 1 auto; }
.interval-review-card__count { flex: 0 0 auto; }
.interval-review-card__content small { color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__face-window { display: grid; width: 100%; min-height: 0; flex: 1 1 auto; }
.interval-review-card__faces { display: grid; width: 100%; min-height: 0; grid-area: 1 / 1; place-items: center; }
.interval-review-card__faces > * { grid-area: 1 / 1; max-width: 100%; }
.interval-review-card__tag-actions { position: relative; z-index: 1; display: grid; padding: 0 1rem .75rem; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: .3rem; }
.interval-review-card__quick-tags { display: flex; grid-column: 2; justify-self: center; gap: .3rem; }
.interval-review-card__tag-control { height: 1.5rem !important; min-height: 1.5rem !important; font-size: .625rem; }
.interval-review-card__eject-button { min-width: 1.5rem; padding: 0; grid-column: 1; justify-self: start; }
.interval-review-card__quick-tag { --v-chip-height: 1.5rem; }
.interval-review-card__quick-tag.v-chip--variant-outlined { border-color: rgba(var(--v-theme-on-surface), .18); }
.interval-review-card :deep(.v-progress-linear) { border-radius: 0; }
.interval-review-card__progress { width: 100%; }
.interval-review-card__progress :deep(.v-progress-linear__determinate) { opacity: .3; transition: none; }

.review-card-buffer { opacity: 1; transform: none; }
.review-card-buffer--background { visibility: hidden; opacity: 0; }
.review-card-buffer--preparing { visibility: visible; opacity: 0; }
.review-card-buffer--background,
.review-card-buffer--preparing,
.review-card-buffer--incoming,
.review-card-buffer--outgoing,
.review-card-buffer--background :deep(*),
.review-card-buffer--preparing :deep(*),
.review-card-buffer--incoming :deep(*),
.review-card-buffer--outgoing :deep(*) { pointer-events: none !important; }
.review-card-buffer--incoming,
.review-card-buffer--outgoing { visibility: visible; transition: opacity 200ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.review-card-buffer--incoming { opacity: 1; transform: none; }
.review-card-buffer--outgoing { opacity: 0; }
.review-card-buffer--preparing.review-card-buffer--next { transform: translateX(1.5rem); }
.review-card-buffer--outgoing.review-card-buffer--next { transform: translateX(-1.5rem); }
.review-card-buffer--preparing.review-card-buffer--previous { transform: translateX(-1.5rem); }
.review-card-buffer--outgoing.review-card-buffer--previous { transform: translateX(1.5rem); }
.review-card-buffer--preparing.review-card-buffer--back { transform: translateY(1.5rem); }
.review-card-buffer--outgoing.review-card-buffer--back { transform: translateY(-1.5rem); }
.review-card-buffer--preparing.review-card-buffer--front { transform: translateY(-1.5rem); }
.review-card-buffer--outgoing.review-card-buffer--front { transform: translateY(1.5rem); }

@media (orientation: portrait) {
  .interval-review-card__content { height: 10.5rem; }
}

@media (orientation: landscape) and (max-height: 43.75rem) {
  .review-card-pane { display: contents; }
  .review-card-stack { height: 100%; min-height: 0; grid-column: 1; grid-row: 1 / 5; }
  .review-card-window { height: 100%; min-height: 0; }
  .review-card,
  .passive-card { height: 100%; min-height: 0; padding: clamp(1rem, 3dvh, 1.5rem) 1.5rem; gap: clamp(.75rem, 2dvh, 1.25rem); }
  .passive-card__content { gap: 0; }
  .review-card__tag-actions { position: static; display: flex; width: 100%; max-width: none; padding-left: 1rem; grid-column: 2; grid-row: 3; align-self: end; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 4.375rem; border-left: .0625rem solid rgb(var(--v-theme-on-surface) / .12); }
  .review-card__eject-button { width: 100%; flex: 0 0 100%; }
  .review-card__quick-tags { flex-wrap: wrap; }
  .review-card__tag-menu-button { height: 2rem; min-width: 0; padding-inline: .5rem; grid-column: auto; justify-self: auto; font-size: .75rem; }
  .review-card__quick-tag { height: 1.75rem; padding-inline: .5rem; font-size: .75rem; }
}

@media (orientation: landscape) and (max-height: 43.75rem) {
  .interval-review-card__content { min-height: 7.25rem; padding: .65rem; }
  .interval-review-card__tag-actions { padding: 0 .65rem .5rem; }
  .interval-review-card__heading,
  .interval-review-card__meta { gap: .5rem; }
  .interval-review-card__main { display: flex; min-height: 0; flex: 1 1 auto; overflow: hidden; }
  .interval-review-card__content { width: 100%; min-height: 0; padding: clamp(.5rem, 2dvh, 1rem); flex: 1 1 auto; gap: clamp(.35rem, 1.5dvh, .65rem); }
  .interval-review-card__face-window,
  .interval-review-card__faces { height: 100%; }
  .interval-review-card__faces { align-items: center; justify-items: center; }
  .interval-review-card__tag-actions,
  .interval-review-card__progress { flex: 0 0 auto; }
}

@media (prefers-reduced-motion: reduce) {
  .review-card__hint,
  .review-card-buffer--incoming,
  .review-card-buffer--outgoing { transition: none; }
}
</style>
