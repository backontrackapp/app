<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { format, isToday, isValid, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ContentIcon from '@/components/ContentIcon.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import JournalImageField from '@/components/JournalImageField.vue'
import { contentRetirementActions, type ContentRetirementActionId } from '@/services/contentRetirementActions'
import { squareImageSourceSignature } from '@/services/avatarImage'
import { mobileKeyboardVisible } from '@/services/mobileKeyboardViewport'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { JournalEntry, SquareImageSourceValue } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const journalStore = useJournalStore()
const taskStore = useTaskStore()
const trackingStore = useTrackingStore()
const entryId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const isEditing = computed(() => Boolean(entryId.value))
const platform = Capacitor.getPlatform()
const allowAutomaticFocus = platform !== 'android'
const supportsFullscreenReflection = platform === 'android' || platform === 'ios'
const form = ref()
const reflectionSlot = ref<HTMLElement>()
const reflectionEditor = ref<HTMLElement>()
const reflectionFullscreen = ref(false)
const reflectionExpanded = ref(false)
const title = ref('')
const body = ref('')
const color = ref('#C7F464')
const image = ref<SquareImageSourceValue>(reflectionImageValue())
const occurredLocal = ref('')
const task = ref<string>()
const trackers = ref<string[]>([])
const loading = ref(isEditing.value)
const saving = ref(false)
const archiving = ref(false)
const deleting = ref(false)
const archived = ref(false)
const archiveDialog = ref(false)
const archiveActions = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const original = ref('')
const retirementActions = contentRetirementActions(
  'reflection',
  'Hide it from your journal timeline while preserving its content and connections.',
  'Permanently remove the reflection. Its linked task and trackers are not affected.',
)
let reflectionAnimationFrame: number | undefined
let reflectionTransitionTimer: number | undefined

const taskItems = computed(() => [...taskStore.tasks]
  .filter(item => !item.archived || (isEditing.value && item.id === task.value))
  .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
  .map(item => ({
    title: item.name,
    value: item.id,
    props: {
      subtitle: [
        item.archived ? 'Archived task' : '',
        item.type === 'journal' ? 'Writing completes this task' : '',
        item.active || item.archived ? '' : 'Paused task',
      ].filter(Boolean).join(' · ') || undefined,
    },
  })))
const selectedTask = computed(() => taskStore.tasks.find(item => item.id === task.value))
const completesJournalTask = computed(() => selectedTask.value?.type === 'journal')
const trackerItems = computed(() => [...trackingStore.trackers]
  .filter(item => !item.archived || (isEditing.value && trackers.value.includes(item.id)))
  .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
  .map(item => ({
    title: item.name,
    value: item.id,
    icon: item.icon,
    props: {
      subtitle: item.archived ? 'Archived tracker' : item.active ? undefined : 'Paused tracker',
    },
  })))
const signature = computed(() => JSON.stringify({
  title: title.value,
  body: body.value,
  color: color.value,
  image: squareImageSourceSignature(image.value),
  occurredLocal: occurredLocal.value,
  task: task.value || '',
  trackers: trackers.value,
}))
const changed = computed(() => !loading.value && signature.value !== original.value)
const canSave = computed(() =>
  Boolean(body.value.trim() && occurredLocal.value)
  && changed.value
  && !saving.value,
)

function defaultOccurredLocal() {
  const queryDate = typeof route.query.date === 'string' ? parseISO(route.query.date) : undefined
  const date = queryDate && isValid(queryDate) ? new Date(queryDate) : new Date()
  if (!isToday(date)) date.setHours(12, 0, 0, 0)
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

function reflectionImageValue(existingUrl = ''): SquareImageSourceValue {
  const source = existingUrl ? 'upload' : 'none'
  return {
    source,
    url: '',
    existingUrl,
    existingSource: source,
  }
}

function destinationQuery() {
  const date = occurredLocal.value ? format(new Date(occurredLocal.value), 'yyyy-MM-dd') : undefined
  return {
    ...(date ? { date } : {}),
    ...(typeof route.query.task === 'string' ? { task: route.query.task } : {}),
    ...(typeof route.query.tracker === 'string' ? { tracker: route.query.tracker } : {}),
  }
}

function destinationRoute() {
  return route.query.from === 'tasks'
    ? { name: 'tasks' as const }
    : { name: 'journal' as const, query: destinationQuery() }
}

function applyEntry(entry: JournalEntry) {
  title.value = entry.title
  body.value = entry.body
  color.value = entry.color || '#C7F464'
  image.value = reflectionImageValue(entry.image)
  occurredLocal.value = format(new Date(entry.occurredAt), "yyyy-MM-dd'T'HH:mm")
  task.value = entry.task
  trackers.value = [...entry.trackers]
  archived.value = entry.archived === true
  original.value = signature.value
}

function initializeNewEntry() {
  occurredLocal.value = defaultOccurredLocal()
  task.value = typeof route.query.task === 'string' ? route.query.task : undefined
  trackers.value = typeof route.query.tracker === 'string' ? [route.query.tracker] : []
  original.value = signature.value
}

async function loadEntry() {
  error.value = ''
  try {
    applyEntry(await journalStore.getEntry(entryId.value))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this reflection.'
  } finally {
    loading.value = false
  }
}

function loadContextOptions() {
  return Promise.allSettled([
    taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ])
}

function removeArchivedNewConnections() {
  if (isEditing.value) return
  if (taskStore.tasks.find(item => item.id === task.value)?.archived) task.value = undefined
  const archivedTrackerIds = new Set(
    trackingStore.trackers.filter(item => item.archived).map(item => item.id),
  )
  trackers.value = trackers.value.filter(id => !archivedTrackerIds.has(id))
}

if (isEditing.value) {
  const cachedEntry = journalStore.entries.find(entry => entry.id === entryId.value)
  if (cachedEntry) {
    applyEntry(cachedEntry)
    loading.value = false
  }
} else {
  initializeNewEntry()
}

onMounted(() => {
  void loadContextOptions().then(removeArchivedNewConnections)
  if (isEditing.value && loading.value) void loadEntry()
})

function clearReflectionAnimation() {
  if (reflectionAnimationFrame !== undefined) {
    window.cancelAnimationFrame(reflectionAnimationFrame)
    reflectionAnimationFrame = undefined
  }
  if (reflectionTransitionTimer !== undefined) {
    window.clearTimeout(reflectionTransitionTimer)
    reflectionTransitionTimer = undefined
  }
}

function setReflectionClipBounds(bounds: DOMRect) {
  const editor = reflectionEditor.value
  if (!editor) return
  const viewport = window.visualViewport
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportWidth = viewport?.width ?? window.innerWidth
  const viewportHeight = viewport?.height ?? window.innerHeight
  const top = Math.max(0, Math.min(viewportHeight, bounds.top - viewportTop))
  const right = Math.max(0, Math.min(viewportWidth, viewportLeft + viewportWidth - bounds.right))
  const bottom = Math.max(0, Math.min(viewportHeight, viewportTop + viewportHeight - bounds.bottom))
  const left = Math.max(0, Math.min(viewportWidth, bounds.left - viewportLeft))

  editor.style.setProperty('--reflection-clip-top', `${top}px`)
  editor.style.setProperty('--reflection-clip-right', `${right}px`)
  editor.style.setProperty('--reflection-clip-bottom', `${bottom}px`)
  editor.style.setProperty('--reflection-clip-left', `${left}px`)
}

function finishReflectionCollapse() {
  reflectionFullscreen.value = false
  reflectionExpanded.value = false
  reflectionSlot.value?.style.removeProperty('min-height')
  document.documentElement.classList.remove('journal-reflection-fullscreen')
}

function expandReflection() {
  if (!supportsFullscreenReflection || reflectionFullscreen.value) return
  const editor = reflectionEditor.value
  const slot = reflectionSlot.value
  if (!editor || !slot) return

  clearReflectionAnimation()
  const bounds = editor.getBoundingClientRect()
  slot.style.minHeight = `${bounds.height}px`
  setReflectionClipBounds(bounds)
  reflectionFullscreen.value = true
  document.documentElement.classList.add('journal-reflection-fullscreen')

  void nextTick(() => {
    reflectionAnimationFrame = window.requestAnimationFrame(() => {
      reflectionAnimationFrame = window.requestAnimationFrame(() => {
        reflectionAnimationFrame = undefined
        reflectionExpanded.value = true
      })
    })
  })
}

function collapseReflection() {
  if (!reflectionFullscreen.value) return
  clearReflectionAnimation()
  const targetBounds = reflectionSlot.value?.getBoundingClientRect()
  if (targetBounds) setReflectionClipBounds(targetBounds)
  reflectionExpanded.value = false

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (reduceMotion) {
    finishReflectionCollapse()
    return
  }
  reflectionTransitionTimer = window.setTimeout(finishReflectionCollapse, 220)
}

watch(mobileKeyboardVisible, (visible, wasVisible) => {
  if (visible || !wasVisible || !reflectionFullscreen.value) return
  const textarea = reflectionEditor.value?.querySelector('textarea')
  if (document.activeElement === textarea) textarea.blur()
  else collapseReflection()
})

onBeforeUnmount(() => {
  clearReflectionAnimation()
  document.documentElement.classList.remove('journal-reflection-fullscreen')
})

async function save() {
  const validation = await form.value?.validate()
  if (!validation?.valid || !canSave.value) return
  const occurred = new Date(occurredLocal.value)
  saving.value = true
  error.value = ''
  try {
    await journalStore.saveEntry({
      id: entryId.value || undefined,
      title: title.value,
      body: body.value,
      color: color.value,
      occurredAt: occurred.toISOString(),
      localDate: format(occurred, 'yyyy-MM-dd'),
      timezoneOffset: occurred.getTimezoneOffset(),
      task: task.value,
      trackers: trackers.value,
    }, image.value)
    await router.replace(destinationRoute())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this reflection.'
  } finally {
    saving.value = false
  }
}

async function removeEntry() {
  if (!entryId.value) return
  deleting.value = true
  error.value = ''
  try {
    await journalStore.deleteEntry(entryId.value)
    deleteDialog.value = false
    await router.replace(destinationRoute())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this reflection.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}

async function setArchived() {
  if (!entryId.value) return
  archiving.value = true
  error.value = ''
  try {
    await journalStore.setEntryArchived(entryId.value, !archived.value)
    archiveDialog.value = false
    archiveActions.value = false
    await router.replace(destinationRoute())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `Could not ${archived.value ? 'restore' : 'archive'} this reflection.`
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
  <main class="app-page app-page--editor journal-editor-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loading" class="d-flex align-center justify-center ga-3 py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading reflection…</span>
    </div>

    <AppForm v-else ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div class="journal-editor-fields">
          <div ref="reflectionSlot" class="journal-editor-reflection-slot">
            <div
              ref="reflectionEditor"
              class="journal-editor-reflection"
              :class="{
                'journal-editor-reflection--fullscreen': reflectionFullscreen,
                'journal-editor-reflection--expanded': reflectionExpanded,
              }"
              :data-keyboard-viewport-fill="reflectionFullscreen || undefined"
            >
              <p class="journal-editor-privacy mb-2">All posts remain 100% private.</p>
              <v-textarea
                v-model="body"
                rows="10"
                :auto-grow="!reflectionFullscreen"
                maxlength="20000"
                counter
                :autofocus="allowAutomaticFocus"
                :rules="[value => Boolean(value?.trim()) || 'Reflection is required']"
                @focus="expandReflection"
                @blur="collapseReflection"
              >
                <template #label>
                  Reflection <span class="required-mark">*</span>
                </template>
              </v-textarea>
            </div>
          </div>
          <v-text-field
            v-model="title"
            label="Title (optional)"
            maxlength="160"
            counter
          />
          <DateTimePickerField v-model="occurredLocal" label="When" />
          <ColorSwatchPicker
            v-model="color"
            label="Reflection color"
            custom-label="Choose a custom reflection color"
          />
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <JournalImageField
          v-model="image"
          :loading="saving"
          @error="error = $event"
        />
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <h2 class="text-body-1 font-weight-black">Connect this reflection</h2>
        <p class="text-body-2 muted mt-1 mb-4">
          {{ completesJournalTask
            ? `Saving this reflection completes ${selectedTask?.name || 'the journaling task'} for its date.`
            : 'Add context without changing task progress or tracking logs.' }}
        </p>
        <div class="journal-editor-context">
          <v-select
            v-model="task"
            label="Task (optional)"
            :items="taskItems"
            :loading="taskStore.loading && !taskItems.length"
            clearable
            variant="outlined"
            hide-details="auto"
          />
          <v-select
            v-model="trackers"
            label="Trackers (optional)"
            :items="trackerItems"
            :loading="trackingStore.loading && !trackerItems.length"
            clearable
            multiple
            chips
            closable-chips
            variant="outlined"
            hide-details="auto"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <ContentIcon :icon="item.raw.icon" size="1.125rem" class="mr-3" />
                </template>
              </v-list-item>
            </template>
            <template #chip="{ props: chipProps, item }">
              <v-chip v-bind="chipProps">
                <ContentIcon :icon="item.raw.icon" size=".875rem" class="mr-1" />
                {{ item.title }}
              </v-chip>
            </template>
          </v-select>
        </div>
      </v-card>
    </AppForm>

    <FormActionBar
      v-if="!loading"
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :has-changes="changed"
      :show-archive="isEditing"
      :archived="archived"
      :archive-label="archived ? 'Restore reflection' : 'Archive reflection'"
      :archive-disabled="archiving || deleting"
      @submit="save"
      @cancel="router.back()"
      @archive="openRetirementActions"
    />

    <ActionBottomSheet
      v-model="archiveActions"
      title="Archive or delete?"
      :description="`Choose what to do with ${title || 'this reflection'}.`"
      aria-label="Archive or permanently delete reflection"
    >
      <template v-for="action in retirementActions" :key="action.id">
        <v-divider v-if="'divider' in action && action.divider" class="my-1" />
        <v-list-item :prepend-icon="action.icon" :title="action.title" :subtitle="action.subtitle" :base-color="action.color" rounded="lg" :disabled="archiving || deleting" @click="runRetirementAction(action.id)" />
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="archiveDialog"
      title="Restore this reflection?"
      message="This reflection will return to its original place in your journal timeline."
      confirm-text="Restore reflection"
      confirm-color="secondary"
      icon="mdi-archive-arrow-up-outline"
      :loading="archiving"
      @confirm="setArchived"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this reflection permanently?"
      message="This permanently removes the journal entry. Its linked task and trackers are not affected. This cannot be undone."
      confirm-text="Delete permanently"
      icon="mdi-delete-forever-outline"
      :loading="deleting"
      @confirm="removeEntry"
    />
  </main>
</template>

<style scoped>
.journal-editor-page { padding-bottom: 5rem; }
.journal-editor-fields,
.journal-editor-context { display: grid; gap: 1rem; }
.journal-editor-reflection-slot { min-width: 0; }
.journal-editor-reflection { display: grid; gap: .25rem; }
.journal-editor-privacy { color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; font-style: italic; line-height: 1.4; }
.required-mark { color: rgb(var(--v-theme-error)); }
.journal-editor-reflection--fullscreen {
  position: fixed;
  z-index: 2000;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 100vw;
  height: var(--app-viewport-height, 100dvh);
  min-height: 0;
  padding-top: max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem));
  padding-bottom: max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem));
  background: rgb(var(--v-theme-background));
  clip-path: inset(
    var(--reflection-clip-top, 0rem)
    var(--reflection-clip-right, 0rem)
    var(--reflection-clip-bottom, 0rem)
    var(--reflection-clip-left, 0rem)
    round .75rem
  );
  transition: clip-path 220ms cubic-bezier(.22, 1, .36, 1);
  will-change: clip-path;
}
.journal-editor-reflection--fullscreen.journal-editor-reflection--expanded { clip-path: inset(0 round 0); }
.journal-editor-reflection--fullscreen .journal-editor-privacy { display: none; }
.journal-editor-reflection--fullscreen :deep(.v-input) {
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
}
.journal-editor-reflection--fullscreen :deep(.v-input__control),
.journal-editor-reflection--fullscreen :deep(.v-field),
.journal-editor-reflection--fullscreen :deep(.v-field__field) {
  height: 100%;
  min-height: 0;
}
.journal-editor-reflection--fullscreen :deep(.v-field) { border-radius: 0; }
.journal-editor-reflection--fullscreen :deep(.v-field__input) {
  height: 100% !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  resize: none;
  -webkit-user-select: text;
  user-select: text;
}
.journal-editor-reflection--fullscreen :deep(.v-input__details) { display: none; }
:global(html.keyboard-open .journal-editor-reflection--fullscreen) { padding-bottom: 0; }
:global(html.platform-android.keyboard-open .journal-editor-reflection--fullscreen) { padding-bottom: 4.5625rem; }
:global(html.platform-android.keyboard-open.journal-reflection-fullscreen .form-action-bar) { z-index: 2001; }
:global(html.journal-reflection-fullscreen .app-bar),
:global(html.journal-reflection-fullscreen .bottom-nav) { display: none !important; }
:global(html.journal-reflection-fullscreen),
:global(html.journal-reflection-fullscreen body) { overflow: hidden; }
@media (prefers-reduced-motion: reduce) {
  .journal-editor-reflection--fullscreen { transition-duration: 0s; }
}
@media (min-width: 48rem) {
  .journal-editor-context { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
