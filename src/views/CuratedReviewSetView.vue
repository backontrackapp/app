<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import FlashcardDuplicateDialog from '@/components/FlashcardDuplicateDialog.vue'
import { api } from '@/lib/api'
import {
  curatedCards,
  curatedReviewSettings,
  preferredCuratedContentLanguage,
} from '@/services/curatedReviewSets'
import { countFlashcardImportDuplicates } from '@/services/flashcardDuplicates'
import {
  loadFlashcardSpeechSupport,
  normalizeSpeechLanguage,
  speechLanguageOptions,
} from '@/services/flashcardSpeech'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  CuratedLanguageOption,
  CuratedReviewSetDetail,
  Flashcard,
  FlashcardDuplicateResolution,
  FlashcardReviewSet,
  FlashcardSpeechLanguage,
} from '@/types/domain'

type CloneDestination =
  | { type: 'new'; name: string }
  | { type: 'existing'; reviewSetId: string }

interface PendingCuratedClone {
  cards: Flashcard[]
  destination: CloneDestination
  resolve: (reviewSet: FlashcardReviewSet) => void
  reject: (cause: unknown) => void
}

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const detail = ref<CuratedReviewSetDetail>()
const frontLanguage = ref('')
const backLanguage = ref('')
const speechLanguages = ref<FlashcardSpeechLanguage[]>([])
const loading = ref(true)
const cloning = ref(false)
const duplicateDialog = ref(false)
const duplicateCount = ref(0)
const error = ref('')
let pendingClone: PendingCuratedClone | undefined
const cards = computed(() => detail.value
  ? curatedCards(detail.value, frontLanguage.value, backLanguage.value)
  : [])
const settings = computed(() => detail.value
  ? curatedReviewSettings(
      detail.value,
      frontLanguage.value,
      backLanguage.value,
      speechLanguages.value,
    )
  : undefined)
const frontLanguageOptions = computed(() => humanReadableLanguageOptions(detail.value?.frontLanguages || []))
const backLanguageOptions = computed(() => humanReadableLanguageOptions(detail.value?.backLanguages || []))

function humanReadableLanguageOptions(options: CuratedLanguageOption[]) {
  const titles = new Map(speechLanguageOptions(options.map(option => option.value))
    .map(option => [normalizeSpeechLanguage(option.tag), option.title]))
  return options.map(option => ({
    ...option,
    title: option.value
      ? titles.get(normalizeSpeechLanguage(option.value)) || option.title
      : option.title,
  }))
}

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [result, , speechSupport] = await Promise.all([
      api.getCuratedReviewSet(String(route.params.slug || '')),
      store.loaded ? Promise.resolve() : store.load(),
      loadFlashcardSpeechSupport(),
    ])
    detail.value = result
    speechLanguages.value = speechSupport.languages
    frontLanguage.value = preferredCuratedContentLanguage(
      result.frontLanguages,
      result.defaultFrontLanguage,
      speechSupport.languages,
    )
    backLanguage.value = preferredCuratedContentLanguage(
      result.backLanguages,
      result.defaultBackLanguage,
      speechSupport.languages,
    )
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load this curated Review set.'
  } finally {
    loading.value = false
  }
}

async function cloneCards(
  selected: Flashcard[],
  destination: CloneDestination,
) {
  if (!settings.value) throw new Error('Curated Review settings are unavailable.')
  if (!detail.value) throw new Error('Curated Review set details are unavailable.')
  const conflicts = countFlashcardImportDuplicates(selected, store.cards)
  if (!conflicts) {
    return performCloneCards(selected, destination, { action: 'duplicate', columns: [] })
  }
  duplicateCount.value = conflicts
  duplicateDialog.value = true
  return new Promise<FlashcardReviewSet>((resolve, reject) => {
    pendingClone = { cards: selected, destination, resolve, reject }
  })
}

async function performCloneCards(
  selected: Flashcard[],
  destination: CloneDestination,
  resolution: FlashcardDuplicateResolution,
) {
  if (!settings.value || !detail.value) {
    throw new Error('Curated Review set details are unavailable.')
  }
  cloning.value = true
  try {
    return await store.cloneCuratedCards(selected, destination, settings.value, {
      frontLanguage: frontLanguage.value,
      backLanguage: backLanguage.value,
      category: detail.value.category,
    }, resolution)
  } finally {
    cloning.value = false
  }
}

async function resolveDuplicateClone(resolution: FlashcardDuplicateResolution) {
  const pending = pendingClone
  if (!pending) return
  duplicateDialog.value = false
  try {
    pending.resolve(await performCloneCards(pending.cards, pending.destination, resolution))
  } catch (cause) {
    pending.reject(cause)
  } finally {
    pendingClone = undefined
  }
}

function setDuplicateDialog(open: boolean) {
  duplicateDialog.value = open
  if (open || !pendingClone || cloning.value) return
  const canceled = new Error('Curated clone canceled.')
  canceled.name = 'AbortError'
  pendingClone.reject(canceled)
  pendingClone = undefined
}

async function cloneAll() {
  if (!detail.value || !settings.value || cloning.value || duplicateDialog.value) return
  error.value = ''
  try {
    const reviewSet = await cloneCards(cards.value, { type: 'new', name: detail.value.name })
    await router.push({ name: 'flashcard-review-set-edit', params: { id: reviewSet.id } })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') return
    error.value = cause instanceof Error ? cause.message : 'Could not clone this curated Review set.'
  }
}
</script>

<template>
  <main class="app-page curated-detail-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div v-if="loading" class="d-flex justify-center align-center ga-3 py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="muted">Loading curated cards…</span>
    </div>
    <template v-else-if="detail">
      <section class="curated-detail-hero">
        <div class="curated-detail-hero__copy">
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            <v-chip color="secondary" variant="tonal" size="small">{{ detail.category }}</v-chip>
            <span class="text-caption muted">{{ cards.length }} cards · free</span>
          </div>
          <h1>{{ detail.name }}</h1>
          <p>{{ detail.description }}</p>
        </div>
        <v-btn color="secondary" size="large" prepend-icon="mdi-content-copy" :loading="cloning" :disabled="duplicateDialog" @click="cloneAll">
          Clone Review set
        </v-btn>
      </section>

      <v-card class="surface-card pa-4 mb-6">
        <div class="language-grid">
          <v-select
            v-model="frontLanguage"
            :items="frontLanguageOptions"
            item-title="title"
            item-value="value"
            label="Front language"
            hide-details="auto"
          />
          <v-select
            v-model="backLanguage"
            :items="backLanguageOptions"
            item-title="title"
            item-value="value"
            label="Back language"
            hide-details="auto"
          />
          <div class="language-note">
            <v-icon icon="mdi-translate" color="secondary" />
            <span>Notes and transliteration follow the back language, with default-column fallback.</span>
          </div>
        </div>
      </v-card>

      <section>
        <div class="section-heading mt-0">
          <div>
            <h2>Cards in this set</h2>
            <p class="text-caption muted mt-1">Select individual cards and use Bulk to create or extend a custom Review set.</p>
          </div>
        </div>
        <FlashcardCardsManager
          :cards="cards"
          :tags="[]"
          selectable
          :interactive="false"
          :can-add="false"
          :show-action-column="false"
          :bulk-actions="['inject_into_review_set']"
          :review-set-from-cards-handler="cloneCards"
          :default-review-set-name="detail.name"
          empty-title="This curated set has no cards"
          empty-description="The source CSV is empty."
        />
      </section>

      <FlashcardDuplicateDialog
        v-if="duplicateDialog"
        :model-value="duplicateDialog"
        :duplicate-count="duplicateCount"
        :loading="cloning"
        @update:model-value="setDuplicateDialog"
        @resolve="resolveDuplicateClone"
      />
    </template>
  </main>
</template>

<style scoped>
.curated-detail-hero { display: flex; margin-bottom: 1.25rem; align-items: flex-end; justify-content: space-between; gap: 1.5rem; }
.curated-detail-hero__copy { max-width: 46rem; }
.curated-detail-hero h1 { font-size: clamp(1.7rem, 4vw, 2.45rem); font-weight: 950; letter-spacing: -.03em; }
.curated-detail-hero p { margin-top: .5rem; color: rgba(var(--v-theme-on-surface), .68); }
.language-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(14rem, 1.15fr); align-items: center; gap: .75rem; }
.language-note { display: flex; color: rgba(var(--v-theme-on-surface), .64); font-size: .76rem; line-height: 1.4; align-items: center; gap: .65rem; }
@media (max-width: 50rem) { .language-grid { grid-template-columns: 1fr 1fr; } .language-note { grid-column: 1 / -1; } }
@media (max-width: 35rem) { .curated-detail-hero { align-items: stretch; flex-direction: column; } .language-grid { grid-template-columns: 1fr; } .language-note { grid-column: auto; } }
</style>
