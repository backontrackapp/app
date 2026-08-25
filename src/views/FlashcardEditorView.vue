<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardAudioSection from '@/components/FlashcardAudioSection.vue'
import FlashcardDuplicateDialog from '@/components/FlashcardDuplicateDialog.vue'
import FlashcardImageField from '@/components/FlashcardImageField.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import { contentRetirementActions, type ContentRetirementActionId } from '@/services/contentRetirementActions'
import { findDuplicateFlashcard } from '@/services/flashcardDuplicates'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  Flashcard,
  FlashcardAudioValue,
  FlashcardDraft,
  FlashcardDuplicateResolution,
  SquareImageSourceValue,
} from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const form = ref()
const frontField = ref()
const loading = ref(true)
const ready = ref(false)
const saving = ref(false)
const archiving = ref(false)
const deleting = ref(false)
const archiveActions = ref(false)
const archiveDialog = ref(false)
const deleteDialog = ref(false)
const navigationDialog = ref(false)
const duplicateDialog = ref(false)
const duplicateCard = ref<Flashcard>()
const pendingNavigationId = ref('')
const navigating = ref(false)
const error = ref('')
const archived = ref(false)
const original = ref('')
const draft = reactive<FlashcardDraft>({ front: '', back: '', transliteration: '', note: '', tags: [] })
const frontAudio = ref<FlashcardAudioValue>(emptyAudio())
const backAudio = ref<FlashcardAudioValue>(emptyAudio())
const image = ref<SquareImageSourceValue>(emptyImage())
const frontAudioRecording = ref(false)
const backAudioRecording = ref(false)
const navigationCardIds = ref(readNavigationCardIds())

const cardId = ref(typeof route.params.id === 'string' ? route.params.id : '')
const reviewSetId = computed(() => typeof route.params.reviewSetId === 'string' ? route.params.reviewSetId : '')
const isReviewSetCard = computed(() => Boolean(reviewSetId.value))
const isEditing = computed(() => Boolean(cardId.value))
const navigationIndex = computed(() => navigationCardIds.value.indexOf(cardId.value))
const showNavigator = computed(() => isEditing.value && navigationIndex.value >= 0)
const previousCardId = computed(() => navigationIndex.value > 0
  ? navigationCardIds.value[navigationIndex.value - 1] || ''
  : '')
const nextCardId = computed(() => (
  navigationIndex.value >= 0 && navigationIndex.value < navigationCardIds.value.length - 1
    ? navigationCardIds.value[navigationIndex.value + 1] || ''
    : ''
))
const returnTo = computed(() => typeof route.query.returnTo === 'string'
  && route.query.returnTo.startsWith('/')
  && !route.query.returnTo.startsWith('//')
  ? route.query.returnTo
  : '')
const signature = computed(() => JSON.stringify({
  front: draft.front,
  back: draft.back,
  transliteration: draft.transliteration,
  note: draft.note,
  tags: draft.tags,
  frontAudio: frontAudio.value.url,
  backAudio: backAudio.value.url,
  imageSource: image.value.source,
  imageUrl: image.value.url,
  imageUpload: image.value.upload ? `${image.value.upload.size}:${image.value.upload.type}` : '',
}))
const changed = computed(() => ready.value && signature.value !== original.value)
const canSave = computed(() => (
  ready.value
  && !saving.value
  && !frontAudioRecording.value
  && !backAudioRecording.value
  && changed.value
  && Boolean(draft.front.trim())
  && Boolean(draft.back.trim())
))
const retirementActions = contentRetirementActions(
  'flashcard',
  'Hide it from your card library and future reviews while keeping its history.',
  'Permanently remove it from the library and every Review set it matches.',
)

function focusFrontWithoutScrolling() {
  if (!allowAutomaticFocus) return
  const fieldElement = frontField.value?.$el
  const textarea = fieldElement instanceof HTMLTextAreaElement
    ? fieldElement
    : fieldElement?.querySelector?.('textarea')
  textarea?.focus({ preventScroll: true })
}

function scrollToFormTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: reduceMotion ? 'auto' : 'smooth',
  })
}

function readNavigationCardIds() {
  const ids = window.history.state?.flashcardNavigationIds
  return Array.isArray(ids) && ids.every(id => typeof id === 'string')
    ? [...new Set(ids)]
    : []
}

async function loadEditor() {
  const initialLoad = !ready.value
  if (initialLoad) loading.value = true
  error.value = ''
  try {
    if (!store.loaded) await store.load()
    if (isReviewSetCard.value) {
      const reviewSet = store.reviewSets.find(item => item.id === reviewSetId.value)
      if (!reviewSet || reviewSet.accessRole === 'readonly') {
        throw new Error('Editor access is required to change these cards.')
      }
      if (!store.reviewSetCards[reviewSetId.value]) {
        await store.loadReviewSetCards(reviewSetId.value)
      }
    }
    if (isEditing.value) {
      const cards = isReviewSetCard.value
        ? store.reviewSetCards[reviewSetId.value] || []
        : store.cards
      const card = cards.find(item => item.id === cardId.value)
      if (!card) throw new Error('That flashcard could not be found.')
      if (!navigationCardIds.value.length) navigationCardIds.value = cards.map(item => item.id)
      applyCard(card)
    } else {
      Object.assign(draft, {
        id: undefined,
        front: '',
        back: '',
        transliteration: '',
        note: '',
        tags: [],
      })
      frontAudio.value = emptyAudio()
      backAudio.value = emptyAudio()
      image.value = emptyImage()
      archived.value = false
    }
    original.value = signature.value
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
  } finally {
    if (initialLoad) loading.value = false
  }
}

onMounted(loadEditor)

function emptyAudio(): FlashcardAudioValue {
  return { url: '', existingUrl: '' }
}

function emptyImage(): SquareImageSourceValue {
  return { source: 'none', url: '', existingUrl: '', existingSource: 'none' }
}

function existingAudio(url: string): FlashcardAudioValue {
  return { url, existingUrl: url }
}

function applyCard(card: typeof store.cards[number]) {
  Object.assign(draft, {
    id: card.id,
    front: card.front,
    back: card.back,
    transliteration: card.transliteration || '',
    note: card.note,
    tags: [...card.tags],
  })
  frontAudio.value = existingAudio(card.frontAudio || '')
  backAudio.value = existingAudio(card.backAudio || '')
  image.value = {
    source: card.imageSource,
    url: card.imageSource === 'url' ? card.image : '',
    existingUrl: card.image,
    existingSource: card.imageSource,
  }
  archived.value = card.archived === true
}

function setAudioRecording(side: 'front' | 'back', recording: boolean) {
  if (side === 'front') frontAudioRecording.value = recording
  else backAudioRecording.value = recording
}

function requestCardNavigation(targetId: string) {
  if (!targetId || navigating.value) return
  if (changed.value) {
    pendingNavigationId.value = targetId
    navigationDialog.value = true
    return
  }
  void navigateToCard(targetId)
}

async function navigateToCard(targetId: string) {
  if (!targetId) return
  navigating.value = true
  navigationDialog.value = false
  pendingNavigationId.value = ''
  error.value = ''
  try {
    const cards = isReviewSetCard.value
      ? store.reviewSetCards[reviewSetId.value] || []
      : store.cards
    const card = cards.find(item => item.id === targetId)
    if (!card) throw new Error('That flashcard could not be found.')
    cardId.value = targetId
    applyCard(card)
    original.value = signature.value
    await nextTick()
    form.value?.resetValidation()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
  } finally {
    navigating.value = false
  }
}

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  if (!isEditing.value) {
    const sourceCards = isReviewSetCard.value
      ? store.reviewSetCards[reviewSetId.value] || []
      : store.cards
    duplicateCard.value = findDuplicateFlashcard(sourceCards, draft.front)
    if (duplicateCard.value) {
      duplicateDialog.value = true
      return
    }
  }
  await persistCard({ action: 'duplicate', columns: [] })
}

async function resetNewCardForm() {
  const retainedTags = [...draft.tags]
  Object.assign(draft, {
    id: undefined,
    front: '',
    back: '',
    transliteration: '',
    note: '',
    tags: retainedTags,
  })
  frontAudio.value = emptyAudio()
  backAudio.value = emptyAudio()
  image.value = emptyImage()
  duplicateCard.value = undefined
  original.value = signature.value
  await nextTick()
  form.value?.resetValidation()
  focusFrontWithoutScrolling()
  scrollToFormTop()
}

async function persistCard(resolution: FlashcardDuplicateResolution) {
  duplicateDialog.value = false
  if (resolution.action === 'skip') {
    if (returnTo.value) await router.replace(returnTo.value)
    else await resetNewCardForm()
    return
  }
  saving.value = true
  error.value = ''
  try {
    const existing = resolution.action === 'duplicate' ? undefined : duplicateCard.value
    const replace = resolution.action === 'replace'
    const update = resolution.action === 'update'
    const cardDraft = {
      id: existing?.id || draft.id,
      front: existing && update ? existing.front : draft.front,
      back: existing && update && !resolution.columns.includes('back') ? existing.back : draft.back,
      transliteration: existing && update && !resolution.columns.includes('transliteration')
        ? existing.transliteration || ''
        : draft.transliteration || '',
      note: existing && update && !resolution.columns.includes('note') ? existing.note : draft.note,
      tags: existing && update && !resolution.columns.includes('tags')
        ? [...existing.tags]
        : draft.tags,
    }
    const resolvedImage = existing
      ? replace || resolution.columns.includes('image')
        ? { ...image.value, existingUrl: existing.image, existingSource: existing.imageSource }
        : undefined
      : image.value
    const resolvedAudio = existing
      ? replace
        ? {
            front: { ...frontAudio.value, existingUrl: existing.frontAudio || '' },
            back: { ...backAudio.value, existingUrl: existing.backAudio || '' },
          }
        : { front: existingAudio(existing.frontAudio || ''), back: existingAudio(existing.backAudio || '') }
      : { front: frontAudio.value, back: backAudio.value }
    if (isReviewSetCard.value) {
      await store.saveReviewSetCard(
        reviewSetId.value,
        cardDraft,
        resolvedImage,
        resolvedAudio,
      )
    } else {
      await store.saveCard(
        cardDraft,
        resolvedImage,
        resolvedAudio,
      )
    }
    if (isEditing.value || returnTo.value) {
      await router.replace(returnTo.value || (isReviewSetCard.value
        ? { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } }
        : { name: 'flashcard-cards' }))
      return
    }

    await resetNewCardForm()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this flashcard.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!cardId.value) return
  deleting.value = true
  error.value = ''
  try {
    if (isReviewSetCard.value) {
      await store.deleteReviewSetCard(reviewSetId.value, cardId.value)
    } else {
      await store.deleteCard(cardId.value)
    }
    deleteDialog.value = false
    await router.replace(returnTo.value || (isReviewSetCard.value
      ? { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } }
      : { name: 'flashcard-cards' }))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this flashcard.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}

async function setArchived() {
  if (!cardId.value) return
  archiving.value = true
  error.value = ''
  try {
    await store.setCardArchived(cardId.value, !archived.value, reviewSetId.value)
    archiveDialog.value = false
    archiveActions.value = false
    await router.replace(returnTo.value || (isReviewSetCard.value
      ? { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } }
      : { name: 'flashcard-cards' }))
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : `Could not ${archived.value ? 'restore' : 'archive'} this flashcard.`
    archiveDialog.value = false
  } finally {
    archiving.value = false
  }
}

function openRetirementActions() {
  if (archived.value) archiveDialog.value = true
  else archiveActions.value = true
}

function runRetirementAction(action: ContentRetirementActionId) {
  archiveActions.value = false
  if (action === 'archive') void setArchived()
  else deleteDialog.value = true
}
</script>

<template>
  <main
    class="app-page app-page--editor flashcard-editor-page"
    :class="{ 'flashcard-editor-page--with-navigation': showNavigator }"
  >
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div v-if="loading" class="flashcard-editor-loading py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading flashcard…</span>
    </div>

    <AppForm v-if="ready" ref="form" @submit.prevent="save">
      <v-card class="surface-card pa-5">
        <div class="flashcard-editor-fields">
          <v-textarea
            ref="frontField"
            v-model="draft.front"
            rows="4"
            auto-grow
            maxlength="5000"
            counter
            autocomplete="off"
            :autofocus="allowAutomaticFocus"
            :rules="[value => Boolean(value?.trim()) || 'Front is required']"
          >
            <template #label>Front <span class="required-mark">*</span></template>
          </v-textarea>
          <v-textarea
            v-model="draft.back"
            rows="5"
            auto-grow
            maxlength="5000"
            counter
            autocomplete="off"
            :rules="[value => Boolean(value?.trim()) || 'Back is required']"
          >
            <template #label>Back <span class="required-mark">*</span></template>
          </v-textarea>
          <v-textarea
            v-model="draft.transliteration"
            label="Transliteration"
            rows="2"
            auto-grow
            maxlength="5000"
            counter
            autocomplete="off"
          />
          <v-textarea
            v-model="draft.note"
            label="Note"
            hint="Shown as a subtitle beneath the back during reviews"
            rows="2"
            auto-grow
            maxlength="2000"
            counter
            autocomplete="off"
          />
          <FlashcardTagCombobox v-if="!isReviewSetCard" v-model="draft.tags" />
          <v-alert v-else type="info" variant="tonal" density="compact">
            Card tags are controlled by the Review set owner so this card stays in the live set.
          </v-alert>
          <FlashcardImageField v-model="image" :loading="saving" @error="error = $event" />
          <FlashcardAudioSection
            v-model:front="frontAudio"
            v-model:back="backAudio"
            :disabled="saving"
            @recording-change="setAudioRecording"
            @error="error = $event"
          />
        </div>
      </v-card>
    </AppForm>

    <FormActionBar
      v-if="ready"
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :has-changes="changed"
      :show-archive="isEditing"
      :archived="archived"
      :archive-label="archived ? 'Restore flashcard' : 'Archive flashcard'"
      :archive-disabled="archiving || deleting"
      @submit="save"
      @cancel="router.back()"
      @archive="openRetirementActions"
    >
      <template v-if="showNavigator" #below>
        <nav class="flashcard-editor-navigator" aria-label="Card editor navigation">
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            aria-label="Previous card"
            :disabled="!previousCardId || navigating"
            @click="requestCardNavigation(previousCardId)"
          />
          <span class="text-body-2 font-weight-bold" aria-live="polite">
            {{ navigationIndex + 1 }} of {{ navigationCardIds.length }}
          </span>
          <v-btn
            icon="mdi-chevron-right"
            variant="text"
            aria-label="Next card"
            :disabled="!nextCardId || navigating"
            @click="requestCardNavigation(nextCardId)"
          />
        </nav>
      </template>
    </FormActionBar>

    <ConfirmDialog
      v-model="navigationDialog"
      title="Discard changes?"
      message="Your unsaved changes will be lost when you open another card."
      confirm-text="Discard and continue"
      confirm-color="warning"
      @confirm="navigateToCard(pendingNavigationId)"
    />

    <FlashcardDuplicateDialog
      v-if="duplicateDialog"
      v-model="duplicateDialog"
      :front="draft.front"
      :loading="saving"
      :tags-available="!isReviewSetCard"
      @resolve="persistCard"
    />

    <ConfirmDialog
      v-model="archiveDialog"
      title="Restore this flashcard?"
      message="This card will return to your card library and matching Review sets, and can be used in future reviews."
      confirm-text="Restore flashcard"
      confirm-color="secondary"
      icon="mdi-archive-arrow-up-outline"
      :loading="archiving"
      @confirm="setArchived"
    />

    <ActionBottomSheet
      v-model="archiveActions"
      title="Archive or delete?"
      :description="`Choose what to do with ${draft.front || 'this flashcard'}.`"
      aria-label="Archive or permanently delete flashcard"
    >
      <template v-for="action in retirementActions" :key="action.id">
        <v-divider v-if="'divider' in action && action.divider" class="my-1" />
        <v-list-item
          :prepend-icon="action.icon"
          :title="action.title"
          :subtitle="action.subtitle"
          :base-color="action.color"
          rounded="lg"
          :disabled="archiving || deleting"
          @click="runRetirementAction(action.id)"
        />
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this flashcard permanently?"
      :message="isReviewSetCard
        ? 'This removes the owner’s source card from their library and every Review set it matches. Existing review history keeps its saved front and back.'
        : 'The card will be removed from future reviews. Existing review history keeps its saved front and back.'"
      confirm-text="Delete permanently"
      icon="mdi-delete-forever-outline"
      :loading="deleting"
      @confirm="remove"
    />
  </main>
</template>

<style scoped>
.flashcard-editor-fields { display: grid; gap: 1rem; }
.flashcard-editor-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.flashcard-editor-navigator { display: flex; min-height: 2.75rem; align-items: center; justify-content: space-between; gap: .5rem; }
.flashcard-editor-navigator .v-btn { width: 2.75rem; min-width: 2.75rem; min-height: 2.75rem; }
.flashcard-editor-page--with-navigation { padding-bottom: 10.5rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
</style>
