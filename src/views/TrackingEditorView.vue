<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmojiSelector from '@/components/EmojiSelector.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import NumberPadField from '@/components/NumberPadField.vue'
import { contentRetirementActions, type ContentRetirementActionId } from '@/services/contentRetirementActions'
import { getHealthConnectStatus } from '@/services/healthConnect'
import { defaultAggregation, TRACKING_PRESETS, trackerDraftFromPreset } from '@/services/tracking'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackerKind, TrackingTrackerDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTrackingStore()
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
const healthConnectConnected = ref(false)
const customUnitSelected = ref(false)
const retirementActions = contentRetirementActions(
  'tracker',
  'Hide it from tracking while preserving its settings and every log.',
  'Permanently remove the tracker and every one of its logs.',
)

const kindOptions: Array<{ value: TrackerKind; title: string; subtitle: string; icon: string }> = [
  { value: 'yes_no', title: 'Yes / no', subtitle: 'One explicit answer per log', icon: 'mdi-check-circle-outline' },
  { value: 'event', title: 'Event', subtitle: 'Log only when it happens; missing days count as not occurred', icon: 'mdi-counter' },
  { value: 'number', title: 'Number', subtitle: 'Any measured numeric value', icon: 'mdi-numeric' },
  { value: 'rating', title: 'Rating', subtitle: 'A bounded scale, such as 1–10', icon: 'mdi-star-outline' },
  { value: 'duration', title: 'Duration', subtitle: 'Minutes spent on something', icon: 'mdi-timer-outline' },
]
const customUnitValue = 'custom'

const draft = reactive<TrackingTrackerDraft>({
  name: '',
  description: '',
  role: 'factor',
  kind: 'yes_no',
  unit: '',
  targetValue: 0,
  targetOperator: 'gte',
  trackingWindow: 'occurrence',
  source: 'manual',
  scaleMin: 1,
  scaleMax: 10,
  favorableDirection: 'neutral',
  dailyAggregation: 'last',
  active: true,
  archived: false,
  sortOrder: 0,
  color: '#C7F464',
  icon: 'mdi-checkbox-marked-circle-outline',
})

const scaleUnitValue = computed(() => `/ ${draft.scaleMax}`)
const unitOptions = computed(() => [
  { title: 'Count', value: 'count' },
  { title: 'Times', value: 'times' },
  { title: 'Sessions', value: 'sessions' },
  { title: 'Steps', value: 'steps' },
  { title: 'Kilograms (kg)', value: 'kg' },
  { title: 'Pounds (lb)', value: 'lb' },
  { title: 'Grams (g)', value: 'g' },
  { title: 'Litres (L)', value: 'L' },
  { title: 'Millilitres (mL)', value: 'mL' },
  { title: 'Calories (kcal)', value: 'kcal' },
  { title: 'Percent (%)', value: '%' },
  { title: 'Minutes', value: 'minutes' },
  ...(draft.kind === 'rating' ? [{
    title: `Out of ${draft.scaleMin}–${draft.scaleMax}`,
    value: scaleUnitValue.value,
  }] : []),
  { title: 'Custom', value: customUnitValue },
])

const isEditing = computed(() => Boolean(route.params.id))
const hasEntries = computed(() => Boolean(draft.id && store.entries.some((entry) => entry.tracker === draft.id)))
const measurementLocked = computed(() => isEditing.value && hasEntries.value)
const canConfigureUnit = computed(() => draft.kind !== 'yes_no'
  && draft.source !== 'health_connect_steps')
const signature = computed(() => JSON.stringify(draft))
const changed = computed(() => ready.value && signature.value !== original.value)
const sourceOptions = computed(() => [
  { title: 'Log manually', value: 'manual' },
  {
    title: 'Health Connect steps',
    value: 'health_connect_steps',
    props: { disabled: !healthConnectConnected.value },
  },
])
const targetValueModel = computed<number>({
  get: () => draft.kind === 'duration' ? draft.targetValue / 60 : draft.targetValue,
  set: (value) => {
    draft.targetValue = draft.kind === 'duration' ? value * 60 : value
  },
})
const unitSelection = computed({
  get: () => customUnitSelected.value
    ? customUnitValue
    : unitOptions.value.some(option => option.value === draft.unit)
      ? draft.unit
      : draft.unit ? customUnitValue : null,
  set: (value: string | null) => {
    customUnitSelected.value = value === customUnitValue
    draft.unit = value === customUnitValue ? '' : value || ''
  },
})

async function markFormReady() {
  await nextTick()
  original.value = signature.value
  ready.value = true
}

watch(() => draft.kind, (kind) => {
  if (measurementLocked.value) return
  customUnitSelected.value = false
  draft.dailyAggregation = defaultAggregation(kind)
  if (kind === 'rating') {
    draft.scaleMin = 1
    draft.scaleMax = 10
    draft.unit = '/ 10'
  } else if (kind === 'yes_no') {
    draft.scaleMin = 0
    draft.scaleMax = 1
    draft.unit = ''
  } else if (kind === 'event') {
    draft.scaleMin = 0
    draft.scaleMax = 0
    draft.unit = 'times'
  } else if (kind === 'duration') {
    draft.scaleMin = 0
    draft.scaleMax = 0
    draft.unit = 'minutes'
  } else if (kind === 'number') {
    draft.scaleMin = 0
    draft.scaleMax = 0
  }
})

watch(
  () => [draft.scaleMin, draft.scaleMax] as const,
  ([, scaleMax], [, previousScaleMax]) => {
    if (draft.kind === 'rating' && draft.unit === `/ ${previousScaleMax}`) {
      draft.unit = `/ ${scaleMax}`
    }
  },
)

watch(() => draft.source, (source) => {
  if (measurementLocked.value || source !== 'health_connect_steps') return
  customUnitSelected.value = false
  draft.kind = 'number'
  draft.unit = 'steps'
  draft.dailyAggregation = 'sum'
})

watch(() => draft.role, (role) => {
  if (role === 'factor') draft.favorableDirection = 'neutral'
  else if (draft.favorableDirection === 'neutral') draft.favorableDirection = 'higher'
})

async function refreshHealthConnectStatus() {
  try {
    const status = await getHealthConnectStatus()
    healthConnectConnected.value = status.availability === 'available' && status.authorized
  } catch {
    healthConnectConnected.value = false
  }
}

onMounted(async () => {
  const healthStatus = refreshHealthConnectStatus()
  if (!store.loaded) await store.load().catch(() => undefined)
  await healthStatus
  const id = typeof route.params.id === 'string' ? route.params.id : ''
  if (id) {
    const tracker = store.trackers.find((item) => item.id === id)
    if (!tracker) {
      error.value = 'That tracker could not be found.'
      await markFormReady()
      return
    }
    Object.assign(draft, tracker)
    await markFormReady()
    return
  }
  const presetId = typeof route.query.preset === 'string' ? route.query.preset : ''
  const preset = TRACKING_PRESETS.find((item) => item.id === presetId)
  if (preset) Object.assign(draft, trackerDraftFromPreset(preset, store.trackers.length))
  else {
    draft.sortOrder = store.trackers.length
    if (route.query.role === 'factor' || route.query.role === 'outcome') draft.role = route.query.role
  }
  await markFormReady()
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.kind === 'rating' && draft.scaleMax <= draft.scaleMin) {
    error.value = 'The top of a rating scale must be greater than the bottom.'
    return
  }
  if (draft.source === 'health_connect_steps' && draft.kind !== 'number') {
    error.value = 'Health Connect steps require a number tracker.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTracker(draft)
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this tracker.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.deleteTracker(draft.id)
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this tracker.'
  } finally {
    deleting.value = false
    deleteDialog.value = false
  }
}

async function setArchived() {
  if (!draft.id) return
  archiving.value = true
  error.value = ''
  try {
    await store.setTrackerArchived(draft.id, !draft.archived)
    archiveDialog.value = false
    archiveActions.value = false
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `Could not ${draft.archived ? 'restore' : 'archive'} this tracker.`
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
  if (action === 'archive') void setArchived()
  else deleteDialog.value = true
}
</script>

<template>
  <main class="app-page app-page--editor tracking-editor">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="measurementLocked" type="info" variant="tonal" density="compact" class="mb-4">
      Measurement type, unit, scale, and daily calculation are locked because this tracker has logs.
    </v-alert>

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <h2 class="section-title">Basics</h2>
        <v-text-field v-model="draft.name" label="Name" :rules="[(value: string) => Boolean(value?.trim()) || 'Name is required']" maxlength="160" variant="outlined" />
        <EmojiSelector
          v-model="draft.icon"
          label="Tracker icon"
          dialog-title="Choose an icon"
        />
        <ColorSwatchPicker v-model="draft.color" />
      </v-card>

      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <h2 class="section-title">Measurement</h2>
        <v-radio-group v-model="draft.kind" :disabled="measurementLocked" class="kind-list" hide-details>
          <v-radio v-for="kind in kindOptions" :key="kind.value" :value="kind.value" color="secondary">
            <template #label>
              <div class="kind-option"><v-icon :icon="kind.icon" /><div><strong>{{ kind.title }}</strong><span>{{ kind.subtitle }}</span></div></div>
            </template>
          </v-radio>
        </v-radio-group>

        <div v-if="draft.kind === 'rating'" class="scale-grid">
          <NumberPadField
            v-model="draft.scaleMin"
            title="Scale minimum"
            :disabled="measurementLocked"
          />
          <NumberPadField
            v-model="draft.scaleMax"
            title="Scale maximum"
            :disabled="measurementLocked"
          />
        </div>
        <v-select
          v-if="draft.kind === 'number'"
          v-model="draft.source"
          label="Source"
          :disabled="measurementLocked"
          :items="sourceOptions"
          variant="outlined"
        />
        <p v-if="draft.kind === 'number' && !healthConnectConnected" class="field-help">
          Connect Health Connect in Settings to use step data.
        </p>
  <v-select
    v-if="canConfigureUnit"
    v-model="unitSelection"
    label="Unit or scale label (optional)"
    placeholder="None"
    persistent-placeholder
    :items="unitOptions"
          :disabled="measurementLocked"
          variant="outlined"
        >
          <template #append-inner>
            <v-btn
              icon="mdi-close"
              size="small"
              variant="text"
              aria-label="Clear unit or scale label"
              :disabled="measurementLocked || !unitSelection"
              @click.stop="unitSelection = null"
            />
          </template>
        </v-select>
        <v-expand-transition>
          <div v-if="canConfigureUnit && unitSelection === customUnitValue">
            <v-text-field
              v-model="draft.unit"
              label="Custom unit or scale label (optional)"
              maxlength="30"
              :disabled="measurementLocked"
              variant="outlined"
            />
          </div>
        </v-expand-transition>
        <v-select
          v-if="draft.kind === 'number' && draft.source !== 'health_connect_steps'"
          v-model="draft.dailyAggregation"
          label="When there are several logs in a day"
          :disabled="measurementLocked"
          :items="[
            { title: 'Use the average', value: 'average' },
            { title: 'Add them together', value: 'sum' },
            { title: 'Use the last log', value: 'last' },
          ]"
          variant="outlined"
        />
        <p v-if="draft.kind === 'event'" class="field-help">Log each occurrence. A day without a log is treated as not occurred.</p>
        <p v-else-if="draft.kind === 'yes_no'" class="field-help">Log an explicit Yes or No for each observation.</p>
        <p v-else class="field-help">Days without a log stay missing.</p>

        <v-divider />
        <h2 class="section-title">Purpose</h2>
        <v-btn-toggle v-model="draft.role" mandatory color="secondary" class="purpose-toggle">
          <v-btn value="factor" prepend-icon="mdi-flask-outline">Thing I did</v-btn>
          <v-btn value="outcome" prepend-icon="mdi-chart-line">How I felt</v-btn>
        </v-btn-toggle>
        <p class="field-help">
          {{ draft.role === 'factor' ? 'A factor you may compare with an outcome later.' : 'A result you want to observe over time.' }}
        </p>
        <v-select
          v-if="draft.role === 'outcome'"
          v-model="draft.favorableDirection"
          label="Which direction is favorable?"
          :items="[
            { title: 'Higher is more favorable', value: 'higher' },
            { title: 'Lower is more favorable', value: 'lower' },
            { title: 'No favorable direction', value: 'neutral' },
          ]"
          variant="outlined"
        />
      </v-card>

      <v-card v-if="draft.kind === 'number' || draft.kind === 'duration'" class="tracker-form-section surface-card pa-5 mb-4">
        <div>
          <h2 class="section-title">Task goal</h2>
          <p class="field-help">Tasks can use this tracker’s target and tracking window while keeping every value in Tracking.</p>
        </div>
        <NumberPadField
          v-model="targetValueModel"
          :title="draft.kind === 'duration' ? 'Target minutes (optional)' : 'Target (optional)'"
        />
        <template v-if="draft.targetValue > 0">
          <v-select
            v-model="draft.targetOperator"
            label="Goal"
            :items="[
              { title: 'At least', value: 'gte' },
              { title: 'At most', value: 'lte' },
              { title: 'Exactly', value: 'eq' },
            ]"
            variant="outlined"
          />
          <v-select
            v-model="draft.trackingWindow"
            label="Tracking window"
            :items="[
              { title: 'Each scheduled day', value: 'occurrence' },
              { title: 'Calendar week', value: 'week' },
            ]"
            variant="outlined"
          />
        </template>
      </v-card>

    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :has-changes="changed"
      :show-archive="isEditing"
      :archived="draft.archived"
      :archive-label="draft.archived ? 'Restore tracker' : 'Archive tracker'"
      :archive-disabled="archiving || deleting"
      @submit="save"
      @cancel="router.back()"
      @archive="openRetirementActions"
    />

    <ActionBottomSheet
      v-model="archiveActions"
      title="Archive or delete?"
      :description="`Choose what to do with ${draft.name || 'this tracker'}.`"
      aria-label="Archive or permanently delete tracker"
    >
      <template v-for="action in retirementActions" :key="action.id">
        <v-divider v-if="'divider' in action && action.divider" class="my-1" />
        <v-list-item :prepend-icon="action.icon" :title="action.title" :subtitle="action.subtitle" :base-color="action.color" rounded="lg" :disabled="archiving || deleting" @click="runRetirementAction(action.id)" />
      </template>
    </ActionBottomSheet>

    <ConfirmDialog v-model="archiveDialog" title="Restore this tracker?" message="This tracker will return to tracking with its previous active or paused state and all of its logs." confirm-text="Restore tracker" confirm-color="secondary" icon="mdi-archive-arrow-up-outline" :loading="archiving" @confirm="setArchived" />
    <ConfirmDialog v-model="deleteDialog" title="Delete tracker permanently?" message="This permanently deletes the tracker and every one of its logs. This cannot be undone." confirm-text="Delete permanently" icon="mdi-delete-forever-outline" :loading="deleting" @confirm="remove" />
  </main>
</template>

<style scoped>
.section-title { font-size: .78rem; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
.tracker-form-section { display: grid; gap: 1rem; }
.field-help { color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; line-height: 1.5; }
.purpose-toggle { display: grid; width: 100%; grid-template-columns: 1fr 1fr; gap: .5rem; }
.purpose-toggle :deep(.v-btn) { min-width: 0; }
.kind-list :deep(.v-selection-control) { min-height: 58px; padding: .35rem .25rem; }
.kind-option { display: flex; align-items: center; gap: .8rem; }
.kind-option div { display: flex; flex-direction: column; }
.kind-option span { color: rgb(var(--v-theme-on-surface) / .52); font-size: .7rem; }
.scale-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.tracking-editor { padding-bottom: 6rem; }
</style>
