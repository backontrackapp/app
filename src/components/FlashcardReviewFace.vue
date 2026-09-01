<script setup lang="ts">
import { computed } from 'vue'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'
import FitReviewContent from '@/components/FitReviewContent.vue'
import {
  flashcardReviewFaceText,
  flashcardReviewFaceTitle,
} from '@/services/flashcards'
import { speechLanguageUsesPinyin } from '@/services/spokenText'
import type {
  FlashcardReviewFaceValue,
  FlashcardReviewQueueCard,
  FlashcardSpeechWord,
} from '@/types/domain'

const props = withDefaults(defineProps<{
  card: FlashcardReviewQueueCard
  value: FlashcardReviewFaceValue
  language?: string
  spokenWord?: FlashcardSpeechWord
  wordsPressable?: boolean
  dense?: boolean
}>(), {
  language: '',
  spokenWord: undefined,
  wordsPressable: false,
  dense: false,
})

const emit = defineEmits<{
  pressWord: [word: string, spokenWord: FlashcardSpeechWord]
}>()

const isImage = computed(() => props.value === 'image')
const isEmpty = computed(() => props.value === 'empty')
const text = computed(() => flashcardReviewFaceText(props.card, props.value))
const showsResponseDetails = computed(() => (
  (props.value === 'back' || props.value === 'transliteration')
  && Boolean(text.value)
))
const missingLabel = computed(() => `No ${flashcardReviewFaceTitle(props.value).toLocaleLowerCase()} on this card`)
const colorizePinyin = computed(() => (
  speechLanguageUsesPinyin(props.language)
  && (props.value === 'back' || props.value === 'transliteration')
))
</script>

<template>
  <div
    class="flashcard-review-face"
    :class="{
      'flashcard-review-face--image': isImage,
      'flashcard-review-face--dense': dense,
    }"
  >
    <template v-if="isImage">
      <img
        v-if="card.image"
        :src="card.image"
        alt="Flashcard image"
        class="flashcard-review-face__image"
      >
      <div v-else class="flashcard-review-face__missing">
        <v-icon icon="mdi-image-off-outline" size="2rem" />
        <span>{{ missingLabel }}</span>
      </div>
    </template>
    <FlashcardResponseText
      v-else-if="showsResponseDetails"
      :back="card.back"
      :transliteration="card.transliteration"
      :note="card.note"
      :back-display="value"
      show-transliteration
      :density="dense ? 'compact' : 'full'"
      fit-largest-word
      :speech-language="language"
      :spoken-word="spokenWord"
      :colorize-pinyin="colorizePinyin"
      :words-pressable="wordsPressable"
      @press-word="(word, spokenWord) => emit('pressWord', word, spokenWord)"
    />
    <FitReviewContent
      v-else-if="text"
      class="flashcard-review-face__text"
      :text="text"
      :language="language"
      :spoken-word="spokenWord"
      :colorize-pinyin="colorizePinyin"
      :tone-source="value === 'back' ? card.transliteration : ''"
      :pinyin="value === 'transliteration'"
      :words-pressable="wordsPressable"
      @press-word="(word, spokenWord) => emit('pressWord', word, spokenWord)"
    />
    <div v-else-if="isEmpty" class="flashcard-review-face__empty" aria-label="Empty face" />
    <div v-else class="flashcard-review-face__missing">
      <v-icon icon="mdi-card-off-outline" size="2rem" />
      <span>{{ missingLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.flashcard-review-face { position: relative; display: flex; width: 100%; min-width: 0; min-height: 0; height: 100%; align-items: center; justify-content: center; }
.flashcard-review-face__text { position: absolute; display: flex; inset: 0; width: 100%; height: 100%; min-height: 0; max-height: 100%; align-items: center; align-self: stretch; justify-content: center; flex-direction: column; }
.flashcard-review-face--image { overflow: hidden; }
.flashcard-review-face__image { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.flashcard-review-face--dense .flashcard-review-face__image { max-height: 8rem; }
.flashcard-review-face__empty { width: 100%; height: 100%; }
.flashcard-review-face__missing { display: flex; max-width: 18rem; align-items: center; justify-content: center; flex-direction: column; gap: .5rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .8125rem; font-weight: 700; text-align: center; }
</style>
