<script setup lang="ts">
import { computed, ref } from 'vue'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'
import FitReviewContent from '@/components/FitReviewContent.vue'
import SpokenText from '@/components/SpokenText.vue'
import { REFIT_TEXT_CONTENT_EVENT } from '@/composables/useFitLargestWord'
import { flashcardTextFontSize } from '@/services/flashcards'
import { speechLanguageUsesPinyin } from '@/services/spokenText'
import { REVIEW_SET_CARD_SWIPE_HINT } from '@/services/swipeHints'
import type {
  FlashcardBackDisplay,
  FlashcardReviewCardQuickTag,
  FlashcardReviewCardSides,
  FlashcardReviewMode,
  FlashcardReviewQueueCard,
  FlashcardReviewSide,
  FlashcardSpeechWord,
} from '@/types/domain'

type ReviewCardTransitionDirection = 'previous' | 'next' | 'front' | 'back'

const props = withDefaults(defineProps<{
  card: FlashcardReviewQueueCard
  side: FlashcardReviewSide
  mode?: FlashcardReviewMode
  cardSides?: FlashcardReviewCardSides
  backDisplay?: FlashcardBackDisplay
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
  showTagActions?: boolean
  quickTags?: FlashcardReviewCardQuickTag[]
  canTag?: boolean
  hasSelectableTags?: boolean
  ejectable?: boolean
  ejecting?: boolean
  ejectDisabled?: boolean
}>(), {
  mode: 'passive',
  cardSides: 'both',
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
  showTagActions: false,
  quickTags: () => [],
  canTag: false,
  hasSelectableTags: false,
  ejectable: false,
  ejecting: false,
  ejectDisabled: false,
})

const emit = defineEmits<{
  activate: [event: Event]
  replay: []
  pointerDown: [event: PointerEvent]
  pointerMove: [event: PointerEvent]
  pointerUp: [event: PointerEvent]
  pointerCancel: [event: PointerEvent]
  lostPointerCapture: [event: PointerEvent]
  afterEnter: []
  tagClickCapture: [event: MouseEvent]
  toggleTag: [name: string]
  openTags: []
  eject: []
}>()

const root = ref<HTMLElement>()
const contentTransitionName = computed(() => props.transitionDirection
  ? `${props.dense ? 'interval-flashcard' : 'standalone-review-content'}-${props.transitionDirection}`
  : undefined)
const imageTransitionName = computed(() => props.transitionDirection
  ? `${props.dense ? 'interval-flashcard' : 'review-card-image'}-${props.transitionDirection}`
  : props.dense ? undefined : 'review-card-image')
const denseTransitionKey = computed(() => `${props.card.id}:${props.side}`)
const colorizePinyin = computed(() => props.speechEnabled
  && props.side === 'back'
  && speechLanguageUsesPinyin(props.speechLanguage))
const standaloneAriaLabel = computed(() => {
  if (props.speechEnabled) return `Replay ${props.side} speech`
  if (props.mode === 'manual' && props.cardSides === 'both' && !props.revealed) return 'Show answer'
  return `${props.side} shown`
})

function refitContent() {
  root.value
    ?.querySelectorAll<HTMLElement>('.fit-review-content, .fit-response-part')
    .forEach(element => element.dispatchEvent(new Event(REFIT_TEXT_CONTENT_EVENT)))
}

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
    :aria-label="paused
      ? `${setName} paused for this step, card ${cardPosition} of ${cardCount}`
      : `${setName}, ${side}, card ${cardPosition} of ${cardCount}`"
    @pointerdown.capture="emit('pointerDown', $event)"
    @pointermove.capture="emit('pointerMove', $event)"
    @pointerup.capture="emit('pointerUp', $event)"
    @pointercancel.capture="emit('pointerCancel', $event)"
    @lostpointercapture.capture="emit('lostPointerCapture', $event)"
    @click="emit('activate', $event)"
    @keydown.enter.self="emit('activate', $event)"
    @keydown.space.self.prevent="emit('activate', $event)"
  >
    <transition :name="imageTransitionName">
      <img
        v-if="card.image"
        :key="card.id"
        :src="card.image"
        alt=""
        class="interval-review-card__image"
      />
    </transition>
    <div class="interval-review-card__main">
      <div class="interval-review-card__content">
        <div class="interval-review-card__heading">
          <span class="interval-review-card__set">
            <v-icon icon="mdi-cards-outline" size="1.0625rem" />
            <span class="text-truncate">{{ setName }}</span>
            <span class="interval-review-card__count">({{ cardPosition }} of {{ cardCount }})</span>
          </span>
          <div class="interval-review-card__meta">
            <small>
              <v-icon v-if="paused" icon="mdi-pause-circle-outline" size=".875rem" />
              {{ paused ? 'Paused' : side === 'front' ? 'Front' : 'Back' }}
            </small>
          </div>
        </div>
        <div class="interval-review-card__face-window">
          <transition :name="contentTransitionName" @after-enter="emit('afterEnter')">
            <div :key="denseTransitionKey" class="interval-review-card__faces">
              <strong
                :class="{ 'interval-review-card__face--hidden': side !== 'front' }"
                :aria-hidden="side !== 'front' ? 'true' : undefined"
                :style="{ fontSize: flashcardTextFontSize(card.front, 'face', 'compact') }"
              >
                <SpokenText
                  :text="card.front"
                  :language="speechLanguage"
                />
              </strong>
              <FlashcardResponseText
                :class="{ 'interval-review-card__face--hidden': side !== 'back' }"
                :aria-hidden="side !== 'back' ? 'true' : undefined"
                :back="card.back"
                :transliteration="card.transliteration"
                :note="card.note"
                :back-display="backDisplay"
                show-transliteration
                density="compact"
                :speech-language="speechLanguage"
                :spoken-word="side === 'back' ? spokenWord : undefined"
                :colorize-pinyin="colorizePinyin"
              />
            </div>
          </transition>
        </div>
      </div>
    </div>
    <footer v-if="showTagActions" class="interval-review-card__tag-actions" aria-label="Flashcard tags">
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
          :prepend-icon="tag.selected ? 'mdi-check' : 'mdi-tag-outline'"
          :disabled="!canTag"
          :aria-pressed="tag.selected"
          :aria-label="`${tag.selected ? 'Remove' : 'Add'} ${tag.name} tag`"
          @click.stop="emit('toggleTag', tag.name)"
        >
          {{ tag.name }}
        </v-chip>
      </div>
      <v-btn
        class="interval-review-card__tag-control interval-review-card__tag-menu-button"
        size="x-small"
        variant="text"
        prepend-icon="mdi-tag-multiple-outline"
        :disabled="!canTag || !hasSelectableTags"
        @click.stop="emit('openTags')"
      >
        Tags
      </v-btn>
    </footer>
    <v-progress-linear
      class="review-set-card__progress interval-review-card__progress"
      :model-value="progress"
      :color="progressColor"
      bg-color="white"
      :bg-opacity="0.14"
      height="5"
      rounded
      :aria-label="progressAriaLabel"
    />
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
          :class="{ 'review-card--back': side === 'back' }"
          :aria-label="standaloneAriaLabel"
          :disabled="disabled"
        >
          <transition :name="imageTransitionName">
            <img v-if="card.image" :key="card.id" :src="card.image" alt="" class="review-card__image" />
          </transition>
          <small>{{ side === 'back' ? 'Back' : 'Front' }}</small>
          <span class="review-card__content-window">
            <transition :name="contentTransitionName" @after-enter="emit('afterEnter')">
              <FitReviewContent
                :key="`manual-front-${card.id}`"
                v-show="side === 'front'"
                :text="card.front"
                :language="speechLanguage"
                :aria-hidden="side !== 'front'"
              />
            </transition>
            <transition :name="contentTransitionName" @after-enter="emit('afterEnter')">
              <span
                :key="`manual-back-${card.id}`"
                v-show="side === 'back'"
                class="review-card__content"
                :aria-hidden="side !== 'back'"
              >
                <span class="review-card__answer">
                  <span v-if="cardSides === 'both'" class="review-card__front-reference">
                    {{ card.front }}
                  </span>
                  <FlashcardResponseText
                    :back="card.back"
                    :transliteration="card.transliteration"
                    :note="card.note"
                    :back-display="backDisplay"
                    show-transliteration
                    fit-largest-word
                    :speech-language="speechLanguage"
                    :spoken-word="side === 'back' ? spokenWord : undefined"
                    :colorize-pinyin="colorizePinyin"
                  />
                </span>
              </span>
            </transition>
          </span>
          <span v-if="speechEnabled" class="review-card__hint">
            <v-icon icon="mdi-volume-high" size="1.125rem" /> Tap to replay
          </span>
          <span v-else-if="cardSides === 'both' && !revealed" class="review-card__hint">
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
          :aria-label="speechEnabled ? `Replay ${side} speech` : undefined"
          :aria-disabled="speechEnabled ? !canReplay : undefined"
          @keydown.enter="emit('replay')"
          @keydown.space.prevent="emit('replay')"
        >
          <transition :name="imageTransitionName">
            <img v-if="card.image" :key="card.id" :src="card.image" alt="" class="review-card__image" />
          </transition>
          <div class="passive-card__content">
            <small>{{ side === 'front' ? 'Front' : 'Back' }}</small>
            <span class="review-card__content-window">
              <transition :name="contentTransitionName" @after-enter="emit('afterEnter')">
                <FitReviewContent
                  :key="`passive-front-${card.id}`"
                  v-show="side === 'front'"
                  :text="card.front"
                  :language="speechLanguage"
                  :aria-hidden="side !== 'front'"
                />
              </transition>
              <transition :name="contentTransitionName" @after-enter="emit('afterEnter')">
                <span
                  :key="`passive-back-${card.id}`"
                  v-show="side === 'back'"
                  class="review-card__content"
                  :aria-hidden="side !== 'back'"
                >
                  <span class="review-card__answer">
                    <FlashcardResponseText
                      :back="card.back"
                      :transliteration="card.transliteration"
                      :note="card.note"
                      :back-display="backDisplay"
                      show-transliteration
                      fit-largest-word
                      :speech-language="speechLanguage"
                      :spoken-word="side === 'back' ? spokenWord : undefined"
                      :colorize-pinyin="colorizePinyin"
                    />
                    <span v-if="cardSides === 'both'" class="review-card__front-reference">
                      {{ card.front }}
                    </span>
                  </span>
                </span>
              </transition>
            </span>
            <span v-if="speechEnabled" class="review-card__hint">
              <v-icon icon="mdi-volume-high" size="1.125rem" /> Tap to replay
            </span>
          </div>
          <v-progress-linear
            class="review-set-card__progress review-progress"
            :model-value="progress"
            :color="progressColor"
            bg-color="white"
            :bg-opacity="0.14"
            height="6"
            rounded
          />
        </div>
      </div>
    </div>

    <footer
      v-if="showTagActions || ejectable"
      class="review-card__tag-actions"
      aria-label="Flashcard actions"
      @click.capture="emit('tagClickCapture', $event)"
      @click.stop
    >
      <v-btn
        v-if="ejectable"
        class="review-card__tag-control review-card__eject-button"
        variant="text"
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
          :variant="tag.selected ? 'flat' : 'outlined'"
          :prepend-icon="tag.selected ? 'mdi-check' : 'mdi-tag-outline'"
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
.review-card-window > * { width: 100%; min-height: inherit; grid-area: 1 / 1; }
.review-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; cursor: pointer; font: inherit; text-align: center; touch-action: none; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.review-card > :not(.review-card__image), .passive-card > :not(.review-card__image) { position: relative; z-index: 1; }
.review-card__image { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .58; pointer-events: none; filter: brightness(.42) saturate(.82); }
.review-card--back { border-color: rgba(var(--v-theme-secondary), .34); }
.review-card :deep(.v-ripple__container),
.passive-card :deep(.v-ripple__container) { position: absolute; z-index: 2; inset: 0; width: 100%; height: 100%; flex: none; }
.review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
.review-card small,
.passive-card small { color: rgba(var(--v-theme-on-surface), .48); font-size: .68rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.review-card strong,
.passive-card strong { max-width: 34rem; overflow-wrap: anywhere; font-size: clamp(1.3rem, 5vw, 2.1rem); font-weight: 850; line-height: 1.35; white-space: pre-wrap; }
.review-card__content-window { position: relative; width: 100%; height: 0; min-height: 0; flex: 1 1 0; overflow: hidden; }
.review-card__content { position: absolute; display: flex; inset: 0; width: 100%; height: 100%; min-height: 0; max-height: 100%; align-items: center; align-self: stretch; justify-content: center; flex-direction: column; overflow: hidden; font-size: var(--fit-review-content-size, 3.6rem); }
.review-card__answer { position: absolute; display: flex; inset: 0; width: 100%; height: 100%; min-width: 0; min-height: 0; max-height: 100%; align-items: center; justify-content: center; flex-direction: column; gap: .45rem; overflow: hidden; }
.review-card__front-reference { max-width: 30rem; overflow-wrap: anywhere; color: rgba(var(--v-theme-on-surface), .48); font-size: clamp(.72rem, 2.2vw, .88rem); line-height: 1.4; white-space: pre-wrap; }
.review-card__hint { display: flex; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .48); font-size: .72rem; font-weight: 800; }
.passive-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-secondary), .28); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; text-align: center; touch-action: none; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.passive-card--interactive { cursor: pointer; }
.passive-card__content { display: flex; width: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; overflow: hidden; }
.review-set-card__progress { position: relative; z-index: 5; flex: 0 0 auto; transition: none; }
.review-set-card__progress :deep(.v-progress-linear__determinate) { transition: none; }
.passive-card .review-set-card__progress { width: min(20rem, 100%); }
.review-card__tag-actions { position: absolute; z-index: 3; right: 1.5rem; bottom: 1.25rem; left: 1.5rem; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .5rem; }
.review-card__tag-control { min-height: 2.75rem; }
.review-card__eject-button { min-width: 0; grid-column: 1; justify-self: start; }
.review-card__quick-tags { display: flex; grid-column: 2; justify-self: end; gap: .5rem; }
.review-card__quick-tag.v-chip--variant-outlined { border-color: rgba(var(--v-theme-on-surface), .18); }

.interval-review-card { position: relative; width: min(100%, 34rem); overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .055); box-shadow: none; color: inherit; cursor: pointer; font: inherit; text-align: left; touch-action: none; }
.interval-review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.1875rem; }
.interval-review-card--disabled { cursor: default; }
.interval-review-card__image { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .52; pointer-events: none; filter: brightness(.38) saturate(.8); }
.interval-review-card__main { display: block; width: 100%; color: inherit; font: inherit; text-align: left; touch-action: none; }
.interval-review-card--playback-paused { border-style: dashed; background: rgba(var(--v-theme-on-surface), .025); opacity: .72; }
.interval-review-card :deep(.v-ripple__container) { z-index: 2; }
.interval-review-card__content { position: relative; z-index: 1; display: flex; box-sizing: border-box; min-height: 8.5rem; padding: 1rem; align-items: center; justify-content: flex-start; flex-direction: column; gap: .65rem; text-align: center; }
.interval-review-card__heading { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: .75rem; }
.interval-review-card__meta { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: .75rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__meta small { display: inline-flex; align-items: center; gap: .25rem; }
.interval-review-card__set { display: flex; min-width: 0; max-width: 75%; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-align: left; text-transform: uppercase; }
.interval-review-card__set > .text-truncate { min-width: 0; flex: 1 1 auto; }
.interval-review-card__count { flex: 0 0 auto; }
.interval-review-card__content small { color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__face-window { display: grid; width: 100%; min-height: 0; overflow: hidden; flex: 1 1 auto; }
.interval-review-card__faces { display: grid; width: 100%; min-height: 0; grid-area: 1 / 1; place-items: center; }
.interval-review-card__faces > * { grid-area: 1 / 1; max-width: 100%; }
.interval-review-card__face--hidden { visibility: hidden; }
.interval-review-card__content strong { overflow-wrap: anywhere; font-size: clamp(1.05rem, 4.5vw, 1.5rem); line-height: 1.3; white-space: pre-wrap; }
.interval-review-card :deep(.flashcard-response-text__supporting) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.interval-review-card :deep(.flashcard-response-text__supporting[data-response-part="note"]) { display: block; text-overflow: ellipsis; white-space: nowrap; -webkit-line-clamp: unset; }
.interval-review-card__tag-actions { position: relative; z-index: 1; display: grid; padding: 0 1rem .75rem; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: .3rem; }
.interval-review-card__quick-tags { display: flex; grid-column: 2; justify-self: center; gap: .3rem; }
.interval-review-card__tag-control { height: 1.5rem !important; min-height: 1.5rem !important; font-size: .625rem; }
.interval-review-card__eject-button { min-width: 1.5rem; padding: 0; grid-column: 1; justify-self: start; }
.interval-review-card__quick-tag { --v-chip-height: 1.5rem; }
.interval-review-card__quick-tag.v-chip--variant-outlined { border-color: rgba(var(--v-theme-on-surface), .18); }
.interval-review-card__tag-menu-button { min-width: 0; padding-inline: .65rem; grid-column: 3; justify-self: end; }
.interval-review-card :deep(.v-progress-linear) { border-radius: 0; }
.interval-review-card__progress { width: 100%; }
.interval-review-card__progress :deep(.v-progress-linear__determinate) { opacity: .3; transition: none; }

.review-card-image-enter-active,
.review-card-image-leave-active,
.review-card-image-next-enter-active,
.review-card-image-next-leave-active,
.review-card-image-previous-enter-active,
.review-card-image-previous-leave-active,
.review-card-image-front-enter-active,
.review-card-image-front-leave-active,
.review-card-image-back-enter-active,
.review-card-image-back-leave-active { transition: opacity 200ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.review-card-image-enter-from,
.review-card-image-leave-to { opacity: 0; }
.review-card-image-next-enter-from,
.review-card-image-previous-leave-to { opacity: 0; transform: translateX(1.5rem); }
.review-card-image-next-leave-to,
.review-card-image-previous-enter-from { opacity: 0; transform: translateX(-1.5rem); }
.review-card-image-back-enter-from,
.review-card-image-front-leave-to { opacity: 0; transform: translateY(1.5rem); }
.review-card-image-back-leave-to,
.review-card-image-front-enter-from { opacity: 0; transform: translateY(-1.5rem); }

.standalone-review-content-next-enter-active,
.standalone-review-content-next-leave-active,
.standalone-review-content-previous-enter-active,
.standalone-review-content-previous-leave-active,
.standalone-review-content-front-enter-active,
.standalone-review-content-front-leave-active,
.standalone-review-content-back-enter-active,
.standalone-review-content-back-leave-active,
.interval-flashcard-next-enter-active,
.interval-flashcard-next-leave-active,
.interval-flashcard-previous-enter-active,
.interval-flashcard-previous-leave-active,
.interval-flashcard-front-enter-active,
.interval-flashcard-front-leave-active,
.interval-flashcard-back-enter-active,
.interval-flashcard-back-leave-active { transition: opacity 160ms ease, transform 180ms cubic-bezier(.22, 1, .36, 1); }
.standalone-review-content-next-enter-from,
.standalone-review-content-previous-leave-to,
.interval-flashcard-next-enter-from,
.interval-flashcard-previous-leave-to { opacity: 0; transform: translateX(1.5rem); }
.standalone-review-content-next-leave-to,
.standalone-review-content-previous-enter-from,
.interval-flashcard-next-leave-to,
.interval-flashcard-previous-enter-from { opacity: 0; transform: translateX(-1.5rem); }
.standalone-review-content-back-enter-from,
.standalone-review-content-front-leave-to,
.interval-flashcard-back-enter-from,
.interval-flashcard-front-leave-to { opacity: 0; transform: translateY(1.5rem); }
.standalone-review-content-back-leave-to,
.standalone-review-content-front-enter-from,
.interval-flashcard-back-leave-to,
.interval-flashcard-front-enter-from { opacity: 0; transform: translateY(-1.5rem); }

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
  .review-card__quick-tags { flex-wrap: wrap; }
  .review-card__tag-menu-button { height: 2rem; min-width: 0; padding-inline: .5rem; grid-column: auto; justify-self: auto; font-size: .75rem; }
  .review-card__quick-tag { height: 1.75rem; padding-inline: .5rem; font-size: .75rem; }
}

@media (orientation: landscape) and (max-height: 43.75rem) {
  .interval-review-card__content { min-height: 7.25rem; padding: .65rem; }
  .interval-review-card__tag-actions { padding: 0 .65rem .5rem; }
  .interval-review-card__heading,
  .interval-review-card__meta { gap: .5rem; }
  .interval-review-card__content strong { display: -webkit-box; overflow: hidden; font-size: clamp(.9rem, 2.5dvh, 1.2rem); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .interval-review-card :deep(.flashcard-response-text--compact) { max-height: none; }
  .interval-review-card :deep(.flashcard-response-text__supporting) { display: -webkit-box; text-overflow: clip; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .interval-review-card__main { display: flex; min-height: 0; flex: 1 1 auto; overflow: hidden; }
  .interval-review-card__content { width: 100%; min-height: 0; padding: clamp(.5rem, 2dvh, 1rem); flex: 1 1 auto; gap: clamp(.35rem, 1.5dvh, .65rem); }
  .interval-review-card__face-window,
  .interval-review-card__faces { height: 100%; }
  .interval-review-card__faces { align-items: center; justify-items: center; }
  .interval-review-card__tag-actions,
  .interval-review-card__progress { flex: 0 0 auto; }
}

@media (prefers-reduced-motion: reduce) {
  .review-card-image-enter-active,
  .review-card-image-leave-active,
  .review-card-image-next-enter-active,
  .review-card-image-next-leave-active,
  .review-card-image-previous-enter-active,
  .review-card-image-previous-leave-active,
  .review-card-image-front-enter-active,
  .review-card-image-front-leave-active,
  .review-card-image-back-enter-active,
  .review-card-image-back-leave-active,
  .standalone-review-content-next-enter-active,
  .standalone-review-content-next-leave-active,
  .standalone-review-content-previous-enter-active,
  .standalone-review-content-previous-leave-active,
  .standalone-review-content-front-enter-active,
  .standalone-review-content-front-leave-active,
  .standalone-review-content-back-enter-active,
  .standalone-review-content-back-leave-active,
  .interval-flashcard-next-enter-active,
  .interval-flashcard-next-leave-active,
  .interval-flashcard-previous-enter-active,
  .interval-flashcard-previous-leave-active,
  .interval-flashcard-front-enter-active,
  .interval-flashcard-front-leave-active,
  .interval-flashcard-back-enter-active,
  .interval-flashcard-back-leave-active { transition: none; }
  .review-card-image-next-enter-from,
  .review-card-image-next-leave-to,
  .review-card-image-previous-enter-from,
  .review-card-image-previous-leave-to,
  .review-card-image-front-enter-from,
  .review-card-image-front-leave-to,
  .review-card-image-back-enter-from,
  .review-card-image-back-leave-to,
  .standalone-review-content-next-enter-from,
  .standalone-review-content-next-leave-to,
  .standalone-review-content-previous-enter-from,
  .standalone-review-content-previous-leave-to,
  .standalone-review-content-front-enter-from,
  .standalone-review-content-front-leave-to,
  .standalone-review-content-back-enter-from,
  .standalone-review-content-back-leave-to,
  .interval-flashcard-next-enter-from,
  .interval-flashcard-next-leave-to,
  .interval-flashcard-previous-enter-from,
  .interval-flashcard-previous-leave-to,
  .interval-flashcard-front-enter-from,
  .interval-flashcard-front-leave-to,
  .interval-flashcard-back-enter-from,
  .interval-flashcard-back-leave-to { opacity: 1; transform: none; }
}
</style>
