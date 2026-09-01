<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmojiSelector from '@/components/EmojiSelector.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import IntervalSettingsFields from '@/components/IntervalSettingsFields.vue'
import { contentRetirementActions, type ContentRetirementActionId } from '@/services/contentRetirementActions'
import {
  cloneIntervalTemplateDraft,
  duplicateIntervalTemplateDraft,
  validateIntervalDefinition,
} from '@/services/intervals'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplateDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const flashcardStore = useFlashcardStore()
const form = ref()
const saving = ref(false)
const archiving = ref(false)
const deleting = ref(false)
const archiveDialog = ref(false)
const archiveActions = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const ready = ref(false)
const original = ref('')
const isEditing = computed(() => Boolean(route.params.id))
const retirementActions = contentRetirementActions(
  'interval',
  'Hide it from your interval plans while keeping its settings and run history.',
  'Permanently remove the reusable interval. Completed runs remain in history.',
)

const draft = reactive<IntervalTemplateDraft>({
  name: '',
  description: '',
  icon: '',
  color: '#C7F464',
  flashcardReviewSet: undefined,
  definition: {
    version: 1,
    children: [],
  },
  cues: { soundEnabled: true, vibrationEnabled: true },
  sortOrder: 0,
  archived: false,
})

const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(
  reviewSet => reviewSet.id === draft.flashcardReviewSet,
))
const availableReviewSets = computed(() => flashcardStore.reviewSets.filter(
  reviewSet => !reviewSet.archived || reviewSet.id === draft.flashcardReviewSet,
))
const signature = computed(() => JSON.stringify(draft))
const changed = computed(() => ready.value && signature.value !== original.value)

async function markFormReady() {
  await nextTick()
  original.value = signature.value
  ready.value = true
}

onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.load(),
    flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
  ])
  const duplicateTemplateId = typeof route.query.duplicate === 'string'
    ? route.query.duplicate
    : ''
  if (!route.params.id && !duplicateTemplateId) {
    draft.sortOrder = store.templates.length
    await markFormReady()
    return
  }
  const templateId = typeof route.params.id === 'string'
    ? route.params.id
    : duplicateTemplateId
  const template = store.templates.find((item) => item.id === templateId)
  if (!template) {
    error.value = 'That interval template could not be found.'
    await markFormReady()
    return
  }
  Object.assign(
    draft,
    duplicateTemplateId
      ? duplicateIntervalTemplateDraft(template, store.templates.length)
      : cloneIntervalTemplateDraft(template),
  )
  await markFormReady()
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  const definitionErrors = validateIntervalDefinition(draft.definition)
  if (definitionErrors.length) {
    error.value = definitionErrors[0] || 'Check the interval sequence.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTemplate(draft)
    await router.replace('/intervals')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the interval.'
  } finally {
    saving.value = false
  }
}

async function removeTemplate() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.deleteTemplate(draft.id)
    await router.replace('/intervals')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete the interval.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}

async function setTemplateArchived() {
  if (!draft.id) return
  archiving.value = true
  error.value = ''
  try {
    await store.setTemplateArchived(draft.id, !draft.archived)
    archiveDialog.value = false
    archiveActions.value = false
    await router.replace('/intervals')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `Could not ${draft.archived ? 'restore' : 'archive'} the interval.`
    archiveDialog.value = false
  } finally {
    archiving.value = false
  }
}

function openRetirementActions() {
  if (draft.archived) archiveDialog.value = true
  else archiveActions.value = true
}

function runRetirementAction(action: ContentRetirementActionId) {
  archiveActions.value = false
  if (action === 'archive') void setTemplateArchived()
  else deleteDialog.value = true
}
</script>

<template>
  <main class="app-page interval-editor">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
      <div class="interval-form-cards">
      <v-card class="surface-card pa-5">
        <div class="field-stack">
          <v-text-field v-model="draft.name" label="Template name" :rules="[value => Boolean(value) || 'Name is required']" />
        </div>
        <EmojiSelector
          v-model="draft.icon"
          label="Interval icon"
          dialog-title="Choose an icon"
          class="mt-4"
        />
        <ColorSwatchPicker
          v-model="draft.color"
          label="Template color"
          custom-label="Choose a custom interval template color"
          class="mt-4"
        />
      </v-card>

      </div>

      <IntervalSettingsFields
        v-model:definition="draft.definition"
        v-model:cues="draft.cues"
        v-model:review-set="draft.flashcardReviewSet"
        :review-sets="availableReviewSets"
        allow-review-set-create
        :review-set-speech-enabled="selectedReviewSet?.speechEnabled === true"
        class="mt-4"
      />
    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :has-changes="changed"
      :show-archive="isEditing"
      :archived="draft.archived"
      :archive-label="draft.archived ? 'Restore interval' : 'Archive interval'"
      :archive-disabled="archiving || deleting"
      @submit="save"
      @cancel="router.back()"
      @archive="openRetirementActions"
    />

    <ActionBottomSheet
      v-model="archiveActions"
      title="Archive or delete?"
      :description="`Choose what to do with ${draft.name || 'this interval'}.`"
      aria-label="Archive or permanently delete interval"
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
      v-model="archiveDialog"
      title="Restore this interval?"
      message="This interval will return to your interval plans with its previous settings."
      confirm-text="Restore interval"
      confirm-color="secondary"
      icon="mdi-archive-arrow-up-outline"
      :loading="archiving"
      @confirm="setTemplateArchived"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this interval permanently?"
      message="The reusable interval will be permanently removed. Completed session history will remain. This cannot be undone."
      confirm-text="Delete permanently"
      icon="mdi-delete-forever-outline"
      :loading="deleting"
      @confirm="removeTemplate"
    />
  </main>
</template>

<style scoped>
.interval-editor { padding-bottom: 6rem; }
.interval-form-cards { display: grid; gap: 1rem; }
.field-stack { display: grid; gap: 1rem; }
</style>
