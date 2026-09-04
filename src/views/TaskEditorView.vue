<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppForm from '@/components/AppForm.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ContentIcon from '@/components/ContentIcon.vue'
import DatePickerField from '@/components/DatePickerField.vue'
import EmojiSelector from '@/components/EmojiSelector.vue'
import ExerciseSelector from '@/components/ExerciseSelector.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import TaskReminderSettings from '@/components/TaskReminderSettings.vue'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { reviewSetCardCount } from '@/services/flashcards'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { createProgramStepCompletion } from '@/services/programStepCompletions'
import { requestTaskReminderPermission, taskReminderSettingsAvailable } from '@/services/taskReminders'
import { taskSupportsImageLogging, taskSupportsQuickLog, TASK_CREATE_TYPE_OPTIONS, TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { TASK_RETIREMENT_ACTIONS, type TaskRetirementActionId } from '@/services/taskRetirementActions'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type {
  ProgramStepCompletion,
  ProgramStepCompletionStyleItem,
  ProgramStepDraft,
  TaskDraft,
  TaskType,
} from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const PROGRAM_STEP_EXPANSION_DURATION_MS = 240
const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const trackingStore = useTrackingStore()
const form = ref()
const saving = ref(false)
const archiving = ref(false)
const archiveDialog = ref(false)
const archiveActions = ref(false)
const deleteDialog = ref(false)
const deleting = ref(false)
const openStep = ref<number>()
let stepReferenceCheckTimer: number | undefined
const referencedStepIds = ref(new Set<string>())
const checkedStepReferenceIds = ref(new Set<string>())
const failedStepReferenceIds = ref(new Set<string>())
const error = ref('')
const ready = ref(false)
const original = ref('')
const reminderAvailable = taskReminderSettingsAvailable()
const stepDragIds = new WeakMap<ProgramStepDraft, string>()
let nextStepDragId = 0
const duplicateTaskId = computed(() => typeof route.query.duplicate === 'string'
  ? route.query.duplicate
  : '')
const requestedProgramStepId = computed(() => typeof route.query.step === 'string'
  ? route.query.step
  : '')
const typeLocked = computed(() => Boolean(route.params.id || duplicateTaskId.value))
const isEditing = computed(() => Boolean(route.params.id))
const completionStyleIntervals = computed(() => intervalStore.templates.filter(interval => (
  !interval.archived
  || draft.intervalTemplate === interval.id
  || draft.steps.some(step => (
    step.intervalTemplate === interval.id
    || step.completions?.some(item => item.intervalTemplate === interval.id)
  ))
)))
const completionStyleReviewSets = computed(() => flashcardStore.reviewSets.filter(reviewSet => (
  !reviewSet.archived
  || draft.flashcardReviewSet === reviewSet.id
  || draft.steps.some(step => (
    step.flashcardReviewSet === reviewSet.id
    || step.completions?.some(item => item.flashcardReviewSet === reviewSet.id)
  ))
)))
const workoutIntervalItems = computed(() => completionStyleIntervals.value.map(interval => ({
  title: interval.name,
  value: interval.id,
  icon: interval.icon || 'mdi-timer-play-outline',
  color: interval.color,
  props: {
    subtitle: `${formatIntervalDuration(intervalDuration(interval.definition))} · ${intervalStepCount(interval.definition)} intervals`,
  },
})))
const completionStyleItems = computed<ProgramStepCompletionStyleItem[]>(() => [
  { type: 'subheader', title: 'Basic' },
  {
    type: 'item',
    title: 'Workout',
    value: 'workout',
    completionType: 'workout',
    icon: 'mdi-dumbbell',
    color: '#C7F464',
    props: { subtitle: 'Exercise sets, with an optional interval' },
  },
  {
    type: 'item',
    title: 'Check-off',
    value: 'check',
    completionType: 'check',
    icon: 'mdi-check-circle-outline',
    color: TASK_TYPE_PRESENTATION.check.color,
    props: { subtitle: 'A separate check-off' },
  },
  {
    type: 'item',
    title: 'Quantity target',
    value: 'quantity',
    completionType: 'quantity',
    icon: 'mdi-chart-donut',
    color: TASK_TYPE_PRESENTATION.daily_total.color,
    props: { subtitle: 'Reach a numeric target' },
  },
  { type: 'subheader', title: 'Intervals' },
  ...(completionStyleIntervals.value.length
    ? completionStyleIntervals.value.map(interval => ({
        type: 'item' as const,
        title: interval.name,
        value: `interval:${interval.id}`,
        completionType: 'interval' as const,
        sourceId: interval.id,
        icon: interval.icon || 'mdi-timer-play-outline',
        color: interval.color,
        props: {
          subtitle: `${formatIntervalDuration(intervalDuration(interval.definition))} · ${intervalStepCount(interval.definition)} intervals`,
        },
      }))
    : [{
        type: 'item' as const,
        title: 'No saved intervals',
        value: 'unavailable:interval',
        icon: 'mdi-timer-off-outline',
        color: TASK_TYPE_PRESENTATION.interval.color,
        props: { subtitle: 'Create an interval first', disabled: true },
      }]),
  { type: 'subheader', title: 'Review sets' },
  ...(completionStyleReviewSets.value.length
    ? completionStyleReviewSets.value.map(reviewSet => ({
        type: 'item' as const,
        title: reviewSet.name,
        value: `flashcards:${reviewSet.id}`,
        completionType: 'flashcards' as const,
        sourceId: reviewSet.id,
        icon: reviewSet.icon || 'mdi-cards-outline',
        color: reviewSet.color || TASK_TYPE_PRESENTATION.flashcards.color,
        props: { subtitle: reviewSetSummary(reviewSet.id) },
      }))
    : [{
        type: 'item' as const,
        title: 'No Review sets',
        value: 'unavailable:flashcards',
        icon: 'mdi-cards-off-outline',
        color: TASK_TYPE_PRESENTATION.flashcards.color,
        props: { subtitle: 'Create a Review set first', disabled: true },
      }]),
])

const weekdays = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 0, label: 'Sunday' },
]
const units = [
  { title: 'Hours', value: 'hours' },
  { title: 'Calories (kcal)', value: 'kcal' },
  { title: 'Grams (g)', value: 'g' },
  { title: 'Litres (L)', value: 'L' },
  { title: 'Count', value: 'count' },
  { title: 'Custom unit', value: 'custom' },
]
const draft = reactive<TaskDraft>({
  name: '',
  description: '',
  type: TASK_CREATE_TYPE_OPTIONS.some(option => option.type === route.query.type)
    ? route.query.type as TaskType
    : 'check',
  icon: '',
  color: '#C7F464',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  archived: false,
  scheduleMode: 'time_based',
  scheduledTime: '09:00',
  scheduledTimes: ['09:00'],
  startDate: format(new Date(), 'yyyy-MM-dd'),
  endDate: undefined,
  recurrenceType: 'daily',
  weekdays: [1, 2, 3, 4, 5],
  intervalWeeks: 1,
  targetValue: 1,
  targetOperator: 'gte',
  unit: 'count',
  customUnit: '',
  goalPeriod: 'occurrence',
  cycleLength: 7,
  programRepeat: true,
  programStrict: false,
  quickLogEnabled: false,
  quickLogSortOrder: 0,
  logWithImagesEnabled: false,
  sortOrder: 0,
  intervalTemplate: undefined,
  flashcardReviewSet: undefined,
  sessionCountMode: 'task',
  sessionGoalType: 'complete',
  sessionTargetSeconds: 20 * 60,
  trackingTrackers: [],
  reminderEnabled: false,
  reminderTimes: [],
  steps: [],
})
const signature = computed(() => JSON.stringify(draft))
const changed = computed(() => ready.value && signature.value !== original.value)

async function markFormReady() {
  await nextTick()
  original.value = signature.value
  ready.value = true
}

function scrollToProgramStep(index: number) {
  const panel = document.querySelector<HTMLElement>(`[data-program-step-index="${index}"]`)
  if (!panel) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  window.setTimeout(() => {
    if (!panel.isConnected) return
    const appBarBottom = document.querySelector<HTMLElement>('.app-bar')
      ?.getBoundingClientRect().bottom ?? 0
    const scrollingElement = document.scrollingElement ?? document.documentElement
    window.scrollTo({
      behavior: reduceMotion ? 'auto' : 'smooth',
      top: Math.max(
        0,
        scrollingElement.scrollTop + panel.getBoundingClientRect().top - appBarBottom,
      ),
    })
  }, reduceMotion ? 0 : PROGRAM_STEP_EXPANSION_DURATION_MS)
}
const scheduledTimes = computed(() => draft.scheduledTimes?.length
  ? draft.scheduledTimes
  : [draft.scheduledTime || '09:00'])

function updateScheduledTime(index: number, value: number | string) {
  const times = [...scheduledTimes.value]
  times[index] = String(value)
  draft.scheduledTimes = times
  draft.scheduledTime = times[0]
}

function addScheduledTime() {
  const times = [...scheduledTimes.value]
  const [hour = 9, minute = 0] = (times.at(-1) || '09:00').split(':').map(Number)
  let nextMinutes = (hour * 60 + minute + 60) % (24 * 60)
  let nextTime = `${String(Math.floor(nextMinutes / 60)).padStart(2, '0')}:${String(nextMinutes % 60).padStart(2, '0')}`
  while (times.includes(nextTime) && times.length < 24 * 60) {
    nextMinutes = (nextMinutes + 1) % (24 * 60)
    nextTime = `${String(Math.floor(nextMinutes / 60)).padStart(2, '0')}:${String(nextMinutes % 60).padStart(2, '0')}`
  }
  draft.scheduledTimes = [...times, nextTime]
}

function removeScheduledTime(index: number) {
  if (scheduledTimes.value.length <= 1) return
  const times = scheduledTimes.value.filter((_, timeIndex) => timeIndex !== index)
  draft.scheduledTimes = times
  draft.scheduledTime = times[0]
}

watch(() => draft.scheduleMode, (mode) => {
  if (mode !== 'time_based' || draft.scheduledTimes?.length) return
  const time = draft.scheduledTime || '09:00'
  draft.scheduledTime = time
  draft.scheduledTimes = [time]
})

const showTarget = computed(() =>
  draft.type === 'duration' || draft.type === 'daily_total' || draft.type === 'step_counter',
)
const showImageLogSettings = computed(() => taskSupportsImageLogging(draft.type))
const showQuickLogSettings = computed(() => taskSupportsQuickLog(draft.type))
const intervalItems = computed(() => intervalStore.templates
  .filter(item => !item.archived || item.id === draft.intervalTemplate)
  .map((item) => ({
    title: item.name,
    value: item.id,
    icon: item.icon || 'mdi-timer-play-outline',
    color: item.color,
    props: {
      subtitle: `${formatIntervalDuration(intervalDuration(item.definition))} · ${intervalStepCount(item.definition)} intervals`,
    },
  })))
const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(item => item.id === draft.flashcardReviewSet))
const isSessionTask = computed(() => draft.type === 'interval' || draft.type === 'flashcards')
const sessionSourceLabel = computed(() => draft.type === 'interval' ? 'interval' : 'Review set')
const sessionCountItems = computed(() => [
  {
    title: 'Only sessions started from this task',
    value: 'task',
  },
  {
    title: `Any session of this ${sessionSourceLabel.value}`,
    value: 'linked',
  },
])
const reviewSetItems = computed(() => flashcardStore.reviewSets
  .filter(item => !item.archived || item.id === draft.flashcardReviewSet)
  .map(item => ({
  title: item.name,
  value: item.id,
  props: {
    subtitle: `${item.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSetCardCount(item)} cards`,
  },
})))
const selectableTrackingTrackers = computed(() => trackingStore.trackers
  .filter(tracker => (!tracker.archived && tracker.active) || draft.trackingTrackers?.includes(tracker.id))
  .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
const trackingTrackerItems = computed(() => [
  { title: 'How I felt', role: 'outcome' as const },
  { title: 'Things I did', role: 'factor' as const },
].flatMap((group) => {
  const items = selectableTrackingTrackers.value
    .filter(tracker => tracker.role === group.role)
    .map(tracker => ({
      type: 'item' as const,
      title: tracker.name,
      value: tracker.id,
      icon: tracker.icon || 'mdi-checkbox-marked-circle-outline',
      color: tracker.color,
      props: {
        subtitle: `${tracker.role === 'factor' ? 'Factor' : 'Outcome'}${tracker.archived ? ' · Archived' : tracker.active ? '' : ' · Paused'}`,
      },
    }))
  return items.length
    ? [{ type: 'subheader' as const, title: group.title }, ...items]
    : []
}))

function removeTrackingTracker(id: string) {
  draft.trackingTrackers = (draft.trackingTrackers ?? []).filter(trackerId => trackerId !== id)
}

function trackingTrackerFor(id: string) {
  return trackingStore.trackers.find(tracker => tracker.id === id)
}

const trackingTaskHint = computed(() => {
  const [trackerId] = draft.trackingTrackers || []
  const tracker = trackerId ? trackingTrackerFor(trackerId) : undefined
  if (
    draft.trackingTrackers?.length === 1
    && tracker
    && ['number', 'duration'].includes(tracker.kind)
    && tracker.targetValue > 0
  ) {
    return 'This tracker provides the task target, goal, tracking window, and logs.'
  }
  return 'This task completes after every selected tracker is logged for the scheduled date.'
})

function reviewSetSummary(reviewSetId?: string) {
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === reviewSetId)
  if (!reviewSet) return ''
  return `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSetCardCount(reviewSet)} cards`
}

function dayOffStep(sortOrder: number): ProgramStepDraft {
  return {
    name: 'Day off',
    description: '',
    sortOrder,
    cycleDays: [sortOrder + 1],
    completionType: 'day_off',
    active: true,
    completions: [],
  }
}

function syncStepCompletionProjection(step: ProgramStepDraft) {
  if (step.completionType === 'day_off') return
  const primary = step.completions?.[0]
  step.completionType = primary?.type || 'check'
  step.targetValue = primary?.targetValue
  step.targetOperator = primary?.targetOperator
  step.unit = primary?.unit
  step.customUnit = primary?.customUnit
  step.intervalTemplate = primary?.intervalTemplate
  step.flashcardReviewSet = primary?.flashcardReviewSet
}

function completionStyleItem(value: unknown) {
  return completionStyleItems.value.find(item => item.value === value && item.completionType)
}

function completionStyleValue(completion: ProgramStepCompletion) {
  const value = completion.type === 'interval'
    ? `interval:${completion.intervalTemplate || ''}`
    : completion.type === 'flashcards'
      ? `flashcards:${completion.flashcardReviewSet || ''}`
      : completion.type
  return completionStyleItem(value) ? value : undefined
}

function setCompletionStyle(
  step: ProgramStepDraft,
  completion: ProgramStepCompletion,
  value: unknown,
) {
  const item = completionStyleItem(value)
  if (!item?.completionType) return
  const type = item.completionType
  completion.type = type
  completion.targetValue = type === 'quantity' ? completion.targetValue || 1 : undefined
  completion.targetOperator = type === 'quantity' ? completion.targetOperator || 'gte' : undefined
  completion.unit = type === 'quantity' ? completion.unit || 'count' : undefined
  completion.customUnit = type === 'quantity' ? completion.customUnit : undefined
  completion.intervalTemplate = type === 'interval' ? item.sourceId : undefined
  completion.flashcardReviewSet = type === 'flashcards' ? item.sourceId : undefined
  completion.exercise = type === 'workout' ? completion.exercise : undefined
  completion.label = type === 'quantity' ? undefined : completion.label
  syncStepCompletionProjection(step)
}

function setCompletionExercise(completion: ProgramStepCompletion, value: string) {
  completion.exercise = value || undefined
  if (completion.exercise) completion.label = undefined
}

async function addCompletion(step: ProgramStepDraft) {
  step.completions ||= []
  const completion = createProgramStepCompletion('workout')
  step.completions.push(completion)
  syncStepCompletionProjection(step)
  await nextTick()
  const completionElement = Array.from(
    document.querySelectorAll<HTMLElement>('[data-completion-id]'),
  ).find(element => element.dataset.completionId === completion.id)
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  completionElement?.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'center',
    inline: 'nearest',
  })
}

function removeCompletion(step: ProgramStepDraft, completionId: string) {
  if (!step.completions || step.completions.length <= 1) return
  step.completions = step.completions.filter(item => item.id !== completionId)
  syncStepCompletionProjection(step)
}

function reorderStepCompletions(step: ProgramStepDraft, result: LongPressDragResult) {
  const completions = step.completions || []
  const byId = new Map(completions.map(item => [item.id, item]))
  const ordered = result.orderedIds
    .map(id => byId.get(id))
    .filter((item): item is ProgramStepCompletion => Boolean(item))
  if (ordered.length !== completions.length) return
  step.completions = ordered
  syncStepCompletionProjection(step)
}

function completionDropHandler(step: ProgramStepDraft) {
  return (result: LongPressDragResult) => reorderStepCompletions(step, result)
}

function syncProgramSequence() {
  draft.steps.forEach((step, index) => {
    step.sortOrder = index
    step.cycleDays = [index + 1]
  })
  draft.cycleLength = draft.steps.length
}

function orderedProgramItems(steps: ProgramStepDraft[], cycleLength: number) {
  const sortedSteps = [...steps].sort((a, b) => a.sortOrder - b.sortOrder)
  if (sortedSteps.some(step => step.completionType === 'day_off')) return sortedSteps

  const stepsByDay = new Map<number, ProgramStepDraft[]>()
  const unassigned: ProgramStepDraft[] = []
  for (const step of sortedSteps) {
    const assignedDays = [...new Set(step.cycleDays)]
      .filter(day => Number.isInteger(day) && day > 0 && day <= cycleLength)
      .sort((a, b) => a - b)
    if (!assignedDays.length) {
      unassigned.push(step)
      continue
    }
    assignedDays.forEach((day, assignmentIndex) => {
      const scheduledStep = assignmentIndex === 0
        ? step
        : {
            ...step,
            id: undefined,
            completions: step.completions?.map(completion => ({
              ...completion,
              id: createProgramStepCompletion(completion.type).id,
            })),
          }
      const daySteps = stepsByDay.get(day) || []
      daySteps.push(scheduledStep)
      stepsByDay.set(day, daySteps)
    })
  }

  const items: ProgramStepDraft[] = []
  for (let day = 1; day <= cycleLength; day += 1) {
    const daySteps = stepsByDay.get(day)
    if (daySteps?.length) items.push(...daySteps)
    else items.push(dayOffStep(items.length))
  }
  items.push(...unassigned)
  return items
}

watch(() => draft.type, (type) => {
  if (typeLocked.value) return
  if (type === 'duration') {
    draft.unit = 'hours'; draft.targetValue = 5; draft.quickLogEnabled = true
  } else if (type === 'daily_total') {
    draft.unit = 'g'; draft.targetValue = 150; draft.quickLogEnabled = true
  } else if (type === 'step_counter') {
    draft.unit = 'steps'; draft.customUnit = ''; draft.targetValue = 10000; draft.targetOperator = 'gte'; draft.quickLogEnabled = true
  } else if (type === 'program' && !draft.steps.length) addStep(false)
}, { immediate: true })

onMounted(async () => {
  await Promise.all([
    store.tasks.length ? Promise.resolve() : store.load(),
    intervalStore.loaded ? Promise.resolve() : intervalStore.load(),
    flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ])
  if (!route.params.id && !duplicateTaskId.value) {
    if (draft.type === 'program' && !draft.steps.length) addStep(false)
    await markFormReady()
    return
  }
  const taskId = typeof route.params.id === 'string'
    ? route.params.id
    : duplicateTaskId.value
  const task = store.tasks.find((item) => item.id === taskId)
  if (!task) {
    error.value = 'That task could not be found.'
    await markFormReady()
    return
  }
  const taskSteps = orderedProgramItems(
    store.steps
      .filter((step) => step.active && step.task === task.id)
      .map(({ task: _task, ...step }) => ({ ...step })),
    task.cycleLength || 0,
  )
  if (duplicateTaskId.value) {
    Object.assign(draft, {
      ...task,
      id: undefined,
      name: `${task.name} copy`,
      archived: false,
      weekdays: [...task.weekdays],
      scheduledTimes: [...(task.scheduledTimes ?? (task.scheduledTime ? [task.scheduledTime] : []))],
      trackingTrackers: [...(task.trackingTrackers ?? [])],
      reminderTimes: [...task.reminderTimes],
      sortOrder: store.tasks.reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1,
      quickLogSortOrder: store.tasks.reduce((highest, item) => Math.max(
        highest,
        item.quickLogSortOrder ?? item.sortOrder,
      ), -1) + 1,
      steps: taskSteps.map(step => ({
        ...step,
        id: undefined,
        completions: step.completions?.map(completion => ({
          ...completion,
          id: createProgramStepCompletion(completion.type).id,
        })),
      })),
    })
    if (task.type === 'program') syncProgramSequence()
    await markFormReady()
    return
  }
  Object.assign(draft, {
    ...task,
    scheduledTimes: [...(task.scheduledTimes ?? (task.scheduledTime ? [task.scheduledTime] : []))],
    steps: taskSteps,
  })
  if (task.type === 'program') {
    syncProgramSequence()
    const requestedStepIndex = draft.steps.findIndex(step => step.id === requestedProgramStepId.value)
    if (requestedStepIndex >= 0) openStep.value = requestedStepIndex
  }
  await markFormReady()
  if (openStep.value !== undefined && requestedProgramStepId.value) {
    scrollToProgramStep(openStep.value)
  }
})

async function addStep(focusName = true) {
  if (draft.steps.length >= 365) return
  draft.steps.push({
    name: '',
    description: '',
    sortOrder: draft.steps.length,
    cycleDays: [draft.steps.length + 1],
    completionType: 'workout',
    targetValue: 1,
    targetOperator: 'gte',
    unit: 'count',
    customUnit: '',
    active: true,
    intervalTemplate: undefined,
    flashcardReviewSet: undefined,
    completions: [createProgramStepCompletion('workout')],
  })
  syncProgramSequence()
  openStep.value = draft.steps.length - 1
  if (focusName && allowAutomaticFocus) {
    await nextTick()
    document.querySelector<HTMLInputElement>(`[data-step-index="${openStep.value}"] input`)?.focus()
  }
}

function addDayOff() {
  if (draft.steps.length >= 365) return
  draft.steps.push(dayOffStep(draft.steps.length))
  syncProgramSequence()
  openStep.value = undefined
}

function duplicateStep(index: number) {
  if (draft.steps.length >= 365) return
  const step = draft.steps[index]
  if (!step || step.completionType === 'day_off') return

  const duplicate: ProgramStepDraft = {
    ...step,
    id: undefined,
    cycleDays: [...step.cycleDays],
    completions: step.completions?.map(completion => ({
      ...completion,
      id: createProgramStepCompletion(completion.type).id,
    })),
  }
  draft.steps.splice(index + 1, 0, duplicate)
  syncProgramSequence()
  openStep.value = index + 1
}

function removeStep(index: number) {
  draft.steps.splice(index, 1)
  syncProgramSequence()
  if (openStep.value === index) openStep.value = undefined
  else if (openStep.value !== undefined && openStep.value > index) openStep.value -= 1
}

function stepWillBeArchived(step: ProgramStepDraft) {
  return Boolean(step.id && (
    failedStepReferenceIds.value.has(step.id)
    || referencedStepIds.value.has(step.id)
  ))
}

function checkingStepReferences(step: ProgramStepDraft) {
  return Boolean(step.id && !checkedStepReferenceIds.value.has(step.id))
}

async function loadStepReferences(step: ProgramStepDraft) {
  if (!step.id || checkedStepReferenceIds.value.has(step.id)) return
  try {
    if (await store.programStepHasReferences(step.id)) referencedStepIds.value.add(step.id)
  } catch {
    failedStepReferenceIds.value.add(step.id)
  } finally {
    checkedStepReferenceIds.value.add(step.id)
  }
}

watch(openStep, (index) => {
  if (index === undefined) return
  const step = draft.steps[index]
  if (!step) return

  // The history check can update the action at the bottom of the panel. Run it
  // after the expand animation so it cannot alter the measured panel height.
  if (stepReferenceCheckTimer !== undefined) window.clearTimeout(stepReferenceCheckTimer)
  stepReferenceCheckTimer = window.setTimeout(() => {
    stepReferenceCheckTimer = undefined
    void loadStepReferences(step)
  }, PROGRAM_STEP_EXPANSION_DURATION_MS)
})

function moveStep(index: number, direction: -1 | 1) {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= draft.steps.length) return
  const [step] = draft.steps.splice(index, 1)
  if (!step) return
  draft.steps.splice(targetIndex, 0, step)
  syncProgramSequence()

  if (openStep.value === index) openStep.value = targetIndex
  else if (openStep.value === targetIndex) openStep.value = index
}

function stepDragId(step: ProgramStepDraft) {
  if (step.id) return step.id
  const existing = stepDragIds.get(step)
  if (existing) return existing
  nextStepDragId += 1
  const id = `new-program-step-${nextStepDragId}`
  stepDragIds.set(step, id)
  return id
}

function reorderStepsByDrag(result: LongPressDragResult) {
  const expandedStep = openStep.value === undefined
    ? undefined
    : draft.steps[openStep.value]
  const stepsById = new Map(draft.steps.map(step => [stepDragId(step), step]))
  const orderedSteps = result.orderedIds
    .map(id => stepsById.get(id))
    .filter((step): step is ProgramStepDraft => Boolean(step))
  if (orderedSteps.length !== draft.steps.length) return

  draft.steps.splice(0, draft.steps.length, ...orderedSteps)
  syncProgramSequence()
  openStep.value = expandedStep
    ? draft.steps.indexOf(expandedStep)
    : undefined
}

async function save() {
  if (draft.type === 'program') syncProgramSequence()
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.type === 'program' && !draft.steps.some(step => step.completionType !== 'day_off')) {
    error.value = 'Add at least one program step.'
    return
  }
  if (draft.type === 'interval' && !draft.intervalTemplate) {
    error.value = 'Select an interval for this task.'
    return
  }
  if (draft.type === 'flashcards' && !draft.flashcardReviewSet) {
    error.value = 'Select a Review set for this task.'
    return
  }
  if (draft.type === 'tracking' && !draft.trackingTrackers?.length) {
    error.value = 'Select at least one tracker for this task.'
    return
  }
  if (isSessionTask.value && draft.sessionGoalType === 'duration' && !draft.sessionTargetSeconds) {
    error.value = 'Choose a duration greater than zero.'
    return
  }
  if (draft.reminderEnabled && !draft.reminderTimes.length) {
    error.value = 'Add at least one notification time.'
    return
  }
  if (new Set(draft.reminderTimes).size !== draft.reminderTimes.length) {
    error.value = 'Choose a different time for each notification.'
    return
  }
  if (draft.scheduleMode === 'time_based' && scheduledTimes.value.some(time => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    error.value = 'Choose a valid time for each task instance.'
    return
  }
  if (draft.scheduleMode === 'time_based' && new Set(scheduledTimes.value).size !== scheduledTimes.value.length) {
    error.value = 'Choose a different time for each task instance.'
    return
  }
  const emptyCompletionStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completionType !== 'day_off' && !step.completions?.length)
    : -1
  if (emptyCompletionStep >= 0) {
    openStep.value = emptyCompletionStep
    error.value = 'Add at least one completion requirement to every program step.'
    return
  }
  const incompleteIntervalStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completions?.some(item => (
      item.type === 'interval' && !item.intervalTemplate
    )))
    : -1
  if (incompleteIntervalStep >= 0) {
    openStep.value = incompleteIntervalStep
    error.value = 'Select an interval for every interval requirement.'
    return
  }
  const incompleteFlashcardStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completions?.some(item => (
      item.type === 'flashcards' && !item.flashcardReviewSet
    )))
    : -1
  if (incompleteFlashcardStep >= 0) {
    openStep.value = incompleteFlashcardStep
    error.value = 'Select a Review set for every Review set requirement.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    if (draft.reminderEnabled && reminderAvailable && !await requestTaskReminderPermission()) {
      throw new Error('Notification permission is required to enable daily reminders.')
    }
    const persistence = store.saveTask(draft)
    await router.replace('/tasks')
    await persistence
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the task.'
  } finally {
    saving.value = false
  }
}

async function setTaskArchived() {
  if (!draft.id) return
  const task = store.tasks.find(item => item.id === draft.id)
  if (!task) return
  archiving.value = true
  error.value = ''
  try {
    await store.setTaskArchived(task, !task.archived)
    archiveDialog.value = false
    await router.replace('/tasks')
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : `Could not ${draft.archived ? 'restore' : 'archive'} the task.`
    archiveDialog.value = false
  } finally {
    archiving.value = false
  }
}

function openTaskRetirementActions() {
  if (draft.archived) {
    archiveDialog.value = true
    return
  }
  archiveActions.value = true
}

function runTaskRetirementAction(action: TaskRetirementActionId) {
  if (archiving.value || deleting.value) return
  if (action === 'archive') {
    archiveActions.value = false
    void setTaskArchived()
    return
  }
  archiveActions.value = false
  deleteDialog.value = true
}

async function deleteTaskPermanently() {
  if (!draft.id) return
  deleting.value = true
  error.value = ''
  try {
    await store.deleteTask(draft.id)
    deleteDialog.value = false
    archiveActions.value = false
    await router.replace('/tasks')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not permanently delete the task.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}

</script>

<template>
  <main class="app-page app-page--editor editor-page" :class="{ 'editor-page--editing': isEditing }">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div class="field-stack mb-4">
          <v-text-field v-model="draft.name" label="Task name" placeholder="e.g. Hit protein target" :rules="[v => Boolean(v) || 'Name is required']" />
        </div>
        <div v-if="!typeLocked" class="mb-4">
          <v-select
            v-model="draft.type"
            label="Task type"
            :items="TASK_CREATE_TYPE_OPTIONS"
            item-title="title"
            item-value="type"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                :title="item.raw.title"
                :subtitle="item.raw.subtitle"
              >
                <template #prepend>
                  <span class="task-type-option-icon mr-3" :style="{ background: item.raw.color }">
                    <v-icon :icon="item.raw.icon" size="1.125rem" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <span class="task-type-selection">
                <span class="task-type-selection-icon" :style="{ background: item.raw.color }">
                  <v-icon :icon="item.raw.icon" size="1rem" />
                </span>
                {{ item.title }}
              </span>
            </template>
          </v-select>
        </div>
        <EmojiSelector
          :model-value="draft.icon || TASK_TYPE_PRESENTATION[draft.type].icon"
          label="Task icon"
          dialog-title="Choose an icon"
          :clearable="Boolean(draft.icon)"
          class="mb-4"
          @update:model-value="draft.icon = $event"
        />
        <ColorSwatchPicker
          v-model="draft.color"
          label="Routine color"
          custom-label="Choose a custom routine color"
          class="mb-4"
        />
        <div class="setting-row">
          <div><strong>Required</strong><p>Counts toward your daily score</p></div>
          <v-switch v-model="draft.mandatory" color="secondary" hide-details inset />
        </div>
        <v-divider />
        <div class="setting-row">
          <div><strong>Review if unfinished</strong><p>Ask whether to miss, carry, or reschedule</p></div>
          <v-switch v-model="draft.reviewWhenMissed" color="secondary" hide-details inset />
        </div>
        <template v-if="showQuickLogSettings">
          <v-divider />
          <div class="setting-row">
            <div><strong>Quick log</strong><p>Show a shortcut at the top of Tasks</p></div>
            <v-switch v-model="draft.quickLogEnabled" color="secondary" hide-details="auto" inset />
          </div>
        </template>
        <template v-if="showImageLogSettings">
          <v-divider />
          <div class="setting-row">
            <div><strong>Log with images</strong><p>Quickly log a labeled amount from a photo</p></div>
            <v-switch v-model="draft.logWithImagesEnabled" color="secondary" hide-details="auto" inset />
          </div>
        </template>
      </v-card>

      <v-card v-if="draft.type === 'interval'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="intervalItems.length">
          <v-select
            v-model="draft.intervalTemplate"
            label="Attached interval"
            :items="intervalItems"
            :rules="[v => Boolean(v) || 'Select an interval']"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <span class="completion-style-icon mr-3" :style="{ background: item.raw.color }">
                    <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <span class="completion-style-selection">
                <span class="completion-style-selection__icon" :style="{ background: item.raw.color }">
                  <ContentIcon :icon="item.raw.icon" size=".875rem" />
                </span>
                <span class="text-truncate">{{ item.title }}</span>
              </span>
            </template>
          </v-select>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-timer-plus-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create an interval first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Interval tasks need a saved interval to run.</p>
          <v-btn color="secondary" variant="tonal" to="/intervals/new">Create interval</v-btn>
        </div>
      </v-card>

      <v-card v-if="draft.type === 'flashcards'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="reviewSetItems.length">
          <v-select
            v-model="draft.flashcardReviewSet"
            label="Review set"
            :items="reviewSetItems"
            autocomplete="off"
            :rules="[v => Boolean(v) || 'Select a Review set']"
          />
          <div v-if="selectedReviewSet" class="interval-attachment-summary">
            <div class="flashcard-attachment-icon">
              <v-icon icon="mdi-cards-playing-outline" />
            </div>
            <div class="min-width-0">
              <strong class="d-block text-truncate">{{ selectedReviewSet.name }}</strong>
              <p class="text-caption muted">{{ reviewSetSummary(selectedReviewSet.id) }}</p>
            </div>
          </div>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-cards-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create a Review set first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Review set tasks need a saved Review set to run.</p>
          <v-btn color="secondary" variant="tonal" to="/flashcards/review-sets/new">Create a review set</v-btn>
        </div>
      </v-card>

      <v-card v-if="isSessionTask" class="surface-card field-stack pa-5 mb-4">
        <div>
          <h2 class="text-body-1 font-weight-black">Session objective</h2>
          <p class="text-body-2 muted mt-1">Choose which sessions count and what finishes this task each day.</p>
        </div>
        <v-select
          v-model="draft.sessionCountMode"
          label="What counts"
          :items="sessionCountItems"
        />
        <div>
          <v-select
            v-model="draft.sessionGoalType"
            label="Goal"
            :items="[
              { title: 'Complete one session', value: 'complete' },
              { title: 'Reach a duration', value: 'duration' },
            ]"
          />
          <v-expand-transition>
            <div v-if="draft.sessionGoalType === 'duration'">
              <div class="session-duration-setting pt-4">
                <label class="field-label">Daily duration</label>
                <TimerWheelPicker
                  v-model="draft.sessionTargetSeconds"
                  :max-minutes="180"
                  mode="duration"
                  class="mt-2"
                />
                <p class="field-help mt-2">
                  Time from completed sessions and sessions you end early is added to this task.
                </p>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </v-card>

      <v-card v-if="draft.type === 'tracking'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="trackingTrackerItems.length">
          <v-select
            v-model="draft.trackingTrackers"
            label="Trackers to log"
            :items="trackingTrackerItems"
            autocomplete="off"
            multiple
            chips
            :rules="[value => Boolean(value?.length) || 'Select at least one tracker']"
            :hint="trackingTaskHint"
            persistent-hint
          >
            <template #item="{ props: itemProps, item }">
              <v-list-subheader v-if="item.raw.type === 'subheader'">
                {{ item.title }}
              </v-list-subheader>
              <v-list-item v-else v-bind="itemProps">
                <template #prepend>
                  <span class="tracking-attachment-icon mr-3" :style="{ background: item.raw.color }">
                    <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <v-chip size="small" closable @click:close.stop="removeTrackingTracker(item.value)">
                <span
                  v-if="trackingTrackerFor(item.value)"
                  class="tracking-selection-icon mr-1"
                  :style="{ background: trackingTrackerFor(item.value)?.color }"
                >
                  <ContentIcon :icon="trackingTrackerFor(item.value)?.icon" size=".875rem" />
                </span>
                {{ item.title }}
              </v-chip>
            </template>
          </v-select>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-chart-box-plus-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create a tracker first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Tracking tasks need at least one tracker to log.</p>
          <v-btn color="secondary" variant="tonal" to="/tracking/new">Create tracker</v-btn>
        </div>
      </v-card>

      <v-card v-if="draft.type === 'journal'" class="surface-card pa-5 mb-4">
        <div class="journal-task-summary">
          <v-icon icon="mdi-notebook-edit-outline" color="secondary" size="24" />
          <div>
            <h2 class="text-body-1 font-weight-black">Write one reflection</h2>
            <p>A linked journal entry completes this task for its scheduled date.</p>
          </div>
        </div>
      </v-card>

      <v-card class="surface-card field-stack pa-5 mb-4">
        <div>
          <h2 class="text-body-1 font-weight-black">Time</h2>
          <p class="text-body-2 muted mt-1">Place this task at any point or at a specific time.</p>
        </div>
        <div>
          <v-btn-toggle
            v-model="draft.scheduleMode"
            class="schedule-mode-toggle"
            color="secondary"
            selected-class="schedule-mode-toggle--selected"
            mandatory
          >
            <v-btn value="all_day" prepend-icon="mdi-calendar-blank-outline">
              At any point
            </v-btn>
            <v-btn value="time_based" prepend-icon="mdi-clock-outline">
              Time based
            </v-btn>
          </v-btn-toggle>
          <v-expand-transition>
            <div v-if="draft.scheduleMode === 'time_based'">
              <div class="scheduled-time-setting pt-4">
                <div
                  v-for="(time, index) in scheduledTimes"
                  :key="index"
                  class="scheduled-time-instance"
                  :class="index ? 'mt-4' : undefined"
                >
                  <div class="scheduled-time-instance__header">
                    <label class="field-label">
                      Scheduled time{{ scheduledTimes.length > 1 ? ` ${index + 1}` : '' }}
                      <span class="text-error">*</span>
                    </label>
                    <v-btn
                      v-if="scheduledTimes.length > 1"
                      icon="mdi-delete-outline"
                      variant="text"
                      color="error"
                      size="small"
                      :aria-label="`Remove scheduled time ${index + 1}`"
                      @click="removeScheduledTime(index)"
                    />
                  </div>
                  <TimerWheelPicker
                    :model-value="time"
                    mode="time"
                    class="mt-2"
                    @update:model-value="updateScheduledTime(index, $event)"
                  />
                </div>
                <v-btn
                  block
                  variant="tonal"
                  color="secondary"
                  prepend-icon="mdi-plus"
                  class="mt-4"
                  @click="addScheduledTime"
                >
                  Add another time
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </v-card>

      <TaskReminderSettings
        v-model:enabled="draft.reminderEnabled"
        v-model:times="draft.reminderTimes"
        :available="reminderAvailable"
        :default-time="draft.scheduleMode === 'time_based' ? scheduledTimes[0] : undefined"
      />

      <v-card v-if="draft.type !== 'program'" class="surface-card field-stack pa-5 mb-4">
        <v-select
          v-model="draft.recurrenceType"
          label="Repeat"
          :items="[
            { title: 'Every day', value: 'daily' },
            { title: 'Selected weekdays', value: 'weekdays' },
            { title: 'Every N weeks', value: 'interval_weeks' },
          ]"
        />
        <div v-if="draft.recurrenceType !== 'daily'" class="scheduled-days">
          <label class="field-label">Scheduled days</label>
          <div class="weekday-wrap mt-2">
            <v-btn-toggle
              v-model="draft.weekdays"
              multiple
              class="weekday-picker"
              color="secondary"
              selected-class="day-picker--selected"
            >
              <v-btn v-for="day in weekdays" :key="day.value" :value="day.value" size="small" class="px-0">{{ day.label }}</v-btn>
            </v-btn-toggle>
          </div>
        </div>
        <v-number-input
          v-if="draft.recurrenceType === 'interval_weeks'"
          v-model="draft.intervalWeeks"
          label="Repeat every"
          :min="1"
          :max="52"
          :step="1"
          suffix="weeks"
        />
        <div class="date-grid date-range-grid">
          <DatePickerField v-model="draft.startDate" label="Starts" />
          <DatePickerField v-model="draft.endDate" label="Ends (optional)" clearable />
        </div>
      </v-card>

      <v-card v-if="showTarget" class="surface-card field-stack pa-5 mb-4">
        <div class="target-grid">
          <v-select
            v-if="draft.type === 'daily_total' || draft.type === 'step_counter'"
            v-model="draft.targetOperator"
            label="Goal"
            :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]"
          />
          <v-number-input
            v-model="draft.targetValue"
            label="Target"
            :min="0"
            :precision="null"
          />
          <v-select v-if="draft.type !== 'step_counter'" v-model="draft.unit" label="Unit" :items="units" />
          <v-text-field v-else model-value="Steps" label="Unit" readonly />
          <v-text-field v-if="draft.type !== 'step_counter' && draft.unit === 'custom'" v-model="draft.customUnit" label="Custom unit" />
        </div>
        <div v-if="draft.type === 'step_counter'" class="step-source-note">
          <v-icon icon="mdi-heart-pulse" color="secondary" size="20" />
          <p>Progress updates automatically from the Health Connect source configured in Settings.</p>
        </div>
        <v-select
          v-if="draft.type === 'duration'"
          v-model="draft.goalPeriod"
          label="Tracking window"
          :items="[{ title: 'Each scheduled day', value: 'occurrence' }, { title: 'Monday–Sunday total', value: 'week' }]"
        />
      </v-card>

      <template v-if="draft.type === 'program'">
        <v-card class="surface-card pa-5 mb-4">
          <div class="mb-4">
            <DatePickerField v-model="draft.startDate" label="Starts" />
          </div>
          <div class="setting-row">
            <div><strong>Repeat program</strong><p>Restart after the final cycle day</p></div>
            <v-switch v-model="draft.programRepeat" color="secondary" hide-details inset />
          </div>
          <v-divider />
          <div class="setting-row">
            <div><strong>Strict sequence</strong><p>Earlier steps must be resolved first</p></div>
            <v-switch v-model="draft.programStrict" color="secondary" hide-details inset />
          </div>
        </v-card>

        <div class="section-heading">
          <h2>Program steps</h2>
          <div class="d-flex flex-wrap justify-end ga-2">
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-power-sleep"
              :disabled="draft.steps.length >= 365"
              @click="addDayOff"
            >
            Day off
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-plus"
              :disabled="draft.steps.length >= 365"
              @click="addStep()"
            >
              Step
            </v-btn>
          </div>
        </div>
        <v-expansion-panels v-model="openStep" variant="accordion" class="step-panels mb-4">
          <v-expansion-panel
            v-for="(step, index) in draft.steps"
            :key="stepDragId(step)"
            :value="index"
            v-long-press-drag="{
              id: stepDragId(step),
              group: 'program-steps',
              handle: '.program-step__drag-handle',
              disabled: draft.steps.length < 2,
              onDrop: reorderStepsByDrag,
            }"
            elevation="0"
            rounded="xl"
            class="surface-card program-step-panel"
            :data-program-step-index="index"
            :class="{
              'program-step-panel--draggable': draft.steps.length > 1,
              'program-step-panel--day-off': step.completionType === 'day_off',
            }"
            :readonly="step.completionType === 'day_off'"
          >
            <v-expansion-panel-title
              class="program-step__drag-handle"
              :hide-actions="step.completionType === 'day_off'"
            >
              <div v-if="step.completionType === 'day_off'" class="day-off-row">
                <span class="step-number day-off-icon"><v-icon icon="mdi-power-sleep" size="18" /></span>
                <div class="min-width-0 flex-grow-1">
                  <strong>Day off</strong>
                  <p class="text-caption muted">Day {{ index + 1 }} · No task scheduled</p>
                </div>
                <div class="d-flex" @touchstart.stop @click.stop>
                  <v-btn
                    icon="mdi-delete-outline"
                    color="error"
                    variant="text"
                    size="small"
                    class="mr-n4"
                    aria-label="Remove day off"
                    @click.stop="removeStep(index)"
                  />
                </div>
              </div>
              <div v-else class="d-flex align-center ga-3">
                <span class="step-number">{{ index + 1 }}</span>
                <div><strong>{{ step.name || `Step ${index + 1}` }}</strong><p class="text-caption muted">Day {{ index + 1 }}</p></div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text v-if="step.completionType !== 'day_off'">
              <div class="field-stack mt-2 mb-4">
                <v-text-field
                  v-model="step.name"
                  :data-step-index="index"
                  label="Step name"
                  :rules="[v => Boolean(v) || 'Name is required']"
                />
                <v-textarea v-model="step.description" label="Instructions (optional)" rows="2" variant="outlined" />
              </div>
              <div class="completion-requirements mb-4">
                <div class="d-flex align-center justify-space-between ga-3 mb-3">
                  <div>
                    <strong class="text-body-2">Completion requirements</strong>
                    <p class="text-caption muted">Complete every item. Hold and drag to reorder.</p>
                  </div>
                  <v-btn
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-plus"
                    @click="addCompletion(step)"
                  >
                    Add
                  </v-btn>
                </div>
                <div class="completion-requirement-list">
                  <div
                    v-for="(completion, completionIndex) in step.completions"
                    :key="completion.id"
                    v-long-press-drag="{
                      id: completion.id,
                      group: `program-step-completions-${stepDragId(step)}`,
                      disabled: (step.completions?.length || 0) < 2,
                      onDrop: completionDropHandler(step),
                    }"
                    class="completion-requirement"
                    :data-completion-id="completion.id"
                  >
                    <div class="completion-requirement__header">
                      <strong>Requirement {{ completionIndex + 1 }}</strong>
                      <v-btn
                        icon="mdi-delete-outline"
                        color="error"
                        variant="text"
                        size="small"
                        :disabled="(step.completions?.length || 0) <= 1"
                        :aria-label="`Remove requirement ${completionIndex + 1}`"
                        @touchstart.stop
                        @click.stop="removeCompletion(step, completion.id)"
                      />
                    </div>
                    <v-select
                      :model-value="completionStyleValue(completion)"
                      label="Completion style"
                      :items="completionStyleItems"
                      autocomplete="off"
                      :rules="[v => Boolean(v) || 'Select a completion style']"
                      @update:model-value="setCompletionStyle(step, completion, $event)"
                    >
                      <template #item="{ props: itemProps, item }">
                        <v-list-item v-bind="itemProps">
                          <template #prepend>
                            <span
                              class="completion-style-icon mr-3"
                              :style="{ background: item.raw.color }"
                            >
                              <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                            </span>
                          </template>
                        </v-list-item>
                      </template>
                      <template #selection="{ item }">
                        <span class="completion-style-selection">
                          <span
                            class="completion-style-selection__icon"
                            :style="{ background: item.raw.color }"
                          >
                            <ContentIcon :icon="item.raw.icon" size=".875rem" />
                          </span>
                          <span class="text-truncate">{{ item.title }}</span>
                        </span>
                      </template>
                    </v-select>
                    <ExerciseSelector
                      v-if="completion.type === 'workout'"
                      :model-value="completion.exercise"
                      label="Exercise (optional)"
                      dialog-title="Choose an exercise"
                      class="mt-4"
                      @update:model-value="setCompletionExercise(completion, $event)"
                    />
                    <v-select
                      v-if="completion.type === 'workout'"
                      v-model="completion.intervalTemplate"
                      class="mt-4"
                      label="Attached interval (optional)"
                      :items="workoutIntervalItems"
                      autocomplete="off"
                      clearable
                      hint="Run it before confirming your reps and weight."
                      persistent-hint
                    >
                      <template #item="{ props: itemProps, item }">
                        <v-list-item v-bind="itemProps">
                          <template #prepend>
                            <span
                              class="completion-style-icon mr-3"
                              :style="{ background: item.raw.color }"
                            >
                              <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                            </span>
                          </template>
                        </v-list-item>
                      </template>
                      <template #selection="{ item }">
                        <span class="completion-style-selection">
                          <span
                            class="completion-style-selection__icon"
                            :style="{ background: item.raw.color }"
                          >
                            <ContentIcon :icon="item.raw.icon" size=".875rem" />
                          </span>
                          <span class="text-truncate">{{ item.title }}</span>
                        </span>
                      </template>
                    </v-select>
                    <v-row v-if="completion.type !== 'quantity' && completion.type !== 'workout'" no-gutters class="mt-4">
                      <v-col cols="12">
                        <v-text-field
                          v-model="completion.label"
                          label="Requirement label (optional)"
                          placeholder="e.g. Warm-up"
                          maxlength="160"
                          autocomplete="off"
                        />
                      </v-col>
                    </v-row>
                    <div v-if="completion.type === 'check'" class="completion-check-summary">
                      <v-icon icon="mdi-check-circle-outline" color="secondary" />
                      <span>A separate check-off is required.</span>
                    </div>
                    <div v-if="completion.type === 'quantity'" class="target-grid mt-4">
                      <v-number-input
                        v-model="completion.targetValue"
                        label="Target"
                        :min="0"
                        :precision="null"
                      />
                      <v-select v-model="completion.targetOperator" label="Goal" :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]" />
                      <v-select v-model="completion.unit" label="Unit" :items="units" />
                      <v-text-field v-if="completion.unit === 'custom'" v-model="completion.customUnit" label="Custom unit" autocomplete="off" />
                    </div>
                  </div>
                </div>
              </div>
              <v-btn
                block
                class="mt-3"
                variant="tonal"
                prepend-icon="mdi-content-copy"
                :disabled="draft.steps.length >= 365"
                @click="duplicateStep(index)"
              >
                Duplicate step
              </v-btn>
                <v-btn
                  block
                  class="mt-2"
                  :color="stepWillBeArchived(step) ? 'warning' : 'error'"
                  variant="tonal"
                  :prepend-icon="stepWillBeArchived(step) ? 'mdi-archive-outline' : 'mdi-delete-outline'"
                  :disabled="checkingStepReferences(step)"
                  @click="removeStep(index)"
                >
                  {{ checkingStepReferences(step)
                    ? 'Checking history…'
                    : stepWillBeArchived(step) ? 'Archive step' : 'Delete step' }}
              </v-btn>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>

    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :has-changes="changed"
      :show-archive="isEditing"
      :archived="draft.archived"
      :archive-label="draft.archived ? 'Restore task' : 'Archive task'"
      :archive-disabled="archiving || deleting"
      @submit="save"
      @cancel="router.back()"
      @archive="openTaskRetirementActions"
    />

    <ActionBottomSheet
      v-model="archiveActions"
      title="Archive or delete?"
      :description="`Choose what to do with ${draft.name || 'this task'}.`"
      aria-label="Archive or permanently delete task"
    >
      <template v-for="action in TASK_RETIREMENT_ACTIONS" :key="action.id">
        <v-divider v-if="'divider' in action && action.divider" class="my-1" />
        <v-list-item
          :prepend-icon="action.icon"
          :title="action.title"
          :subtitle="action.subtitle"
          :base-color="action.color"
          rounded="lg"
          :disabled="archiving || deleting"
          @click="runTaskRetirementAction(action.id)"
        />
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="archiveDialog"
      :title="draft.archived ? 'Restore this task?' : 'Archive this task?'"
      :message="draft.archived
        ? 'This task will return to its schedule with its settings and history preserved.'
        : 'This task will leave your schedule, while its settings, logged entries, and history remain available.'"
      :confirm-text="draft.archived ? 'Restore task' : 'Archive task'"
      :confirm-color="draft.archived ? 'secondary' : 'warning'"
      :icon="draft.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-arrow-down-outline'"
      :loading="archiving"
      @confirm="setTaskArchived"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this task permanently?"
      message="This permanently removes the task, its program steps, occurrences, entries, and image logs. Saved interval and Review sessions remain in history but will no longer be linked. This cannot be undone."
      confirm-text="Delete permanently"
      icon="mdi-delete-forever-outline"
      :loading="deleting"
      @confirm="deleteTaskPermanently"
    />
  </main>
</template>

<style scoped>
.task-type-option-icon,
.task-type-selection-icon { display: inline-grid; flex: 0 0 auto; place-items: center; border-radius: .5rem; color: #17200f; }
.task-type-option-icon { width: 2.25rem; height: 2.25rem; }
.task-type-selection { display: inline-flex; min-width: 0; align-items: center; gap: .5rem; }
.task-type-selection-icon { width: 1.5rem; height: 1.5rem; }
.setting-row { display: flex; min-height: 70px; align-items: center; justify-content: space-between; gap: 1rem; }
.setting-row strong { font-size: .83rem; }
.setting-row p { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; }
.field-label { color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 750; }
.scheduled-days, .weekday-wrap { width: 100%; min-width: 0; max-width: 100%; }
.weekday-picker { display: flex; width: 100%; min-width: 0; max-width: 100%; flex-wrap: wrap; justify-content: flex-start; gap: .5rem; height: auto }
.weekday-picker :deep(.v-btn) { width: auto; min-width: 2.75rem; flex: 1 1 calc(50% - .5rem); min-height: 2.75rem; }
.weekday-picker :deep(.day-picker--selected) {
  background: rgb(var(--v-theme-secondary)) !important;
  color: rgb(var(--v-theme-on-secondary)) !important;
  opacity: 1;
}
.field-stack { display: grid; gap: 1rem; }
.schedule-mode-toggle { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); height: auto; gap: .5rem; }
.schedule-mode-toggle :deep(.v-btn) { min-width: 0; min-height: 2.75rem; }
.schedule-mode-toggle :deep(.schedule-mode-toggle--selected) {
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
  opacity: 1;
}
.scheduled-time-setting { min-width: 0; }
.scheduled-time-instance__header { display: flex; min-height: 2.75rem; align-items: center; justify-content: space-between; gap: 1rem; }
.date-grid, .target-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.date-range-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
.step-source-note { display: flex; align-items: flex-start; gap: .65rem; padding: .8rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.step-source-note p { color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.45; }
.step-panels :deep(.v-expansion-panel) { border: 1px solid rgb(var(--v-theme-on-surface) / .08); }
.step-panels :deep(.program-step-panel--draggable .program-step__drag-handle) { cursor: grab; }
.step-panels :deep(.program-step-panel--day-off) { background: rgb(var(--v-theme-background)); }
.completion-requirement-list { display: grid; }
.completion-requirement { display: grid; padding: 0 1rem .5rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .1); border-radius: 1rem; background: rgb(var(--v-theme-background) / .6); cursor: grab; }
.completion-requirement .target-grid { grid-template-columns: 1fr; }
.completion-requirement__header { display: flex; min-height: 2.75rem; align-items: center; gap: .65rem; }
.completion-requirement__header strong { min-width: 0; flex: 1 1 auto; font-size: .78rem; }
.completion-check-summary { display: flex; min-height: 2.75rem; align-items: center; gap: .65rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; }
.completion-style-icon { display: grid; width: 2.125rem; height: 2.125rem; flex: 0 0 auto; place-items: center; border-radius: .6875rem; color: #17200f; }
.completion-style-selection { display: inline-flex; min-width: 0; align-items: center; gap: .5rem; }
.completion-style-selection__icon { display: inline-grid; width: 1.5rem; height: 1.5rem; flex: 0 0 auto; place-items: center; border-radius: .5rem; color: #17200f; }
.day-off-row { display: flex; width: 100%; min-width: 0; align-items: center; gap: .75rem; }
.step-number.day-off-icon { background: rgb(var(--v-theme-background)); color: rgb(var(--v-theme-on-surface) / .68); }
.interval-attachment-summary { display: flex; align-items: center; gap: .75rem; padding: .85rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.flashcard-attachment-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.tracking-attachment-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 11px; color: #17200f; }
.tracking-selection-icon { display: inline-grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; border-radius: .4rem; color: #17200f; }
.journal-task-summary { display: flex; align-items: flex-start; gap: .75rem; }
.journal-task-summary p { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.45; }
.step-number { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .75rem; font-weight: 900; }
.editor-page,
.editor-page--editing { padding-bottom: 5rem; }
@media (min-width: 60rem) {
  .editor-page,
  .editor-page--editing { padding-bottom: 5rem; }
}
@media (min-width: 37.5rem) {
  .weekday-picker :deep(.v-btn) { width: auto; min-width: 0; flex: 1 1 0; }
  .completion-requirement .target-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
