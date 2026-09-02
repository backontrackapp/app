import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import { addDays, parseISO, startOfWeek, subDays } from 'date-fns'
import { api, apiAssetUrl } from '@/lib/api'
import { createLocalRecordId, hasLocalBootstrap, listLocalRecords, repairLegacyHealthConnectEntrySync } from '@/lib/localDatabase'
import { readHealthConnectSteps } from '@/services/healthConnect'
import { healthConnectEntrySession, isHealthConnectEntry } from '@/services/healthConnectEntries'
import { completedIntervalFlashcardReviewSeconds } from '@/services/intervals'
import {
  normalizeExerciseSets,
  normalizeProgramStepCompletions,
  programStepCompletionPayload,
  programStepPrimaryCompletion,
} from '@/services/programStepCompletions'
import { dailyTotalCompletionPercent, isTaskScheduled, meetsTarget, programCycleDay, progressPercent, stepsForDate, toDateKey } from '@/services/schedule'
import { taskNeedsReview } from '@/services/taskCardActions'
import { taskScheduledTimes } from '@/services/taskScheduleLayout'
import { taskGoalTracker } from '@/services/taskTrackers'
import { reconcileTaskReminders } from '@/services/taskReminders'
import { taskSupportsImageLogging, taskSupportsQuickLog } from '@/services/taskTypes'
import { useSnackbarStore } from '@/stores/snackbar'
import { useJournalStore } from '@/stores/journal'
import { useTrackingStore } from '@/stores/tracking'
import type {
  Entry,
  IntervalDefinition,
  IntervalRuntimeState,
  Occurrence,
  ProgramStep,
  Task,
  TaskDraft,
  TaskLogImage,
  TaskLogImageUpdate,
  TaskProgress,
} from '@/types/domain'
import type { ExerciseSet } from '@/types/exercise'

const TASK_PROGRESS_HISTORY_DAYS = 120

const asNumberArray = (value: unknown, fallback: number[] = []) =>
  Array.isArray(value) ? value.map(Number) : fallback

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const asBooleanRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === true || item === 1]))
  : {}

const asWorkoutSetsRecord = (value: unknown): Record<string, ExerciseSet[]> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([completionId, sets]) => [
        completionId,
        normalizeExerciseSets(sets),
      ]))
    : {}
)

function taskInstanceTime(task: Task, scheduledTime = '') {
  return scheduledTime || task.scheduledTimes?.[0] || task.scheduledTime || ''
}

function mapTask(record: Record<string, any>): Task {
  const scheduledTimes = asStringArray(record.scheduled_times)
  const legacyScheduledTime = typeof record.scheduled_time === 'string'
    ? record.scheduled_time
    : ''
  const effectiveScheduledTimes = scheduledTimes.length
    ? scheduledTimes
    : legacyScheduledTime
      ? [legacyScheduledTime]
      : []
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    type: record.type,
    icon: record.icon || undefined,
    color: record.color || undefined,
    mandatory: record.mandatory,
    reviewWhenMissed: record.review_when_missed,
    active: record.active,
    archived: record.archived === true,
    scheduleMode: record.schedule_mode === 'time_based' ? 'time_based' : 'all_day',
    scheduledTime: record.schedule_mode === 'time_based' ? effectiveScheduledTimes[0] : undefined,
    scheduledTimes: record.schedule_mode === 'time_based' ? effectiveScheduledTimes : [],
    startDate: record.start_date,
    endDate: record.end_date || undefined,
    recurrenceType: record.recurrence_type,
    weekdays: asNumberArray(record.weekdays),
    intervalWeeks: Number(record.interval_weeks || 1),
    targetValue: record.target_value || undefined,
    targetOperator: record.target_operator || undefined,
    unit: record.unit || undefined,
    customUnit: record.custom_unit || undefined,
    goalPeriod: record.goal_period || undefined,
    cycleLength: record.cycle_length || undefined,
    programRepeat: record.program_repeat,
    programStrict: record.program_strict,
    quickLogEnabled: taskSupportsQuickLog(record.type) && record.quick_log_enabled === true,
    quickLogSortOrder: Number(record.quick_log_sort_order || 0),
    logWithImagesEnabled: taskSupportsImageLogging(record.type) && record.log_with_images_enabled === true,
    sortOrder: record.sort_order || 0,
    intervalTemplate: record.interval_template || undefined,
    flashcardReviewSet: record.flashcard_review_set || undefined,
    sessionCountMode: record.session_count_mode === 'linked' ? 'linked' : 'task',
    sessionGoalType: record.session_goal_type === 'duration' ? 'duration' : 'complete',
    sessionTargetSeconds: Number(record.session_target_seconds || 0),
    trackingTrackers: asStringArray(record.tracking_trackers),
    reminderEnabled: record.reminder_enabled === true,
    reminderTimes: asStringArray(record.reminder_times),
  }
}

function mapStep(record: Record<string, any>): ProgramStep {
  const completions = normalizeProgramStepCompletions(record)
  const primary = programStepPrimaryCompletion(completions)
  return {
    id: record.id,
    task: record.task,
    name: record.name,
    description: record.description || '',
    sortOrder: record.sort_order || 0,
    cycleDays: asNumberArray(record.cycle_days),
    completionType: record.completion_type === 'day_off' ? 'day_off' : primary?.type || 'check',
    targetValue: primary?.targetValue,
    targetOperator: primary?.targetOperator,
    unit: primary?.unit,
    customUnit: primary?.customUnit,
    active: record.active !== false,
    intervalTemplate: primary?.intervalTemplate,
    flashcardReviewSet: primary?.flashcardReviewSet,
    completions,
  }
}

function mapOccurrence(record: Record<string, any>): Occurrence {
  return {
    id: record.id,
    task: record.task,
    programStep: record.program_step || undefined,
    scheduledDate: record.scheduled_date,
    scheduledTime: record.scheduled_time || undefined,
    status: record.status,
    sealed: record.sealed === true,
    completedAt: record.completed_at || undefined,
    snapshotName: record.snapshot_name,
    snapshotTarget: record.snapshot_target || undefined,
    snapshotUnit: record.snapshot_unit || undefined,
    completionState: asBooleanRecord(record.completion_state),
    workoutSets: asWorkoutSetsRecord(record.workout_sets),
  }
}

function mapEntry(record: Record<string, any>): Entry {
  return {
    id: record.id,
    task: record.task,
    occurrence: record.occurrence || undefined,
    programStep: record.program_step || undefined,
    programStepCompletion: record.program_step_completion || undefined,
    entryDate: record.entry_date,
    createdAt: record.created_at || `${record.entry_date}T00:00:00Z`,
    value: Number(record.value),
    kind: record.kind,
    unit: record.unit || '',
    note: record.note || undefined,
    label: record.label || undefined,
    taskLogImage: record.task_log_image || undefined,
    sourceType: record.source_type || undefined,
    sourceSession: record.source_session || undefined,
  }
}

function mapTaskLogImage(record: Record<string, any>): TaskLogImage {
  return {
    id: record.id,
    task: record.task,
    label: record.label || '',
    amount: Number(record.amount),
    unit: record.unit || '',
    image: record.image_file
      ? apiAssetUrl(`/task-log-images/${record.image_file}`)
      : apiAssetUrl(record.image_url || ''),
    usageCount: Number(record.usage_count || 0),
    active: record.active !== false,
    createdAt: record.created_at || '',
    updatedAt: record.updated_at || '',
  }
}

export const useTaskStore = defineStore('tasks', () => {
  const journalStore = useJournalStore()
  const trackingStore = useTrackingStore()
  const tasks = ref<Task[]>([])
  const steps = ref<ProgramStep[]>([])
  const occurrences = ref<Occurrence[]>([])
  const entries = ref<Entry[]>([])
  const taskLogImages = ref<TaskLogImage[]>([])
  const selectedDate = ref(new Date())
  const loading = ref(false)
  const error = ref('')
  const stepCountLoading = ref(false)
  const stepCountError = ref('')
  const optimisticOccurrencePatches = ref<Partial<Record<string, {
    revision: number
    status?: Occurrence['status']
    sealed?: boolean
    completionState?: Record<string, boolean>
  }>>>({})
  let stepCountRequest = 0
  let progressRangeRequest = 0
  let initialProgressSince = ''
  let reconciledSessionProgressKey = ''
  let reminderSyncPromise: Promise<void> | undefined
  let reminderSyncRequested = false
  let optimisticOccurrenceRevision = 0
  let occurrenceMutationRevision = 0
  let entryMutationRevision = 0
  const loadedProgressRanges = new Set<string>()
  const pendingOccurrenceCreates = new Map<string, Promise<Occurrence>>()
  const pendingOccurrenceValues = new Map<string, Occurrence>()
  const pendingEntryUpserts = new Set<Entry>()
  const pendingEntryDeletes = new Set<string>()
  const pendingProgramShifts = new Set<string>()
  const workoutSetSaveQueues = new Map<string, Promise<void>>()

  const activeTasks = computed(() => tasks.value.filter((task) => task.active && !task.archived))

  function occurrenceStatusKey(
    taskId: string,
    scheduledDate: string,
    programStepId = '',
    scheduledTime = '',
  ) {
    return `${scheduledDate}:${scheduledTime}:${taskId}:${programStepId}`
  }

  function mergePendingOccurrences(loaded: Occurrence[]) {
    const merged = [...loaded]
    for (const [key, pending] of pendingOccurrenceValues) {
      const index = merged.findIndex(item => occurrenceStatusKey(
        item.task,
        item.scheduledDate,
        item.programStep,
        item.scheduledTime,
      ) === key)
      if (index >= 0) merged.splice(index, 1, pending)
      else merged.push(pending)
    }
    return merged
  }

  function mergePendingEntries(loaded: Entry[]) {
    const merged = loaded.filter(entry => !pendingEntryDeletes.has(entry.id))
    for (const pending of pendingEntryUpserts) {
      const index = merged.findIndex(entry => entry.id === pending.id)
      if (index >= 0) merged.splice(index, 1, pending)
      else merged.unshift(pending)
    }
    return merged
  }

  const taskById = computed(() => new Map(tasks.value.map(task => [task.id, task])))
  const stepById = computed(() => new Map(steps.value.map(step => [step.id, step])))
  const occurrenceIndex = computed(() => {
    const byStatusKey = new Map<string, Occurrence>()
    const byDate = new Map<string, Occurrence[]>()
    const programOccurrencesByTask = new Map<string, Occurrence[]>()
    for (const occurrence of occurrences.value) {
      const statusKey = occurrenceStatusKey(
        occurrence.task,
        occurrence.scheduledDate,
        occurrence.programStep,
        occurrence.scheduledTime,
      )
      if (!byStatusKey.has(statusKey)) byStatusKey.set(statusKey, occurrence)
      const dateOccurrences = byDate.get(occurrence.scheduledDate)
      if (dateOccurrences) dateOccurrences.push(occurrence)
      else byDate.set(occurrence.scheduledDate, [occurrence])
      if (occurrence.programStep) {
        const programOccurrences = programOccurrencesByTask.get(occurrence.task)
        if (programOccurrences) programOccurrences.push(occurrence)
        else programOccurrencesByTask.set(occurrence.task, [occurrence])
      }
    }
    return { byStatusKey, byDate, programOccurrencesByTask }
  })

  function programShiftDates(task: Task) {
    return (occurrenceIndex.value.programOccurrencesByTask.get(task.id) || [])
      .filter((occurrence) => {
        const optimisticStatus = optimisticOccurrencePatches.value[
          occurrenceStatusKey(
            occurrence.task,
            occurrence.scheduledDate,
            occurrence.programStep,
            occurrence.scheduledTime,
          )
        ]?.status
        return (optimisticStatus ?? occurrence.status) === 'rescheduled'
      })
      .map(occurrence => occurrence.scheduledDate)
      .filter((date, index, dates) => dates.indexOf(date) === index)
  }

  function programCycleDayForDate(task: Task, date: Date) {
    return programCycleDay(task, date, programShiftDates(task))
  }

  function stepsForTaskDate(task: Task, date: Date) {
    return stepsForDate(task, steps.value, date, programShiftDates(task))
  }

  function taskIsScheduledForDate(task: Task, date: Date) {
    return isTaskScheduled(task, date, programShiftDates(task))
  }
  const taskEntryIndex = computed(() => {
    const byStatusKey = new Map<string, Entry[]>()
    for (const entry of entries.value) {
      const statusKey = occurrenceStatusKey(entry.task, entry.entryDate, entry.programStep)
      const matchingEntries = byStatusKey.get(statusKey)
      if (matchingEntries) matchingEntries.push(entry)
      else byStatusKey.set(statusKey, [entry])
    }
    return byStatusKey
  })
  const trackingEntryTrackerIdsByDate = computed(() => {
    const trackerIdsByDate = new Map<string, Set<string>>()
    for (const entry of trackingStore.entries) {
      const trackerIds = trackerIdsByDate.get(entry.localDate)
      if (trackerIds) trackerIds.add(entry.tracker)
      else trackerIdsByDate.set(entry.localDate, new Set([entry.tracker]))
    }
    return trackerIdsByDate
  })
  const journalEntryCountByTaskDate = computed(() => {
    const counts = new Map<string, number>()
    for (const entry of journalStore.entries) {
      if (!entry.task) continue
      const statusKey = occurrenceStatusKey(entry.task, entry.localDate)
      counts.set(statusKey, (counts.get(statusKey) || 0) + 1)
    }
    return counts
  })

  function entriesFor(task: Task, date: Date, step?: ProgramStep, scheduledTime = '') {
    const instanceTime = taskInstanceTime(task, scheduledTime)
    const weekly = task.goalPeriod === 'week' && !step
    const start = weekly ? startOfWeek(date, { weekStartsOn: 1 }) : date
    const matchingEntries: Entry[] = []
    for (let offset = 0; offset < (weekly ? 7 : 1); offset += 1) {
      const entryDate = toDateKey(addDays(start, offset))
      const entries = taskEntryIndex.value.get(
        occurrenceStatusKey(task.id, entryDate, step?.id),
      ) || []
      if (!instanceTime) {
        matchingEntries.push(...entries)
        continue
      }
      const occurrence = occurrenceFor(task, parseISO(entryDate), step, instanceTime)
      if (occurrence) matchingEntries.push(...entries.filter(entry => entry.occurrence === occurrence.id))
    }
    return matchingEntries
  }

  function occurrenceFor(task: Task, date: Date, step?: ProgramStep, scheduledTime = '') {
    const instanceTime = taskInstanceTime(task, scheduledTime)
    return occurrenceIndex.value.byStatusKey.get(
      occurrenceStatusKey(task.id, toDateKey(date), step?.id, instanceTime),
    )
  }

  function makeProgress(
    task: Task,
    date: Date,
    step?: ProgramStep,
    scheduledTime = '',
  ): TaskProgress {
    const instanceTime = taskInstanceTime(task, scheduledTime)
    const occurrence = occurrenceFor(task, date, step, instanceTime)
    const dateKey = toDateKey(date)
    const optimisticPatch = optimisticOccurrencePatches.value[
      occurrenceStatusKey(task.id, dateKey, step?.id, instanceTime)
    ]
    const goalTracker = !step ? taskGoalTracker(task, trackingStore.trackers) : undefined
    const trackingTrackerIds = !step && task.type === 'tracking' && !goalTracker
      ? [...new Set(task.trackingTrackers ?? [])]
      : []
    const loggedTrackingTrackerIds = trackingEntryTrackerIdsByDate.value.get(dateKey)
    const loggedTrackingTrackerCount = trackingTrackerIds.reduce(
      (count, trackerId) => count + Number(loggedTrackingTrackerIds?.has(trackerId)),
      0,
    )
    const journalEntryCount = !step && task.type === 'journal'
      ? journalEntryCountByTaskDate.value.get(occurrenceStatusKey(task.id, dateKey)) || 0
      : 0
    const matchingEntries = entriesFor(task, date, step, instanceTime)
    const goalTrackingStart = goalTracker?.trackingWindow === 'week'
      ? startOfWeek(date, { weekStartsOn: 1 })
      : date
    const goalTrackingEntries = goalTracker
      ? trackingStore.entries
        .filter(entry => (
          entry.tracker === goalTracker.id
          && entry.localDate >= toDateKey(goalTrackingStart)
          && entry.localDate <= dateKey
        ))
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      : []
    const goalTrackerValue = !goalTracker
      ? 0
      : goalTracker.dailyAggregation === 'average'
        ? goalTrackingEntries.length
          ? goalTrackingEntries.reduce((sum, entry) => sum + entry.value, 0) / goalTrackingEntries.length
          : 0
        : goalTracker.dailyAggregation === 'last'
          ? goalTrackingEntries.at(-1)?.value || 0
          : goalTrackingEntries.reduce((sum, entry) => sum + entry.value, 0)
    const baseValue = goalTracker
      ? goalTrackerValue
      : trackingTrackerIds.length
      ? loggedTrackingTrackerCount
      : !step && task.type === 'journal'
        ? journalEntryCount
      : matchingEntries.reduce((sum, entry) => sum + entry.value, 0)
    const storedStatus = optimisticPatch?.status ?? occurrence?.status ?? 'pending'
    const occurrenceComplete = storedStatus === 'completed'
    const occurrenceSkipped = storedStatus === 'skipped'
    const occurrenceSealed = optimisticPatch?.sealed ?? Boolean(occurrence?.sealed)
    const completionState = optimisticPatch?.completionState ?? occurrence?.completionState ?? {}
    const stepCompletions = step?.completions?.length
      ? step.completions
      : step && step.completionType !== 'day_off'
        ? normalizeProgramStepCompletions({
            completions: [{
              id: 'completion-legacy',
              type: step.completionType,
              targetValue: step.targetValue,
              targetOperator: step.targetOperator,
              unit: step.unit,
              customUnit: step.customUnit,
              intervalTemplate: step.intervalTemplate,
              flashcardReviewSet: step.flashcardReviewSet,
            }],
            completion_type: step.completionType,
            target_value: step.targetValue,
            target_operator: step.targetOperator,
            unit: step.unit,
            custom_unit: step.customUnit,
            interval_template: step.intervalTemplate,
            flashcard_review_set: step.flashcardReviewSet,
          })
        : []
    const completionItems = step ? stepCompletions.map((completion) => {
      const itemEntries = matchingEntries.filter(entry => (
        entry.programStepCompletion === completion.id
        || (stepCompletions.length === 1 && !entry.programStepCompletion)
      ))
      const itemValue = itemEntries.reduce((sum, entry) => sum + entry.value, 0)
      const target = completion.targetValue ?? 1
      const operator = completion.targetOperator || 'gte'
      const legacyComplete = stepCompletions.length === 1
        && !Object.keys(completionState).length
        && occurrenceComplete
      const complete = completion.type === 'quantity'
        ? operator !== 'lte' && meetsTarget(itemValue, target, operator)
        : completionState[completion.id] === true || legacyComplete
      return {
        ...completion,
        value: itemValue,
        percent: completion.type === 'quantity'
          ? progressPercent(itemValue, target, operator)
          : complete ? 100 : 0,
        complete,
      }
    }) : undefined
    const value = completionItems?.length && completionItems.length > 1
      ? completionItems.filter(item => item.complete).length
      : completionItems?.[0]?.type === 'quantity'
        ? completionItems[0].value
        : baseValue
    const isSessionDuration = !step
      && ['interval', 'flashcards'].includes(task.type)
      && task.sessionGoalType === 'duration'
    const target = completionItems?.length && completionItems.length > 1
      ? completionItems.length
      : completionItems?.[0]?.type === 'quantity'
        ? completionItems[0].targetValue ?? 1
        : goalTracker?.targetValue || trackingTrackerIds.length || (!step && task.type === 'journal'
          ? 1
          : isSessionDuration
            ? task.sessionTargetSeconds || 1
            : task.targetValue || 1)
    const operator = completionItems?.[0]?.targetOperator || goalTracker?.targetOperator || task.targetOperator || 'gte'
    const targetReached = task.type === 'tracking' && !step && !goalTracker
      ? trackingTrackerIds.length > 0 && value === target
      : task.type === 'journal' && !step
        ? value > 0
      : meetsTarget(value, target, operator)
    const isOccurrenceDriven = !step
      && ['check', 'interval', 'flashcards'].includes(task.type)
      && !isSessionDuration
    const manuallyCompleted = isSessionDuration && occurrenceComplete && occurrenceSealed
    const manuallyCompletedStep = Boolean(step && occurrenceComplete && occurrenceSealed)
    const isDailyTotal = !step && task.type === 'daily_total'
    const isDurationTotal = !step && task.type === 'duration'
    const isTrackerDailyTotal = goalTracker?.kind === 'number'
      && goalTracker.source !== 'health_connect_steps'
    const isTrackerDurationTotal = goalTracker?.kind === 'duration'
    const sealed = (
      isDailyTotal
      || isDurationTotal
      || isTrackerDailyTotal
      || isTrackerDurationTotal
      || isSessionDuration
    ) && occurrenceSealed
    const complete = occurrenceSkipped
      ? false
      : completionItems
        ? manuallyCompletedStep || (completionItems.length > 0 && completionItems.every(item => item.complete))
        : isOccurrenceDriven
        ? occurrenceComplete
        : manuallyCompleted
          ? true
          : isDailyTotal || isTrackerDailyTotal
            ? sealed
            : (isDurationTotal || isTrackerDurationTotal) && sealed
              ? true
              : operator !== 'lte' && targetReached
    return {
      task,
      scheduledDate: toDateKey(date),
      scheduledTime: instanceTime || undefined,
      occurrence,
      value,
      percent: completionItems
        ? manuallyCompletedStep
          ? 100
          : completionItems.length
            ? Math.round(completionItems.reduce((sum, item) => sum + item.percent, 0) / completionItems.length)
            : 0
        : isOccurrenceDriven || manuallyCompleted
        ? (occurrenceComplete ? 100 : 0)
        : progressPercent(value, target, operator),
      complete,
      sealed,
      status: occurrenceSkipped
        ? 'skipped'
        : complete
          ? 'completed'
          : !isOccurrenceDriven && storedStatus === 'completed'
            ? 'pending'
            : storedStatus,
      programStep: step,
      completionItems,
      tracker: goalTracker,
      locked: step ? isStepLocked(task, step, date, instanceTime) : false,
    }
  }

  function isStepLocked(task: Task, step: ProgramStep, date: Date, scheduledTime = '') {
    if (!task.programStrict) return false
    const currentDay = programCycleDayForDate(task, date)
    if (!currentDay) return false
    const earlierSlots = steps.value
      .filter((candidate) =>
        candidate.active
        && candidate.completionType !== 'day_off'
        && candidate.task === task.id)
      .flatMap((candidate) => candidate.cycleDays.map((day) => ({ candidate, day })))
      .filter(({ candidate, day }) => day < currentDay || (day === currentDay && candidate.sortOrder < step.sortOrder))
    return earlierSlots.some(({ candidate, day }) => {
      const maxLookback = Math.max(task.cycleLength || 1, 1) + programShiftDates(task).length
      let slotDate: Date | undefined = day === currentDay ? date : undefined
      if (!slotDate) {
        for (let offset = 1; offset <= maxLookback; offset += 1) {
          const candidateDate = addDays(date, -offset)
          if (programCycleDayForDate(task, candidateDate) === day) {
            slotDate = candidateDate
            break
          }
        }
      }
      if (!slotDate) return true
      const occurrence = occurrenceFor(task, slotDate, candidate, scheduledTime)
      return !occurrence || occurrence.status === 'pending'
    })
  }

  function progressForDate(date: Date) {
    const result: TaskProgress[] = []
    const includedStatusKeys = new Set<string>()
    const dateKey = toDateKey(date)
    const dateOccurrences = occurrenceIndex.value.byDate.get(dateKey) || []
    const anchoredProgramInstances = new Set(dateOccurrences.flatMap((occurrence) => {
      if (!occurrence.programStep) return []
      const statusKey = occurrenceStatusKey(
        occurrence.task,
        dateKey,
        occurrence.programStep,
        occurrence.scheduledTime,
      )
      const effectiveStatus = optimisticOccurrencePatches.value[statusKey]?.status
        ?? occurrence.status
      const hasActivity = Boolean(
        occurrence.sealed
        || Object.values(occurrence.completionState || {}).some(Boolean)
        || entries.value.some(entry => entry.occurrence === occurrence.id),
      )
      return effectiveStatus !== 'pending' || hasActivity
        ? [`${occurrence.task}:${occurrence.scheduledTime || ''}`]
        : []
    }))
    for (const task of activeTasks.value) {
      if (!taskIsScheduledForDate(task, date)) continue
      const scheduledTimes = taskScheduledTimes(task)
      const instanceTimes = scheduledTimes.length ? scheduledTimes : ['']
      for (const scheduledTime of instanceTimes) {
        if (task.type !== 'program') {
          result.push(makeProgress(task, date, undefined, scheduledTime))
          includedStatusKeys.add(occurrenceStatusKey(task.id, dateKey, '', scheduledTime))
          continue
        }
        for (const step of stepsForTaskDate(task, date)) {
          const statusKey = occurrenceStatusKey(task.id, dateKey, step.id, scheduledTime)
          if (
            anchoredProgramInstances.has(`${task.id}:${scheduledTime}`)
            && !occurrenceIndex.value.byStatusKey.has(statusKey)
          ) continue
          result.push(makeProgress(task, date, step, scheduledTime))
          includedStatusKeys.add(statusKey)
        }
      }
    }
    for (const occurrence of dateOccurrences) {
      const statusKey = occurrenceStatusKey(
        occurrence.task,
        dateKey,
        occurrence.programStep,
        occurrence.scheduledTime,
      )
      if (includedStatusKeys.has(statusKey)) continue
      includedStatusKeys.add(statusKey)
      const task = taskById.value.get(occurrence.task)
      const step = occurrence.programStep ? stepById.value.get(occurrence.programStep) : undefined
      if (!task) continue
      const optimisticStatus = optimisticOccurrencePatches.value[statusKey]?.status
      const effectiveStatus = optimisticStatus ?? occurrence.status
      if (task.type === 'program' && step && effectiveStatus === 'pending') {
        const scheduled = stepsForTaskDate(task, date).some(candidate => candidate.id === step.id)
        const previousDate = toDateKey(subDays(date, 1))
        const carriedFromPreviousDay = occurrenceIndex.value.byStatusKey.get(
          occurrenceStatusKey(task.id, previousDate, step.id, occurrence.scheduledTime),
        )?.status === 'carried'
        const hasActivity = Boolean(
          occurrence.sealed
          || Object.values(occurrence.completionState || {}).some(Boolean)
          || entries.value.some(entry => entry.occurrence === occurrence.id),
        )
        if (!scheduled && !carriedFromPreviousDay && !hasActivity) continue
      }
      result.push(makeProgress(task, date, step, occurrence.scheduledTime))
    }
    return result.sort((a, b) => Number(b.task.mandatory) - Number(a.task.mandatory) || a.task.sortOrder - b.task.sortOrder)
  }

  const selectedProgress = computed(() => progressForDate(selectedDate.value))

  function completionRateForDate(date: Date) {
    const progress = progressForDate(date).filter(item => item.status !== 'skipped')
    if (!progress.length) return undefined
    const earnedProgress = progress.reduce(
      (total, item) => {
        if (!item.programStep && (item.task.type === 'daily_total' || item.tracker)) {
          if (!item.sealed) return total
          return total + dailyTotalCompletionPercent(
            item.value,
            item.tracker?.targetValue || item.task.targetValue || 0,
            item.tracker?.targetOperator || item.task.targetOperator || 'gte',
          )
        }
        return total + Math.max(0, Math.min(item.percent, 100))
      },
      0,
    )
    return Math.round(earnedProgress / progress.length)
  }

  function reviewProgressForDate(date: Date) {
    const selectedDateKey = toDateKey(date)
    if (selectedDateKey > toDateKey(new Date())) return []

    const candidates = new Map<string, TaskProgress>()
    const addCandidate = (item: TaskProgress) => {
      candidates.set(
        occurrenceStatusKey(
          item.task.id,
          item.scheduledDate,
          item.programStep?.id,
          item.scheduledTime,
        ),
        item,
      )
    }

    progressForDate(subDays(date, 1)).forEach(addCandidate)

    for (const task of activeTasks.value) {
      if (
        task.type !== 'program'
        || (!task.programStrict && !task.reviewWhenMissed)
      ) continue
      const retainedHistoryStart = subDays(date, TASK_PROGRESS_HISTORY_DAYS)
      const taskStart = addDays(parseISO(task.startDate), -programShiftDates(task).length)
      const reviewStart = taskStart > retainedHistoryStart ? taskStart : retainedHistoryStart
      for (
        let reviewDate = reviewStart;
        reviewDate < date;
        reviewDate = addDays(reviewDate, 1)
      ) {
        for (const step of stepsForTaskDate(task, reviewDate)) {
          const scheduledTimes = taskScheduledTimes(task)
          for (const scheduledTime of scheduledTimes.length ? scheduledTimes : ['']) {
            addCandidate(makeProgress(task, reviewDate, step, scheduledTime))
          }
        }
      }
    }

    return [...candidates.values()]
      .filter(item => taskNeedsReview(item, selectedDateKey) || Boolean(
        item.programStep
        && item.task.programStrict
        && item.scheduledDate < selectedDateKey
        && item.status === 'pending'
        && !item.complete,
      ))
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)
        || left.task.sortOrder - right.task.sortOrder
        || (left.programStep?.sortOrder ?? 0) - (right.programStep?.sortOrder ?? 0))
  }

  const completionRate = computed(() => completionRateForDate(selectedDate.value) || 0)

  function isTaskIncompleteForReminder(task: Task, date: Date) {
    const dateKey = toDateKey(date)
    const progress: TaskProgress[] = []
    const includedStatusKeys = new Set<string>()
    if (task.active && !task.archived && taskIsScheduledForDate(task, date)) {
      const scheduledSteps = task.type === 'program'
        ? stepsForTaskDate(task, date)
        : [undefined]
      const scheduledTimes = taskScheduledTimes(task)
      for (const scheduledTime of scheduledTimes.length ? scheduledTimes : ['']) {
        for (const step of scheduledSteps) {
          progress.push(makeProgress(task, date, step, scheduledTime))
          includedStatusKeys.add(occurrenceStatusKey(task.id, dateKey, step?.id, scheduledTime))
        }
      }
    }
    for (const occurrence of occurrenceIndex.value.byDate.get(dateKey) || []) {
      if (occurrence.task !== task.id) continue
      const statusKey = occurrenceStatusKey(
        task.id,
        dateKey,
        occurrence.programStep,
        occurrence.scheduledTime,
      )
      if (includedStatusKeys.has(statusKey)) continue
      includedStatusKeys.add(statusKey)
      const step = occurrence.programStep ? stepById.value.get(occurrence.programStep) : undefined
      progress.push(makeProgress(task, date, step, occurrence.scheduledTime))
    }
    return progress.length > 0 && progress.some(item => !item.complete)
  }

  function syncTaskReminders() {
    reminderSyncRequested = true
    if (!reminderSyncPromise) {
      reminderSyncPromise = runTaskReminderSync().finally(() => {
        reminderSyncPromise = undefined
      })
    }
    return reminderSyncPromise
  }

  async function runTaskReminderSync() {
    while (reminderSyncRequested) {
      reminderSyncRequested = false
      try {
        await reconcileTaskReminders(tasks.value, {
          isTaskIncomplete: isTaskIncompleteForReminder,
        })
      } catch {
        // Reminder maintenance must not prevent task data from saving.
      }
    }
  }

  async function load() {
    if (!api.authStore.record) return
    const startedAtOccurrenceMutationRevision = occurrenceMutationRevision
    const startedAtEntryMutationRevision = entryMutationRevision
    loading.value = true
    error.value = ''
    try {
      await repairLegacyHealthConnectEntrySync(api.authStore.record.id)
      const since = toDateKey(subDays(new Date(), TASK_PROGRESS_HISTORY_DAYS))
      const [taskRecords, stepRecords, occurrenceRecords, entryRecords] = await Promise.all([
        api.collection('tasks').getFullList({ sort: 'sort_order' }),
        api.collection('program_steps').getFullList({ sort: 'sort_order' }),
        api.collection('occurrences').getFullList({
          filter: `scheduled_date >= "${since}" || status = "rescheduled"`,
          sort: '-scheduled_date',
        }),
        api.collection('entries').getFullList({ filter: `entry_date >= "${since}"`, sort: '-created_at' }),
      ])
      tasks.value = taskRecords.map(mapTask)
      steps.value = stepRecords.map(mapStep)
      if (
        startedAtOccurrenceMutationRevision === occurrenceMutationRevision
        && startedAtEntryMutationRevision === entryMutationRevision
      ) {
        occurrences.value = mergePendingOccurrences(occurrenceRecords.map(mapOccurrence))
      }
      if (startedAtEntryMutationRevision === entryMutationRevision) {
        entries.value = mergePendingEntries(entryRecords.map(mapEntry))
      }
      const reconciliationKey = `${api.authStore.record.id}:${since}`
      if (reconciledSessionProgressKey !== reconciliationKey) {
        const reconciled = await api.reconcileSessionTaskProgress?.(since)
        reconciled?.occurrences.forEach(upsertOccurrenceRecord)
        reconciled?.entries.forEach(upsertEntryRecord)
        reconciledSessionProgressKey = reconciliationKey
      }
      initialProgressSince = since
      loadedProgressRanges.clear()
      await reconcileLocalSessionProgress(since)
      await syncTaskReminders()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load your plan.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function loadProgressRange(start: string, end: string) {
    if (initialProgressSince && start >= initialProgressSince) return true
    const rangeKey = `${start}:${end}`
    if (loadedProgressRanges.has(rangeKey)) return true
    const request = ++progressRangeRequest
    const startedAtOccurrenceMutationRevision = occurrenceMutationRevision
    const startedAtEntryMutationRevision = entryMutationRevision
    try {
      const [occurrenceRecords, entryRecords] = await Promise.all([
        api.collection('occurrences').getFullList({
          filter: `scheduled_date >= "${start}" && scheduled_date <= "${end}"`,
          sort: '-scheduled_date',
        }),
        api.collection('entries').getFullList({
          filter: `entry_date >= "${start}" && entry_date <= "${end}"`,
          sort: '-created_at',
        }),
      ])
      if (request !== progressRangeRequest) return false
      if (
        startedAtOccurrenceMutationRevision === occurrenceMutationRevision
        && startedAtEntryMutationRevision === entryMutationRevision
      ) {
        const mergedOccurrences = new Map(occurrences.value.map((item) => [item.id, item]))
        occurrenceRecords.map(mapOccurrence).forEach((item) => mergedOccurrences.set(item.id, item))
        occurrences.value = mergePendingOccurrences([...mergedOccurrences.values()])
      }
      if (startedAtEntryMutationRevision === entryMutationRevision) {
        const mergedEntries = new Map(entries.value.map((item) => [item.id, item]))
        entryRecords.map(mapEntry).forEach((item) => mergedEntries.set(item.id, item))
        entries.value = mergePendingEntries([...mergedEntries.values()])
      }
      loadedProgressRanges.add(rangeKey)
      await syncTaskReminders()
      return true
    } catch (cause) {
      if (request === progressRangeRequest) {
        error.value = cause instanceof Error ? cause.message : 'Could not load task progress for this week.'
      }
      throw cause
    }
  }

  async function refreshStepCount(date = selectedDate.value) {
    const request = ++stepCountRequest
    const legacyStepTasks = activeTasks.value.filter(
      task => task.type === 'step_counter' && isTaskScheduled(task, date),
    )
    const stepTrackerIds = activeTasks.value.flatMap((task) => {
      if (!isTaskScheduled(task, date)) return []
      const tracker = taskGoalTracker(task, trackingStore.trackers)
      return tracker?.source === 'health_connect_steps' ? [tracker.id] : []
    })
    if (!legacyStepTasks.length && !stepTrackerIds.length) {
      stepCountLoading.value = false
      stepCountError.value = ''
      return
    }

    stepCountLoading.value = true
    stepCountError.value = ''
    await nextTick()
    try {
      const value = await readHealthConnectSteps(date)
      if (request !== stepCountRequest) return
      const entryDate = toDateKey(date)
      for (const task of legacyStepTasks) {
        const occurrence = await ensureOccurrence(task, date)
        const existing = entries.value.find(entry => (
          entry.task === task.id
          && !entry.programStep
          && entry.entryDate === entryDate
          && isHealthConnectEntry(entry)
          && (entry.sourceSession === entryDate
            || entry.sourceSession === healthConnectEntrySession(entryDate))
        ))
        const payload = {
          occurrence: occurrence.id,
          entry_date: entryDate,
          value,
          kind: 'quantity',
          unit: 'steps',
          note: '',
          source_type: '',
          source_session: healthConnectEntrySession(entryDate),
        }
        const unchanged = existing
          && existing.occurrence === payload.occurrence
          && existing.value === payload.value
          && existing.kind === payload.kind
          && existing.unit === payload.unit
          && (existing.note || '') === payload.note
          && !existing.sourceType
          && existing.sourceSession === payload.source_session
        if (unchanged) {
          await syncEntryProgress(makeProgress(task, date))
          continue
        }
        const record = existing
          ? await api.collection('entries').update(existing.id, payload)
          : await api.collection('entries').create({
              owner: api.authStore.record!.id,
              task: task.id,
              program_step: '',
              ...payload,
            })
        upsertEntryRecord(record)
        await syncEntryProgress(makeProgress(task, date))
      }
      await trackingStore.syncHealthConnectSteps(stepTrackerIds, toDateKey(date), value)
      for (const task of activeTasks.value) {
        const tracker = taskGoalTracker(task, trackingStore.trackers)
        if (!tracker || !stepTrackerIds.includes(tracker.id)) continue
        await syncEntryProgress(makeProgress(task, date))
      }
    } catch (cause) {
      if (request !== stepCountRequest) return
      await syncTaskReminders()
      stepCountError.value = cause instanceof Error
        ? cause.message
        : 'Your Health Connect steps could not be loaded.'
    } finally {
      if (request === stepCountRequest) stepCountLoading.value = false
    }
  }

  async function ensureOccurrence(
    task: Task,
    date: Date,
    step?: ProgramStep,
    scheduledTime = '',
  ) {
    const instanceTime = taskInstanceTime(task, scheduledTime)
    const existing = occurrenceFor(task, date, step, instanceTime)
    const key = occurrenceStatusKey(task.id, toDateKey(date), step?.id, instanceTime)
    if (existing) return pendingOccurrenceCreates.get(key) || existing

    const goalTracker = !step ? taskGoalTracker(task, trackingStore.trackers) : undefined
    const occurrence: Occurrence = {
      id: createLocalRecordId(),
      task: task.id,
      programStep: step?.id,
      scheduledDate: toDateKey(date),
      scheduledTime: instanceTime || undefined,
      status: 'pending',
      sealed: false,
      snapshotName: step?.name || task.name,
      snapshotTarget: step?.completions && step.completions.length > 1
        ? step.completions.length
        : step?.completions?.[0]?.targetValue
          ?? step?.targetValue
          ?? goalTracker?.targetValue
          ?? task.targetValue
          ?? 0,
      snapshotUnit: step?.completions && step.completions.length > 1
        ? 'requirements'
        : step?.completions?.[0]?.customUnit
          || step?.completions?.[0]?.unit
          || step?.customUnit
          || step?.unit
          || goalTracker?.unit
          || task.customUnit
          || task.unit
          || '',
      completionState: {},
      workoutSets: {},
    }
    occurrences.value.push(occurrence)
    pendingOccurrenceValues.set(key, occurrence)

    const persistence = (async () => {
      try {
        const record = await api.collection('occurrences').create({
          owner: api.authStore.record!.id,
          task: task.id,
          program_step: step?.id || '',
          scheduled_date: occurrence.scheduledDate,
          scheduled_time: occurrence.scheduledTime || '',
          status: 'pending',
          sealed: false,
          snapshot_name: occurrence.snapshotName,
          snapshot_target: occurrence.snapshotTarget,
          snapshot_unit: occurrence.snapshotUnit || '',
          completion_state: {},
          workout_sets: {},
        })
        Object.assign(occurrence, mapOccurrence(record))
        return occurrence
      } catch (cause) {
        occurrences.value = occurrences.value.filter(item => item !== occurrence)
        throw cause
      } finally {
        pendingOccurrenceCreates.delete(key)
        pendingOccurrenceValues.delete(key)
      }
    })()
    pendingOccurrenceCreates.set(key, persistence)
    return persistence
  }

  async function updateOccurrenceOptimistically(
    progress: TaskProgress,
    patch: {
      status?: Occurrence['status']
      sealed?: boolean
      completedAt?: string
      completionState?: Record<string, boolean>
    },
    waitFor?: Promise<unknown>,
  ) {
    occurrenceMutationRevision += 1
    const progressDate = parseISO(progress.scheduledDate)
    const key = occurrenceStatusKey(
      progress.task.id,
      progress.scheduledDate,
      progress.programStep?.id,
      progress.scheduledTime,
    )
    const revision = ++optimisticOccurrenceRevision
    optimisticOccurrencePatches.value = {
      ...optimisticOccurrencePatches.value,
      [key]: {
        revision,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.sealed !== undefined ? { sealed: patch.sealed } : {}),
        ...(patch.completionState !== undefined ? { completionState: patch.completionState } : {}),
      },
    }
    try {
      if (waitFor) await waitFor
      const occurrence = await ensureOccurrence(
        progress.task,
        progressDate,
        progress.programStep,
        progress.scheduledTime,
      )
      const payload: Record<string, unknown> = {}
      if (patch.status !== undefined) payload.status = patch.status
      if (patch.sealed !== undefined) payload.sealed = patch.sealed
      if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt
      if (patch.completionState !== undefined) payload.completion_state = patch.completionState
      const record = await api.collection('occurrences').update(occurrence.id, payload)
      return upsertOccurrenceRecord(record)
    } finally {
      if (optimisticOccurrencePatches.value[key]?.revision === revision) {
        const nextPatches = { ...optimisticOccurrencePatches.value }
        delete nextPatches[key]
        optimisticOccurrencePatches.value = nextPatches
      }
      occurrenceMutationRevision += 1
    }
  }

  async function toggleComplete(progress: TaskProgress, complete: boolean) {
    const progressDate = parseISO(progress.scheduledDate)
    const existing = occurrenceFor(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    if (existing && (existing.status === 'completed') === complete) return
    await updateOccurrenceOptimistically(progress, {
      status: complete ? 'completed' : 'pending',
      completedAt: complete ? new Date().toISOString() : '',
    })
    void syncTaskReminders()
  }

  async function saveProgramStepWorkoutSets(
    progress: TaskProgress,
    completionId: string,
    value: ExerciseSet[],
  ) {
    const stepId = progress.programStep?.id
    if (!stepId) return
    const stepIndex = steps.value.findIndex(step => step.id === stepId)
    const step = stepIndex >= 0 ? steps.value[stepIndex]! : progress.programStep
    const completion = step.completions?.find(item => item.id === completionId)
    if (completion?.type !== 'workout') return

    const exerciseSets = normalizeExerciseSets(value)
    const completions = (step.completions || []).map(item => (
      item.id === completionId ? { ...item, exerciseSets } : item
    ))
    if (stepIndex >= 0) {
      steps.value = steps.value.toSpliced(stepIndex, 1, { ...step, completions })
    }

    const queueKey = `${stepId}:${completionId}`
    const previousSave = workoutSetSaveQueues.get(queueKey) || Promise.resolve()
    const save = previousSave.catch(() => undefined).then(async () => {
      const occurrence = await ensureOccurrence(
        progress.task,
        parseISO(progress.scheduledDate),
        step,
        progress.scheduledTime,
      )
      const workoutSets = {
        ...(occurrence.workoutSets || {}),
        [completionId]: exerciseSets,
      }
      occurrence.workoutSets = workoutSets

      await Promise.all([
        api.collection('program_steps').update(stepId, {
          completions: programStepCompletionPayload(completions),
        }),
        api.collection('occurrences').update(occurrence.id, { workout_sets: workoutSets }),
      ])
    })
    workoutSetSaveQueues.set(queueKey, save)
    try {
      await save
    } finally {
      if (workoutSetSaveQueues.get(queueKey) === save) {
        workoutSetSaveQueues.delete(queueKey)
      }
    }
  }

  async function setProgramStepCompletion(
    progress: TaskProgress,
    completionId: string,
    complete: boolean,
  ) {
    if (!progress.programStep?.completions?.some(item => item.id === completionId)) return
    const currentCompletion = progress.completionItems?.find(item => item.id === completionId)
    if (currentCompletion?.complete === complete) return
    const completionState = {
      ...(progress.occurrence?.completionState || {}),
      ...(optimisticOccurrencePatches.value[
        occurrenceStatusKey(
          progress.task.id,
          progress.scheduledDate,
          progress.programStep.id,
          progress.scheduledTime,
        )
      ]?.completionState || {}),
      [completionId]: complete,
    }
    const completionItems = progress.completionItems?.map(item => (
      item.id === completionId ? { ...item, complete } : item
    )) || []
    const stepComplete = completionItems.length > 0 && completionItems.every(item => item.complete)
    await updateOccurrenceOptimistically(progress, {
      completionState,
      status: stepComplete ? 'completed' : 'pending',
      sealed: false,
      completedAt: stepComplete ? new Date().toISOString() : '',
    })
    void syncTaskReminders()
  }

  async function markProgramStepIncomplete(progress: TaskProgress) {
    if (!progress.programStep || !progress.complete) return
    const completionState = {
      ...(progress.occurrence?.completionState || {}),
      ...(optimisticOccurrencePatches.value[
        occurrenceStatusKey(
          progress.task.id,
          progress.scheduledDate,
          progress.programStep.id,
          progress.scheduledTime,
        )
      ]?.completionState || {}),
    }
    const clearableCompletionIds = (progress.completionItems || [])
      .filter(item => item.type !== 'quantity' && item.complete)
      .map(item => item.id)
    if (!clearableCompletionIds.length && !progress.sealed) return
    clearableCompletionIds.forEach((completionId) => {
      completionState[completionId] = false
    })
    await updateOccurrenceOptimistically(progress, {
      completionState,
      status: 'pending',
      sealed: false,
      completedAt: '',
    })
    void syncTaskReminders()
  }

  async function completeAttributedTask(
    taskId: string,
    dateKey: string,
    programStepId = '',
    programStepCompletionId = '',
    preserveRecordedCompletion = false,
    scheduledTime = '',
  ) {
    if (!taskId || !dateKey) return undefined
    const progress = progressForDate(parseISO(dateKey)).find(item => (
      item.task.id === taskId
      && (item.programStep?.id || '') === programStepId
      && (!scheduledTime || item.scheduledTime === scheduledTime)
    ))
    if (!progress) return undefined
    if (programStepId && programStepCompletionId) {
      if (
        preserveRecordedCompletion
        && Object.prototype.hasOwnProperty.call(
          progress.occurrence?.completionState || {},
          programStepCompletionId,
        )
      ) return progress.occurrence
      await setProgramStepCompletion(progress, programStepCompletionId, true)
    } else if (!progress.complete) await toggleComplete(progress, true)
    return occurrenceFor(
      progress.task,
      parseISO(dateKey),
      progress.programStep,
      progress.scheduledTime,
    )
  }

  async function applyLocalSessionProgress(input: {
    id: string
    sourceType: 'interval' | 'flashcards'
    sourceId?: string
    taskId?: string
    programStepId?: string
    programStepCompletionId?: string
    taskDate?: string
    taskScheduledTime?: string
    startedAt: string
    status: 'completed' | 'ended'
    elapsedSeconds: number
    completedAt: string
  }, syncReminders = true, preserveRecordedProgramCompletion = false) {
    if (!tasks.value.length) await load()
    const taskDate = input.taskDate || toDateKey(new Date(input.startedAt))
    const workoutIntervalNeedsConfirmation = !input.programStepCompletionId
      && input.programStepId
      && steps.value.find(step => step.id === input.programStepId)?.completions?.some(completion => (
        completion.type === 'workout' && completion.intervalTemplate === input.sourceId
      ))
    if (
      input.programStepId
      && input.taskId
      && input.status === 'completed'
      && !workoutIntervalNeedsConfirmation
    ) {
      await completeAttributedTask(
        input.taskId,
        taskDate,
        input.programStepId,
        input.programStepCompletionId,
        preserveRecordedProgramCompletion,
        input.taskScheduledTime,
      )
    }
    if (!input.sourceId) return

    const date = parseISO(taskDate)
    const candidates = tasks.value.filter(task => (
      task.active
      && !task.archived
      && task.type === input.sourceType
      && (input.sourceType === 'interval'
        ? task.intervalTemplate === input.sourceId
        : task.flashcardReviewSet === input.sourceId)
      && (task.id === input.taskId || task.sessionCountMode === 'linked')
      && isTaskScheduled(task, date)
    ))
    for (const task of candidates) {
      if (task.sessionGoalType !== 'duration') {
        if (input.status === 'completed') {
          await completeAttributedTask(task.id, taskDate, '', '', false, input.taskScheduledTime)
        }
        continue
      }
      if (input.elapsedSeconds <= 0) continue
      const existingEntry = entries.value.find(entry => (
        entry.task === task.id
        && entry.sourceType === input.sourceType
        && entry.sourceSession === input.id
      ))
      if (existingEntry) continue

      const occurrence = await ensureOccurrence(task, date, undefined, input.taskScheduledTime)
      const record = await api.collection('entries').create({
        owner: api.authStore.record!.id,
        task: task.id,
        occurrence: occurrence.id,
        program_step: '',
        entry_date: taskDate,
        value: Math.max(0, Math.round(input.elapsedSeconds)),
        kind: 'duration',
        unit: 'seconds',
        note: '',
        source_type: input.sourceType,
        source_session: input.id,
      })
      upsertEntryRecord(record)
      const updated = makeProgress(task, date, undefined, input.taskScheduledTime)
      if (updated.complete && occurrence.status !== 'completed') {
        await updateOccurrenceOptimistically(updated, {
          status: 'completed',
          completedAt: input.completedAt,
        })
      }
    }
    if (syncReminders) await syncTaskReminders()
  }

  async function reconcileLocalSessionProgress(since: string) {
    const accountId = api.authStore.record?.id || ''
    if (!tasks.value.length || !accountId || !await hasLocalBootstrap(accountId)) return
    const [intervalSessions, flashcardSessions] = await Promise.all([
      listLocalRecords(accountId, 'interval_sessions'),
      listLocalRecords(accountId, 'flashcard_review_sessions'),
    ])
    const sessions = [
      ...intervalSessions.map(session => ({
        record: session,
        sourceType: 'interval' as const,
        sourceId: String(session.template || ''),
      })),
      ...flashcardSessions.map(session => ({
        record: session,
        sourceType: 'flashcards' as const,
        sourceId: String(session.review_set || ''),
      })),
    ]
    for (const { record, sourceType, sourceId } of sessions) {
      const status = String(record.status || '')
      if (status !== 'completed' && status !== 'ended') continue
      const startedAt = String(record.started_at || '')
      const taskDate = String(record.task_date || '')
      if (!startedAt || (startedAt.slice(0, 10) < since && (!taskDate || taskDate < since))) continue
      await applyLocalSessionProgress({
        id: String(record.id || ''),
        sourceType,
        sourceId,
        taskId: String(record.task || ''),
        programStepId: String(record.program_step || ''),
        programStepCompletionId: String(record.program_step_completion || ''),
        taskDate,
        taskScheduledTime: String(record.task_scheduled_time || ''),
        startedAt,
        status,
        elapsedSeconds: Number(record.elapsed_seconds || 0),
        completedAt: String(record.ended_at || record.updated_at || new Date().toISOString()),
      }, false, true)
      if (sourceType !== 'interval') continue
      const snapshot = record.flashcard_snapshot
      const definition = record.definition_snapshot
      const runtime = record.runtime_state
      const reviewSetId = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? String((snapshot as Record<string, unknown>).reviewSet || '')
        : ''
      if (
        !reviewSetId
        || !definition
        || typeof definition !== 'object'
        || Array.isArray(definition)
        || !runtime
        || typeof runtime !== 'object'
        || Array.isArray(runtime)
      ) continue
      const reviewElapsedSeconds = completedIntervalFlashcardReviewSeconds(
        definition as unknown as IntervalDefinition,
        runtime as unknown as IntervalRuntimeState,
        Number(record.elapsed_seconds || 0),
      )
      if (reviewElapsedSeconds <= 0) continue
      await applyLocalSessionProgress({
        id: String(record.id || ''),
        sourceType: 'flashcards',
        sourceId: reviewSetId,
        taskDate: String(record.task_date || ''),
        taskScheduledTime: String(record.task_scheduled_time || ''),
        startedAt,
        status,
        elapsedSeconds: reviewElapsedSeconds,
        completedAt: String(record.ended_at || record.updated_at || new Date().toISOString()),
      }, false)
    }
  }

  async function setTotalSealed(progress: TaskProgress) {
    const trackerCanSeal = Boolean(
      progress.tracker && progress.tracker.source !== 'health_connect_steps',
    )
    if (
      (
        !['daily_total', 'duration'].includes(progress.task.type)
        && !trackerCanSeal
      )
      || progress.programStep
    ) return
    const sealed = !progress.sealed
    await updateOccurrenceOptimistically(progress, {
      sealed,
      status: sealed ? 'completed' : 'pending',
      completedAt: sealed ? new Date().toISOString() : '',
    })
    void syncTaskReminders()
  }

  async function addEntry(
    progress: TaskProgress,
    amount: number,
    kind?: Entry['kind'],
    programStepCompletionId = '',
    imageLog?: Pick<TaskLogImage, 'id' | 'label'>,
  ) {
    if (progress.sealed) return
    if (amount === 0) throw new Error('Task log entries cannot have a value of zero.')
    entryMutationRevision += 1
    const progressDate = parseISO(progress.scheduledDate)
    const occurrencePromise = ensureOccurrence(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    const occurrence = occurrenceFor(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )!
    const completion = progress.programStep?.completions?.find(
      item => item.id === programStepCompletionId,
    )
    const unit = completion?.customUnit
      || completion?.unit
      || progress.programStep?.customUnit
      || progress.programStep?.unit
      || progress.task.customUnit
      || progress.task.unit
      || (progress.task.type === 'duration' ? 'hours' : '')
    const entry: Entry = {
      id: createLocalRecordId(),
      task: progress.task.id,
      occurrence: occurrence.id,
      programStep: progress.programStep?.id,
      programStepCompletion: programStepCompletionId || undefined,
      entryDate: progress.scheduledDate,
      createdAt: new Date().toISOString(),
      value: amount,
      kind: kind || (progress.task.type === 'duration' ? 'duration' : 'quantity'),
      unit,
      label: imageLog?.label,
      taskLogImage: imageLog?.id,
    }
    entries.value.unshift(entry)
    pendingEntryUpserts.add(entry)
    const persistence = (async () => {
      const persistedOccurrence = await occurrencePromise
      entry.occurrence = persistedOccurrence.id
      const record = await api.collection('entries').create({
        owner: api.authStore.record!.id,
        task: entry.task,
        occurrence: entry.occurrence,
        program_step: entry.programStep || '',
        program_step_completion: entry.programStepCompletion || '',
        entry_date: entry.entryDate,
        value: entry.value,
        kind: entry.kind,
        unit: entry.unit,
        note: '',
        label: entry.label || '',
        task_log_image: entry.taskLogImage || '',
      })
      Object.assign(entry, mapEntry(record))
      return entry
    })()
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
    } catch (cause) {
      entries.value = entries.value.filter(item => item !== entry)
      throw cause
    } finally {
      pendingEntryUpserts.delete(entry)
      entryMutationRevision += 1
    }
  }

  async function updateEntry(progress: TaskProgress, entryId: string, amount: number) {
    if (progress.sealed) return undefined
    if (amount === 0) throw new Error('Task log entries cannot have a value of zero.')
    const index = entries.value.findIndex(item => item.id === entryId)
    const previous = index >= 0 ? { ...entries.value[index]! } : undefined
    const entry = index >= 0
      ? entries.value[index]!
      : {
          id: entryId,
          task: progress.task.id,
          occurrence: progress.occurrence?.id,
          programStep: progress.programStep?.id,
          entryDate: progress.scheduledDate,
          createdAt: new Date().toISOString(),
          value: amount,
          kind: progress.task.type === 'duration' ? 'duration' : 'quantity',
          unit: progress.programStep?.customUnit
            || progress.programStep?.unit
            || progress.task.customUnit
            || progress.task.unit
            || '',
        } satisfies Entry
    entryMutationRevision += 1
    entry.value = amount
    if (index < 0) entries.value.unshift(entry)
    pendingEntryUpserts.add(entry)
    const persistence = api.collection('entries').update(entryId, {
      value: amount,
    }).then((record) => {
      Object.assign(entry, mapEntry(record))
      return entry
    })
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
      return entry
    } catch (cause) {
      if (previous) Object.assign(entry, previous)
      else entries.value = entries.value.filter(item => item !== entry)
      throw cause
    } finally {
      pendingEntryUpserts.delete(entry)
      entryMutationRevision += 1
    }
  }

  async function deleteEntry(progress: TaskProgress, entryId: string) {
    if (progress.sealed) return false
    const index = entries.value.findIndex(entry => entry.id === entryId)
    const entry = index >= 0 ? entries.value[index] : undefined
    entryMutationRevision += 1
    pendingEntryDeletes.add(entryId)
    if (index >= 0) entries.value.splice(index, 1)
    const persistence = api.collection('entries').delete(entryId)
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
    } catch (cause) {
      if (entry && !entries.value.includes(entry)) entries.value.splice(index, 0, entry)
      throw cause
    } finally {
      pendingEntryDeletes.delete(entryId)
      entryMutationRevision += 1
    }
    useSnackbarStore().showDeletion('Log')
    return true
  }

  async function syncEntryProgress(progress: TaskProgress, waitFor?: Promise<unknown>) {
    const progressDate = parseISO(progress.scheduledDate)
    const updated = makeProgress(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    const isCheck = !progress.programStep && progress.task.type === 'check'
    const occurrence = occurrenceFor(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    if (!isCheck && occurrence) {
      const shouldComplete = updated.complete
      const nextStatus = shouldComplete ? 'completed' : 'pending'
      if (occurrence.status !== nextStatus) {
        await updateOccurrenceOptimistically(updated, {
          status: nextStatus,
          completedAt: shouldComplete ? new Date().toISOString() : '',
        }, waitFor)
      }
    }
    void syncTaskReminders()
  }

  async function loadEntriesForDay(
    taskId: string,
    entryDate: string,
    programStepId?: string,
    occurrenceId?: string,
  ) {
    const stepFilter = programStepId
      ? `program_step = "${programStepId}"`
      : 'program_step = ""'
    const occurrenceFilter = occurrenceId ? ` && occurrence = "${occurrenceId}"` : ''
    const records = await api.collection('entries').getFullList({
      filter: `task = "${taskId}" && entry_date = "${entryDate}" && ${stepFilter}${occurrenceFilter}`,
      sort: '-created_at',
    })
    return records.map(mapEntry)
  }

  async function loadTaskLogImages(taskId: string) {
    const records = await api.collection('task_log_images').getFullList({
      filter: `task = "${taskId}" && active = true`,
      sort: '-usage_count,-updated_at',
    })
    const images = records.map(mapTaskLogImage)
    taskLogImages.value = [
      ...taskLogImages.value.filter(item => item.task !== taskId),
      ...images,
    ]
    return images
  }

  async function logTaskImage(
    progress: TaskProgress,
    imageLog: TaskLogImage,
    programStepCompletionId = '',
  ) {
    if (progress.sealed) return
    await addEntry(progress, imageLog.amount, undefined, programStepCompletionId, imageLog)
    const previousCount = imageLog.usageCount
    imageLog.usageCount += 1
    try {
      const record = await api.collection('task_log_images').update(imageLog.id, {
        usage_count: imageLog.usageCount,
        updated_at: new Date().toISOString(),
      })
      Object.assign(imageLog, mapTaskLogImage(record))
    } catch {
      imageLog.usageCount = previousCount
    }
  }

  async function createTaskLogImage(
    progress: TaskProgress,
    input: { label: string; amount: number; image: Blob },
    programStepCompletionId = '',
  ) {
    const unit = progress.programStep?.customUnit
      || progress.programStep?.unit
      || progress.task.customUnit
      || progress.task.unit
      || (progress.task.type === 'duration' ? 'hours' : '')
    const record = await api.collection('task_log_images').create({
      owner: api.authStore.record!.id,
      task: progress.task.id,
      label: input.label.trim(),
      amount: input.amount,
      unit,
      active: true,
    })
    const imageLog = mapTaskLogImage(record)
    taskLogImages.value.unshift(imageLog)
    try {
      Object.assign(imageLog, mapTaskLogImage(await api.updateTaskLogImage(imageLog.id, input.image)))
      await logTaskImage(progress, imageLog, programStepCompletionId)
      return imageLog
    } catch (cause) {
      taskLogImages.value = taskLogImages.value.filter(item => item !== imageLog)
      await api.collection('task_log_images').delete(imageLog.id).catch(() => undefined)
      throw cause
    }
  }

  async function updateTaskLogImage(imageLog: TaskLogImage, input: TaskLogImageUpdate) {
    const previous = { ...imageLog }
    const updatedAt = new Date().toISOString()
    imageLog.label = input.label.trim()
    imageLog.amount = input.amount
    imageLog.updatedAt = updatedAt
    try {
      const record = await api.collection('task_log_images').update(imageLog.id, {
        label: imageLog.label,
        amount: imageLog.amount,
        updated_at: updatedAt,
      })
      Object.assign(imageLog, mapTaskLogImage(record))
      if (input.image) {
        Object.assign(imageLog, mapTaskLogImage(await api.updateTaskLogImage(imageLog.id, input.image)))
      }
      return imageLog
    } catch (cause) {
      Object.assign(imageLog, previous)
      throw cause
    }
  }

  async function archiveTaskLogImage(imageLog: TaskLogImage) {
    const previous = { ...imageLog }
    imageLog.active = false
    try {
      const record = await api.collection('task_log_images').update(imageLog.id, {
        active: false,
        updated_at: new Date().toISOString(),
      })
      Object.assign(imageLog, mapTaskLogImage(record))
    } catch (cause) {
      Object.assign(imageLog, previous)
      throw cause
    }
  }

  async function setStatus(progress: TaskProgress, status: Occurrence['status']) {
    if (status === 'carried' && (progress.task.type === 'program' || progress.programStep)) {
      throw new Error('Programs can only be marked missed or shifted.')
    }
    const progressDate = parseISO(progress.scheduledDate)
    const statusUpdate = updateOccurrenceOptimistically(progress, {
      status,
      sealed: status === 'completed',
      completedAt: status === 'completed' ? new Date().toISOString() : '',
    })
    const carriedOccurrence = status === 'carried'
      ? ensureOccurrence(
          progress.task,
          addDays(progressDate, 1),
          progress.programStep,
          progress.scheduledTime,
        )
      : undefined
    await Promise.all([statusUpdate, carriedOccurrence])
    void syncTaskReminders()
  }

  async function saveTask(draft: TaskDraft) {
    error.value = ''
    const sortOrder = draft.id
      ? draft.sortOrder
      : tasks.value.reduce((highest, task) => Math.max(highest, task.sortOrder), -1) + 1
    const quickLogSortOrder = draft.id
      ? draft.quickLogSortOrder ?? draft.sortOrder
      : tasks.value.reduce((highest, task) => Math.max(
          highest,
          task.quickLogSortOrder ?? task.sortOrder,
        ), -1) + 1
    const scheduledTimes = draft.scheduleMode === 'time_based'
      ? [...new Set(draft.scheduledTimes?.length ? draft.scheduledTimes : [draft.scheduledTime || ''])]
          .filter(Boolean)
      : []
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      description: draft.description,
      type: draft.type,
      icon: draft.icon || '',
      color: draft.color || '#C7F464',
      mandatory: draft.mandatory,
      review_when_missed: draft.reviewWhenMissed,
      active: draft.active,
      archived: draft.archived === true,
      schedule_mode: draft.scheduleMode === 'time_based' ? 'time_based' : 'all_day',
      scheduled_time: scheduledTimes[0] || '',
      scheduled_times: scheduledTimes,
      start_date: draft.startDate,
      end_date: draft.endDate || '',
      recurrence_type: draft.recurrenceType,
      weekdays: draft.weekdays,
      interval_weeks: draft.intervalWeeks,
      target_value: draft.targetValue || 0,
      target_operator: draft.targetOperator || 'gte',
      unit: draft.type === 'step_counter' ? 'steps' : draft.unit || '',
      custom_unit: draft.type === 'step_counter' ? '' : draft.customUnit || '',
      goal_period: draft.goalPeriod || 'occurrence',
      cycle_length: draft.type === 'program' ? draft.steps.length : draft.cycleLength || 0,
      program_repeat: draft.programRepeat ?? true,
      program_strict: draft.programStrict ?? false,
      quick_log_enabled: taskSupportsQuickLog(draft.type) && draft.quickLogEnabled === true,
      quick_log_sort_order: quickLogSortOrder,
      log_with_images_enabled: taskSupportsImageLogging(draft.type) && draft.logWithImagesEnabled === true,
      sort_order: sortOrder,
      interval_template: draft.type === 'interval' ? draft.intervalTemplate || '' : '',
      flashcard_review_set: draft.type === 'flashcards' ? draft.flashcardReviewSet || '' : '',
      session_count_mode: ['interval', 'flashcards'].includes(draft.type)
        ? draft.sessionCountMode || 'task'
        : 'task',
      session_goal_type: ['interval', 'flashcards'].includes(draft.type)
        ? draft.sessionGoalType || 'complete'
        : 'complete',
      session_target_seconds: ['interval', 'flashcards'].includes(draft.type)
        && draft.sessionGoalType === 'duration'
          ? draft.sessionTargetSeconds || 0
          : 0,
      tracking_trackers: draft.type === 'tracking' ? [...new Set(draft.trackingTrackers ?? [])] : [],
      reminder_enabled: draft.reminderEnabled,
      reminder_times: [...new Set(draft.reminderTimes)],
    }
    const previousTasks = tasks.value
    const previousSteps = steps.value
    const optimisticTask = mapTask({ id: draft.id || createLocalRecordId(), ...payload })
    const taskIndex = draft.id ? tasks.value.findIndex(task => task.id === draft.id) : -1
    if (taskIndex >= 0) tasks.value = tasks.value.toSpliced(taskIndex, 1, optimisticTask)
    else tasks.value = [...tasks.value, optimisticTask]
    let optimisticSteps: ProgramStep[] = []
    if (draft.type === 'program') {
      optimisticSteps = draft.steps.map((step, index) => {
        const completions = step.completionType === 'day_off' ? [] : step.completions || []
        const primary = programStepPrimaryCompletion(completions)
        return mapStep({
          id: step.id || createLocalRecordId(),
          task: optimisticTask.id,
          name: step.name,
          description: step.description,
          sort_order: index,
          cycle_days: [index + 1],
          completion_type: step.completionType === 'day_off' ? 'day_off' : primary?.type || 'check',
          target_value: primary?.targetValue ?? 0,
          target_operator: primary?.targetOperator || 'gte',
          unit: primary?.unit || '',
          custom_unit: primary?.customUnit || '',
          active: true,
          interval_template: primary?.type === 'interval' ? primary.intervalTemplate || '' : '',
          flashcard_review_set: primary?.type === 'flashcards' ? primary.flashcardReviewSet || '' : '',
          completions: programStepCompletionPayload(completions),
        })
      })
      steps.value = [
        ...steps.value.filter(step => step.task !== optimisticTask.id),
        ...steps.value.filter(step => step.task === optimisticTask.id && !step.active),
        ...optimisticSteps,
      ]
    }
    try {
      const existingSteps = draft.id && draft.type === 'program'
        ? previousSteps.filter(step => step.active && step.task === draft.id)
        : []
      const retainedStepIds = new Set(draft.steps.map(step => step.id).filter(Boolean))
      const removedSteps = existingSteps.filter(step => !retainedStepIds.has(step.id))
      const existingStepById = new Map(existingSteps.map(step => [step.id, step]))
      const changedCompletionSteps = draft.steps.flatMap((step) => {
        if (!step.id) return []
        const existingStep = existingStepById.get(step.id)
        if (!existingStep) return []
        const previousDefinition = programStepCompletionPayload(existingStep.completions || [])
        const nextDefinition = programStepCompletionPayload(step.completions || [])
        return JSON.stringify(previousDefinition) === JSON.stringify(nextDefinition)
          ? []
          : [existingStep]
      })
      const referencedStepIds = new Set<string>()
      const referenceCandidates = [...new Map(
        [...removedSteps, ...changedCompletionSteps].map(step => [step.id, step]),
      ).values()]
      if (referenceCandidates.length) {
        const referenceChecks = await Promise.all(referenceCandidates.map(async step => ({
          id: step.id,
          referenced: await programStepHasReferences(step.id),
        })))
        referenceChecks
          .filter(check => check.referenced)
          .forEach(check => referencedStepIds.add(check.id))
      }
      const versionedStepIds = new Set(changedCompletionSteps
        .filter(step => referencedStepIds.has(step.id))
        .map(step => step.id))
      const retiredSteps = [...new Map(
        [
          ...removedSteps,
          ...changedCompletionSteps.filter(step => versionedStepIds.has(step.id)),
        ].map(step => [step.id, step]),
      ).values()]
      steps.value = [
        ...steps.value,
        ...retiredSteps
          .filter(step => referencedStepIds.has(step.id))
          .map(step => ({ ...step, active: false })),
      ]
      const record = draft.id
        ? await api.collection('tasks').update(draft.id, payload)
        : await api.collection('tasks').create(payload)
      const taskId = record.id
      Object.assign(optimisticTask, mapTask(record))
      optimisticSteps.forEach((step) => {
        step.task = taskId
      })

      if (draft.type === 'program') {
        await Promise.all(retiredSteps.map((step) => referencedStepIds.has(step.id)
          ? api.collection('program_steps').update(step.id, { active: false })
          : api.collection('program_steps').delete(step.id),
        ))
        const stepRecords = await Promise.all(
          draft.steps.map((step, index) => {
            const completions = step.completionType === 'day_off' ? [] : step.completions || []
            const primary = programStepPrimaryCompletion(completions)
            const stepPayload = {
              owner: api.authStore.record!.id,
              task: taskId,
              name: step.name,
              description: step.description,
              sort_order: index,
              cycle_days: [index + 1],
              completion_type: step.completionType === 'day_off' ? 'day_off' : primary?.type || 'check',
              target_value: primary?.targetValue ?? 0,
              target_operator: primary?.targetOperator || 'gte',
              unit: primary?.unit || '',
              custom_unit: primary?.customUnit || '',
              active: true,
              interval_template: primary?.type === 'interval' ? primary.intervalTemplate || '' : '',
              flashcard_review_set: primary?.type === 'flashcards' ? primary.flashcardReviewSet || '' : '',
              completions: programStepCompletionPayload(completions),
            }
            return step.id && !versionedStepIds.has(step.id)
              ? api.collection('program_steps').update(step.id, stepPayload)
              : api.collection('program_steps').create(stepPayload)
          }),
        )
        stepRecords.forEach((stepRecord, index) => {
          const optimisticStep = optimisticSteps[index]
          if (optimisticStep) Object.assign(optimisticStep, mapStep(stepRecord))
        })
      }
      void syncTaskReminders()
      useSnackbarStore().showSaved('Task', optimisticTask.name)
      return taskId
    } catch (cause) {
      tasks.value = previousTasks
      steps.value = previousSteps
      error.value = cause instanceof Error ? cause.message : 'Could not save the task.'
      void syncTaskReminders()
      throw cause
    }
  }

  async function programStepHasReferences(stepId: string) {
    const filter = `program_step = "${stepId}"`
    const collections = ['occurrences', 'entries', 'interval_sessions', 'flashcard_review_sessions']
    const results = await Promise.all(collections.map(collection =>
      api.collection(collection).getList(1, 1, { filter }),
    ))
    return results.some(result => result.totalItems > 0)
  }

  async function toggleTaskActive(task: Task) {
    const previous = { ...task }
    task.active = !task.active
    try {
      const record = await api.collection('tasks').update(task.id, { active: task.active })
      Object.assign(task, mapTask(record))
    } catch (cause) {
      Object.assign(task, previous)
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  async function setTaskArchived(task: Task, archived: boolean) {
    const previous = { ...task }
    task.archived = archived
    try {
      const record = await api.collection('tasks').update(task.id, { archived })
      Object.assign(task, mapTask(record))
    } catch (cause) {
      Object.assign(task, previous)
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  function progressIsScheduled(progress: TaskProgress) {
    const date = parseISO(progress.scheduledDate)
    if (progress.programStep) {
      return stepsForTaskDate(progress.task, date)
        .some(step => step.id === progress.programStep?.id)
    }
    return progress.task.type !== 'program' && isTaskScheduled(progress.task, date)
  }

  async function toggleSkipped(progress: TaskProgress, skipped: boolean) {
    if (skipped) {
      await setStatus(progress, 'skipped')
      return
    }
    const occurrence = occurrenceFor(
      progress.task,
      parseISO(progress.scheduledDate),
      progress.programStep,
      progress.scheduledTime,
    )
    if (!occurrence || occurrence.status !== 'skipped') return
    if (progressIsScheduled(progress)) {
      await setStatus(progress, 'pending')
      return
    }
    const index = occurrences.value.indexOf(occurrence)
    occurrences.value.splice(index, 1)
    try {
      await api.collection('occurrences').delete(occurrence.id)
    } catch (cause) {
      occurrences.value.splice(index, 0, occurrence)
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  function upsertOccurrenceRecord(record: Record<string, any>) {
    occurrenceMutationRevision += 1
    const occurrence = mapOccurrence(record)
    const index = occurrences.value.findIndex((item) => item.id === occurrence.id)
    if (index >= 0) occurrences.value.splice(index, 1, occurrence)
    else occurrences.value.push(occurrence)
    void syncTaskReminders()
    return occurrence
  }

  function upsertEntryRecord(record: Record<string, any>) {
    const entry = mapEntry(record)
    const index = entries.value.findIndex(item => item.id === entry.id)
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    void syncTaskReminders()
    return entry
  }

  function reorderTasksInMemory(orderedIds: string[]) {
    const uniqueIds = [...new Set(orderedIds)]
    const orderedIdSet = new Set(uniqueIds)
    const orderedTasks = uniqueIds
      .map((id) => tasks.value.find((task) => task.id === id))
      .filter((task): task is Task => Boolean(task))

    if (orderedTasks.length < 2) return

    let orderedIndex = 0
    tasks.value = tasks.value.map((task) =>
      orderedIdSet.has(task.id)
        ? orderedTasks[orderedIndex++] ?? task
        : task,
    )
    tasks.value.forEach((task, index) => {
      task.sortOrder = index
    })
  }

  async function reorderTasks(orderedIds: string[]) {
    const previousTasks = tasks.value.map((task) => ({ ...task }))
    const previousSortOrders = new Map(
      previousTasks.map((task) => [task.id, task.sortOrder]),
    )
    reorderTasksInMemory(orderedIds)
    const changedTasks = tasks.value.filter(
      (task) => previousSortOrders.get(task.id) !== task.sortOrder,
    )
    if (!changedTasks.length) return

    error.value = ''
    try {
      await Promise.all(
        changedTasks.map((task) =>
          api.collection('tasks').update(task.id, { sort_order: task.sortOrder }),
        ),
      )
      await syncTaskReminders()
    } catch (cause) {
      tasks.value = previousTasks
      await Promise.allSettled(
        changedTasks.map((task) =>
          api.collection('tasks').update(task.id, {
            sort_order: previousSortOrders.get(task.id),
          }),
        ),
      )
      error.value = cause instanceof Error
        ? cause.message
        : 'Could not save the task order.'
      throw cause
    }
  }

  async function reorderQuickLogs(orderedIds: string[]) {
    const uniqueIds = [...new Set(orderedIds)]
    const orderedIdSet = new Set(uniqueIds)
    const orderedTasks = uniqueIds
      .map(id => tasks.value.find(task => (
        task.id === id && taskSupportsQuickLog(task.type) && task.quickLogEnabled
      )))
      .filter((task): task is Task => Boolean(task))
    if (orderedTasks.length < 2 || orderedTasks.length !== uniqueIds.length) return

    const previousTasks = tasks.value.map(task => ({ ...task }))
    const previousSortOrders = new Map(previousTasks.map(task => [
      task.id,
      task.quickLogSortOrder ?? task.sortOrder,
    ]))
    const quickLogTasks = tasks.value
      .filter(task => taskSupportsQuickLog(task.type) && task.quickLogEnabled)
      .sort((left, right) => (
        (left.quickLogSortOrder ?? left.sortOrder) - (right.quickLogSortOrder ?? right.sortOrder)
        || left.sortOrder - right.sortOrder
      ))
    let orderedIndex = 0
    quickLogTasks.forEach((task, index) => {
      const orderedTask = orderedIdSet.has(task.id)
        ? orderedTasks[orderedIndex++] ?? task
        : task
      orderedTask.quickLogSortOrder = index
    })
    const changedTasks = quickLogTasks.filter(task => (
      previousSortOrders.get(task.id) !== task.quickLogSortOrder
    ))
    if (!changedTasks.length) return

    error.value = ''
    try {
      await Promise.all(changedTasks.map(task => api.collection('tasks').update(task.id, {
        quick_log_sort_order: task.quickLogSortOrder,
      })))
    } catch (cause) {
      tasks.value = previousTasks
      await Promise.allSettled(changedTasks.map(task => api.collection('tasks').update(task.id, {
        quick_log_sort_order: previousSortOrders.get(task.id),
      })))
      error.value = cause instanceof Error
        ? cause.message
        : 'Could not save the quick-log order.'
      throw cause
    }
  }

  async function deleteTask(taskId: string) {
    const previousTasks = tasks.value
    const previousSteps = steps.value
    const previousOccurrences = occurrences.value
    const previousEntries = entries.value
    const previousTaskLogImages = taskLogImages.value
    tasks.value = tasks.value.filter((task) => task.id !== taskId)
    steps.value = steps.value.filter((step) => step.task !== taskId)
    occurrences.value = occurrences.value.filter((occurrence) => occurrence.task !== taskId)
    entries.value = entries.value.filter((entry) => entry.task !== taskId)
    taskLogImages.value = taskLogImages.value.filter((image) => image.task !== taskId)
    try {
      await api.collection('tasks').delete(taskId)
    } catch (cause) {
      tasks.value = previousTasks
      steps.value = previousSteps
      occurrences.value = previousOccurrences
      entries.value = previousEntries
      taskLogImages.value = previousTaskLogImages
      throw cause
    } finally {
      void syncTaskReminders()
    }
    useSnackbarStore().showDeletion('Task')
  }

  async function shiftProgram(progress: TaskProgress) {
    if (!progress.programStep) return
    const progressDate = parseISO(progress.scheduledDate)
    const stepIsScheduled = stepsForTaskDate(progress.task, progressDate)
      .some(step => step.id === progress.programStep?.id)
    if (!stepIsScheduled) return
    const shiftKey = occurrenceStatusKey(
      progress.task.id,
      progress.scheduledDate,
      progress.programStep.id,
      progress.scheduledTime,
    )
    const currentProgress = makeProgress(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    if (pendingProgramShifts.has(shiftKey) || currentProgress.status === 'rescheduled') return
    pendingProgramShifts.add(shiftKey)
    const previousStart = progress.task.startDate
    const shiftedStart = toDateKey(addDays(parseISO(progress.task.startDate), 1))
    progress.task.startDate = shiftedStart
    try {
      await setStatus(progress, 'rescheduled')
      await api.collection('tasks').update(progress.task.id, { start_date: shiftedStart })
    } catch (cause) {
      progress.task.startDate = previousStart
      throw cause
    } finally {
      pendingProgramShifts.delete(shiftKey)
      void syncTaskReminders()
    }
  }

  async function undoReviewResolution(progress: TaskProgress, cleanFollowing = false) {
    if (progress.status !== 'missed' && progress.status !== 'rescheduled') return
    const progressDate = parseISO(progress.scheduledDate)
    const occurrence = occurrenceFor(
      progress.task,
      progressDate,
      progress.programStep,
      progress.scheduledTime,
    )
    if (!occurrence || (occurrence.status !== 'missed' && occurrence.status !== 'rescheduled')) return

    const affected = cleanFollowing ? [
      occurrence,
      ...occurrences.value.filter(item => (
        item.id !== occurrence.id
        && item.task === progress.task.id
        && item.scheduledDate > progress.scheduledDate
        && (item.status === 'missed' || item.status === 'rescheduled')
      )),
    ] : [occurrence]
    const previousOccurrences = affected.map(item => ({
      occurrence: item,
      value: {
        ...item,
        completionState: { ...(item.completionState || {}) },
      },
    }))
    const previousStart = progress.task.startDate
    const shiftCount = affected.filter(item => item.status === 'rescheduled').length
    for (const item of affected) {
      item.status = 'pending'
      item.sealed = false
      item.completedAt = undefined
    }
    if (shiftCount) {
      progress.task.startDate = toDateKey(subDays(parseISO(previousStart), shiftCount))
    }
    occurrenceMutationRevision += 1
    try {
      await api.bulkResolveTaskReview({
        action: 'undo',
        items: affected.map(item => ({ occurrence: occurrenceRecord(item) })),
        taskPatches: shiftCount
          ? [{ id: progress.task.id, startDate: progress.task.startDate }]
          : [],
      })
    } catch (cause) {
      for (const previous of previousOccurrences) Object.assign(previous.occurrence, previous.value)
      progress.task.startDate = previousStart
      throw cause
    } finally {
      occurrenceMutationRevision += 1
      void syncTaskReminders()
    }
  }

  const occurrenceRecord = (occurrence: Occurrence) => ({
    id: occurrence.id,
    task: occurrence.task,
    program_step: occurrence.programStep || '',
    scheduled_date: occurrence.scheduledDate,
    scheduled_time: occurrence.scheduledTime || '',
    status: occurrence.status,
    sealed: occurrence.sealed,
    completed_at: occurrence.completedAt || '',
    snapshot_name: occurrence.snapshotName,
    snapshot_target: occurrence.snapshotTarget || 0,
    snapshot_unit: occurrence.snapshotUnit || '',
    completion_state: occurrence.completionState || {},
  })

  async function bulkResolveReview(
    progressItems: TaskProgress[],
    action: 'missed' | 'carried' | 'shift',
  ) {
    if (!progressItems.length) return
    if (action === 'carried' && progressItems.some(item => (
      item.task.type === 'program' || item.programStep
    ))) {
      throw new Error('Programs can only be marked missed or shifted.')
    }
    const previousOccurrences = occurrences.value.map(item => ({
      ...item,
      completionState: { ...(item.completionState || {}) },
    }))
    const previousTaskStarts = new Map(
      progressItems.map(item => [item.task.id, item.task.startDate]),
    )
    const resolvedStatus: Occurrence['status'] = action === 'shift' ? 'rescheduled' : action
    const payloadItems: Array<{
      occurrence: Record<string, any> & { id: string }
      carriedOccurrence?: Record<string, any> & { id: string }
    }> = []
    const shiftCounts = new Map<string, number>()

    try {
      for (const progress of progressItems) {
        const progressDate = parseISO(progress.scheduledDate)
        let occurrence = occurrenceFor(
          progress.task,
          progressDate,
          progress.programStep,
          progress.scheduledTime,
        )
        if (!occurrence) {
          occurrence = {
            id: createLocalRecordId(),
            task: progress.task.id,
            programStep: progress.programStep?.id,
            scheduledDate: progress.scheduledDate,
            scheduledTime: progress.scheduledTime,
            status: 'pending',
            sealed: false,
            snapshotName: progress.programStep?.name || progress.task.name,
            snapshotTarget: (progress.programStep?.completions?.length || 0) > 1
              ? progress.programStep!.completions!.length
              : progress.programStep?.completions?.[0]?.targetValue
                ?? progress.programStep?.targetValue
                ?? progress.task.targetValue
                ?? 0,
            snapshotUnit: progress.programStep?.customUnit
              || progress.programStep?.unit
              || progress.task.customUnit
              || progress.task.unit
              || '',
            completionState: {},
          }
          occurrences.value.push(occurrence)
        }
        occurrence.status = resolvedStatus
        occurrence.sealed = false
        occurrence.completedAt = undefined

        let carriedOccurrence: Occurrence | undefined
        if (action === 'carried') {
          const carriedDate = addDays(progressDate, 1)
          carriedOccurrence = occurrenceFor(
            progress.task,
            carriedDate,
            progress.programStep,
            progress.scheduledTime,
          )
          if (!carriedOccurrence) {
            carriedOccurrence = {
              ...occurrence,
              id: createLocalRecordId(),
              scheduledDate: toDateKey(carriedDate),
              status: 'pending',
            }
            occurrences.value.push(carriedOccurrence)
          }
        }
        if (action === 'shift') {
          shiftCounts.set(progress.task.id, (shiftCounts.get(progress.task.id) || 0) + 1)
        }
        payloadItems.push({
          occurrence: occurrenceRecord(occurrence),
          ...(carriedOccurrence ? { carriedOccurrence: occurrenceRecord(carriedOccurrence) } : {}),
        })
      }

      const taskPatches = [...shiftCounts].map(([taskId, count]) => {
        const task = taskById.value.get(taskId)!
        task.startDate = toDateKey(addDays(parseISO(task.startDate), count))
        return { id: task.id, startDate: task.startDate }
      })
      occurrenceMutationRevision += 1
      await api.bulkResolveTaskReview({ action, items: payloadItems, taskPatches })
    } catch (cause) {
      occurrences.value = previousOccurrences
      for (const [taskId, startDate] of previousTaskStarts) {
        const task = taskById.value.get(taskId)
        if (task) task.startDate = startDate
      }
      throw cause
    } finally {
      occurrenceMutationRevision += 1
      void syncTaskReminders()
    }
  }

  return {
    tasks,
    steps,
    occurrences,
    entries,
    taskLogImages,
    selectedDate,
    loading,
    error,
    stepCountLoading,
    stepCountError,
    activeTasks,
    selectedProgress,
    completionRate,
    progressForDate,
    taskIsScheduledForDate,
    stepsForTaskDate,
    completionRateForDate,
    reviewProgressForDate,
    syncTaskReminders,
    load,
    loadProgressRange,
    refreshStepCount,
    makeProgress,
    entriesFor,
    toggleComplete,
    saveProgramStepWorkoutSets,
    setProgramStepCompletion,
    markProgramStepIncomplete,
    completeAttributedTask,
    applyLocalSessionProgress,
    setTotalSealed,
    addEntry,
    updateEntry,
    deleteEntry,
    loadEntriesForDay,
    loadTaskLogImages,
    logTaskImage,
    createTaskLogImage,
    updateTaskLogImage,
    archiveTaskLogImage,
    setStatus,
    progressIsScheduled,
    toggleSkipped,
    shiftProgram,
    undoReviewResolution,
    bulkResolveReview,
    saveTask,
    programStepHasReferences,
    reorderQuickLogs,
    toggleTaskActive,
    setTaskArchived,
    upsertOccurrenceRecord,
    upsertEntryRecord,
    reorderTasks,
    deleteTask,
  }
})
