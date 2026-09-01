<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { isValid, parseISO } from 'date-fns'
import fitty, { type FittyInstance } from 'fitty'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ContentIcon from '@/components/ContentIcon.vue'
import ExerciseDetailsPanel from '@/components/ExerciseDetailsPanel.vue'
import FlashcardCardDialog from '@/components/FlashcardCardDialog.vue'
import FlashcardContextActions from '@/components/FlashcardContextActions.vue'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import AppForm from '@/components/AppForm.vue'
import IntervalSettingsFields from '@/components/IntervalSettingsFields.vue'
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import RunnerStartScreen from '@/components/RunnerStartScreen.vue'
import RunnerSessionActions from '@/components/RunnerSessionActions.vue'
import ReviewSetCard from '@/components/ReviewSetCard.vue'
import {
  nativeBackgroundIntervalIsActive,
  stopBackgroundInterval,
  syncBackgroundInterval,
  waitForBackgroundIntervalSpeech,
} from '@/services/backgroundInterval'
import {
  flashcardSpeechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport,
  speakFlashcardText,
  stopFlashcardSpeech,
  toggleFlashcardSpeechOverAmplification,
  waitForFlashcardSpeechHandoff,
} from '@/services/flashcardSpeech'
import {
  cardMatchesTags,
  createIntervalFlashcardReviewSnapshot,
  DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
  DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
  flashcardEjectExcludes,
  flashcardEjectReachesExclusionThreshold,
  flashcardEjectLoadsNext,
  flashcardReviewFaceSpeech,
  flashcardReviewFaceValue,
  flashcardReviewActionFromSwipe,
  intervalFlashcardEjectionOffsetMs,
  intervalFlashcardNavigationOffsetMs,
  intervalFlashcardPhase,
  intervalFlashcardSideOffsetMs,
  flashcardReviewSettingsAreValid,
  flashcardReviewSettingsSignature,
  flashcardTagToggleUpdate,
  FLASHCARD_SETTINGS_APPLY_MENU_ITEMS,
  INTERVAL_FLASHCARD_QUICK_TAGS,
  updateFlashcardReviewExclusions,
} from '@/services/flashcards'
import { createIntervalCueHandoff } from '@/services/intervalCueHandoff'
import {
  notifyIntervalTransition,
  playFlashcardEjectCue,
  playIntervalCompleteCue,
  playIntervalCountCue,
  playIntervalGoCue,
  prepareIntervalCues,
  prepareFlashcardEjectCue,
  requestIntervalWakeLock,
} from '@/services/intervalCues'
import {
  cloneIntervalTemplateDraft,
  createRuntimeState,
  formatIntervalDuration,
  intervalDuration,
  intervalFlashcardReviewPlaybackElapsedMs,
  intervalFlashcardReviewPlaybackIsActive,
  intervalRunProgress,
  intervalStepPlaysFlashcardReview,
  reconcileIntervalRuntime,
  rebaseIntervalRuntimeForDefinition,
  resolveIntervalStep,
  intervalStepDurationSeconds,
  intervalStepUsesStopwatch,
  validateIntervalDefinition,
} from '@/services/intervals'
import { exercisePresentationById } from '@/services/exercisePresentations'
import { loadExerciseOptions } from '@/services/exercises'
import { programStepRequirementName } from '@/services/programStepCompletions'
import { toDateKey } from '@/services/schedule'
import { intervalRunnerSessionMenuItems } from '@/services/runnerSessionActions'
import { setReviewSetAudioFocus } from '@/services/reviewSetAudioFocus'
import { confirmSwipeHint, REVIEW_SET_CARD_SWIPE_HINT } from '@/services/swipeHints'
import { prepareFlashcardSpeechWordTracking } from '@/services/spokenText'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { showSavedSnackbar } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type {
  Flashcard,
  FlashcardContextAction,
  FlashcardReviewSettings,
  FlashcardSettingsApplyTarget,
  FlashcardSpeechSupport,
  FlashcardSpeechWord,
  IntervalDefinition,
  IntervalFlashcardReviewSnapshot,
  IntervalRuntimeState,
  IntervalSession,
  IntervalSettingsApplyTarget,
  RunnerSessionAction,
  TaskProgress,
} from '@/types/domain'
import type { ExerciseOption } from '@/types/exercise'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const flashcardStore = useFlashcardStore()
const taskStore = useTaskStore()
const reviewAudioFocusScope = `interval-review:${String(
  route.params.sessionId || route.params.templateId || 'preview',
)}`
const displayRemainingMs = ref(0)
const runnerClockMs = ref(Date.now())
const progressRingsContent = ref<HTMLElement>()
const timerValueElement = ref<HTMLElement>()
const syncing = ref(false)
const starting = ref(false)
const speechOverAmplified = ref(flashcardSpeechOverAmplificationIsEnabled())
const speechOverAmplificationBusy = ref(false)
const sessionActionsSheet = ref(false)
const intervalSettingsDialog = ref(false)
const intervalSettingsApplyMenu = ref(false)
const intervalSettingsSaveTarget = ref<IntervalSettingsApplyTarget>()
const intervalSettingsError = ref('')
const intervalSettingsOriginal = ref('')
const endDialog = ref(false)
const noteDialog = ref(false)
const noteDraft = ref('')
const noteField = ref<{ focus: () => void }>()
const noteSaving = ref(false)
const noteError = ref('')
const attributionSheet = ref(false)
const replaceActiveSessionDialog = ref(false)
const replacingActiveSession = ref(false)
const activeSessionName = ref('')
const pendingActiveSessionStart = ref<
  | { kind: 'request' }
  | {
      kind: 'template'
      taskId?: string
      programStepId?: string
      programStepCompletionId?: string
    }
>()
const flashcardContextSheet = ref(false)
const openingFlashcardContext = ref(false)
const flashcardNavigating = ref(false)
const intervalFlashcardTransitionDirection = ref<'previous' | 'next' | 'front' | 'back'>()
const flashcardTagSaving = ref('')
const flashcardEditorDialog = ref(false)
const flashcardEditorCard = ref<Flashcard>()
const flashcardDeleteDialog = ref(false)
const flashcardDeleting = ref(false)
const flashcardEjecting = ref(false)
const flashcardSettingsDialog = ref(false)
const flashcardSettingsApplyMenu = ref(false)
const flashcardSettingsForm = ref()
const flashcardSettingsSaveTarget = ref<FlashcardSettingsApplyTarget>()
const flashcardSettingsError = ref('')
const flashcardSettingsOriginal = ref('')
const flashcardSpeechLoading = ref(false)
const flashcardSpeechSupport = ref<FlashcardSpeechSupport>({ available: false, languages: [] })
const spokenFlashcardWord = ref<FlashcardSpeechWord>()
const flashcardSettingsDraft = reactive<FlashcardReviewSettings>({
  mode: 'passive',
  cardSides: 'both',
  invertFaces: false,
  indefinite: true,
  maxCards: 1,
  ejectBehavior: 'remove',
  ejectExcludeAfter: DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  frontDisplay: DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
  backDisplay: DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
  speechEnabled: false,
  backSpeechRate: 1,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'difficult',
  sortDirection: 'asc',
})
const error = ref('')
const completionError = ref('')
const pendingCompletion = ref<{
  sessionId: string
  runtime: IntervalRuntimeState
  elapsedSeconds: number
  endedAt: string
}>()
const backgroundError = ref('')
const timerEffect = ref<'count' | ''>('')
const timerEffectKey = ref(0)
const runnerExercise = shallowRef<ExerciseOption>()
const runnerExerciseVisible = ref(false)
const runnerSwipeOffset = ref(0)
const runnerSwipeDragging = ref(false)
let animationFrame: number | undefined
let wakeLock: { release: () => Promise<void> } | undefined
let runnerMounted = false
let lastCountCue = ''
let timerEffectTimeout: number | undefined
let intervalFlashcardClickResetTimer: number | undefined
let intervalFlashcardSwipeStart: {
  pointerId: number
  x: number
  y: number
  scrollElement?: HTMLElement
  scrollTop: number
  maxScrollTop: number
} | undefined
let runnerExerciseRequestId = 0
let runnerSwipeStart: {
  input: 'pointer' | 'touch'
  pointerId: number
  x: number
  y: number
  width: number
} | undefined
let suppressIntervalFlashcardClick = false
let lastSpokenFlashcardKey = ''
let reconcilingVisibilitySpeech = false
let resumeAfterFlashcardContext = false
let resumeAfterFlashcardModal = false
let resumeAfterIntervalSettings = false
let flashcardSaveWork: Promise<void> = Promise.resolve()
const cueHandoff = createIntervalCueHandoff(document.visibilityState)
let timerFit: FittyInstance | undefined
let timerFitResizeObserver: ResizeObserver | undefined

const previewSession = ref<IntervalSession>()
const intervalSettingsDraft = reactive({
  flashcardReviewSet: undefined as string | undefined,
  definition: {
    version: 1 as const,
    children: [],
  } as IntervalDefinition,
  cues: { soundEnabled: true, vibrationEnabled: true },
})
const isTemplatePreview = computed(() => Boolean(route.params.templateId))
const previewTemplate = computed(() => store.templates.find((item) => item.id === route.params.templateId))
const persistedSession = computed(() => store.sessions.find((item) => item.id === route.params.sessionId))
const session = computed(() => persistedSession.value || previewSession.value)
const sessionTemplate = computed(() => previewTemplate.value
  || store.templates.find(item => item.id === session.value?.template))
const sessionIcon = computed(() => session.value?.presentation.icon || sessionTemplate.value?.icon || 'mdi-timer-outline')
const sessionColor = computed(() => session.value?.presentation.color || sessionTemplate.value?.color || '#C7F464')
const current = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex) : undefined)
const next = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex + 1) : undefined)
const finished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const currentConfirmation = computed(() => current.value?.step.kind === 'confirmation')
const currentStopwatch = computed(() => Boolean(
  current.value && intervalStepUsesStopwatch(current.value.step),
))
const sessionElapsedMs = computed(() => {
  displayRemainingMs.value
  runnerClockMs.value
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return item.runtime.accumulatedMs
  return item.runtime.accumulatedMs
    + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())
})
const flashcardReviewPlaybackEnabled = computed(() => {
  const review = session.value?.flashcardReview
  const step = current.value?.step
  return Boolean(
    review
    && step
    && session.value?.status === 'running'
    && intervalFlashcardReviewPlaybackIsActive(
      review,
      step,
      displayRemainingMs.value,
    ),
  )
})
const shouldHoldReviewAudioFocus = computed(() => {
  const item = session.value
  const review = item?.flashcardReview
  const step = current.value?.step
  return Boolean(
    item?.status === 'running'
    && review?.speechEnabled
    && !review.speechPaused
    && review.cards.length
    && step
    && intervalStepPlaysFlashcardReview(step),
  )
})
const flashcardReviewElapsedMs = computed(() => {
  const item = session.value
  const review = item?.flashcardReview
  if (!item || !review) return 0
  return intervalFlashcardReviewPlaybackElapsedMs(
    review,
    item.definition,
    item.runtime,
    displayRemainingMs.value,
    sessionElapsedMs.value,
  )
})
const flashcardPhase = computed(() => session.value?.flashcardReview
  ? intervalFlashcardPhase(session.value.flashcardReview, flashcardReviewElapsedMs.value)
  : undefined)
const flashcardReviewSet = computed(() => flashcardStore.reviewSets
  .find(item => item.id === session.value?.flashcardReview?.reviewSet))
const flashcardFrontDisplay = computed(() => {
  const review = session.value?.flashcardReview
  return flashcardReviewFaceValue({
    frontDisplay: review?.frontDisplay || flashcardReviewSet.value?.frontDisplay,
  }, 'front')
})
const flashcardBackDisplay = computed(() => {
  const review = session.value?.flashcardReview
  return flashcardReviewFaceValue({
    backDisplay: review?.backDisplay || flashcardReviewSet.value?.backDisplay,
  }, 'back')
})
const flashcardContextDisabled = computed(() => Boolean(
  isTemplatePreview.value
  || syncing.value
  || openingFlashcardContext.value
  || flashcardNavigating.value,
))
const canManageIntervalCards = computed(() => Boolean(
  flashcardReviewSet.value && flashcardReviewSet.value.accessRole !== 'readonly',
))
const sessionTtsPaused = computed(() => Boolean(session.value?.flashcardReview?.speechPaused))
const sessionActionItems = computed(() => intervalRunnerSessionMenuItems({
  speechAvailable: Boolean(session.value?.flashcardReview?.speechEnabled && flashcardPhase.value),
  amplified: speechOverAmplified.value,
  busy: syncing.value || starting.value || speechOverAmplificationBusy.value,
  preview: isTemplatePreview.value,
}))
const sessionActionsDisabled = computed(() => sessionActionItems.value.every(item => item.disabled))
const intervalSettingsSourceTemplate = computed(() => store.templates.find(
  template => template.id === session.value?.template,
))
const intervalSettingsReviewSet = computed(() => flashcardStore.reviewSets.find(
  reviewSet => reviewSet.id === intervalSettingsDraft.flashcardReviewSet,
))
const intervalSettingsChanged = computed(() => intervalSettingsDialog.value
  && JSON.stringify(intervalSettingsDraft) !== intervalSettingsOriginal.value)
const intervalSettingsReviewSetIsValid = computed(() => !intervalSettingsDraft.flashcardReviewSet
  || intervalSettingsDraft.flashcardReviewSet === session.value?.flashcardReview?.reviewSet
  || Boolean(intervalSettingsReviewSet.value?.matchingCardCount))
const canSaveIntervalSettings = computed(() => intervalSettingsChanged.value
  && intervalSettingsReviewSetIsValid.value
  && validateIntervalDefinition(intervalSettingsDraft.definition).length === 0)
const intervalSettingsSaving = computed(() => Boolean(intervalSettingsSaveTarget.value))
const intervalSettingsApplyItems = computed(() => [
  { target: 'session' as const, title: 'Current session', icon: 'mdi-timer-outline' },
  {
    target: 'interval' as const,
    title: 'Interval',
    icon: 'mdi-timer-cog-outline',
    disabled: !intervalSettingsSourceTemplate.value,
  },
  {
    target: 'both' as const,
    title: 'Both',
    icon: 'mdi-check-all',
    disabled: !intervalSettingsSourceTemplate.value,
  },
])
const intervalFlashcardSource = computed(() => {
  const reviewSet = flashcardReviewSet.value
  if (!reviewSet) return []
  return reviewSet.accessRole === 'owner'
    ? flashcardStore.cards
    : flashcardStore.reviewSetCards[reviewSet.id] || []
})
const currentFlashcardRecord = computed(() => intervalFlashcardSource.value
  .find(card => card.id === flashcardPhase.value?.card.id))
const displayedIntervalFlashcard = computed(() => {
  const queuedCard = flashcardPhase.value?.card
  const sourceCard = currentFlashcardRecord.value
  if (!queuedCard || !sourceCard) return queuedCard
  if (
    queuedCard.transliteration
    && queuedCard.ttsFront !== undefined
    && queuedCard.ttsBack !== undefined
  ) return queuedCard
  return {
    ...queuedCard,
    transliteration: queuedCard.transliteration || sourceCard.transliteration || '',
    ttsFront: (queuedCard.ttsFront ?? sourceCard.ttsFront) || '',
    ttsBack: (queuedCard.ttsBack ?? sourceCard.ttsBack) || '',
  }
})
const canTagCurrentFlashcard = computed(() => Boolean(
  !isTemplatePreview.value
  && flashcardReviewSet.value?.accessRole === 'owner'
  && currentFlashcardRecord.value,
))
const intervalQuickTags = computed(() => INTERVAL_FLASHCARD_QUICK_TAGS.map((quickTag) => {
  const tag = flashcardStore.tags.find(
    item => item.name.toLocaleLowerCase() === quickTag.name.toLocaleLowerCase(),
  )
  return {
    ...quickTag,
    id: tag?.id,
    selected: Boolean(tag && flashcardPhase.value?.card.tags.includes(tag.id)),
  }
}))
const flashcardSettingsChanged = computed(() => flashcardSettingsDialog.value
  && flashcardReviewSettingsSignature(flashcardSettingsDraft) !== flashcardSettingsOriginal.value)
const canSaveFlashcardSettings = computed(() => flashcardSettingsChanged.value
  && flashcardReviewSettingsAreValid(flashcardSettingsDraft))
const flashcardSettingsSaving = computed(() => Boolean(flashcardSettingsSaveTarget.value))
const remainingLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.ceil(displayRemainingMs.value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
})
const stopwatchElapsedMs = computed(() => {
  const item = session.value
  if (!item || !currentStopwatch.value) return 0
  const baseElapsedMs = Math.max(0, item.runtime.stepElapsedMs || 0)
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return baseElapsedMs
  return baseElapsedMs + Math.max(0, runnerClockMs.value - new Date(item.runtime.stepStartedAt).getTime())
})
const stopwatchLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.floor(stopwatchElapsedMs.value / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
const displayedTimeLabel = computed(() => currentStopwatch.value ? stopwatchLabel.value : remainingLabel.value)
const progress = computed(() => {
  if (!session.value || !current.value) {
    return { total: finished.value ? 100 : 0, item: finished.value ? 100 : 0 }
  }
  return intervalRunProgress(
    session.value.definition,
    current.value.index,
    displayRemainingMs.value,
  )
})
const showTotalProgress = computed(() => (current.value?.totalSteps || 0) > 1)
const showRoundProgress = computed(() => progress.value.round !== undefined)
const elapsedSeconds = computed(() => {
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return Math.round(item.runtime.accumulatedMs / 1000)
  return Math.round((item.runtime.accumulatedMs + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())) / 1000)
})
const hasStarted = computed(() => {
  const item = session.value
  if (!item) return false
  const initialStep = resolveIntervalStep(item.definition, 0)
  const initialDurationMs = initialStep ? intervalStepDurationSeconds(initialStep.step) * 1000 : 0
  return item.runtime.stepIndex > 0
    || item.runtime.accumulatedMs > 0
    || item.runtime.remainingMs < initialDurationMs
})
const playActionLabel = computed(() => hasStarted.value ? 'Resume' : 'Start')
const returnTo = computed(() => typeof route.query.returnTo === 'string'
  ? route.query.returnTo
  : route.query.from === 'tasks' ? '/tasks' : '/intervals')
const runnerRouteQuery = computed(() => ({
  ...(route.query.from ? { from: route.query.from } : {}),
  ...(typeof route.query.returnTo === 'string' ? { returnTo: route.query.returnTo } : {}),
}))
const originTaskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const startTaskName = computed(() => {
  const taskId = originTaskId.value || session.value?.task
  return taskId ? taskStore.tasks.find(task => task.id === taskId)?.name : undefined
})
const originProgramStepId = computed(() => typeof route.query.step === 'string' ? route.query.step : '')
const originProgramStepCompletionId = computed(() => (
  typeof route.query.completion === 'string' ? route.query.completion : ''
))
const attributedProgramStep = computed(() => {
  const programStepId = originProgramStepId.value || session.value?.programStep
  return programStepId
    ? taskStore.steps.find(step => step.id === programStepId)
    : undefined
})
const attributedProgramStepCompletion = computed(() => {
  const completionId = originProgramStepCompletionId.value || session.value?.programStepCompletion
  const completions = attributedProgramStep.value?.completions
  const identified = completionId
    ? completions?.find(completion => completion.id === completionId)
    : undefined
  if (identified) return identified
  return completions?.find(completion => (
    completion.type === 'interval'
    && completion.intervalTemplate === session.value?.template
  ))
})
const attributedExercise = computed(() => {
  const exerciseId = attributedProgramStepCompletion.value?.exercise
  return exercisePresentationById(exerciseId)
})

function presentationForTemplate(
  templateId: string | undefined,
  programStepId?: string,
  programStepCompletionId?: string,
) {
  const template = store.templates.find((item) => item.id === templateId)
  const completions = programStepId
    ? taskStore.steps.find((step) => step.id === programStepId)?.completions || []
    : []
  const completion = completions.find((item) => item.id === programStepCompletionId)
    || completions.find((item) => (
      (item.type === 'interval' || item.type === 'workout')
      && item.intervalTemplate === templateId
    ))
  return {
    icon: template?.icon || 'mdi-timer-outline',
    color: template?.color || '#C7F464',
    ...(completion?.exercise ? { exercise: completion.exercise } : {}),
  }
}
const runnerStageTrackStyle = computed(() => ({
  transform: `translate3d(calc(${runnerExerciseVisible.value ? '-100%' : '0%'} + ${runnerSwipeOffset.value}px), 0, 0)`,
}))
const runnerIdentityTitle = computed(() => programStepRequirementName(
  attributedProgramStepCompletion.value,
  attributedExercise.value?.name,
  session.value?.name || 'Interval',
))
const completionIdentityTitle = computed(() => attributedExercise.value
  ? runnerIdentityTitle.value
  : session.value?.name || 'Interval')
const runnerIdentityImage = computed(() => attributedExercise.value?.imageUrl)
const runnerIdentitySummary = computed(() => {
  if (!session.value) return ''
  const duration = `${formatIntervalDuration(session.value.plannedSeconds)} total`
  return runnerIdentityTitle.value === session.value.name
    ? duration
    : `${session.value.name} · ${duration}`
})

watch(() => attributedExercise.value?.id, async (exerciseId) => {
  const requestId = ++runnerExerciseRequestId
  runnerExercise.value = undefined
  runnerExerciseVisible.value = false
  runnerSwipeOffset.value = 0
  runnerSwipeDragging.value = false
  runnerSwipeStart = undefined
  if (!exerciseId) return

  try {
    const exercises = await loadExerciseOptions()
    if (requestId === runnerExerciseRequestId) {
      runnerExercise.value = exercises.find(exercise => exercise.id === exerciseId)
    }
  } catch {
    // The runner remains fully usable when the bundled exercise details cannot be loaded.
  }
}, { immediate: true })
const originTaskDate = computed(() => {
  if (typeof route.query.date !== 'string') return toDateKey(new Date())
  const parsed = parseISO(route.query.date)
  return isValid(parsed) && toDateKey(parsed) === route.query.date
    ? route.query.date
    : toDateKey(new Date())
})
const attachedProgressCandidates = computed(() => {
  const templateId = typeof route.params.templateId === 'string' ? route.params.templateId : session.value?.template
  if (!templateId) return []
  const taskDate = originTaskId.value ? parseISO(originTaskDate.value) : new Date()
  const taskProgress = taskStore.tasks
    .filter((task) => task.type === 'interval' && task.intervalTemplate === templateId)
    .map((task) => taskStore.makeProgress(task, taskDate))
  const stepProgress = taskStore.steps
    .filter((step) => step.active
      && step.completions?.some(completion => (
        completion.type === 'interval' && completion.intervalTemplate === templateId
      )))
    .flatMap((step) => {
      const task = taskStore.tasks.find((item) => item.id === step.task && item.type === 'program')
      return task ? [taskStore.makeProgress(task, taskDate, step)] : []
    })
  return [...taskProgress, ...stepProgress]
})
const eligibleTaskProgress = computed(() => {
  const taskDate = originTaskId.value ? parseISO(originTaskDate.value) : new Date()
  return attachedProgressCandidates.value
    .filter((item) => (item.status === 'pending' || item.status === 'missed')
      && !item.complete
      && (!item.programStep || item.completionItems?.some(completion => (
        completion.type === 'interval'
        && completion.intervalTemplate === (typeof route.params.templateId === 'string'
          ? route.params.templateId
          : session.value?.template)
        && !completion.complete
      )))
      && !item.locked
      && item.task.active
      && !item.task.archived
      && (Boolean(item.occurrence)
        || (item.programStep
          ? taskStore.stepsForTaskDate(item.task, taskDate).some((step) => step.id === item.programStep?.id)
          : taskStore.taskIsScheduledForDate(item.task, taskDate))))
})
function intervalCompletionId(progress: TaskProgress) {
  if (!progress.programStep) return undefined
  const templateId = typeof route.params.templateId === 'string'
    ? route.params.templateId
    : session.value?.template
  return progress.completionItems?.find(completion => (
    completion.id === originProgramStepCompletionId.value
    && completion.type === 'interval'
    && completion.intervalTemplate === templateId
    && !completion.complete
  ))?.id || progress.completionItems?.find(completion => (
    completion.type === 'interval'
    && completion.intervalTemplate === templateId
    && !completion.complete
  ))?.id
}
const attributedTaskName = computed(() => {
  const taskId = session.value?.task
  if (!taskId) return undefined
  const task = taskStore.tasks.find((item) => item.id === taskId)
  const programStep = session.value?.programStep
    ? taskStore.steps.find((step) => step.id === session.value?.programStep)
    : undefined
  return programStep ? `${task?.name || 'Program'} · ${programStep.name}` : task?.name
})
const noteChanged = computed(() => noteDraft.value.trim() !== (session.value?.note || ''))

watch([
  () => session.value?.status,
  () => session.value?.flashcardReview?.speechEnabled,
  () => session.value?.flashcardReview?.speechPaused,
  () => flashcardReviewPlaybackEnabled.value,
  () => flashcardPhase.value?.key,
], () => {
  if (!flashcardNavigating.value) void speakCurrentFlashcardSide()
}, { flush: 'post' })

watch(shouldHoldReviewAudioFocus, (active) => {
  void setReviewSetAudioFocus(reviewAudioFocusScope, active)
}, { immediate: true, flush: 'sync' })

watch([
  () => flashcardPhase.value?.card.id,
  () => flashcardPhase.value?.side,
], ([cardId, side], [previousCardId, previousSide]) => {
  if (!cardId || !side || !previousCardId || !previousSide) return
  const cardChanged = cardId !== previousCardId
  const sideChanged = side !== previousSide
  if (cardChanged || sideChanged) spokenFlashcardWord.value = undefined
  if (intervalFlashcardTransitionDirection.value) return

  if (cardChanged) {
    intervalFlashcardTransitionDirection.value = 'next'
  } else if (sideChanged) {
    intervalFlashcardTransitionDirection.value = side
  }
}, { flush: 'sync' })

watch(flashcardContextSheet, (open, wasOpen) => {
  if (wasOpen && !open) void finishFlashcardContext()
})

function createTimerFit() {
  timerFit?.unsubscribe()
  timerFit = undefined
  const container = progressRingsContent.value
  const value = timerValueElement.value
  if (!container || !value || !container.clientWidth || !container.clientHeight) return

  const style = window.getComputedStyle(value)
  const fontSize = Number.parseFloat(style.fontSize) || 64
  const lineHeight = Number.parseFloat(style.lineHeight)
  const lineHeightRatio = Number.isFinite(lineHeight) ? lineHeight / fontSize : 1.2
  timerFit = fitty(value, {
    minSize: 1,
    maxSize: Math.max(1, Math.min(fontSize, container.clientHeight / lineHeightRatio)),
    multiLine: false,
    observeMutations: false,
  })
  timerFit.fit({ sync: true })
}

watch([progressRingsContent, timerValueElement], ([container, value]) => {
  timerFitResizeObserver?.disconnect()
  timerFitResizeObserver = undefined
  timerFit?.unsubscribe()
  timerFit = undefined
  if (!container || !value) return
  if ('ResizeObserver' in window) {
    timerFitResizeObserver = new ResizeObserver(createTimerFit)
    timerFitResizeObserver.observe(container)
  }
  createTimerFit()
}, { flush: 'post' })

watch(displayedTimeLabel, () => {
  void nextTick(() => timerFit?.fit({ sync: true }))
}, { flush: 'post' })

onMounted(async () => {
  runnerMounted = true
  try {
    await Promise.all([
      store.loaded ? Promise.resolve() : store.load(),
      flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
      taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    ])
    if (isTemplatePreview.value) {
      const template = store.templates.find((item) => item.id === route.params.templateId)
      if (!template) {
        error.value = 'That interval template could not be found.'
        return
      }
      const now = new Date()
      const runtime = createRuntimeState(template.definition, now)
      runtime.stepStartedAt = undefined
      let flashcardReview
      if (template.flashcardReviewSet) {
        const reviewSet = flashcardStore.reviewSets.find(item => item.id === template.flashcardReviewSet)
        if (!reviewSet) {
          error.value = 'The Review set attached to this interval could not be found.'
          return
        }
        const reviewCards = reviewSet.accessRole === 'owner'
          ? flashcardStore.cards
          : await flashcardStore.loadReviewSetCards(reviewSet.id)
        flashcardReview = createIntervalFlashcardReviewSnapshot(reviewSet, reviewCards)
        if (!flashcardReview) {
          error.value = 'The Review set attached to this interval has no matching cards.'
          return
        }
      }
      previewSession.value = {
        id: `template-preview-${template.id}`,
        template: template.id,
        task: originTaskId.value || undefined,
        programStep: originProgramStepId.value || undefined,
        programStepCompletion: originProgramStepCompletionId.value || undefined,
        taskDate: originTaskId.value ? originTaskDate.value : toDateKey(now),
        source: 'template',
        status: 'paused',
        name: template.name,
        definition: template.definition,
        cues: template.cues,
        flashcardReview,
        startedAt: now.toISOString(),
        plannedSeconds: intervalDuration(template.definition),
        elapsedSeconds: 0,
        runtime,
        presentation: presentationForTemplate(
          template.id,
          originProgramStepId.value || undefined,
          originProgramStepCompletionId.value || undefined,
        ),
        updated: now.toISOString(),
      }
      if (originTaskId.value && !eligibleTaskProgress.value.some((item) =>
        item.task.id === originTaskId.value
        && (item.programStep?.id || '') === originProgramStepId.value
        && (!originProgramStepCompletionId.value || item.completionItems?.some(completion => (
          completion.id === originProgramStepCompletionId.value
          && completion.type === 'interval'
          && !completion.complete
        )))
      )) {
        error.value = 'This interval task or program step is not open for the selected date.'
        return
      }
    }
    if (!session.value) {
      error.value = 'That interval session could not be found.'
      return
    }
    await ensureIntervalFlashcardSource()
    displayRemainingMs.value = session.value.runtime.remainingMs
    await tick()
    animationFrame = window.requestAnimationFrame(updateProgressFrame)
    document.addEventListener('visibilitychange', handleVisibility)
    cueHandoff.recordVisibility(document.visibilityState)
    window.addEventListener('pagehide', handlePageHide)

    const autoplay = route.query.autoplay === '1' && session.value.status === 'paused'
    if (autoplay) await resume()

    const active = session.value
    if (!autoplay && active?.status === 'running') {
      void prepareIntervalCues(active.cues)
      void syncNativeTimer(active)
      void speakCurrentFlashcardSide()
      void requestIntervalWakeLock().then(async (lock) => {
        if (!runnerMounted || session.value?.id !== active.id || session.value.status !== 'running') {
          await lock?.release()
          return
        }
        wakeLock = lock
      })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not restore the interval.'
  }
})

onBeforeUnmount(() => {
  runnerMounted = false
  runnerExerciseRequestId += 1
  resetRunnerSwipe()
  timerFitResizeObserver?.disconnect()
  timerFit?.unsubscribe()
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  if (intervalFlashcardClickResetTimer) window.clearTimeout(intervalFlashcardClickResetTimer)
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', handlePageHide)
  void wakeLock?.release()
  void stopFlashcardSpeech()
  void setReviewSetAudioFocus(reviewAudioFocusScope, false)
})

async function speakCurrentFlashcardSide(allowPaused = false) {
  const item = session.value
  const review = item?.flashcardReview
  const phase = flashcardPhase.value
  const key = item && phase ? `${item.id}:${phase.key}` : ''
  if (reconcilingVisibilitySpeech) return
  if (document.visibilityState !== 'visible') return
  if (
    !item
    || (!allowPaused && item.status !== 'running')
    || !review?.speechEnabled
    || (!allowPaused && review.speechPaused)
    || (!allowPaused && !flashcardReviewPlaybackEnabled.value)
    || !phase
    || !key
  ) {
    if (!item || !review?.speechEnabled || review.speechPaused || !phase || !key) {
      lastSpokenFlashcardKey = ''
    }
    await stopFlashcardSpeech()
    return
  }
  if (key === lastSpokenFlashcardKey) return

  lastSpokenFlashcardKey = key
  try {
    const faceValue = phase.side === 'front'
      ? flashcardFrontDisplay.value
      : flashcardBackDisplay.value
    const { text, audio } = flashcardReviewFaceSpeech(phase.card, faceValue)
    const language = phase.side === 'front' ? review.frontLanguage : review.backLanguage
    if (!text && !audio) {
      await stopFlashcardSpeech()
      return
    }
    prepareFlashcardSpeechWordTracking(word => {
      const current = flashcardPhase.value
      if (current?.key === phase.key && session.value?.id === item.id) {
        spokenFlashcardWord.value = word
      }
    })
    const speechRate = phase.side === 'back' ? review.backSpeechRate : 1
    if (audio) await speakFlashcardText(text, language, phase.key, audio, speechRate)
    else await speakFlashcardText(text, language, phase.key, '', speechRate)
  } catch {
    spokenFlashcardWord.value = undefined
    // Speech is optional during intervals; timer playback continues without an inline warning.
  }
}

async function toggleSpeechOverAmplification() {
  if (speechOverAmplificationBusy.value) return
  const item = session.value
  if (!item) return
  speechOverAmplificationBusy.value = true
  try {
    speechOverAmplified.value = await toggleFlashcardSpeechOverAmplification()
    if (item.status === 'running') await syncNativeTimer(item)
  } catch {
    backgroundError.value = 'TTS over-amplification could not be changed.'
  } finally {
    speechOverAmplificationBusy.value = false
  }
}

function handleRunnerSessionAction(action: RunnerSessionAction) {
  if (action === 'amplification') void toggleSpeechOverAmplification()
  else if (action === 'settings') void openIntervalSettings()
  else if (action === 'restart') void restart()
  else if (action === 'end') endDialog.value = true
}

function cloneIntervalSettings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function openIntervalSettings() {
  const item = session.value
  if (!item || isTemplatePreview.value || syncing.value || intervalSettingsSaving.value) return
  resumeAfterIntervalSettings = item.status === 'running'
  intervalSettingsError.value = ''
  try {
    if (resumeAfterIntervalSettings) await pause()
    const currentSession = session.value
    if (!currentSession || finished.value) {
      resumeAfterIntervalSettings = false
      return
    }
    intervalSettingsDraft.definition = cloneIntervalSettings(currentSession.definition)
    intervalSettingsDraft.cues = cloneIntervalSettings(currentSession.cues)
    intervalSettingsDraft.flashcardReviewSet = currentSession.flashcardReview?.reviewSet
    intervalSettingsOriginal.value = JSON.stringify(intervalSettingsDraft)
    intervalSettingsDialog.value = true
  } catch (cause) {
    resumeAfterIntervalSettings = false
    error.value = cause instanceof Error ? cause.message : 'Could not open the interval settings.'
  }
}

async function closeIntervalSettings() {
  intervalSettingsApplyMenu.value = false
  intervalSettingsDialog.value = false
  intervalSettingsError.value = ''
  const shouldResume = resumeAfterIntervalSettings
  resumeAfterIntervalSettings = false
  if (!shouldResume || session.value?.status !== 'paused') return
  try {
    await resume()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not resume this interval.'
  }
}

async function saveIntervalSettings(target: IntervalSettingsApplyTarget) {
  const item = session.value
  if (!item || intervalSettingsSaving.value || !intervalSettingsChanged.value) return
  const definitionErrors = validateIntervalDefinition(intervalSettingsDraft.definition)
  if (definitionErrors.length) {
    intervalSettingsError.value = definitionErrors[0] || 'Check the interval sequence.'
    return
  }

  intervalSettingsSaveTarget.value = target
  intervalSettingsError.value = ''
  try {
    const definition = cloneIntervalSettings(intervalSettingsDraft.definition)
    const cues = cloneIntervalSettings(intervalSettingsDraft.cues)
    const flashcardReviewSet = intervalSettingsDraft.flashcardReviewSet
    if (target === 'interval' || target === 'both') {
      const template = intervalSettingsSourceTemplate.value
      if (!template) throw new Error('This session is not linked to a saved interval.')
      await store.saveTemplate({
        ...cloneIntervalTemplateDraft(template),
        flashcardReviewSet,
        definition,
        cues,
      })
    }

    if (target === 'session' || target === 'both') {
      const currentReviewSet = item.flashcardReview?.reviewSet
      let flashcardReview = item.flashcardReview
      if (flashcardReviewSet !== currentReviewSet) {
        if (!flashcardReviewSet) {
          flashcardReview = undefined
        } else {
          const reviewSet = intervalSettingsReviewSet.value
          if (!reviewSet) throw new Error('The selected Review set could not be found.')
          const cards = reviewSet.accessRole === 'owner'
            ? flashcardStore.cards
            : await flashcardStore.loadReviewSetCards(reviewSet.id)
          flashcardReview = createIntervalFlashcardReviewSnapshot(reviewSet, cards)
          if (!flashcardReview) throw new Error('The selected Review set has no matching cards.')
          flashcardReview.playbackOffsetMs = -intervalFlashcardReviewPlaybackElapsedMs(
            flashcardReview,
            item.definition,
            item.runtime,
            displayRemainingMs.value,
            sessionElapsedMs.value,
          )
        }
      }
      const runtime = rebaseIntervalRuntimeForDefinition(
        item.definition,
        definition,
        item.runtime,
      )
      const updated = await store.updateSession(item.id, {
        definition,
        cues,
        runtime,
        plannedSeconds: intervalDuration(definition),
        elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
      })
      if (flashcardReviewSet !== currentReviewSet) {
        await store.updateSessionFlashcardReview(item.id, flashcardReview)
      }
      showSavedSnackbar('Interval session', item.name)
      displayRemainingMs.value = updated.runtime.remainingMs
      lastCountCue = ''
      lastSpokenFlashcardKey = ''
    }
    await closeIntervalSettings()
  } catch (cause) {
    intervalSettingsError.value = cause instanceof Error
      ? cause.message
      : 'Could not update the interval settings.'
  } finally {
    intervalSettingsSaveTarget.value = undefined
  }
}

function applyIntervalSettingsTo(target: IntervalSettingsApplyTarget) {
  intervalSettingsApplyMenu.value = false
  void saveIntervalSettings(target)
}

function pulseTimer(effect: 'count') {
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  timerEffect.value = effect
  timerEffectKey.value += 1
  timerEffectTimeout = window.setTimeout(() => {
    timerEffect.value = ''
    timerEffectTimeout = undefined
  }, 560)
}

function reconciled(item: IntervalSession) {
  return item.status === 'running'
    ? reconcileIntervalRuntime(item.definition, item.runtime)
    : { runtime: { ...item.runtime }, completed: false, transitions: 0 }
}

function playCurrentStepCue(item: IntervalSession) {
  if (item.status !== 'running') return
  const step = resolveIntervalStep(item.definition, item.runtime.stepIndex)?.step
  if (!step) return
  playIntervalGoCue(item.cues, step.kind, step.name)
}

async function syncNativeTimer(item: IntervalSession) {
  try {
    await syncBackgroundInterval(item)
    backgroundError.value = ''
  } catch (cause) {
    backgroundError.value = cause instanceof Error ? cause.message : 'Background interval timing is unavailable.'
  }
}

function mirrorCurrentRuntime() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  store.mirrorRuntime(item.id, result.runtime)
}

function handlePageHide() {
  cueHandoff.recordVisibility('hidden')
  mirrorCurrentRuntime()
  void wakeLock?.release()
  wakeLock = undefined
  if (nativeBackgroundIntervalIsActive()) {
    void setReviewSetAudioFocus(reviewAudioFocusScope, false)
  } else {
    void stopFlashcardSpeech()
  }
}

async function handleVisibility() {
  cueHandoff.recordVisibility(document.visibilityState)
  if (document.visibilityState === 'visible' && session.value?.status === 'running') {
    const backgroundWasActive = nativeBackgroundIntervalIsActive()
    reconcilingVisibilitySpeech = backgroundWasActive
    try {
      if (backgroundWasActive) {
        await Promise.all([
          waitForFlashcardSpeechHandoff(),
          waitForBackgroundIntervalSpeech(),
        ])
        if (document.visibilityState !== 'visible') return
      }
      wakeLock = await requestIntervalWakeLock()
      await tick()
      await setReviewSetAudioFocus(
        reviewAudioFocusScope,
        shouldHoldReviewAudioFocus.value,
      )
      if (backgroundWasActive && flashcardPhase.value) {
        lastSpokenFlashcardKey = `${session.value.id}:${flashcardPhase.value.key}`
      }
    } finally {
      reconcilingVisibilitySpeech = false
    }
    await speakCurrentFlashcardSide()
  } else if (document.visibilityState !== 'visible') {
    await wakeLock?.release()
    wakeLock = undefined
    if (nativeBackgroundIntervalIsActive()) {
      await setReviewSetAudioFocus(reviewAudioFocusScope, false)
    } else {
      await stopFlashcardSpeech()
    }
  }
}

async function tick() {
  const item = session.value
  if (!item || finished.value || pendingCompletion.value) return
  runnerClockMs.value = Date.now()
  if (syncing.value) {
    if (item.status === 'running') displayRemainingMs.value = reconciled(item).runtime.remainingMs
    else displayRemainingMs.value = item.runtime.remainingMs
    return
  }
  const suppressCues = cueHandoff.consumeForegroundSuppression(document.visibilityState)
  if (item.status === 'paused') {
    displayRemainingMs.value = item.runtime.remainingMs
    return
  }
  const result = reconciled(item)
  displayRemainingMs.value = result.runtime.remainingMs
  if (!result.transitions) {
    const remainingSeconds = Math.ceil(result.runtime.remainingMs / 1000)
    if (remainingSeconds >= 1 && remainingSeconds <= 3) {
      const cue = `${result.runtime.stepIndex}:${remainingSeconds}`
      if (cue !== lastCountCue) {
        lastCountCue = cue
        if (!suppressCues) {
          pulseTimer('count')
          playIntervalCountCue(item.cues)
        }
      }
    }
  }
  if (!result.transitions) return

  syncing.value = true
  store.mirrorRuntime(item.id, result.runtime)
  try {
    if (result.completed) {
      await completeSession(item, result.runtime, !suppressCues)
      return
    }
    if (!suppressCues) {
      const nextStep = resolveIntervalStep(item.definition, result.runtime.stepIndex)?.step
      playIntervalGoCue(
        item.cues,
        nextStep?.kind,
        nextStep?.name,
      )
    }
    const updated = await store.updateSession(item.id, {
      runtime: result.runtime,
      elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
    })
    const resolved = resolveIntervalStep(updated.definition, updated.runtime.stepIndex)
    if (resolved) {
      await notifyIntervalTransition(resolved.step.name, `Interval ${resolved.index + 1} of ${resolved.totalSteps}`)
    }
  } finally {
    syncing.value = false
  }
}

function updateProgressFrame() {
  if (!runnerMounted) return
  void tick()
  animationFrame = window.requestAnimationFrame(updateProgressFrame)
}

async function completeSession(
  item: IntervalSession,
  runtime: IntervalRuntimeState,
  playCompletionCue = true,
) {
  if (playCompletionCue) playIntervalCompleteCue(item.cues)
  await stopFlashcardSpeech()
  await notifyIntervalTransition(`${item.name} complete`, 'Your interval session is finished.')
  await stopBackgroundInterval()
  const completion = {
    sessionId: item.id,
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  }
  try {
    await store.completeSession(completion.sessionId, completion)
    completionError.value = ''
    pendingCompletion.value = undefined
  } catch (cause) {
    pendingCompletion.value = completion
    completionError.value = cause instanceof Error
      ? cause.message
      : 'Could not save the completed interval.'
  }
  await wakeLock?.release()
  wakeLock = undefined
}

async function retryCompletion() {
  const completion = pendingCompletion.value
  if (!completion || syncing.value) return
  syncing.value = true
  try {
    await store.completeSession(completion.sessionId, completion)
    completionError.value = ''
    pendingCompletion.value = undefined
  } catch (cause) {
    completionError.value = cause instanceof Error
      ? cause.message
      : 'Could not save the completed interval.'
  } finally {
    syncing.value = false
  }
}

async function openNoteDialog() {
  noteDraft.value = session.value?.note || ''
  noteError.value = ''
  noteDialog.value = true
  await nextTick()
  noteField.value?.focus()
}

async function saveSessionNote() {
  const item = session.value
  if (!item || noteSaving.value || !noteChanged.value) return
  noteSaving.value = true
  noteError.value = ''
  try {
    await store.updateSession(item.id, { note: noteDraft.value.trim() })
    noteDialog.value = false
  } catch (cause) {
    noteError.value = cause instanceof Error ? cause.message : 'Could not save the interval note.'
  } finally {
    noteSaving.value = false
  }
}

async function pause() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  if (result.completed) return completeSession(item, result.runtime)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.updateSession(item.id, {
    status: 'paused',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
  })
  displayRemainingMs.value = runtime.remainingMs
  await stopBackgroundInterval()
  await stopFlashcardSpeech()
  await wakeLock?.release()
  wakeLock = undefined
}

async function resume() {
  const item = session.value
  if (!item || item.status !== 'paused') return
  const now = new Date().toISOString()
  const step = resolveIntervalStep(item.definition, item.runtime.stepIndex)
  const runtime = {
    ...item.runtime,
    stepStartedAt: step?.step.kind === 'confirmation' ? undefined : now,
    updatedAt: now,
  }
  await prepareIntervalCues(item.cues)
  const updated = await store.updateSession(item.id, { status: 'running', runtime })
  await syncNativeTimer(updated)
  wakeLock = await requestIntervalWakeLock()
}

async function requestStartTemplate(replaceActive = false) {
  const active = store.activeSession
  if (active && !replaceActive) {
    activeSessionName.value = active.name
    pendingActiveSessionStart.value = { kind: 'request' }
    replaceActiveSessionDialog.value = true
    return
  }
  if (!originTaskId.value && eligibleTaskProgress.value.length) {
    attributionSheet.value = true
    return
  }
  await startTemplate(
    originTaskId.value || undefined,
    originProgramStepId.value || undefined,
    originProgramStepCompletionId.value || undefined,
  )
}

async function startTemplate(
  taskId?: string,
  programStepId?: string,
  programStepCompletionId?: string,
  replaceActive = false,
) {
  const item = previewSession.value
  if (!item || starting.value) return
  if (store.activeSession && !replaceActive) {
    activeSessionName.value = store.activeSession.name
    pendingActiveSessionStart.value = {
      kind: 'template',
      taskId,
      programStepId,
      programStepCompletionId,
    }
    attributionSheet.value = false
    replaceActiveSessionDialog.value = true
    return
  }

  starting.value = true
  error.value = ''
  try {
    const attributedProgress = taskId
      ? eligibleTaskProgress.value.find((progress) =>
          progress.task.id === taskId
          && (progress.programStep?.id || '') === (programStepId || '')
          && (!programStepCompletionId || progress.completionItems?.some(completion => (
            completion.id === programStepCompletionId && !completion.complete
          ))),
        )
      : undefined
    if (attributedProgress?.status === 'missed') {
      await taskStore.setStatus(attributedProgress, 'pending')
    }
    await prepareIntervalCues(item.cues)
    const started = await store.startSession({
      name: item.name,
      source: 'template',
      definition: item.definition,
      cues: item.cues,
      template: item.template,
      task: taskId,
      programStep: programStepId,
      ...(programStepCompletionId ? { programStepCompletion: programStepCompletionId } : {}),
      taskDate: taskId ? item.taskDate : undefined,
      flashcardReview: item.flashcardReview,
      presentation: presentationForTemplate(item.template, programStepId, programStepCompletionId),
    })
    if (
      started.task !== taskId
      || started.programStep !== programStepId
      || started.programStepCompletion !== programStepCompletionId
    ) {
      pendingActiveSessionStart.value = {
        kind: 'template',
        taskId,
        programStepId,
        programStepCompletionId,
      }
      activeSessionName.value = started.name
      replaceActiveSessionDialog.value = true
      return
    }
    playCurrentStepCue(started)
    attributionSheet.value = false
    await router.replace({
      name: 'interval-runner',
      params: { sessionId: started.id },
      query: runnerRouteQuery.value,
    })

    // A normal route handoff mounts the running session separately. Keep this
    // preview intact until then so the welcome screen remains under the incoming
    // runner instead of exposing an empty frame. Finish locally only when the
    // router host kept the preview route instance mounted.
    if (typeof route.params.templateId === 'string') {
      previewSession.value = undefined
      displayRemainingMs.value = started.runtime.remainingMs
      if (started.status === 'running') {
        await syncNativeTimer(started)
        wakeLock = await requestIntervalWakeLock()
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the interval.'
  } finally {
    starting.value = false
  }
}

async function replaceActiveSession() {
  if (replacingActiveSession.value) return
  replacingActiveSession.value = true
  error.value = ''
  try {
    await store.endActiveSession()
    await stopBackgroundInterval()
    await stopFlashcardSpeech()
    replaceActiveSessionDialog.value = false
    const pending = pendingActiveSessionStart.value
    pendingActiveSessionStart.value = undefined
    if (pending?.kind === 'template') {
      await startTemplate(
        pending.taskId,
        pending.programStepId,
        pending.programStepCompletionId,
        true,
      )
    } else {
      await requestStartTemplate(true)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not end the active interval.'
  } finally {
    replacingActiveSession.value = false
  }
}

async function advanceCurrent(item: IntervalSession) {
  if (syncing.value) return
  syncing.value = true
  const result = reconciled(item)
  const nextIndex = result.runtime.stepIndex + 1
  const nextStep = resolveIntervalStep(item.definition, nextIndex)
  try {
    if (!nextStep) {
      await completeSession(item, {
        ...result.runtime,
        stepIndex: nextIndex,
        remainingMs: 0,
        stepStartedAt: undefined,
      })
      return
    }
    const now = new Date().toISOString()
    const runtime = {
      ...result.runtime,
      stepIndex: nextIndex,
      remainingMs: intervalStepDurationSeconds(nextStep.step) * 1000,
      stepElapsedMs: 0,
      stepStartedAt: item.status === 'running' && nextStep.step.kind !== 'confirmation'
        ? now
        : undefined,
      updatedAt: now,
    }
    const updated = await store.updateSession(item.id, {
      runtime,
      elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    })
    displayRemainingMs.value = runtime.remainingMs
    lastCountCue = ''
    if (updated.status === 'running') await syncNativeTimer(updated)
    playIntervalGoCue(item.cues, nextStep.step.kind, nextStep.step.name)
  } finally {
    syncing.value = false
  }
}

async function confirmCurrent() {
  const item = session.value
  if (
    !item
    || item.status !== 'running'
    || current.value?.step.kind !== 'confirmation'
    || finished.value
  ) return
  await advanceCurrent(item)
}

async function completeStopwatchStep() {
  const item = session.value
  if (
    !item
    || item.status !== 'running'
    || !currentStopwatch.value
    || finished.value
  ) return
  await advanceCurrent(item)
}

async function skip() {
  const item = session.value
  if (!item || currentConfirmation.value || finished.value) return
  await advanceCurrent(item)
}

async function previous() {
  const item = session.value
  if (!item || finished.value) return
  const result = reconciled(item)
  const previousIndex = Math.max(0, result.runtime.stepIndex - 1)
  const previousStep = resolveIntervalStep(item.definition, previousIndex)
  if (!previousStep) return
  const now = new Date().toISOString()
  const runtime = {
    ...result.runtime,
    stepIndex: previousIndex,
    remainingMs: intervalStepDurationSeconds(previousStep.step) * 1000,
    stepElapsedMs: 0,
    stepStartedAt: item.status === 'running' && previousStep.step.kind !== 'confirmation'
      ? now
      : undefined,
    updatedAt: now,
  }
  const updated = await store.updateSession(item.id, { runtime, elapsedSeconds: Math.round(runtime.accumulatedMs / 1000) })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
  if (updated.status === 'running') await syncNativeTimer(updated)
  playIntervalGoCue(item.cues, previousStep.step.kind, previousStep.step.name)
}

async function restart() {
  const item = session.value
  if (!item) return
  if (item.flashcardReview?.playbackOffsetMs !== undefined) {
    await updateFlashcardSnapshot({ ...item.flashcardReview, playbackOffsetMs: undefined })
  }
  const runtime = createRuntimeState(item.definition)
  if (item.status === 'paused') runtime.stepStartedAt = undefined
  const updated = await store.updateSession(item.id, { status: item.status === 'paused' ? 'paused' : 'running', runtime, elapsedSeconds: 0 })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
  lastSpokenFlashcardKey = ''
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function ensureIntervalFlashcardSource() {
  const reviewSet = flashcardReviewSet.value
  if (reviewSet && reviewSet.accessRole !== 'owner') {
    await flashcardStore.loadReviewSetCards(reviewSet.id)
  }
}

async function openFlashcardContext() {
  if (suppressIntervalFlashcardClick) {
    suppressIntervalFlashcardClick = false
    if (intervalFlashcardClickResetTimer) {
      window.clearTimeout(intervalFlashcardClickResetTimer)
      intervalFlashcardClickResetTimer = undefined
    }
    return
  }
  const item = session.value
  if (
    !item
    || flashcardContextDisabled.value
  ) return
  resumeAfterFlashcardContext = item.status === 'running'
  openingFlashcardContext.value = true
  try {
    if (resumeAfterFlashcardContext) await pause()
    if (session.value?.id === item.id && !finished.value) {
      flashcardContextSheet.value = true
    } else {
      resumeAfterFlashcardContext = false
    }
  } catch (cause) {
    resumeAfterFlashcardContext = false
    error.value = cause instanceof Error ? cause.message : 'Could not pause this interval.'
  } finally {
    openingFlashcardContext.value = false
  }
}

async function finishFlashcardContext() {
  const shouldResume = resumeAfterFlashcardContext
  resumeAfterFlashcardContext = false
  if (!shouldResume || session.value?.status !== 'paused') return
  try {
    await resume()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not resume this interval.'
  }
}

async function pauseForFlashcardModal() {
  const shouldPause = session.value?.status === 'running'
  resumeAfterFlashcardModal = resumeAfterFlashcardModal
    || resumeAfterFlashcardContext
    || shouldPause
  resumeAfterFlashcardContext = false
  if (shouldPause) await pause()
}

async function finishFlashcardModal() {
  if (resumeAfterFlashcardModal && session.value?.status === 'paused') await resume()
  resumeAfterFlashcardModal = false
}

async function updateFlashcardSnapshot(review: IntervalFlashcardReviewSnapshot) {
  const item = session.value
  if (!item || isTemplatePreview.value) return
  const updated = await store.updateSessionFlashcardReview(item.id, review)
  lastSpokenFlashcardKey = ''
  return updated
}

async function navigateIntervalFlashcard(
  direction: 'previous' | 'next',
  transitionDirection: 'previous' | 'next' | 'front' | 'back' = direction,
) {
  const item = session.value
  const review = item?.flashcardReview
  if (
    !item
    || !review
    || review.cards.length < 2
    || isTemplatePreview.value
    || syncing.value
    || flashcardNavigating.value
    || finished.value
  ) return

  flashcardNavigating.value = true
  lastSpokenFlashcardKey = ''
  try {
    await stopFlashcardSpeech()
    intervalFlashcardTransitionDirection.value = transitionDirection
    const updated = await updateFlashcardSnapshot({
      ...review,
      playbackOffsetMs: intervalFlashcardNavigationOffsetMs(
        review,
        flashcardReviewElapsedMs.value,
        direction,
      ),
    })
    if (updated?.status === 'running') await syncNativeTimer(updated)
    if (updated) {
      await nextTick()
      await speakCurrentFlashcardSide(true)
    }
  } catch (cause) {
    intervalFlashcardTransitionDirection.value = undefined
    error.value = cause instanceof Error ? cause.message : 'Could not navigate this Review set.'
  } finally {
    flashcardNavigating.value = false
  }
}

async function showIntervalFlashcardSide(
  side: 'front' | 'back',
  transitionDirection: 'previous' | 'next' | 'front' | 'back' = side,
) {
  const item = session.value
  const review = item?.flashcardReview
  if (
    !item
    || !review
    || flashcardPhase.value?.side === side
    || isTemplatePreview.value
    || syncing.value
    || flashcardNavigating.value
    || finished.value
  ) return

  flashcardNavigating.value = true
  lastSpokenFlashcardKey = ''
  try {
    await stopFlashcardSpeech()
    intervalFlashcardTransitionDirection.value = transitionDirection
    const updated = await updateFlashcardSnapshot({
      ...review,
      playbackOffsetMs: intervalFlashcardSideOffsetMs(
        review,
        flashcardReviewElapsedMs.value,
        side,
      ),
    })
    if (updated?.status === 'running') await syncNativeTimer(updated)
    if (updated) {
      await nextTick()
      await speakCurrentFlashcardSide(true)
    }
  } catch (cause) {
    intervalFlashcardTransitionDirection.value = undefined
    error.value = cause instanceof Error ? cause.message : 'Could not flip this flashcard.'
  } finally {
    flashcardNavigating.value = false
  }
}

function resetRunnerSwipe() {
  runnerSwipeStart = undefined
  runnerSwipeOffset.value = 0
  runnerSwipeDragging.value = false
}

function showRunnerExercise() {
  if (!runnerExercise.value) return
  resetRunnerSwipe()
  runnerExerciseVisible.value = true
}

function showRunnerProgress() {
  resetRunnerSwipe()
  runnerExerciseVisible.value = false
  void nextTick(() => timerFit?.fit({ sync: true }))
}

function runnerSwipeCanStart(target: EventTarget | null) {
  const element = target instanceof Element ? target : undefined
  if (!runnerExercise.value || !element) return false
  if (element.closest('button, a, [role="button"]')) return false
  return runnerExerciseVisible.value || Boolean(element.closest('.runner-main'))
}

function beginRunnerGesture(
  input: 'pointer' | 'touch',
  pointerId: number,
  x: number,
  y: number,
  width: number,
  target: EventTarget | null,
) {
  if (runnerSwipeStart || !runnerSwipeCanStart(target)) return
  runnerSwipeStart = {
    input,
    pointerId,
    x,
    y,
    width,
  }
  runnerSwipeOffset.value = 0
  runnerSwipeDragging.value = false
}

function beginRunnerSwipe(event: PointerEvent) {
  if (
    !event.isPrimary
    || event.pointerType === 'touch'
    || (event.pointerType === 'mouse' && event.button !== 0)
  ) return
  const stage = event.currentTarget
  beginRunnerGesture(
    'pointer',
    event.pointerId,
    event.clientX,
    event.clientY,
    stage instanceof HTMLElement ? stage.clientWidth : 0,
    event.target,
  )
}

function runnerTouchWithId(touches: TouchList, pointerId: number) {
  return Array.from(touches).find(touch => touch.identifier === pointerId)
}

function beginRunnerTouchSwipe(event: TouchEvent) {
  if (event.touches.length !== 1) return
  const touch = event.changedTouches[0]
  const stage = event.currentTarget
  if (!touch) return
  beginRunnerGesture(
    'touch',
    touch.identifier,
    touch.clientX,
    touch.clientY,
    stage instanceof HTMLElement ? stage.clientWidth : 0,
    event.target,
  )
}

function updateRunnerSwipe(
  input: 'pointer' | 'touch',
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  const start = runnerSwipeStart
  if (!start || start.input !== input || start.pointerId !== pointerId) return false

  const deltaX = clientX - start.x
  const deltaY = clientY - start.y
  if (!runnerSwipeDragging.value) {
    if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) return false
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      runnerSwipeStart = undefined
      return false
    }
    const movingTowardExercise = !runnerExerciseVisible.value && deltaX < 0
    const movingTowardProgress = runnerExerciseVisible.value && deltaX > 0
    if (!movingTowardExercise && !movingTowardProgress) {
      runnerSwipeStart = undefined
      return false
    }
    runnerSwipeDragging.value = true
  }

  const width = Math.max(0, start.width)
  runnerSwipeOffset.value = runnerExerciseVisible.value
    ? Math.min(width, Math.max(0, deltaX))
    : Math.max(-width, Math.min(0, deltaX))
  return true
}

function moveRunnerSwipe(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const wasDragging = runnerSwipeDragging.value
  if (!updateRunnerSwipe('pointer', event.pointerId, event.clientX, event.clientY)) return
  if (event.cancelable) event.preventDefault()
  if (wasDragging || !runnerSwipeDragging.value) return
  try {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  } catch {
    // Pointer capture is optional; the stable runner stage still receives ordinary pointer events.
  }
}

function moveRunnerTouchSwipe(event: TouchEvent) {
  const start = runnerSwipeStart
  if (!start || start.input !== 'touch') return
  const touch = runnerTouchWithId(event.touches, start.pointerId)
  if (!touch) return
  if (
    updateRunnerSwipe('touch', touch.identifier, touch.clientX, touch.clientY)
    && event.cancelable
  ) event.preventDefault()
}

function finishRunnerGesture(input: 'pointer' | 'touch', pointerId: number) {
  const start = runnerSwipeStart
  if (!start || start.input !== input || start.pointerId !== pointerId) return

  const shouldChangePanel = runnerSwipeDragging.value
    && Math.abs(runnerSwipeOffset.value) >= Math.min(56, start.width * .16)
  const wasShowingExercise = runnerExerciseVisible.value
  resetRunnerSwipe()
  if (!shouldChangePanel) return
  if (wasShowingExercise) showRunnerProgress()
  else showRunnerExercise()
}

function finishRunnerSwipe(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  updateRunnerSwipe('pointer', event.pointerId, event.clientX, event.clientY)
  finishRunnerGesture('pointer', event.pointerId)
}

function finishRunnerTouchSwipe(event: TouchEvent) {
  const start = runnerSwipeStart
  if (!start || start.input !== 'touch') return
  const touch = runnerTouchWithId(event.changedTouches, start.pointerId)
  if (!touch) return
  updateRunnerSwipe('touch', touch.identifier, touch.clientX, touch.clientY)
  finishRunnerGesture('touch', touch.identifier)
}

function cancelRunnerSwipe(event?: PointerEvent) {
  if (
    event
    && (
      runnerSwipeStart?.input !== 'pointer'
      || runnerSwipeStart.pointerId !== event.pointerId
    )
  ) return
  resetRunnerSwipe()
}

function cancelRunnerTouchSwipe(event: TouchEvent) {
  const start = runnerSwipeStart
  if (
    !start
    || start.input !== 'touch'
    || (
      event.changedTouches.length
      && !runnerTouchWithId(event.changedTouches, start.pointerId)
    )
  ) return
  resetRunnerSwipe()
}

function beginIntervalFlashcardSwipe(event: PointerEvent) {
  const review = session.value?.flashcardReview
  const startedFromTagControl = (event.target as Element | null)
    ?.closest('.interval-review-card__tag-control')
  if (
    !event.isPrimary
    || (event.pointerType === 'mouse' && event.button !== 0)
    || startedFromTagControl
    || !review
    || isTemplatePreview.value
    || syncing.value
    || openingFlashcardContext.value
    || flashcardNavigating.value
  ) return

  const response = (event.target as Element | null)?.closest('.flashcard-response-text')
  const scrollElement = response instanceof HTMLElement ? response : undefined
  intervalFlashcardSwipeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollElement,
    scrollTop: scrollElement?.scrollTop || 0,
    maxScrollTop: scrollElement
      ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      : 0,
  }
  try {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  } catch {
    // Pointer capture is optional; the stable card surface still receives ordinary pointer events.
  }
}

function moveIntervalFlashcardSwipe(event: PointerEvent) {
  const start = intervalFlashcardSwipeStart
  if (!start?.scrollElement || start.pointerId !== event.pointerId) return
  const deltaX = event.clientX - start.x
  const deltaY = event.clientY - start.y
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return
  start.scrollElement.scrollTop = Math.min(
    start.maxScrollTop,
    Math.max(0, start.scrollTop - deltaY),
  )
}

function suppressNextIntervalFlashcardClick() {
  suppressIntervalFlashcardClick = true
  if (intervalFlashcardClickResetTimer) window.clearTimeout(intervalFlashcardClickResetTimer)
  intervalFlashcardClickResetTimer = window.setTimeout(() => {
    suppressIntervalFlashcardClick = false
    intervalFlashcardClickResetTimer = undefined
  }, 350)
}

function finishIntervalFlashcardSwipe(event: PointerEvent) {
  const start = intervalFlashcardSwipeStart
  if (!start || start.pointerId !== event.pointerId) return
  intervalFlashcardSwipeStart = undefined

  const gesture = flashcardReviewActionFromSwipe(start, { x: event.clientX, y: event.clientY })
  if (!gesture) {
    if (start.scrollElement && Math.abs(start.scrollElement.scrollTop - start.scrollTop) > 1) {
      suppressNextIntervalFlashcardClick()
    }
    return
  }

  const responseConsumedGesture = start.scrollElement && (
    (gesture.action === 'next' && start.scrollTop < start.maxScrollTop)
    || (gesture.action === 'previous' && start.scrollTop > 0)
  )
  suppressNextIntervalFlashcardClick()
  if (responseConsumedGesture) return
  confirmSwipeHint(REVIEW_SET_CARD_SWIPE_HINT.id)
  if (gesture.action === 'previous' || gesture.action === 'next') {
    void navigateIntervalFlashcard(gesture.action, gesture.transition)
  } else {
    void showIntervalFlashcardSide(gesture.action, gesture.transition)
  }
}

function cancelIntervalFlashcardSwipe(event: PointerEvent) {
  if (intervalFlashcardSwipeStart?.pointerId === event.pointerId) {
    intervalFlashcardSwipeStart = undefined
  }
}

function finishIntervalFlashcardTransition() {
  intervalFlashcardTransitionDirection.value = undefined
}

async function toggleSessionTts() {
  const item = session.value
  const review = item?.flashcardReview
  if (!item || !review?.speechEnabled || syncing.value) return

  const shouldResume = resumeAfterFlashcardContext || item.status === 'running'
  const wasPaused = Boolean(review.speechPaused)
  const pausedElapsedMs = wasPaused && Number.isFinite(review.speechPausedElapsedMs)
    ? Math.max(0, review.speechPausedElapsedMs!)
    : flashcardReviewElapsedMs.value
  resumeAfterFlashcardContext = false
  try {
    if (wasPaused) {
      const runtime = {
        ...item.runtime,
        flashcardReviewAccumulatedMs: pausedElapsedMs,
        updatedAt: new Date().toISOString(),
      }
      await store.updateSession(item.id, { runtime })
      await updateFlashcardSnapshot({
        ...review,
        speechPaused: false,
        speechPausedElapsedMs: undefined,
      })
    } else {
      await stopFlashcardSpeech()
      await updateFlashcardSnapshot({
        ...review,
        speechPaused: true,
        speechPausedElapsedMs: pausedElapsedMs,
      })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update Review set playback.'
  } finally {
    if (shouldResume && session.value?.status === 'paused') {
      try {
        await resume()
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : 'Could not resume this interval.'
      }
    }
  }
}

function snapshotCard(card: Flashcard) {
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    ttsFront: card.ttsFront || '',
    ttsBack: card.ttsBack || '',
    transliteration: card.transliteration || '',
    note: card.note,
    frontAudio: card.frontAudio,
    backAudio: card.backAudio,
    image: card.image,
    tags: [...card.tags],
    ejectCount: card.ejectCount,
  }
}

async function openFlashcardEditor(action: 'add' | 'edit') {
  if (!session.value?.flashcardReview || !canManageIntervalCards.value || syncing.value) return
  await pauseForFlashcardModal()
  try {
    await ensureIntervalFlashcardSource()
    flashcardEditorCard.value = action === 'edit' ? currentFlashcardRecord.value : undefined
    if (action === 'edit' && !flashcardEditorCard.value) {
      throw new Error('That flashcard could not be found.')
    }
    flashcardEditorDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await finishFlashcardModal()
  }
}

async function closeFlashcardEditor(open: boolean) {
  flashcardEditorDialog.value = open
  if (!open) {
    await flashcardSaveWork
    await finishFlashcardModal()
  }
}

async function saveIntervalFlashcard(card: Flashcard) {
  const review = session.value?.flashcardReview
  if (!review) return
  const existing = review.cards.findIndex(item => item.id === card.id)
  const cards = [...review.cards]
  if (existing >= 0) cards.splice(existing, 1, snapshotCard(card))
  else if (cardMatchesTags(card, review.tags)) cards.push(snapshotCard(card))
  await updateFlashcardSnapshot({ ...review, cards })
}

async function toggleIntervalFlashcardTag(tag: { name: string }) {
  const cardId = flashcardPhase.value?.card.id
  if (!cardId || !canTagCurrentFlashcard.value || flashcardTagSaving.value) return
  flashcardTagSaving.value = tag.name
  try {
    const resolvedTag = await flashcardStore.createTag(tag.name)
    const update = flashcardTagToggleUpdate(
      flashcardPhase.value?.card.tags || [],
      resolvedTag,
      flashcardStore.tags,
    )
    const updatedCards = await flashcardStore.bulkUpdateCards(update.action, [cardId], update.values)
    const updatedCard = updatedCards.find(card => card.id === cardId)
    if (!updatedCard) throw new Error('The flashcard could not be updated.')
    await saveIntervalFlashcard(updatedCard)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update this flashcard tag.'
  } finally {
    flashcardTagSaving.value = ''
  }
}

function handleIntervalFlashcardSaved(card: Flashcard) {
  flashcardSaveWork = saveIntervalFlashcard(card)
}

async function requestFlashcardRemoval() {
  if (!flashcardPhase.value || !canManageIntervalCards.value) return
  await pauseForFlashcardModal()
  try {
    await ensureIntervalFlashcardSource()
    if (!currentFlashcardRecord.value) throw new Error('That flashcard could not be found.')
    flashcardDeleteDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await finishFlashcardModal()
  }
}

async function ejectIntervalFlashcard() {
  const review = session.value?.flashcardReview
  const cardId = flashcardPhase.value?.card.id
  if (!review || !cardId || flashcardEjecting.value) return
  flashcardEjecting.value = true
  void prepareFlashcardEjectCue()
  const reviewSet = flashcardReviewSet.value
  const previousExcludedCards = [...(reviewSet?.excludedCards || [])]
  try {
    const ejectCount = await flashcardStore.recordCardEject(review.reviewSet, cardId)
    const cards = review.cards.filter(card => card.id !== cardId)
    const reserveCardIds = [...(review.reserveCardIds || [])]
    const maxCards = review.maxCards || review.cards.length
    if (flashcardEjectLoadsNext(review.ejectBehavior) && reserveCardIds.length) {
      await ensureIntervalFlashcardSource()
      while (reserveCardIds.length && cards.length < maxCards) {
        const replacementId = reserveCardIds.shift()!
        if (cards.some(card => card.id === replacementId)) continue
        const replacement = intervalFlashcardSource.value.find(card => card.id === replacementId)
        if (!replacement) continue
        cards.push({
          id: replacement.id,
          front: replacement.front,
          back: replacement.back,
          ttsFront: replacement.ttsFront || '',
          ttsBack: replacement.ttsBack || '',
          transliteration: replacement.transliteration || '',
          note: replacement.note,
          frontAudio: replacement.frontAudio,
          backAudio: replacement.backAudio,
          image: replacement.image,
          tags: [...replacement.tags],
          ejectCount: replacement.ejectCount,
        })
      }
    }
    if (
      flashcardEjectExcludes(review.ejectBehavior)
      && flashcardEjectReachesExclusionThreshold(
        ejectCount,
        review.ejectExcludeAfter,
      )
    ) {
      if (!reviewSet) throw new Error('The Review set for this session is no longer available.')
        await flashcardStore.saveReviewSetPreferences(reviewSet.id, {
          ...reviewSet,
          excludedCards: updateFlashcardReviewExclusions(
            previousExcludedCards,
            'exclude',
            [cardId],
          ),
        })
    }
    await updateFlashcardSnapshot({
      ...review,
      cards,
      reserveCardIds,
      playbackOffsetMs: intervalFlashcardEjectionOffsetMs(
        review,
        flashcardReviewElapsedMs.value,
        cardId,
        cards,
      ),
    })
    playFlashcardEjectCue()
  } catch (cause) {
    if (flashcardEjectExcludes(review.ejectBehavior) && reviewSet) {
      try {
        await flashcardStore.saveReviewSetPreferences(reviewSet.id, {
          ...reviewSet,
          excludedCards: previousExcludedCards,
        })
      } catch {
        // Preserve the eject failure; synchronization can retry the preference update.
      }
    }
    error.value = cause instanceof Error ? cause.message : 'Could not eject this flashcard.'
  } finally {
    flashcardEjecting.value = false
  }
}

async function cancelFlashcardRemoval() {
  flashcardDeleteDialog.value = false
  await finishFlashcardModal()
}

async function removeIntervalFlashcard() {
  const review = session.value?.flashcardReview
  const card = currentFlashcardRecord.value
  const reviewSet = flashcardReviewSet.value
  if (!review || !card || !reviewSet || flashcardDeleting.value) return
  flashcardDeleting.value = true
  try {
    if (reviewSet.accessRole === 'owner') await flashcardStore.deleteCard(card.id)
    else await flashcardStore.deleteReviewSetCard(reviewSet.id, card.id)
    await updateFlashcardSnapshot({
      ...review,
      cards: review.cards.filter(item => item.id !== card.id),
    })
    flashcardDeleteDialog.value = false
    await finishFlashcardModal()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not remove this flashcard.'
  } finally {
    flashcardDeleting.value = false
  }
}

async function openFlashcardSettings() {
  const review = session.value?.flashcardReview
  if (!review || syncing.value) return
  await pauseForFlashcardModal()
  Object.assign(flashcardSettingsDraft, {
    mode: 'passive',
    cardSides: 'both',
    invertFaces: false,
    indefinite: true,
    maxCards: review.maxCards || review.cards.length,
    ejectBehavior: review.ejectBehavior || 'remove',
    ejectExcludeAfter: review.ejectExcludeAfter || DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
    frontSeconds: review.frontSeconds,
    backSeconds: review.backSeconds,
    backSpeechRepeatCount: review.backSpeechRepeatCount,
    frontDisplay: review.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
    backDisplay: review.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
    speechEnabled: review.speechEnabled,
    backSpeechRate: review.backSpeechRate,
    frontLanguage: review.frontLanguage,
    backLanguage: review.backLanguage,
    sortMode: review.sortMode,
    sortDirection: review.sortDirection,
  })
  flashcardSettingsOriginal.value = flashcardReviewSettingsSignature(flashcardSettingsDraft)
  flashcardSettingsError.value = ''
  flashcardSettingsDialog.value = true
  flashcardSpeechLoading.value = true
  try {
    await ensureIntervalFlashcardSource()
    flashcardSpeechSupport.value = await loadFlashcardSpeechSupport()
  } finally {
    flashcardSpeechLoading.value = false
  }
}

async function closeFlashcardSettings() {
  flashcardSettingsApplyMenu.value = false
  flashcardSettingsDialog.value = false
  flashcardSettingsError.value = ''
  await finishFlashcardModal()
}

async function validateFlashcardSettings() {
  const validation = await flashcardSettingsForm.value?.validate()
  const review = session.value?.flashcardReview
  const reviewSet = flashcardReviewSet.value
  if (!validation?.valid || !canSaveFlashcardSettings.value || !review || !reviewSet) return
  return { review, reviewSet }
}

async function saveFlashcardSettings(target: FlashcardSettingsApplyTarget = 'session') {
  const context = await validateFlashcardSettings()
  if (!context) return
  flashcardSettingsSaveTarget.value = target
  flashcardSettingsError.value = ''
  try {
    if (target === 'review-set' || target === 'both') {
      const settings = {
        ...context.reviewSet,
        cardSides: 'both',
        invertFaces: false,
        maxCards: flashcardSettingsDraft.maxCards,
        ejectBehavior: flashcardSettingsDraft.ejectBehavior,
        ejectExcludeAfter: flashcardSettingsDraft.ejectExcludeAfter,
        frontSeconds: flashcardSettingsDraft.frontSeconds,
        backSeconds: flashcardSettingsDraft.backSeconds,
        backSpeechRepeatCount: flashcardSettingsDraft.backSpeechRepeatCount,
        frontDisplay: flashcardSettingsDraft.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
        backDisplay: flashcardSettingsDraft.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
        speechEnabled: flashcardSettingsDraft.speechEnabled,
        backSpeechRate: flashcardSettingsDraft.backSpeechRate,
        frontLanguage: flashcardSettingsDraft.frontLanguage,
        backLanguage: flashcardSettingsDraft.backLanguage,
        sortMode: flashcardSettingsDraft.sortMode,
        sortDirection: flashcardSettingsDraft.sortDirection,
      }
      if (context.reviewSet.accessRole === 'owner') {
        await flashcardStore.saveReviewSet(settings)
      } else {
        await flashcardStore.saveReviewSetPreferences(context.reviewSet.id, settings)
        showSavedSnackbar('Review set', context.reviewSet.name)
      }
    }

    if (target === 'session' || target === 'both') {
      const snapshot = createIntervalFlashcardReviewSnapshot(
        { ...context.reviewSet, ...flashcardSettingsDraft },
        intervalFlashcardSource.value,
      )
      if (!snapshot) throw new Error('These settings do not match any available cards.')
      await updateFlashcardSnapshot({
        ...snapshot,
        ...(context.review.speechPaused
          ? {
              speechPaused: true,
              speechPausedElapsedMs: context.review.speechPausedElapsedMs,
            }
          : {}),
      })
      showSavedSnackbar('Review session', context.reviewSet.name)
    }
    await closeFlashcardSettings()
  } catch (cause) {
    flashcardSettingsError.value = cause instanceof Error
      ? cause.message
      : 'Could not update the flashcard settings.'
  } finally {
    flashcardSettingsSaveTarget.value = undefined
  }
}

function applyFlashcardSettingsTo(target: FlashcardSettingsApplyTarget) {
  flashcardSettingsApplyMenu.value = false
  void saveFlashcardSettings(target)
}

function handleFlashcardContextAction(action: FlashcardContextAction) {
  if (action === 'add' || action === 'edit') void openFlashcardEditor(action)
  else if (action === 'eject') void ejectIntervalFlashcard()
  else if (action === 'remove') void requestFlashcardRemoval()
  else if (action === 'toggle_tts') void toggleSessionTts()
  else if (action === 'settings') void openFlashcardSettings()
}

async function endEarly() {
  const item = session.value
  if (!item) return
  endDialog.value = false
  const result = reconciled(item)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.endSession(item.id, {
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  })
  await stopBackgroundInterval()
  await stopFlashcardSpeech()
  await wakeLock?.release()
  wakeLock = undefined
}

async function runAgain() {
  const item = session.value
  if (!item || starting.value) return

  starting.value = true
  try {
    await prepareIntervalCues(item.cues)
    const flashcardReview = item.flashcardReview
      ? {
          ...item.flashcardReview,
          speechPaused: false,
          speechPausedElapsedMs: undefined,
          playbackOffsetMs: undefined,
        }
      : undefined
    const nextSession = await store.startSession({
      name: item.name,
      source: item.source,
      definition: item.definition,
      cues: item.cues,
      template: item.template,
      flashcardReview,
      presentation: item.presentation,
    })
    playCurrentStepCue(nextSession)
    await router.replace({
      name: 'interval-runner',
      params: { sessionId: nextSession.id },
      query: runnerRouteQuery.value,
    })
    displayRemainingMs.value = nextSession.runtime.remainingMs
    await syncNativeTimer(nextSession)
    wakeLock = await requestIntervalWakeLock()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the interval again.'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <main class="runner-page" :class="{ 'runner-page--finished': finished }">
    <v-alert v-if="backgroundError" type="warning" variant="tonal" class="mb-3">{{ backgroundError }}</v-alert>
    <v-alert v-if="completionError" type="error" variant="tonal" class="mb-3">
      {{ completionError }}
      <template #append>
        <v-btn size="small" variant="text" :loading="syncing" @click="retryCompletion">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>

    <div class="runner-screen-stage">
      <transition name="runner-screen">
        <RunnerStartScreen
          v-if="!error && session && isTemplatePreview"
          key="start"
          class="runner-screen runner-view"
          :title="runnerIdentityTitle"
          :summary="runnerIdentitySummary"
          :task-name="startTaskName"
          :icon="sessionIcon"
          :image="runnerIdentityImage"
          :image-alt="attributedExercise?.name"
          :color="sessionColor"
          primary-label="Start interval"
          cancel-label="Cancel interval"
          :busy="starting"
          @start="requestStartTemplate()"
          @cancel="router.replace(returnTo)"
        />

        <section
          v-else-if="!error && session && finished"
          key="briefing"
          class="finish-card runner-screen runner-view runner-view--briefing"
        >
          <div
            class="finish-icon"
            :class="{ 'finish-icon--image': runnerIdentityImage }"
            :style="{ background: sessionColor }"
          >
            <v-img
              v-if="runnerIdentityImage"
              class="finish-image"
              :src="runnerIdentityImage"
              :alt="attributedExercise?.name || runnerIdentityTitle"
              cover
              eager
            >
              <template #error>
                <ContentIcon :icon="sessionIcon" size="2.125rem" />
              </template>
            </v-img>
            <ContentIcon v-else :icon="sessionIcon" size="2.125rem" />
          </div>
          <p class="runner-label finish-status">
            <span>{{ session.status === 'completed' ? 'Session completed' : 'Session ended' }}</span>
            <template v-if="completionIdentityTitle !== session.name">
              <span class="finish-status__separator">·</span>
              <span class="finish-status__interval">{{ session.name }}</span>
            </template>
          </p>
          <h1 class="display-title">
            {{ completionIdentityTitle }}<span class="text-secondary">.</span>
          </h1>
          <p v-if="completionIdentityTitle !== session.name" class="finish-source">{{ session.name }}</p>
          <div class="finish-stats">
            <div><span>Planned</span><strong>{{ formatIntervalDuration(session.plannedSeconds) }}</strong></div>
            <div><span>Elapsed</span><strong>{{ formatIntervalDuration(session.elapsedSeconds) }}</strong></div>
            <div><span>Intervals</span><strong>{{ Math.min(session.runtime.stepIndex, current?.totalSteps || session.runtime.stepIndex) }}</strong></div>
          </div>
          <div v-if="session.note" class="finish-note">
            <v-icon icon="mdi-note-text-outline" size="22" />
            <p>{{ session.note }}</p>
          </div>
          <div class="finish-actions">
            <v-btn
              class="finish-actions__done"
              color="secondary"
              size="x-large"
              prepend-icon="mdi-check-bold"
              :to="returnTo"
            >
              Done
            </v-btn>
            <v-btn variant="tonal" size="large" prepend-icon="mdi-replay" :loading="starting" @click="runAgain()">Run again</v-btn>
            <v-btn variant="outlined" size="large" prepend-icon="mdi-note-plus-outline" @click="openNoteDialog">
              {{ session.note ? 'Edit note' : 'Add note' }}
            </v-btn>
          </div>
        </section>

        <div
          v-else-if="!error && session && current"
          key="runner"
          class="runner-screen runner-view runner-view--active"
        >
          <header
            class="runner-header"
            :class="{ 'runner-header--with-review': flashcardPhase && session.flashcardReview }"
          >
            <v-btn icon="mdi-chevron-down" variant="text" aria-label="Leave runner" :to="returnTo" />
            <div class="runner-header__title text-center min-width-0">
              <div class="runner-header__standard-title">
                <p class="runner-label">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
                <strong class="text-truncate d-block">{{ session.name }}</strong>
              </div>
              <div class="runner-header__review-title">
                <strong class="text-truncate">{{ session.name }}</strong>
                <span class="runner-label">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</span>
              </div>
            </div>
            <div class="runner-header__actions">
              <v-btn
                icon="mdi-dots-vertical"
                variant="text"
                class="runner-actions-button"
                aria-label="Interval actions"
                :disabled="sessionActionsDisabled"
                @touchstart.stop
                @click.stop="sessionActionsSheet = true"
              />
            </div>
          </header>

          <div
            class="runner-stage"
            :class="{ 'runner-stage--swiping': runnerSwipeDragging }"
            @pointerdown="beginRunnerSwipe"
            @pointermove="moveRunnerSwipe"
            @pointerup="finishRunnerSwipe"
            @pointercancel="cancelRunnerSwipe"
            @lostpointercapture="cancelRunnerSwipe"
            @touchstart.passive="beginRunnerTouchSwipe"
            @touchmove="moveRunnerTouchSwipe"
            @touchend="finishRunnerTouchSwipe"
            @touchcancel="cancelRunnerTouchSwipe"
          >
            <div class="runner-stage__track" :style="runnerStageTrackStyle">
              <div
                class="runner-stage__panel runner-stage__panel--exercise"
                :aria-hidden="!runnerExerciseVisible"
                :inert="runnerExerciseVisible ? undefined : true"
              >
                <ExerciseDetailsPanel
                  v-if="runnerExercise"
                  :exercise="runnerExercise"
                  :active="runnerExerciseVisible"
                  @show-progress="showRunnerProgress"
                />
              </div>

              <div
                class="runner-stage__panel runner-stage__original"
                :class="{ 'runner-stage--with-review': flashcardPhase && session.flashcardReview }"
                :aria-hidden="runnerExerciseVisible"
                :inert="runnerExerciseVisible ? true : undefined"
              >
                <div class="runner-stage__primary">
              <section
                class="runner-main"
                :class="{ 'runner-main--with-review': flashcardPhase }"
              >
              <div class="runner-details">
                <p class="runner-session">{{ session.name }}</p>
                <p v-if="attributedTaskName" class="runner-task-link">
                  Completes {{ attributedTaskName }}
                </p>
                <p class="runner-label runner-position">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
                <h1 class="runner-step">{{ current.step.name }}</h1>
              </div>
              <div class="runner-progress-stack">
                <div class="runner-progress">
                  <!-- <v-btn
                    v-if="runnerExercise"
                    class="runner-exercise-details-button"
                    icon="mdi-dumbbell"
                    variant="tonal"
                    color="secondary"
                    size="small"
                    aria-label="Show exercise details"
                    @touchstart.stop
                    @pointerdown.stop
                    @click.stop="showRunnerExercise"
                  /> -->
                  <div class="progress-rings">
                    <IntervalTypeIcon
                      v-if="current.step.kind"
                      class="runner-type-backdrop"
                      :kind="current.step.kind"
                      size="clamp(8rem, 44vw, 8rem)"
                      :animated="session.status === 'running'"
                    />
                    <v-progress-circular
                      v-if="showTotalProgress"
                      class="progress-ring progress-ring--total"
                      :model-value="progress.total"
                      :width="7"
                      color="info"
                      bg-color="surface-variant"
                      :aria-label="`Total progress: ${Math.round(progress.total)}%`"
                    />
                    <v-progress-circular
                      v-if="showRoundProgress"
                      class="progress-ring progress-ring--round"
                      :model-value="progress.round"
                      :width="7"
                      color="warning"
                      bg-color="surface-variant"
                      :aria-label="`Current round progress: ${Math.round(progress.round || 0)}%`"
                    />
                    <v-progress-circular
                      class="progress-ring progress-ring--item"
                      :model-value="progress.item"
                      :width="12"
                      color="secondary"
                      bg-color="surface-variant"
                      :aria-label="`Current item progress: ${Math.round(progress.item)}%`"
                    />
                    <div
                      v-if="!currentConfirmation"
                      ref="progressRingsContent"
                      class="progress-rings__content"
                    >
                      <span
                        :key="timerEffectKey"
                        ref="timerValueElement"
                        class="timer-value"
                        :class="{
                          'timer-value--count': timerEffect === 'count',
                        }"
                      >
                        {{ displayedTimeLabel }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <p class="next-copy">{{ next ? `Next: ${next.step.name}` : 'Final interval' }}</p>
              </section>

              <footer class="runner-controls runner-controls--landscape">
                <v-btn
                  v-if="currentStopwatch"
                  color="secondary"
                  class="runner-confirm-button"
                  prepend-icon="mdi-check-bold"
                  :loading="syncing"
                  :disabled="isTemplatePreview || session.status !== 'running'"
                  @touchstart.stop
                  @click.stop="completeStopwatchStep"
                >
                  Completed
                </v-btn>
                <v-btn
                  v-else-if="currentConfirmation"
                  color="secondary"
                  class="runner-confirm-button"
                  append-icon="mdi-arrow-right"
                  :loading="starting || syncing"
                  :disabled="!isTemplatePreview && session.status !== 'running'"
                  @touchstart.stop
                  @click.stop="isTemplatePreview ? requestStartTemplate() : confirmCurrent()"
                >
                  {{ isTemplatePreview ? playActionLabel : 'Continue' }}
                </v-btn>
                <template v-else>
                  <v-btn
                    icon="mdi-skip-previous"
                    variant="tonal"
                    :disabled="isTemplatePreview || current.index === 0"
                    aria-label="Previous interval"
                    @click="previous"
                  />
                  <v-btn
                    :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
                    color="secondary"
                    class="runner-pause-button"
                    :loading="starting"
                    :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
                    @touchstart.stop
                    @click.stop="isTemplatePreview ? requestStartTemplate() : session.status === 'paused' ? resume() : pause()"
                  />
                  <v-btn icon="mdi-skip-next" variant="tonal" aria-label="Next interval" :disabled="isTemplatePreview" @click="skip" />
                </template>
                <v-btn
                  icon="mdi-chevron-left"
                  variant="text"
                  class="runner-back-button"
                  aria-label="Leave runner"
                  :to="returnTo"
                />
                <v-btn
                  icon="mdi-dots-vertical"
                  variant="text"
                  class="runner-actions-button"
                  aria-label="Interval actions"
                  :disabled="sessionActionsDisabled"
                  @touchstart.stop
                  @click.stop="sessionActionsSheet = true"
                />
              </footer>
            </div>

            <footer class="runner-controls runner-controls--portrait">
              <v-btn
                v-if="currentStopwatch"
                class="runner-confirm-button"
                color="secondary"
                size="x-large"
                prepend-icon="mdi-check-bold"
                :loading="syncing"
                :disabled="isTemplatePreview || session.status !== 'running'"
                @touchstart.stop
                @click.stop="completeStopwatchStep"
              >
                Completed
              </v-btn>
              <v-btn
                v-else-if="currentConfirmation"
                class="runner-confirm-button"
                color="secondary"
                size="x-large"
                append-icon="mdi-arrow-right"
                :loading="starting || syncing"
                :disabled="!isTemplatePreview && session.status !== 'running'"
                @touchstart.stop
                @click.stop="isTemplatePreview ? requestStartTemplate() : confirmCurrent()"
              >
                {{ isTemplatePreview ? playActionLabel : 'Continue' }}
              </v-btn>
              <template v-else>
                <v-btn icon="mdi-skip-previous" variant="tonal" size="large" aria-label="Previous interval" :disabled="isTemplatePreview || current.index === 0" @click="previous" />
                <v-btn
                  :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
                  color="secondary"
                  size="x-large"
                  :loading="starting"
                  :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
                  @touchstart.stop
                  @click.stop="isTemplatePreview ? requestStartTemplate() : session.status === 'paused' ? resume() : pause()"
                />
                <v-btn icon="mdi-skip-next" variant="tonal" size="large" aria-label="Skip interval" :disabled="isTemplatePreview" @click="skip" />
              </template>
            </footer>

            <ReviewSetCard
              v-if="flashcardPhase && session.flashcardReview"
              dense
              :card="displayedIntervalFlashcard || flashcardPhase.card"
              :side="flashcardPhase.side"
              :front-display="flashcardFrontDisplay"
              :back-display="flashcardBackDisplay"
              :disabled="flashcardContextDisabled"
              :transition-direction="intervalFlashcardTransitionDirection"
              :set-name="session.flashcardReview.name"
              :card-position="flashcardPhase.cardIndex + 1"
              :card-count="session.flashcardReview.cards.length"
              :paused="!flashcardReviewPlaybackEnabled"
              :speech-enabled="session.flashcardReview.speechEnabled"
              :speech-language="flashcardPhase.side === 'front'
                ? session.flashcardReview.frontLanguage
                : session.flashcardReview.backLanguage"
              :spoken-word="spokenFlashcardWord"
              :progress="flashcardPhase.progress"
              progress-color="info"
              :progress-aria-label="flashcardReviewPlaybackEnabled
                ? `${Math.round(flashcardPhase.progress)}% through the ${flashcardPhase.side}`
                : `Review set paused at ${Math.round(flashcardPhase.progress)}% through the ${flashcardPhase.side}`"
              show-tag-actions
              :quick-tags="intervalQuickTags"
              :can-tag="canTagCurrentFlashcard"
              ejectable
              :ejecting="flashcardEjecting"
              :eject-disabled="isTemplatePreview || syncing || flashcardEjecting"
              @pointer-down="beginIntervalFlashcardSwipe"
              @pointer-move="moveIntervalFlashcardSwipe"
              @pointer-up="finishIntervalFlashcardSwipe"
              @pointer-cancel="cancelIntervalFlashcardSwipe"
              @lost-pointer-capture="cancelIntervalFlashcardSwipe"
              @activate="openFlashcardContext"
              @after-enter="finishIntervalFlashcardTransition"
              @eject="ejectIntervalFlashcard"
              @toggle-tag="toggleIntervalFlashcardTag({ name: $event })"
              @previous="navigateIntervalFlashcard('previous', $event)"
              @next="navigateIntervalFlashcard('next', $event)"
              @flip="showIntervalFlashcardSide"
              @toggle-playback="session.status === 'paused' ? resume() : pause()"
            />

              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <RunnerSessionActions
      v-model="sessionActionsSheet"
      title="Interval actions"
      aria-label="Interval session actions"
      :items="sessionActionItems"
      @action="handleRunnerSessionAction"
    />

    <AppDialog
      v-model="intervalSettingsDialog"
      persistent
      scrollable
      fullscreen
    >
      <v-card class="interval-settings-card" rounded="0">
        <v-card-title class="interval-settings-header d-flex align-center ga-3">
          <v-icon icon="mdi-timer-cog-outline" color="secondary" />
          <span>Settings</span>
        </v-card-title>
        <v-card-text class="interval-settings-body px-4 py-4">
          <v-alert
            v-if="intervalSettingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ intervalSettingsError }}
          </v-alert>
          <AppForm @submit.prevent="saveIntervalSettings('session')">
            <IntervalSettingsFields
              v-model:definition="intervalSettingsDraft.definition"
              v-model:cues="intervalSettingsDraft.cues"
              v-model:review-set="intervalSettingsDraft.flashcardReviewSet"
              :review-sets="flashcardStore.reviewSets"
              :review-set-speech-enabled="intervalSettingsReviewSet?.speechEnabled === true"
            />
          </AppForm>
        </v-card-text>
        <v-divider />
        <v-card-actions class="interval-settings-actions ga-2">
          <v-btn
            class="interval-settings-actions__cancel"
            variant="text"
            :disabled="intervalSettingsSaving"
            @click="closeIntervalSettings"
          >
            Cancel
          </v-btn>
          <v-btn
            class="interval-settings-actions__primary apply-interval-settings-menu"
            color="secondary"
            variant="flat"
            :loading="intervalSettingsSaving"
            :disabled="!canSaveIntervalSettings || intervalSettingsSaving"
            @click="intervalSettingsApplyMenu = true"
          >
            Apply to...
          </v-btn>
        </v-card-actions>
        <ActionBottomSheet
          v-model="intervalSettingsApplyMenu"
          title="Apply to..."
          aria-label="Choose where to apply interval settings"
        >
          <v-list-item
            v-for="item in intervalSettingsApplyItems"
            :key="item.target"
            :class="`apply-interval-settings-target--${item.target}`"
            :title="item.title"
            :prepend-icon="item.icon"
            :disabled="item.disabled"
            rounded="lg"
            @click="applyIntervalSettingsTo(item.target)"
          />
        </ActionBottomSheet>
      </v-card>
    </AppDialog>

    <FlashcardContextActions
      v-model="flashcardContextSheet"
      :busy="syncing || starting"
      :can-manage-card="!isTemplatePreview && canManageIntervalCards && Boolean(flashcardPhase)"
      :can-add-card="!isTemplatePreview && canManageIntervalCards"
      :can-eject-card="!isTemplatePreview && Boolean(flashcardPhase)"
      :can-toggle-tts="!isTemplatePreview && session?.flashcardReview?.speechEnabled === true"
      :tts-paused="sessionTtsPaused"
      @action="handleFlashcardContextAction"
    />

    <FlashcardCardDialog
      :model-value="flashcardEditorDialog"
      :card="flashcardEditorCard"
      :review-set-id="flashcardReviewSet?.accessRole === 'owner' ? undefined : flashcardReviewSet?.id"
      :initial-tags="session?.flashcardReview?.tags"
      @update:model-value="closeFlashcardEditor"
      @saved="handleIntervalFlashcardSaved"
    />

    <AppDialog
      v-model="flashcardSettingsDialog"
      persistent
      scrollable
      fullscreen
    >
      <v-card class="flashcard-settings-card" rounded="0">
        <v-card-title class="flashcard-settings-header d-flex align-center ga-3">
          <v-icon icon="mdi-tune-variant" color="secondary" />
          <span>Flashcard settings</span>
        </v-card-title>
        <v-card-text class="px-5 py-4">
          <v-alert
            v-if="flashcardSettingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ flashcardSettingsError }}
          </v-alert>
          <AppForm ref="flashcardSettingsForm" @submit.prevent="saveFlashcardSettings('session')">
            <FlashcardReviewSettingsFields
              :model-value="flashcardSettingsDraft"
              :speech-support="flashcardSpeechSupport"
              :speech-loading="flashcardSpeechLoading"
              :available-cards="intervalFlashcardSource.length"
              session
              interval
            />
          </AppForm>
        </v-card-text>
        <v-divider />
        <v-card-actions class="flashcard-settings-actions ga-2">
          <v-btn
            class="flashcard-settings-actions__cancel"
            variant="text"
            :disabled="flashcardSettingsSaving"
            @click="closeFlashcardSettings"
          >
            Cancel
          </v-btn>
          <v-btn
            class="flashcard-settings-actions__primary apply-settings-menu"
            color="secondary"
            variant="flat"
            :loading="flashcardSettingsSaving"
            :disabled="!canSaveFlashcardSettings || flashcardSettingsSaving"
            @click="flashcardSettingsApplyMenu = true"
          >
            Apply to...
          </v-btn>
        </v-card-actions>
        <ActionBottomSheet
          v-model="flashcardSettingsApplyMenu"
          title="Apply to..."
          aria-label="Choose where to apply flashcard settings"
        >
          <v-list-item
            v-for="item in FLASHCARD_SETTINGS_APPLY_MENU_ITEMS"
            :key="item.target"
            :class="`apply-settings-target--${item.target}`"
            :title="item.title"
            :prepend-icon="item.icon"
            rounded="lg"
            @click="applyFlashcardSettingsTo(item.target)"
          />
        </ActionBottomSheet>
      </v-card>
    </AppDialog>

    <ConfirmDialog
      :model-value="flashcardDeleteDialog"
      title="Remove this flashcard?"
      message="The card will be deleted from future reviews and removed from this interval. Existing review history keeps its saved faces."
      confirm-text="Remove card"
      confirm-color="error"
      icon="mdi-delete-outline"
      :loading="flashcardDeleting"
      @update:model-value="!$event && cancelFlashcardRemoval()"
      @confirm="removeIntervalFlashcard"
    />

    <ConfirmDialog
      v-model="endDialog"
      title="End this session?"
      message="Your elapsed time will be saved, but this run will be marked as ended early."
      confirm-text="End session"
      icon="mdi-stop-circle-outline"
      @confirm="endEarly"
    />

    <AppDialog v-model="noteDialog" max-width="480" :persistent="noteSaving">
      <v-card class="pa-5">
        <div class="note-dialog-heading">
          <div class="note-dialog-icon">
            <v-icon icon="mdi-note-edit-outline" size="24" />
          </div>
          <div class="min-width-0">
            <h2 class="text-h6 font-weight-black">Interval note</h2>
            <p class="text-body-2 muted mt-1">Capture how the session felt or anything worth remembering.</p>
          </div>
        </div>
        <v-alert v-if="noteError" type="error" variant="tonal" class="mt-4">{{ noteError }}</v-alert>
        <v-textarea
          ref="noteField"
          v-model="noteDraft"
          label="Note"
          maxlength="2000"
          counter
          rows="4"
          auto-grow
          class="mt-5"
          @keydown.ctrl.enter="saveSessionNote"
          @keydown.meta.enter="saveSessionNote"
        />
        <div class="note-dialog-actions mt-5">
          <v-btn variant="text" :disabled="noteSaving" @click="noteDialog = false">Cancel</v-btn>
          <v-btn class="mobile-large-action" color="secondary" size="large" :loading="noteSaving" :disabled="!noteChanged" @click="saveSessionNote">Save note</v-btn>
        </div>
      </v-card>
    </AppDialog>

    <ActionBottomSheet
      v-model="attributionSheet"
      title="Choose what this run completes"
      aria-label="Choose an interval task or standalone run"
    >
      <p class="text-body-2 muted px-4 pb-3">Choose one open task for today, or run the interval on its own.</p>
      <p v-if="!eligibleTaskProgress.length" class="text-caption muted px-4 pb-2">No attached tasks are open for this date.</p>
      <v-list-item
        v-for="item in eligibleTaskProgress"
        :key="`${item.task.id}-${item.programStep?.id || ''}`"
        prepend-icon="mdi-format-list-checks"
        :title="item.programStep?.name || item.task.name"
        :subtitle="item.programStep ? `${item.task.name} · Complete one requirement when the interval finishes` : 'Complete this task when the interval finishes'"
        rounded="lg"
        @click="startTemplate(item.task.id, item.programStep?.id, intervalCompletionId(item))"
      />
      <v-list-item
        prepend-icon="mdi-timer-outline"
        title="Standalone"
        subtitle="Save the run without completing a task"
        rounded="lg"
        @click="startTemplate()"
      />
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="replaceActiveSessionDialog"
      title="End the active interval?"
      :message="`${activeSessionName || 'Another interval'} is already in progress. End it and start ${previewSession?.name || 'this interval'} instead?`"
      confirm-text="End and continue"
      confirm-color="warning"
      icon="mdi-alert-outline"
      :loading="replacingActiveSession || starting"
      @confirm="replaceActiveSession"
    />
  </main>
</template>

<style scoped>
.runner-page {
  position: fixed;
  z-index: 1003;
  inset: 0;
  display: flex;
  width: 100%;
  max-width: 100vw;
  height: 100dvh;
  min-height: 0;
  padding:
    max(1rem, env(safe-area-inset-top))
    1rem
    max(1rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  background: rgb(var(--v-theme-background));
}
.runner-page.page-depth-deeper-enter-active > *,
.runner-page.page-depth-deeper-leave-active > *,
.runner-page.page-depth-higher-enter-active > *,
.runner-page.page-depth-higher-leave-active > * {
  transition: none;
}
.runner-page.page-depth-deeper-enter-from > *,
.runner-page.page-depth-deeper-leave-to > *,
.runner-page.page-depth-higher-enter-from > *,
.runner-page.page-depth-higher-leave-to > * {
  transform: none;
}
.runner-view--active {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.runner-header { display: grid; width: 100%; max-width: 54.25rem; margin-inline: auto; grid-template-columns: 3rem minmax(0, 1fr) auto; align-items: center; }
.runner-header__review-title { display: none; }
.runner-header__actions { display: flex; align-items: center; justify-content: flex-end; gap: .125rem; }
.runner-actions-button { min-width: 2.75rem; min-height: 2.75rem; }
.runner-label { color: rgb(var(--v-theme-on-surface) / .52); font-size: .68rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.runner-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  isolation: isolate;
  touch-action: pan-y;
}
.runner-stage__track {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 0 0 100%;
  transition: transform 240ms cubic-bezier(.22, 1, .36, 1);
  will-change: transform;
}
.runner-stage--swiping .runner-stage__track { transition: none; }
.runner-stage__panel {
  width: 100%;
  height: 100%;
  min-width: 100%;
  min-height: 0;
  flex: 0 0 100%;
}
.runner-stage__panel--exercise {
  order: 2;
  display: flex;
  padding: .25rem;
}
.runner-stage__original {
  position: relative;
  order: 1;
  display: flex;
  flex-direction: column;
  isolation: isolate;
}
.runner-stage__primary { display: contents; }
.runner-type-backdrop {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 50%;
  opacity: .3;
  pointer-events: none;
  filter: drop-shadow(0 0 2.75rem currentColor);
  transition: opacity 200ms ease;
  transform-origin: center center;
  transform: translate(-50%, -50%) rotate(-8deg);
  -webkit-mask-image: radial-gradient(circle, #000 32%, rgba(0, 0, 0, .82) 56%, transparent 82%);
  mask-image: radial-gradient(circle, #000 32%, rgba(0, 0, 0, .82) 56%, transparent 82%);
}
.runner-type-backdrop--hidden { opacity: 0; }
.runner-main,
.runner-controls,
.runner-details,
.runner-progress-stack,
.runner-progress,
.next-copy { position: relative; z-index: 1; }
.runner-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  touch-action: pan-y;
}
.runner-details { display: contents; }
.runner-progress-stack { display: flex; width: 100%; flex-direction: column; align-items: center; }
.runner-session { display: none; }
.runner-task-link { margin-top: .45rem; color: rgb(var(--v-theme-secondary)); font-size: .76rem; font-weight: 800; }
.runner-position { display: none; }
.runner-step { min-width: 0; max-width: 40rem; margin-top: .5rem; font-size: clamp(2rem, 10vw, 4.5rem); font-weight: 900; line-height: 1; }
.runner-progress {
  display: flex;
  width: 100%;
  margin: 2.25rem 0 1.5rem;
  flex-direction: column;
  align-items: center;
}
.runner-main--with-review .runner-progress { margin: 1.25rem 0 1rem; }
.runner-exercise-details-button {
  position: absolute;
  z-index: 3;
  top: .5rem;
  right: .5rem;
  min-width: 2.75rem;
  min-height: 2.75rem;
}
.runner-stage__original > .interval-review-card { z-index: 1; margin-top: 1rem; align-self: center; }
.runner-main--with-review .progress-rings { width: min(13.5rem, calc(100vw - 3rem)); }
.runner-main--with-review .timer-value { font-size: 3.25rem; }
.progress-rings {
  position: relative;
  width: min(292px, calc(100vw - 2rem));
  aspect-ratio: 1;
  container-type: inline-size;
  isolation: isolate;
}
.progress-rings :deep(.v-progress-circular__overlay) { transition: none; }
.progress-ring {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.progress-ring--total {
  width: 100% !important;
  height: 100% !important;
  opacity: .5;
}
.progress-ring--round {
  width: calc(100% - 16px) !important;
  height: calc(100% - 16px) !important;
  opacity: .75;
}
.progress-ring--item {
  width: calc(100% - 32px) !important;
  height: calc(100% - 32px) !important;
  opacity: 1;
}
.progress-rings__content {
  position: absolute;
  z-index: 2;
  inset: 40px;
  display: grid;
  place-items: center;
}
.timer-value { display: inline-block; font-family: "Arial Narrow", Impact, sans-serif; font-size: 4rem; font-weight: 900; letter-spacing: -.04em; transform-origin: center; }
.timer-value--count { color: rgb(var(--v-theme-warning)); animation: timer-value-pulse 560ms cubic-bezier(.22, 1, .36, 1); }
@keyframes timer-value-pulse {
  0% { transform: scale(1); }
  38% { transform: scale(1.16); }
  100% { transform: scale(1); }
}
.next-copy { color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; }
.runner-controls { display: grid; width: 100%; max-width: 54.25rem; margin-inline: auto; grid-template-columns: 1fr auto 1fr; align-items: center; justify-items: center; gap: 1rem; }
.runner-controls .runner-confirm-button { width: min(100%, 22rem); grid-column: 1 / -1; }
.runner-controls--landscape { display: none; }
.finish-card { width: 100%; max-width: 620px; margin: auto; text-align: center; }
.finish-icon { display: grid; width: 4.5rem; height: 4.5rem; margin: 0 auto 1rem; place-items: center; border-radius: 1.5rem; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.finish-icon--image {
  overflow: hidden;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .12);
  background: rgb(var(--v-theme-surface-variant)) !important;
}
.finish-image { width: 100% !important; height: 100% !important; }
.finish-image :deep(.v-img__img) { object-fit: cover; }
.finish-status__separator,
.finish-status__interval { display: none; }
.finish-card h1 { margin-top: .75rem; font-size: clamp(2.8rem, 12vw, 5rem); }
.finish-source { margin-top: .5rem; color: rgb(var(--v-theme-on-surface) / .56); font-size: .875rem; font-weight: 800; }
.finish-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin: 2rem 0; }
.finish-stats div { display: flex; padding: 1rem .5rem; flex-direction: column; border-radius: 16px; background: rgb(var(--v-theme-surface)); }
.finish-stats span { color: rgb(var(--v-theme-on-surface) / .52); font-size: .6rem; text-transform: uppercase; }
.finish-stats strong { margin-top: .25rem; font-size: 1rem; }
.finish-note {
  display: flex;
  margin: -1rem 0 1.5rem;
  padding: 1rem;
  align-items: flex-start;
  gap: .75rem;
  border: 1px solid rgb(var(--v-theme-on-surface) / .08);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface) / .76);
  text-align: left;
}
.finish-note :deep(.v-icon) { flex: 0 0 auto; color: rgb(var(--v-theme-secondary)); }
.finish-note p { overflow-wrap: anywhere; white-space: pre-wrap; }
.finish-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.finish-actions__done { min-height: 4rem; grid-column: 1 / -1; }
@media (orientation: landscape) {
  .finish-actions { grid-template-columns: 1fr; }
  .finish-actions__done { grid-column: 1; }
  .finish-status {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: .4rem;
  }
  .finish-status__separator,
  .finish-status__interval { display: inline; }
  .finish-status__interval {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .finish-source { display: none; }
}
.note-dialog-heading { display: flex; align-items: center; gap: 12px; }
.note-dialog-icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 15px;
  background: rgb(var(--v-theme-secondary) / .16);
  color: rgb(var(--v-theme-secondary));
}
.note-dialog-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.flashcard-settings-card,
.interval-settings-card { min-height: 100dvh; }
.interval-settings-body { width: 100%; max-width: 56.25rem; margin: 0 auto; }
.flashcard-settings-header,
.interval-settings-header {
  padding:
    calc(1.25rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)))
    calc(1.25rem + env(safe-area-inset-right, 0rem))
    1rem
    calc(1.25rem + env(safe-area-inset-left, 0rem)) !important;
}
.flashcard-settings-actions,
.interval-settings-actions {
  display: flex;
  align-items: center;
  padding:
    1rem
    calc(1rem + env(safe-area-inset-right, 0rem))
    calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)))
    calc(1rem + env(safe-area-inset-left, 0rem)) !important;
}
.flashcard-settings-actions > .v-btn,
.interval-settings-actions > .v-btn { height: 3rem; }

@media (min-width: 60rem) {
  .flashcard-settings-actions > .v-btn,
  .interval-settings-actions > .v-btn { height: 2.25rem; }
}
.flashcard-settings-actions__cancel,
.flashcard-settings-actions__primary,
.interval-settings-actions__cancel,
.interval-settings-actions__primary {
  min-width: 0;
  flex: 1 1 0;
}
@media (min-width: 60rem) {
  .flashcard-settings-actions,
  .interval-settings-actions { justify-content: flex-end; }
  .flashcard-settings-actions__cancel,
  .flashcard-settings-actions__primary,
  .interval-settings-actions__cancel,
  .interval-settings-actions__primary { max-width: 10rem; }
}
@media (orientation: portrait) {
  .runner-page {
    padding-bottom: max(1rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  }

}

@media (orientation: landscape) and (max-height: 700px) {
  .runner-page {
    display: flex;
    width: 100%;
    max-width: 100vw;
    height: 100dvh;
    min-height: 0;
    padding:
      1rem
      max(1rem, env(safe-area-inset-right))
      max(1rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    gap: .5rem;
    overflow: hidden;
  }

  .runner-page > :deep(.v-alert) {
    position: fixed;
    z-index: 20;
    top: max(.5rem, env(safe-area-inset-top));
    left: 50%;
    width: min(34rem, calc(100vw - 2rem));
    margin: 0 !important;
    transform: translateX(-50%);
  }

  .runner-header {
    display: none;
  }

  .runner-stage {
    min-width: 0;
    min-height: 0;
    padding-top: 1rem;
  }

  .runner-stage__original {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(14rem, .85fr);
    grid-template-rows: minmax(0, 1fr) auto auto auto;
    gap: .5rem 1rem;
  }

  .runner-main {
    display: contents;
  }

  .runner-details {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding:
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 1;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    border-left: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-radius: 0;
    background: transparent;
    text-align: left;
  }

  .runner-progress-stack {
    display: flex;
    min-width: 0;
    min-height: 0;
    grid-column: 1;
    grid-row: 1 / 5;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .runner-session {
    display: block;
    margin-bottom: clamp(.6rem, 2dvh, 1rem);
    overflow: hidden;
    color: rgb(var(--v-theme-on-surface) / .5);
    font-size: .72rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-position {
    display: block;
    margin-bottom: .45rem;
    color: rgb(var(--v-theme-secondary));
  }

  .runner-step {
    margin-top: 0;
    overflow-wrap: anywhere;
    font-size: clamp(1.65rem, 4.5vw, 3.6rem);
    line-height: .96;
  }

  .interval-review-card {
    flex: 0 0 auto;
  }

  .runner-progress {
    --runner-progress-inset: clamp(1rem, 5dvh, 2.5rem);
    display: flex;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: var(--runner-progress-inset);
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: visible;
    border-radius: 0;
    background: transparent;
  }

  .runner-main--with-review .runner-progress {
    margin: 0;
    padding: clamp(.5rem, 2dvh, 1rem);
  }

  .runner-main--with-review .progress-rings {
    width: min(12rem, 50dvh, calc(100% - 1rem));
  }

  .runner-stage__original > .interval-review-card {
    width: min(100%, 30rem);
    margin: 0;
    grid-column: 2;
    grid-row: 4;
  }

  .progress-rings {
    width: min(
      100%,
      calc(
        100dvh
        - max(1rem, env(safe-area-inset-top))
        - max(1rem, env(safe-area-inset-bottom))
        - var(--runner-progress-inset)
        - var(--runner-progress-inset)
      )
    );
  }

  .runner-type-backdrop {
    --interval-type-size: 75cqi !important;
  }

  .timer-value {
    font-size: clamp(3rem, 18dvh, 6rem);
  }

  .next-copy {
    min-width: 0;
    padding: .7rem 0 .7rem clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 2;
    overflow: hidden;
    border-top: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-radius: 0;
    background: transparent;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-controls--portrait {
    display: none;
  }

  .runner-controls--landscape {
    display: grid;
    width: 100%;
    padding: .5rem 0 0 clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 3;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
    align-content: center;
    gap: .5rem;
    border-radius: 0;
    background: transparent;
  }

  .runner-controls :deep(.v-btn) {
    width: 100% !important;
    max-width: none;
    min-width: 0;
  }

  .runner-controls--landscape :deep(.v-btn) {
    height: clamp(2.75rem, 12dvh, 3.5rem);
  }

  .runner-controls--landscape :deep(.runner-pause-button) {
    height: clamp(3rem, 14dvh, 4rem);
  }

  .runner-controls--landscape :deep(.v-btn__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .runner-controls--landscape .runner-back-button {
    grid-column: 1;
  }

  .runner-controls--landscape .runner-actions-button {
    grid-column: 3;
  }

  .runner-stage--with-review {
    grid-template-columns: minmax(0, 1.25fr) minmax(13rem, .75fr);
    grid-template-rows: minmax(0, 1fr);
    gap: .5rem 1rem;
  }

  .runner-stage--with-review .runner-stage__primary {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-column: 2;
    grid-row: 1;
    grid-template-rows: auto auto auto;
    align-content: space-between;
  }

  .runner-header--with-review {
    display: grid;
    max-width: none;
    min-height: 2.75rem;
    flex: 0 0 2.75rem;
  }

  .runner-header--with-review .runner-header__standard-title {
    display: none;
  }

  .runner-header--with-review .runner-header__review-title {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }

  .runner-header--with-review .runner-header__review-title > strong {
    min-width: 0;
    max-width: 20rem;
  }

  .runner-header--with-review .runner-header__review-title > .runner-label {
    flex: 0 0 auto;
    color: rgb(var(--v-theme-secondary));
  }

  .runner-stage--with-review .runner-details {
    padding: .5rem .75rem 0;
    grid-column: 1;
    grid-row: 1;
    align-self: start;
    justify-content: flex-start;
    align-items: center;
    border-left: 0;
    text-align: center;
  }

  .runner-stage--with-review .runner-task-link {
    margin-top: 0;
  }

  .runner-stage--with-review .runner-session,
  .runner-stage--with-review .runner-position {
    display: none;
  }

  .runner-stage--with-review .runner-step {
    font-size: clamp(1.35rem, 5dvh, 2.5rem);
  }

  .runner-stage--with-review .runner-progress-stack {
    grid-column: 1;
    grid-row: 2;
  }

  .runner-stage--with-review .runner-progress {
    padding: .25rem;
  }

  .runner-stage--with-review .progress-rings {
    width: min(13.458rem, 42.5dvh, calc(85% - .425rem));
  }

  .runner-stage--with-review .runner-type-backdrop {
    --interval-type-size: max(0rem, calc(75cqi - 2.625rem)) !important;
  }

  .runner-stage--with-review .timer-value {
    font-size: clamp(2.25rem, 12dvh, 3.75rem);
  }

  .runner-stage--with-review .next-copy {
    display: none;
  }

  .runner-stage--with-review .runner-controls--landscape {
    padding: .5rem .75rem 0;
    grid-column: 1;
    grid-row: 3;
  }

  .runner-stage--with-review .runner-back-button,
  .runner-stage--with-review .runner-actions-button {
    display: none;
  }

  .runner-stage--with-review > .interval-review-card {
    display: flex;
    width: min(100%, 34rem);
    max-width: 34rem;
    height: 100%;
    max-height: 100%;
    min-height: 0;
    margin: 0 auto;
    grid-column: 1;
    grid-row: 1;
    align-self: stretch;
    flex-direction: column;
  }

  .runner-page--finished .runner-screen-stage {
    place-items: center;
  }

  .runner-page--finished .runner-view--active {
    height: 100%;
  }

  .finish-card {
    display: grid;
    width: min(100%, 56rem);
    max-width: none;
    margin: 0;
    padding: clamp(.75rem, 3dvh, 1.25rem);
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    grid-template-columns: auto minmax(10rem, 1fr) minmax(9rem, auto);
    grid-template-rows: auto auto auto;
    align-items: center;
    gap: .35rem clamp(.75rem, 3vw, 2rem);
    border-radius: 28px;
    background: rgb(var(--v-theme-surface) / .72);
    text-align: left;
  }

  .finish-icon {
    width: clamp(3rem, 12dvh, 4rem);
    height: clamp(3rem, 12dvh, 4rem);
    margin: 0;
    grid-column: 1;
    grid-row: 1 / -1;
    border-radius: 18px;
  }

  .finish-card > .runner-label {
    grid-column: 2;
    grid-row: 1;
    align-self: end;
  }

  .finish-card h1 {
    margin-top: 0;
    grid-column: 2;
    grid-row: 2;
    font-size: clamp(1.8rem, 6vw, 3.5rem);
  }

  .finish-stats {
    margin: .5rem 0 0;
    grid-column: 2;
    grid-row: 3;
    gap: .4rem;
  }

  .finish-stats div {
    padding: .5rem;
  }

  .finish-actions {
    width: clamp(13rem, 40vw, 18rem);
    min-width: 0;
    grid-column: 3;
    grid-row: 1 / -1;
    align-self: center;
    gap: .5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .runner-stage__track,
  .runner-type-backdrop {
    transition: none;
  }
}
</style>
