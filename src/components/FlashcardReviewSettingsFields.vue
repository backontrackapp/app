<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import {
  DEFAULT_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
  DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  FLASHCARD_REVIEW_FACE_VALUE_OPTIONS,
  FLASHCARD_REVIEW_SORT_OPTIONS,
  MAX_FLASHCARD_BACK_SPEECH_REPEATS,
  MAX_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
  MAX_FLASHCARD_SESSION_CARDS,
  MAX_FLASHCARD_BACK_SPEECH_RATE,
  MAX_FLASHCARD_EJECT_EXCLUDE_AFTER,
  MIN_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
  MIN_FLASHCARD_BACK_SPEECH_REPEATS,
  MIN_FLASHCARD_EJECT_EXCLUDE_AFTER,
  MIN_FLASHCARD_BACK_SPEECH_RATE,
  flashcardEjectBehavior,
  flashcardEjectExcludes,
  flashcardEjectLoadsNext,
  flashcardReviewFaceCanSpeak,
  flashcardReviewFaceValue,
  normalizeFlashcardBackSpeechRate,
} from '@/services/flashcards'
import {
  defaultFlashcardSpeechLanguage,
  speechLanguageOptions,
} from '@/services/flashcardSpeech'
import type {
  FlashcardReviewFaceValue,
  FlashcardReviewSettings,
  FlashcardSpeechSupport,
} from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: FlashcardReviewSettings
  speechSupport: FlashcardSpeechSupport
  speechLoading?: boolean
  minCards?: number
  maxCards?: number
  availableCards?: number
  session?: boolean
  interval?: boolean
  elapsedSeconds?: number
}>(), {
  speechLoading: false,
  minCards: 1,
  maxCards: MAX_FLASHCARD_SESSION_CARDS,
  availableCards: 0,
  session: false,
  interval: false,
  elapsedSeconds: 0,
})

const CUSTOM_MAX_CARDS_THRESHOLD = 50
const settings = computed(() => props.modelValue)
const frontDisplay = computed({
  get: () => flashcardReviewFaceValue(settings.value, 'front'),
  set: (value: FlashcardReviewFaceValue) => {
    settings.value.frontDisplay = value
  },
})
const backDisplay = computed({
  get: () => flashcardReviewFaceValue(settings.value, 'back'),
  set: (value: FlashcardReviewFaceValue) => {
    settings.value.backDisplay = value
  },
})
const vuetifyDefaultsAvailable = Boolean(inject(Symbol.for('vuetify:defaults'), null))
const ejectLoadsNext = computed({
  get: () => flashcardEjectLoadsNext(settings.value.ejectBehavior),
  set: (enabled: boolean | null) => {
    settings.value.ejectBehavior = flashcardEjectBehavior(
      Boolean(enabled),
      flashcardEjectExcludes(settings.value.ejectBehavior),
    )
  },
})
const ejectExcludes = computed({
  get: () => flashcardEjectExcludes(settings.value.ejectBehavior),
  set: (enabled: boolean | null) => {
    settings.value.ejectBehavior = flashcardEjectBehavior(
      flashcardEjectLoadsNext(settings.value.ejectBehavior),
      Boolean(enabled),
    )
  },
})
const ejectExcludeAfter = computed({
  get: () => settings.value.ejectExcludeAfter || DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  set: (value: number) => {
    settings.value.ejectExcludeAfter = Number(value)
  },
})
const cardLimit = computed(() => {
  const minimum = Math.min(
    MAX_FLASHCARD_SESSION_CARDS,
    Math.max(1, Math.floor(props.minCards)),
  )
  const configuredMaximum = Math.min(
    MAX_FLASHCARD_SESSION_CARDS,
    Math.max(minimum, Math.floor(props.maxCards)),
  )
  const availableMaximum = props.availableCards > 0
    ? Math.min(configuredMaximum, Math.floor(props.availableCards))
    : configuredMaximum
  const maximum = Math.max(minimum, availableMaximum)
  const sliderMaximum = Math.min(CUSTOM_MAX_CARDS_THRESHOLD, maximum)

  return {
    minimum,
    maximum,
    sliderMinimum: Math.min(minimum, sliderMaximum),
    sliderMaximum,
  }
})
const sliderMaxCards = computed({
  get: () => Math.min(Number(settings.value.maxCards), cardLimit.value.sliderMaximum),
  set: (value: number) => {
    settings.value.maxCards = Number(value)
  },
})
const customMaxCardsVisible = computed(() => (
  cardLimit.value.maximum > CUSTOM_MAX_CARDS_THRESHOLD
  && Number(settings.value.maxCards) >= CUSTOM_MAX_CARDS_THRESHOLD
))
const timeLimitEnabled = computed({
  get: () => (settings.value.timeLimitSeconds || 0) > 0,
  set: (enabled: boolean) => {
    settings.value.timeLimitSeconds = enabled
      ? Math.max(
          settings.value.timeLimitSeconds || DEFAULT_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
          minimumTimeLimitSeconds.value,
        )
      : 0
  },
})
const minimumTimeLimitSeconds = computed(() => Math.min(
  MAX_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
  Math.max(
    MIN_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
    Math.ceil((props.session ? props.elapsedSeconds + 60 : 60) / 60) * 60,
  ),
))
const timeLimitSeconds = computed({
  get: () => settings.value.timeLimitSeconds || DEFAULT_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS,
  set: (value: number | string) => {
    settings.value.timeLimitSeconds = Math.max(minimumTimeLimitSeconds.value, Number(value))
  },
})
const speechLanguages = computed(() => speechLanguageOptions([
  ...props.speechSupport.languages.map(language => language.tag),
  settings.value.frontLanguage,
  settings.value.backLanguage,
]))
const frontSpeechEnabled = computed(() => flashcardReviewFaceCanSpeak(frontDisplay.value))
const backSpeechEnabled = computed(() => flashcardReviewFaceCanSpeak(backDisplay.value))
const backSpeechRate = computed({
  get: () => normalizeFlashcardBackSpeechRate(settings.value.backSpeechRate),
  set: (value: number) => {
    settings.value.backSpeechRate = normalizeFlashcardBackSpeechRate(value)
  },
})

watch(cardLimit, ({ minimum, maximum }) => {
  if (settings.value.maxCards < minimum) settings.value.maxCards = minimum
  if (settings.value.maxCards > maximum) settings.value.maxCards = maximum
}, { immediate: true })

watch(() => settings.value.ejectExcludeAfter, (value) => {
  if (
    !Number.isInteger(value)
    || value < MIN_FLASHCARD_EJECT_EXCLUDE_AFTER
    || value > MAX_FLASHCARD_EJECT_EXCLUDE_AFTER
  ) settings.value.ejectExcludeAfter = DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER
}, { immediate: true })

watch(() => [settings.value.cardSides, settings.value.invertFaces], () => {
  settings.value.cardSides = 'both'
  settings.value.invertFaces = false
}, { immediate: true })

function updateMode(mode: 'manual' | 'passive') {
  settings.value.mode = mode
  settings.value.indefinite = mode === 'passive'
  settings.value.timeLimitSeconds = mode === 'passive'
    ? settings.value.timeLimitSeconds || DEFAULT_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS
    : 0
}

function updateSpeechEnabled(enabled: boolean | null) {
  if (!enabled) return
  const fallback = defaultFlashcardSpeechLanguage(props.speechSupport.languages)
  if (frontSpeechEnabled.value && !settings.value.frontLanguage) {
    settings.value.frontLanguage = fallback
  }
  if (backSpeechEnabled.value && !settings.value.backLanguage) {
    settings.value.backLanguage = fallback
  }
}

</script>

<template>
  <div class="flashcard-review-settings-fields">
    <v-card class="surface-card pa-5">
      <template v-if="!interval">
        <label class="field-label">Review mode <span class="required-mark">*</span></label>
        <v-btn-toggle
          :model-value="settings.mode"
          mandatory
          color="secondary"
          variant="tonal"
          class="mode-toggle mt-2"
          @update:model-value="updateMode"
        >
          <v-btn value="manual" prepend-icon="mdi-gesture-tap">Manual</v-btn>
          <v-btn value="passive" prepend-icon="mdi-play-speed">Passive</v-btn>
        </v-btn-toggle>
        <p class="mode-hint mt-3" aria-live="polite">
          <v-icon icon="mdi-information-outline" size="18" />
          <span v-if="settings.mode === 'manual'">
            Reveal the back value when you're ready, then mark the card as a success or error.
          </span>
          <span v-else>
            Front and back advance automatically using the durations below; cards count as viewed, not graded.
          </span>
        </p>
        <v-expand-transition>
          <div v-if="settings.mode === 'passive'">
            <div class="mode-indefinite-setting pt-4">
              <v-divider />
              <div class="setting-row pt-3">
                <div>
                  <strong>Run indefinitely</strong>
                  <p>Loop through these cards until the time limit is reached or you end the review</p>
                </div>
                <v-switch
                  v-model="settings.indefinite"
                  color="secondary"
                  hide-details="auto"
                  inset
                  aria-label="Run review indefinitely"
                />
              </div>
            </div>
            <v-divider class="my-5" />
            <div class="setting-row">
              <div>
                <strong>Time limit</strong>
                <p>Finish the review automatically after this much active time</p>
              </div>
              <v-switch
                v-model="timeLimitEnabled"
                color="secondary"
                hide-details="auto"
                inset
                aria-label="Set a Review set time limit"
              />
            </div>
            <v-expand-transition>
              <div v-if="timeLimitEnabled">
                <div class="time-limit-picker mt-4">
                  <TimerWheelPicker
                    v-model="timeLimitSeconds"
                    mode="hours-minutes"
                    :active="timeLimitEnabled"
                  />
                  <p class="mode-hint mt-3">
                    <v-icon icon="mdi-timer-outline" size="18" />
                    Only active review time counts toward the limit.
                  </p>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </v-expand-transition>
        <v-divider class="my-5" />
      </template>
      <label class="field-label">Face values <span class="required-mark">*</span></label>
      <v-row class="mt-2">
        <v-col cols="12" sm="6">
          <v-select
            v-model="frontDisplay"
            :items="FLASHCARD_REVIEW_FACE_VALUE_OPTIONS"
            item-title="title"
            item-value="value"
            aria-label="Front face value"
          >
            <template #label>Front value <span class="required-mark">*</span></template>
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :prepend-icon="item.raw.icon" />
            </template>
          </v-select>
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="backDisplay"
            :items="FLASHCARD_REVIEW_FACE_VALUE_OPTIONS"
            item-title="title"
            item-value="value"
            aria-label="Back face value"
          >
            <template #label>Back value <span class="required-mark">*</span></template>
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :prepend-icon="item.raw.icon" />
            </template>
          </v-select>
        </v-col>
      </v-row>
      <p class="mode-hint mt-1">
        <v-icon icon="mdi-information-outline" size="18" />
        Choose the card field shown on each review face. Image shows the card image directly.
      </p>

      <v-expand-transition>
        <div v-if="settings.mode === 'passive'">
          <div class="passive-settings mt-5">
            <LabeledSlider
              v-model="settings.frontSeconds"
              title="Front duration"
              :min="1"
              :max="20"
              :step="1"
              :value-label="`${settings.frontSeconds} ${settings.frontSeconds === 1 ? 'second' : 'seconds'}`"
              min-label="1 second"
              max-label="20 seconds"
              aria-label="Front duration in seconds"
            />
            <LabeledSlider
              v-model="settings.backSeconds"
              title="Back duration"
              :min="1"
              :max="20"
              :step="1"
              :value-label="`${settings.backSeconds} ${settings.backSeconds === 1 ? 'second' : 'seconds'}`"
              min-label="1 second"
              max-label="20 seconds"
              aria-label="Back duration in seconds"
            />
          </div>
        </div>
      </v-expand-transition>
    </v-card>

    <v-card class="surface-card pa-5">
      <div class="setting-row">
        <div>
          <strong>Read cards aloud</strong>
          <p v-if="speechLoading">Checking speech synthesis on this device…</p>
          <p v-else-if="speechSupport.available">
            {{ !frontSpeechEnabled && !backSpeechEnabled
              ? 'The selected values have no text to read aloud'
              : 'Speak the selected front and back values whenever each face appears' }}
          </p>
          <p v-else>Speech synthesis is not available on this device</p>
        </div>
        <v-switch
          v-model="settings.speechEnabled"
          color="secondary"
          :loading="speechLoading"
          :disabled="speechLoading || (!speechSupport.available && !settings.speechEnabled)"
          hide-details="auto"
          inset
          aria-label="Read cards aloud"
          @update:model-value="updateSpeechEnabled"
        />
      </div>

      <v-expand-transition>
        <div v-if="settings.speechEnabled">
          <div class="speech-language-fields mt-5">
            <v-select
              v-if="frontSpeechEnabled"
              v-model="settings.frontLanguage"
              :items="speechLanguages"
              item-title="title"
              item-value="tag"
              :disabled="!speechSupport.available"
              :rules="[value => Boolean(value) || 'Select a front language']"
            >
              <template #label>Front language <span class="required-mark">*</span></template>
            </v-select>
            <v-select
              v-if="backSpeechEnabled"
              v-model="settings.backLanguage"
              :items="speechLanguages"
              item-title="title"
              item-value="tag"
              :disabled="!speechSupport.available"
              :rules="[value => Boolean(value) || 'Select a back language']"
            >
              <template #label>Back language <span class="required-mark">*</span></template>
            </v-select>
            <div
              v-if="settings.mode === 'passive' && backSpeechEnabled"
              class="speech-repeat-setting"
            >
              <LabeledSlider
                v-model="settings.backSpeechRepeatCount"
                title="Repeat back aloud"
                :min="MIN_FLASHCARD_BACK_SPEECH_REPEATS"
                :max="MAX_FLASHCARD_BACK_SPEECH_REPEATS"
                :step="1"
                :value-label="settings.backSpeechRepeatCount === 1 ? 'Once' : `${settings.backSpeechRepeatCount} times`"
                min-label="Once"
                :max-label="`${MAX_FLASHCARD_BACK_SPEECH_REPEATS} times`"
                aria-label="Number of times to read each flashcard back aloud"
              />
              <p class="mode-hint mt-3">
                <v-icon icon="mdi-information-outline" size="18" />
                Each repeat adds the configured back duration before advancing to the next card.
              </p>
            </div>
            <div v-if="backSpeechEnabled" class="back-speech-rate-setting">
              <LabeledSlider
                v-model="backSpeechRate"
                title="Back speech speed"
                :min="MIN_FLASHCARD_BACK_SPEECH_RATE"
                :max="MAX_FLASHCARD_BACK_SPEECH_RATE"
                :step="0.25"
                :value-label="`${backSpeechRate}×`"
                min-label="0.25×"
                max-label="1×"
                aria-label="Back text-to-speech speed"
              />
            </div>
            <p class="speech-background-hint">
              <v-icon icon="mdi-cellphone-sound" size="18" />
              Passive reviews keep speaking on Android while the app is in the background or the screen is locked.
            </p>
          </div>
        </div>
      </v-expand-transition>
    </v-card>

    <v-card class="surface-card pa-5">
      <v-select
        v-model="settings.sortMode"
        label="Card order"
        :items="FLASHCARD_REVIEW_SORT_OPTIONS"
        :disabled="session"
        item-title="title"
        item-value="value"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :title="item.raw.title" :subtitle="item.raw.subtitle" />
        </template>
      </v-select>
      <v-btn-toggle
        v-model="settings.sortDirection"
        mandatory
        color="secondary"
        variant="tonal"
        size="small"
        class="sort-direction-toggle mt-2"
        :disabled="session"
      >
        <v-btn value="asc" prepend-icon="mdi-sort-ascending">ASC</v-btn>
        <v-btn value="desc" prepend-icon="mdi-sort-descending">DESC</v-btn>
      </v-btn-toggle>
      <p v-if="session" class="mode-hint mt-3">
        <v-icon icon="mdi-lock-outline" size="18" />
        Card order is fixed after a session starts.
      </p>
      <v-divider class="my-5" />
      <LabeledSlider
        v-model="sliderMaxCards"
        title="Max cards per session"
        :min="cardLimit.sliderMinimum"
        :max="cardLimit.sliderMaximum"
        :step="1"
        :value-label="`${settings.maxCards} cards`"
        :min-label="`${cardLimit.sliderMinimum} ${cardLimit.sliderMinimum === 1 ? 'card' : 'cards'}`"
        :max-label="cardLimit.maximum > CUSTOM_MAX_CARDS_THRESHOLD ? `${CUSTOM_MAX_CARDS_THRESHOLD}+ cards` : `${cardLimit.sliderMaximum} cards`"
        aria-label="Maximum cards per Review set session"
      />
      <v-expand-transition>
        <div v-if="customMaxCardsVisible">
          <v-number-input
            v-model="settings.maxCards"
            class="mt-4"
            :min="Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)"
            :max="cardLimit.maximum"
            :step="1"
            :rules="[
              value => Number.isInteger(Number(value)) || 'Use a whole number',
              value => Number(value) >= Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)
                && Number(value) <= cardLimit.maximum
                || `Use ${Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)}–${cardLimit.maximum} cards`,
            ]"
            autocomplete="off"
            persistent-hint
            :hint="`Choose a custom limit up to ${cardLimit.maximum} available cards`"
          >
            <template #label>Custom max cards <span class="required-mark">*</span></template>
          </v-number-input>
        </div>
      </v-expand-transition>
      <p class="mode-hint mt-3">
        <v-icon icon="mdi-information-outline" size="18" />
        <span v-if="session">The limit and order are applied to the cards remaining in this session.</span>
        <span v-else>Cards are filtered and ordered first, then up to {{ settings.maxCards }} are included in each session.</span>
      </p>
      <v-divider class="my-5" />
      <template v-if="settings.ejectBehavior">
        <label class="field-label">Eject button behavior</label>
        <div v-if="vuetifyDefaultsAvailable" class="eject-behavior-options mt-2">
          <v-checkbox
            v-model="ejectExcludes"
            color="secondary"
            hide-details="auto"
          >
            <template #label>
              <span class="eject-behavior-option py-2">
                <strong>Exclude card</strong>
                <small>Count card ejections, then prevent the card from appearing in future sessions.</small>
              </span>
            </template>
          </v-checkbox>
          <v-expand-transition>
            <div v-if="ejectExcludes">
              <div class="ml-10 mb-3">
                <LabeledSlider
                  v-model="ejectExcludeAfter"
                  title="Ejections before exclusion"
                  :min="MIN_FLASHCARD_EJECT_EXCLUDE_AFTER"
                  :max="MAX_FLASHCARD_EJECT_EXCLUDE_AFTER"
                  :value-label="ejectExcludeAfter"
                  :aria-label="`Exclude a card after ${ejectExcludeAfter} ejections`"
                />
              </div>
            </div>
          </v-expand-transition>
          <v-checkbox
            v-model="ejectLoadsNext"
            color="secondary"
            hide-details="auto"
          >
            <template #label>
              <span class="eject-behavior-option py-2">
                <strong>Inject a new card</strong>
                <small>Keep the active list filled from the rest of the Review set.</small>
              </span>
            </template>
          </v-checkbox>
        </div>
        <div v-else class="eject-behavior-options mt-2">
          <label class="eject-behavior-native-option">
            <input v-model="ejectExcludes" type="checkbox">
            <span class="eject-behavior-option py-2">
              <strong>Exclude after {{ ejectExcludeAfter }} {{ ejectExcludeAfter === 1 ? 'ejection' : 'ejections' }}.</strong>
              <small>Count card ejections, then prevent the card from appearing in future sessions.</small>
            </span>
          </label>
          <v-expand-transition>
            <div v-if="ejectExcludes">
              <div class="ml-10 mb-3">
                <LabeledSlider
                  v-model="ejectExcludeAfter"
                  title="Ejections before exclusion"
                  :min="MIN_FLASHCARD_EJECT_EXCLUDE_AFTER"
                  :max="MAX_FLASHCARD_EJECT_EXCLUDE_AFTER"
                  :value-label="ejectExcludeAfter"
                  :aria-label="`Exclude a card after ${ejectExcludeAfter} ejections`"
                />
              </div>
            </div>
          </v-expand-transition>
          <label class="eject-behavior-native-option">
            <input v-model="ejectLoadsNext" type="checkbox">
            <span class="eject-behavior-option py-2">
              <strong>Inject a new card.</strong>
              <small>Keep the active list filled from the rest of the Review set.</small>
            </span>
          </label>
        </div>
      </template>
    </v-card>
  </div>
</template>

<style scoped>
.flashcard-review-settings-fields { display: grid; gap: 1rem; }
.field-label { color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 800; }
.required-mark { color: rgb(var(--v-theme-error)); }
.mode-toggle { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.mode-toggle :deep(.v-btn) { width: 100%; min-height: 3rem; }
.sort-direction-toggle { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.sort-direction-toggle :deep(.v-btn) { width: 100%; }
.eject-behavior-options :deep(.v-selection-control) { min-height: 3rem; }
.eject-behavior-native-option { display: flex; align-items: center; gap: .75rem; min-height: 3rem; }
.eject-behavior-option { display: grid; }
.eject-behavior-option small { color: rgba(var(--v-theme-on-surface), .5); font-size: .7rem; line-height: 1.45; }
.mode-hint { display: flex; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.mode-hint .v-icon { flex: 0 0 auto; }
.passive-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.setting-row { display: grid; min-height: 4rem; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .5); font-size: .7rem; }
.speech-language-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.speech-repeat-setting,
.back-speech-rate-setting,
.speech-background-hint { grid-column: 1 / -1; }
.speech-background-hint { display: flex; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.speech-background-hint .v-icon { flex: 0 0 auto; }
@media (max-width: 31.25rem) {
  .passive-settings,
  .speech-language-fields { grid-template-columns: 1fr; }
  .speech-repeat-setting,
  .back-speech-rate-setting,
  .speech-background-hint { grid-column: auto; }
}
</style>
