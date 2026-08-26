<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppForm from '@/components/AppForm.vue'
import AppDialog from '@/components/AppDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardCardDialog from '@/components/FlashcardCardDialog.vue'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import ReviewSetCard from '@/components/ReviewSetCard.vue'
import RunnerStartScreen from '@/components/RunnerStartScreen.vue'
import RunnerSessionActions from '@/components/RunnerSessionActions.vue'
import {
  backgroundFlashcardReviewState,
  flashcardSpeechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport,
  nativeFlashcardBackgroundIsAvailable,
  speakFlashcardText,
  stopBackgroundFlashcardReview,
  stopFlashcardSpeech,
  syncBackgroundFlashcardReview,
  toggleFlashcardSpeechOverAmplification,
  waitForFlashcardSpeechHandoff,
} from '@/services/flashcardSpeech'
import {
  playFlashcardEjectCue,
  playReviewCompleteCue,
  prepareFlashcardEjectCue,
} from '@/services/intervalCues'
import { reviewRunnerSessionMenuItems } from '@/services/runnerSessionActions'
import { requestScreenWakeLock, type ScreenWakeLock } from '@/services/screenWakeLock'
import { confirmSwipeHint, REVIEW_SET_CARD_SWIPE_HINT } from '@/services/swipeHints'
import { prepareFlashcardSpeechWordTracking } from '@/services/spokenText'
import {
  createFlashcardReviewPreviewSession,
  DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  FLASHCARD_SETTINGS_APPLY_MENU_ITEMS,
  firstFlashcardReviewSide,
  flashcardBackDurationMs,
  flashcardReviewShowsSide,
  flashcardReviewSettingsAreValid,
  flashcardReviewSettingsSignature,
  flashcardReviewActionFromSwipe,
  flashcardTagToggleUpdate,
  formatReviewDuration,
  INTERVAL_FLASHCARD_QUICK_TAGS,
  normalizeFlashcardBackSpeechRepeatCount,
  otherFlashcardReviewSide,
  sessionAccuracy,
} from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import { showSavedSnackbar } from '@/stores/snackbar'
import type {
  BackgroundFlashcardReviewState,
  Flashcard,
  FlashcardContextAction,
  FlashcardReviewAction,
  FlashcardReviewSession,
  FlashcardReviewSettings,
  FlashcardReviewSide,
  FlashcardSettingsApplyTarget,
  FlashcardSpeechSupport,
  FlashcardSpeechWord,
  FlashcardTag,
  RunnerSessionAction,
} from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
type ReviewCardTransitionDirection = 'previous' | 'next' | 'front' | 'back'
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const revealed = ref(false)
const reviewCardTransitionDirection = ref<ReviewCardTransitionDirection>()
const reviewCardPane = ref<InstanceType<typeof ReviewSetCard>>()
const sessionActionsSheet = ref(false)
const endDialog = ref(false)
const replaceActiveReviewDialog = ref(false)
const replacingActiveReview = ref(false)
const activeReviewName = ref('')
const cardTagSaving = ref('')
const cardEditorDialog = ref(false)
const cardEditorCard = ref<Flashcard>()
const deleteCardDialog = ref(false)
const deleteCardId = ref('')
const deletingCard = ref(false)
const sessionSettingsDialog = ref(false)
const sessionSettingsApplyMenu = ref(false)
const sessionSettingsForm = ref()
const sessionSettingsSaving = ref(false)
const sessionSettingsError = ref('')
const sessionSettingsOriginal = ref('')
const sessionSpeechLoading = ref(false)
const sessionSpeechSupport = ref<FlashcardSpeechSupport>({ available: false, languages: [] })
const speechOverAmplified = ref(flashcardSpeechOverAmplificationIsEnabled())
const speechOverAmplificationBusy = ref(false)
const sessionSettingsDraft = reactive<FlashcardReviewSettings>({
  mode: 'manual',
  cardSides: 'both',
  invertFaces: false,
  indefinite: false,
  timeLimitSeconds: 0,
  maxCards: 20,
  ejectBehavior: 'remove',
  ejectExcludeAfter: DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  backDisplay: 'back',
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'difficult',
  sortDirection: 'asc',
})
const tickVersion = ref(0)
const passiveSide = ref<'front' | 'back'>('front')
const passiveRemainingMs = ref(0)
const localElapsedMs = ref(0)
const currentQueueIndex = ref(0)
const ejectedQueueIndexes: number[] = []
const visibilityPaused = ref(false)
const nativeBackgroundReady = ref(false)
const speechPlaybackWarning = ref('')
const backgroundSpeechWarning = ref('')
const speechFailureSnackbar = ref(false)
const spokenWord = ref<FlashcardSpeechWord>()
const reconcilingBackground = ref(false)
const visibilitySpeechHandoff = ref(false)
const backgroundViewedTarget = ref<number>()
const backgroundVisualSnapshotReady = ref(false)
const backgroundPassiveRemainingMs = ref(0)
const backgroundPassiveDurationMs = ref(1000)
let animationFrame: number | undefined
let lastTickAt = 0
let mounted = true
let skipLeavePause = false
let passiveAdvancing = false
let completingTimeLimit = false
let continuePassiveTickWhileBusy = false
let visibilityWork: Promise<void> = Promise.resolve()
let lastSpokenKey = ''
let speechRequest = 0
let wakeLock: ScreenWakeLock | undefined
let acquiringWakeLock = false
let wakeLockRetryRequested = false
let manualSwipeStart: {
  pointerId: number
  x: number
  y: number
  scrollElement?: HTMLElement
  scrollTop: number
  maxScrollTop: number
} | undefined
let suppressManualCardTap = false
let manualCardTapResetTimer: number | undefined
let resumeAfterSessionActions = false
let resumeAfterSessionSettings = false
let resumeAfterCardEditor = false
const speechFailureWarnedSessionIds = new Set<string>()

const currentSessionId = ref('')
const previewSession = ref<FlashcardReviewSession>()
const persistedSession = computed(() => store.sessions.find(item => item.id === currentSessionId.value))
const session = computed(() => persistedSession.value || previewSession.value)
const isReviewSetPreview = computed(() => Boolean(previewSession.value))
const currentCard = computed(() => session.value?.queue[0])
const currentReviewSet = computed(() => store.reviewSets.find(item => item.id === session.value?.reviewSet))
const currentSourceCards = computed(() => {
  if (!currentReviewSet.value) return store.cards
  return currentReviewSet.value.accessRole === 'owner'
    ? store.cards
    : store.reviewSetCards[currentReviewSet.value.id] || []
})
const currentSourceCard = computed(() => currentSourceCards.value.find(card => card.id === currentCard.value?.id))
const displayedCard = computed(() => {
  const queuedCard = currentCard.value
  const sourceTransliteration = currentSourceCard.value?.transliteration
  if (!queuedCard || queuedCard.transliteration || !sourceTransliteration) return queuedCard
  return { ...queuedCard, transliteration: sourceTransliteration }
})
const canManageCurrentCard = computed(() => !currentReviewSet.value
  || currentReviewSet.value.accessRole !== 'readonly')
const canTagCurrentCard = computed(() => Boolean(
  !isReviewSetPreview.value
  && currentReviewSet.value?.accessRole === 'owner'
  && currentSourceCard.value,
))
const quickTags = computed(() => INTERVAL_FLASHCARD_QUICK_TAGS.map((quickTag) => {
  const tag = (store.tags || []).find(
    item => item.name.toLocaleLowerCase() === quickTag.name.toLocaleLowerCase(),
  )
  return {
    ...quickTag,
    selected: Boolean(tag && currentCard.value?.tags.includes(tag.id)),
  }
}))
const isFinished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const isRunning = computed(() => session.value?.status === 'running')
const canReplayCurrentSide = computed(() => Boolean(
  session.value?.speechEnabled
  && currentCard.value
  && !isReviewSetPreview.value
  && !isFinished.value
  && !busy.value,
))
const shouldKeepScreenAwake = computed(() => Boolean(
  session.value && !isFinished.value && !isReviewSetPreview.value,
))
const elapsedSeconds = computed(() => {
  tickVersion.value
  const elapsed = Math.max(
    session.value?.elapsedSeconds || 0,
    Math.floor(localElapsedMs.value / 1000),
  )
  const limit = session.value?.timeLimitSeconds || 0
  return limit > 0 ? Math.min(limit, elapsed) : elapsed
})
const timeLimitProgress = computed(() => session.value?.timeLimitSeconds
  ? Math.min(100, elapsedSeconds.value / session.value.timeLimitSeconds * 100)
  : 0)
const timeLimitReached = computed(() => Boolean(
  session.value?.timeLimitSeconds
  && elapsedSeconds.value >= session.value.timeLimitSeconds,
))
const displayedViewedCount = computed(() => Math.max(
  session.value?.viewedCount || 0,
  backgroundViewedTarget.value || 0,
))
const completedCards = computed(() => session.value
  ? Math.min(
      session.value.totalCards,
      session.value.totalCards - session.value.queue.length
        + Math.max(0, displayedViewedCount.value - session.value.viewedCount),
    )
  : 0)
const progressCards = computed(() => {
  if (!session.value?.totalCards) return 0
  return session.value.indefinite
    ? displayedViewedCount.value % session.value.totalCards
    : completedCards.value
})
const currentCardPosition = computed(() => session.value?.queue.length
  ? Math.min(currentQueueIndex.value, session.value.queue.length - 1) + 1
  : 0)
const progress = computed(() => {
  const cardProgress = session.value?.totalCards
    ? Math.round(progressCards.value / session.value.totalCards * 100)
    : 0
  return Math.max(cardProgress, timeLimitProgress.value)
})
const firstReviewSide = computed(() => firstFlashcardReviewSide(
  session.value?.cardSides || 'both',
  session.value?.invertFaces,
))
const manualShowingBack = computed(() => session.value?.cardSides === 'back'
  || (session.value?.cardSides === 'both'
    && (revealed.value ? firstReviewSide.value === 'front' : firstReviewSide.value === 'back')))
const backSpeechRepeatCount = computed(() => session.value?.mode === 'passive'
  && session.value.speechEnabled
  ? normalizeFlashcardBackSpeechRepeatCount(session.value.backSpeechRepeatCount)
  : 1)
const passiveDurationMs = computed(() => {
  if (!session.value) return 1000
  return passiveSide.value === 'front'
    ? session.value.frontSeconds * 1000
    : flashcardBackDurationMs(session.value.backSeconds, backSpeechRepeatCount.value)
})
const passiveSpeechRepeatIndex = computed(() => {
  if (
    session.value?.mode !== 'passive'
    || passiveSide.value !== 'back'
    || backSpeechRepeatCount.value === 1
  ) return 0
  const baseBackDurationMs = Math.max(1000, session.value.backSeconds * 1000)
  const elapsedBackMs = Math.max(0, passiveDurationMs.value - passiveRemainingMs.value)
  return Math.min(
    backSpeechRepeatCount.value - 1,
    Math.floor(elapsedBackMs / baseBackDurationMs),
  )
})
const passiveProgress = computed(() => {
  tickVersion.value
  if (session.value?.mode !== 'passive') return 0
  const remainingMs = backgroundVisualSnapshotReady.value
    ? backgroundPassiveRemainingMs.value
    : passiveRemainingMs.value
  const durationMs = backgroundVisualSnapshotReady.value
    ? backgroundPassiveDurationMs.value
    : passiveDurationMs.value
  return Math.max(0, Math.min(100, (1 - remainingMs / durationMs) * 100))
})
const accuracy = computed(() => session.value ? sessionAccuracy(session.value) : undefined)
const exitDestination = computed(() => route.query.from === 'tasks' ? '/tasks' : '/flashcards')
const speechWarning = computed(() => speechPlaybackWarning.value || backgroundSpeechWarning.value)
const previewSummary = computed(() => {
  if (!session.value) return ''
  const cards = `${session.value.totalCards} ${session.value.totalCards === 1 ? 'card' : 'cards'}`
  const limit = session.value.timeLimitSeconds
    ? ` · ${formatReviewDuration(session.value.timeLimitSeconds)} limit`
    : ''
  return `${cards}${limit}${session.value.indefinite ? ' · looping' : ''}`
})
const currentSpeechSide = computed<FlashcardReviewSide>(() => session.value?.mode === 'manual'
  ? (manualShowingBack.value ? 'back' : 'front')
  : passiveSide.value)
const currentSpeechLanguage = computed(() => currentSpeechSide.value === 'front'
  ? session.value?.frontLanguage || ''
  : session.value?.backLanguage || '')
const currentBackDisplay = computed(() => {
  const reviewSet = store.reviewSets.find(item => item.id === session.value?.reviewSet)
  return reviewSet?.backDisplay === 'transliteration'
    || session.value?.backDisplay === 'transliteration'
    ? 'transliteration'
    : 'back'
})
const canUseNativeBackground = computed(() => Boolean(
  nativeFlashcardBackgroundIsAvailable()
  && session.value?.mode === 'passive'
  && session.value.speechEnabled
  && session.value.frontLanguage
  && session.value.backLanguage
  && session.value.status === 'running',
))
const canNavigateCards = computed(() => Boolean(
  (session.value?.status === 'running' || session.value?.status === 'paused')
  && session.value.queue.length > 1,
))
const sessionSettingsMinimumCards = computed(() => {
  if (sessionSettingsDraft.mode === 'passive' && sessionSettingsDraft.indefinite) return 1
  return Math.min(100, (session.value?.viewedCount || 0) + (session.value?.ejectedCount || 0) + 1)
})
const sessionSettingsAvailableCards = computed(() => store.reviewSets
  .find(reviewSet => reviewSet.id === session.value?.reviewSet)
  ?.matchingCardCount || 0)
const sessionSettingsChanged = computed(() => sessionSettingsDialog.value
  && flashcardReviewSettingsSignature(sessionSettingsDraft) !== sessionSettingsOriginal.value)
const canSaveSessionSettings = computed(() => sessionSettingsChanged.value
  && flashcardReviewSettingsAreValid(sessionSettingsDraft, sessionSettingsMinimumCards.value)
  && (!sessionSettingsDraft.timeLimitSeconds
    || sessionSettingsDraft.timeLimitSeconds > elapsedSeconds.value))
const sessionActionItems = computed(() => reviewRunnerSessionMenuItems({
  speechAvailable: Boolean(session.value?.speechEnabled && currentCard.value),
  amplified: speechOverAmplified.value,
  busy: busy.value || speechOverAmplificationBusy.value,
  preview: isReviewSetPreview.value,
  finished: isFinished.value,
  canRestart: Boolean(session.value?.reviewSet),
  canManageCard: canManageCurrentCard.value && Boolean(currentCard.value),
  canAddCard: canManageCurrentCard.value,
  canEjectCard: Boolean(currentCard.value),
  canUndoEject: Boolean(session.value?.ejectedCount),
}))
watch([
  loading,
  () => session.value?.status,
  () => session.value?.speechEnabled,
  () => currentCard.value?.id,
  currentSpeechSide,
  passiveSpeechRepeatIndex,
], ([, status, , cardId, side], [, previousStatus, , previousCardId, previousSide]) => {
  const navigatedWhilePaused = status === 'paused'
    && previousStatus === 'paused'
    && (cardId !== previousCardId || side !== previousSide)
  if (!navigatedWhilePaused) void speakCurrentSide()
}, { flush: 'post' })

watch(() => currentCard.value?.id, (cardId, previousCardId) => {
  if (!cardId || !previousCardId || cardId === previousCardId) return
  resetCurrentCardPhase()
}, { flush: 'sync' })

watch([
  () => currentCard.value?.id,
  currentSpeechSide,
], ([cardId, side], [previousCardId, previousSide]) => {
  if (!cardId || !side || !previousCardId || !previousSide) return
  const cardChanged = cardId !== previousCardId
  const sideChanged = side !== previousSide
  if (cardChanged || sideChanged) spokenWord.value = undefined
  if (reviewCardTransitionDirection.value) return

  if (cardChanged) {
    reviewCardTransitionDirection.value = 'back'
  } else if (sideChanged) {
    reviewCardTransitionDirection.value = side === 'back' ? 'next' : 'previous'
  }
}, { flush: 'sync' })

function scheduleReviewContentFit() {
  void nextTick(() => {
    if (!mounted) return
    reviewCardPane.value?.refitContent()
  })
}

watch([
  () => currentCard.value?.id,
  currentSpeechSide,
], scheduleReviewContentFit, { flush: 'post' })

watch(sessionActionsSheet, (open, wasOpen) => {
  if (wasOpen && !open) void finishSessionActions()
})

watch(shouldKeepScreenAwake, (keepAwake) => {
  if (keepAwake && document.visibilityState === 'visible') void acquireWakeLock()
  else void releaseWakeLock()
})

onMounted(async () => {
  mounted = true
  try {
    if (!store.loaded) await store.load()
    if (typeof route.params.sessionId === 'string') {
      const loaded = await store.loadSession(route.params.sessionId)
      currentSessionId.value = loaded.id
      initializeLocalState(loaded)
    } else if (typeof route.params.reviewSetId === 'string') {
      const reviewSet = store.reviewSets.find(item => item.id === route.params.reviewSetId)
      if (!reviewSet) throw new Error('That Review set could not be found.')
      const cards = reviewSet.accessRole === 'owner'
        ? store.cards
        : await store.loadReviewSetCards(reviewSet.id)
      const prepared = createFlashcardReviewPreviewSession(reviewSet, cards)
      if (!prepared) throw new Error('No flashcards match this Review set.')
      previewSession.value = {
        ...prepared,
        task: typeof route.query.task === 'string' ? route.query.task : undefined,
        programStep: typeof route.query.step === 'string' ? route.query.step : undefined,
        programStepCompletion: typeof route.query.completion === 'string'
          ? route.query.completion
          : undefined,
        taskDate: typeof route.query.date === 'string' ? route.query.date : undefined,
      }
      initializeLocalState(previewSession.value)
    } else {
      throw new Error('This review could not be found.')
    }
    const autoResume = !isReviewSetPreview.value
      && session.value?.status === 'paused'
      && (session.value.mode === 'manual' || route.query.autoplay === '1')
    if (autoResume) {
      await resumeReview()
    } else {
      const restoredBackground = await reconcileBackgroundReview()
      if (!restoredBackground) await syncNativeBackground()
    }
    animationFrame = window.requestAnimationFrame(updateProgressFrame)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (shouldKeepScreenAwake.value && document.visibilityState === 'visible') void acquireWakeLock()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start this review.'
  } finally {
    loading.value = false
  }
})

onBeforeRouteLeave(async () => {
  if (!skipLeavePause) {
    await pauseReview(false)
    await stopBackgroundFlashcardReview()
    await stopFlashcardSpeech()
  }
  return true
})

onBeforeUnmount(() => {
  mounted = false
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
  if (manualCardTapResetTimer) window.clearTimeout(manualCardTapResetTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  void releaseWakeLock()
  void stopFlashcardSpeech()
})

async function acquireWakeLock() {
  if (acquiringWakeLock) {
    wakeLockRetryRequested = true
    return
  }
  if (
    wakeLock
    || !mounted
    || !shouldKeepScreenAwake.value
    || document.visibilityState !== 'visible'
  ) return
  acquiringWakeLock = true
  try {
    const lock = await requestScreenWakeLock()
    if (!lock) return
    if (!mounted || !shouldKeepScreenAwake.value || document.visibilityState !== 'visible') {
      await lock.release()
      return
    }
    wakeLock = lock
  } finally {
    acquiringWakeLock = false
    if (wakeLockRetryRequested) {
      wakeLockRetryRequested = false
      void acquireWakeLock()
    }
  }
}

async function releaseWakeLock() {
  const lock = wakeLock
  wakeLock = undefined
  await lock?.release()
}

function initializeLocalState(value: FlashcardReviewSession) {
  localElapsedMs.value = value.elapsedSeconds * 1000
  currentQueueIndex.value = 0
  ejectedQueueIndexes.length = 0
  lastTickAt = Date.now()
  revealed.value = false
  restorePassiveState(value)
}

function passiveStorageKey(id: string) {
  return `backontrack-flashcard-passive:${id}`
}

function restorePassiveState(value: FlashcardReviewSession) {
  passiveSide.value = firstFlashcardReviewSide(value.cardSides, value.invertFaces)
  passiveRemainingMs.value = passiveDurationMs.value
  if (value.mode !== 'passive') return
  try {
    const saved = JSON.parse(localStorage.getItem(passiveStorageKey(value.id)) || '')
    if (
      saved?.cardId === value.queue[0]?.id
      && (saved.side === 'front' || saved.side === 'back')
      && flashcardReviewShowsSide(value.cardSides, saved.side)
    ) {
      passiveSide.value = saved.side
      passiveRemainingMs.value = Math.max(1, Number(saved.remainingMs) || passiveDurationMs.value)
      const restoredSpeechKey = speechKey(true)
      if (saved.spokenKey === restoredSpeechKey) lastSpokenKey = restoredSpeechKey
    }
  } catch {
    // Start the current card from its front when local recovery is unavailable.
  }
}

function savePassiveState() {
  if (!session.value || session.value.mode !== 'passive' || !currentCard.value) return
  try {
    localStorage.setItem(passiveStorageKey(session.value.id), JSON.stringify({
      cardId: currentCard.value.id,
      side: passiveSide.value,
      remainingMs: passiveRemainingMs.value,
      spokenKey: lastSpokenKey,
    }))
  } catch {
    // Server queue state remains recoverable even when local phase storage is unavailable.
  }
}

function clearPassiveState() {
  if (!session.value) return
  try {
    localStorage.removeItem(passiveStorageKey(session.value.id))
  } catch {
    // Nothing else is required.
  }
}

function tick() {
  const now = Date.now()
  const delta = lastTickAt ? Math.max(0, now - lastTickAt) : 0
  lastTickAt = now
  if (
    !isRunning.value
    || document.visibilityState !== 'visible'
    || (busy.value && !continuePassiveTickWhileBusy)
  ) return
  if (visibilitySpeechHandoff.value || reconcilingBackground.value) {
    localElapsedMs.value += delta
    if (
      backgroundVisualSnapshotReady.value
      && session.value?.mode === 'passive'
      && currentCard.value
    ) {
      backgroundPassiveRemainingMs.value = Math.max(
        0,
        backgroundPassiveRemainingMs.value - delta,
      )
    }
    tickVersion.value++
    return
  }
  localElapsedMs.value += delta
  if (timeLimitReached.value && !completingTimeLimit) {
    completingTimeLimit = true
    void completeTimeLimit()
    tickVersion.value++
    return
  }
  if (session.value?.mode === 'passive' && currentCard.value) {
    passiveRemainingMs.value = Math.max(0, passiveRemainingMs.value - delta)
    if (passiveRemainingMs.value === 0 && !passiveAdvancing) void advancePassive()
  }
  tickVersion.value++
}

async function completeTimeLimit() {
  try {
    await performAction('end')
  } finally {
    completingTimeLimit = false
  }
}

function updateProgressFrame() {
  if (!mounted) return
  tick()
  animationFrame = window.requestAnimationFrame(updateProgressFrame)
}

async function advancePassive() {
  if (!session.value || session.value.mode !== 'passive' || passiveAdvancing) return
  if (session.value.cardSides === 'both' && passiveSide.value === firstReviewSide.value) {
    passiveSide.value = otherFlashcardReviewSide(passiveSide.value)
    passiveRemainingMs.value = passiveDurationMs.value
    savePassiveState()
    await syncNativeBackground()
    return
  }
  passiveAdvancing = true
  try {
    await performAction('view')
  } finally {
    passiveAdvancing = false
  }
}

function resetCurrentCardPhase() {
  revealed.value = false
  passiveSide.value = firstReviewSide.value
  passiveRemainingMs.value = passiveDurationMs.value
  if (isFinished.value) clearPassiveState()
  else savePassiveState()
}

async function navigateLeft(
  transitionDirection: ReviewCardTransitionDirection = 'front',
) {
  if (!session.value || !canNavigateCards.value || busy.value) return
  const speakAfterNavigation = session.value.status === 'paused'
  reviewCardTransitionDirection.value = transitionDirection
  if (!await performAction('previous')) {
    reviewCardTransitionDirection.value = undefined
  } else if (speakAfterNavigation) {
    lastSpokenKey = ''
    await nextTick()
    await speakCurrentSide(true)
  }
}

async function navigateRight(
  transitionDirection: ReviewCardTransitionDirection = 'back',
) {
  if (!session.value || !canNavigateCards.value || busy.value) return
  const speakAfterNavigation = session.value.status === 'paused'
  reviewCardTransitionDirection.value = transitionDirection
  if (!await performAction('next')) {
    reviewCardTransitionDirection.value = undefined
  } else if (speakAfterNavigation) {
    lastSpokenKey = ''
    await nextTick()
    await speakCurrentSide(true)
  }
}

async function performAction(
  action: FlashcardReviewAction,
  options: { syncNative?: boolean; playCompletionCue?: boolean; viewCount?: number } = {},
) {
  if (!session.value || busy.value) return false
  const previousStatus = session.value.status
  const previousQueueLength = session.value.queue.length
  const previousQueueIndex = currentQueueIndex.value
  tick()
  busy.value = true
  error.value = ''
  let succeeded = false
  if (action === 'eject') void prepareFlashcardEjectCue()
  try {
    const replacementIndex = previousQueueLength - previousQueueIndex - 1
    const updated = action === 'eject' && previousQueueIndex > 0
      ? await store.act(session.value.id, action, elapsedSeconds.value, 1, replacementIndex)
      : options.viewCount === undefined
      ? await store.act(session.value.id, action, elapsedSeconds.value)
      : await store.act(session.value.id, action, elapsedSeconds.value, options.viewCount)
    if (action === 'previous' && updated.queue.length) {
      currentQueueIndex.value = (previousQueueIndex - 1 + previousQueueLength) % previousQueueLength
    } else if (action === 'next' || action === 'push') {
      currentQueueIndex.value = updated.queue.length
        ? (previousQueueIndex + 1) % previousQueueLength
        : 0
    } else if (action === 'view' && updated.indefinite && updated.queue.length) {
      currentQueueIndex.value = (
        previousQueueIndex + Math.max(1, Math.round(options.viewCount || 1))
      ) % updated.queue.length
    } else if (action === 'eject') {
      ejectedQueueIndexes.push(previousQueueIndex)
      currentQueueIndex.value = updated.queue.length
        ? Math.min(previousQueueIndex, updated.queue.length - 1)
        : 0
    } else if (action === 'undo_eject') {
      currentQueueIndex.value = updated.queue.length
        ? Math.min(ejectedQueueIndexes.pop() ?? 0, updated.queue.length - 1)
        : 0
    } else if (action === 'restart') {
      currentQueueIndex.value = 0
      ejectedQueueIndexes.length = 0
    } else if (updated.queue.length) {
      currentQueueIndex.value = Math.min(previousQueueIndex, updated.queue.length - 1)
    } else {
      currentQueueIndex.value = 0
    }
    localElapsedMs.value = updated.elapsedSeconds * 1000
    lastTickAt = Date.now()
    if (['success', 'error', 'view', 'previous', 'next', 'push', 'eject', 'undo_eject', 'restart'].includes(action)) resetCurrentCardPhase()
    continuePassiveTickWhileBusy = action === 'view'
      && updated.mode === 'passive'
      && updated.status === 'running'
    if (action === 'eject') playFlashcardEjectCue()
    if (
      action !== 'eject'
      && previousStatus === 'running'
      && updated.status === 'completed'
      && options.playCompletionCue !== false
      && document.visibilityState === 'visible'
    ) {
      playReviewCompleteCue()
    }
    if (updated.status === 'completed' || updated.status === 'ended') {
      clearPassiveState()
      await stopBackgroundFlashcardReview()
      await stopFlashcardSpeech()
    } else if (updated.status !== 'running') {
      await stopBackgroundFlashcardReview()
      await stopFlashcardSpeech()
    } else if (options.syncNative !== false) {
      await syncNativeBackground()
    }
    succeeded = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update this review.'
    if (session.value?.mode === 'passive' && passiveRemainingMs.value === 0) {
      passiveRemainingMs.value = 500
    }
  } finally {
    continuePassiveTickWhileBusy = false
    busy.value = false
  }
  return succeeded
}

async function pauseReview(markVisibilityPause: boolean) {
  if (!session.value || session.value.status !== 'running' || busy.value) return
  tick()
  savePassiveState()
  if (markVisibilityPause) visibilityPaused.value = true
  await stopBackgroundFlashcardReview()
  await stopFlashcardSpeech()
  await performAction('pause')
}

async function startPreviewReview(replaceActive = false) {
  const preview = previewSession.value
  if (!preview?.reviewSet || busy.value) return
  if (store.activeSession && !replaceActive) {
    activeReviewName.value = store.activeSession.name
    replaceActiveReviewDialog.value = true
    return
  }
  sessionActionsSheet.value = false
  busy.value = true
  error.value = ''
  try {
    const started = await store.startReview(preview.reviewSet, {
      task: preview.task,
      programStep: preview.programStep,
      ...(preview.programStepCompletion
        ? { programStepCompletion: preview.programStepCompletion }
        : {}),
      taskDate: preview.taskDate,
    })
    skipLeavePause = true
    try {
      await router.replace({
        name: 'flashcard-review-runner',
        params: { sessionId: started.id },
        query: {
          ...(route.query.from ? { from: route.query.from } : {}),
        },
      })
    } finally {
      skipLeavePause = false
    }

    // A normal route handoff mounts the running session separately. Keeping this
    // preview intact lets it slide away instead of flashing the session layout
    // before navigation begins. Finish locally only if the router host kept this
    // preview route instance mounted.
    if (typeof route.params.reviewSetId === 'string') {
      currentSessionId.value = started.id
      previewSession.value = undefined
      initializeLocalState(started)
      lastSpokenKey = ''
      const restoredBackground = await reconcileBackgroundReview()
      if (!restoredBackground) await syncNativeBackground()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start this review.'
  } finally {
    busy.value = false
  }
}

async function replaceActiveReview() {
  const active = store.activeSession
  if (replacingActiveReview.value) return
  replacingActiveReview.value = true
  error.value = ''
  try {
    if (active) await store.act(active.id, 'end', active.elapsedSeconds)
    replaceActiveReviewDialog.value = false
    await startPreviewReview(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not end the active review.'
  } finally {
    replacingActiveReview.value = false
  }
}

async function resumeReview() {
  if (!session.value || session.value.status !== 'paused' || busy.value) return
  await performAction('resume')
  lastTickAt = Date.now()
  visibilityPaused.value = false
}

async function openSessionActions() {
  const value = session.value
  if (!value || busy.value || isFinished.value) return
  resumeAfterSessionActions = value.mode === 'passive' && value.status === 'running'
  if (resumeAfterSessionActions) await pauseReview(false)
  if (session.value?.id === value.id && !isFinished.value) sessionActionsSheet.value = true
  else resumeAfterSessionActions = false
}

async function finishSessionActions() {
  const shouldResume = resumeAfterSessionActions
  resumeAfterSessionActions = false
  if (shouldResume && session.value?.status === 'paused') await resumeReview()
}

async function restartReview() {
  const value = session.value
  if (!value?.reviewSet || isReviewSetPreview.value || isFinished.value || busy.value) return
  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  await stopBackgroundFlashcardReview()
  await stopFlashcardSpeech()
  const restarted = await performAction('restart')
  if (!restarted) await syncNativeBackground()
  await speakCurrentSide()
}

function handleVisibilityChange() {
  if (
    canUseNativeBackground.value
    && nativeBackgroundReady.value
  ) {
    visibilitySpeechHandoff.value = true
    if (document.visibilityState === 'hidden') backgroundVisualSnapshotReady.value = false
  }
  visibilityWork = visibilityWork.then(async () => {
    let preserveBackgroundHandoff = false
    try {
      if (!mounted || isFinished.value) return
      if (document.visibilityState === 'hidden') {
        // Android's window flag is harmless in the background and becomes effective
        // again as soon as the Activity resumes. Keep its holder alive for the whole
        // review screen; browser wake-lock sentinels must be requested again instead.
        if (wakeLock?.kind !== 'native-android') await releaseWakeLock()
        lastSpokenKey = speechKey()
        if (canUseNativeBackground.value && nativeBackgroundReady.value) {
          preserveBackgroundHandoff = true
          savePassiveState()
          return
        }
        await stopFlashcardSpeech()
        await pauseReview(true)
        return
      }

      await acquireWakeLock()
      if (canUseNativeBackground.value) {
        const restored = await reconcileBackgroundReview()
        if (restored) return
      }
      if (visibilityPaused.value && session.value?.status === 'paused') {
        await resumeReview()
      }
      await speakCurrentSide()
    } finally {
      if (!preserveBackgroundHandoff) visibilitySpeechHandoff.value = false
    }
  })
}

function speechKey(allowPaused = false) {
  if (
    !currentCard.value
    || !session.value?.speechEnabled
    || (
      session.value.status !== 'running'
      && !(allowPaused && session.value.status === 'paused')
    )
  ) return ''
  return `${currentCard.value.id}:${currentSpeechSide.value}:${passiveSpeechRepeatIndex.value}`
}

async function speakCurrentSide(allowPaused = false) {
  const request = ++speechRequest
  const value = session.value
  const card = currentCard.value
  const key = speechKey(allowPaused)
  if (
    reconcilingBackground.value
    || visibilitySpeechHandoff.value
    || document.visibilityState !== 'visible'
  ) return
  if (
    loading.value
    || !value
    || !card
    || !key
  ) {
    if (!value || !card || !value.speechEnabled) lastSpokenKey = ''
    await stopFlashcardSpeech()
    return
  }
  if (key === lastSpokenKey) return

  lastSpokenKey = key
  const side = currentSpeechSide.value
  try {
    const text = side === 'front' ? card.front : card.back
    const language = side === 'front' ? value.frontLanguage : value.backLanguage
    const audio = (side === 'front' ? card.frontAudio : card.backAudio) || ''
    prepareFlashcardSpeechWordTracking(word => {
      if (request === speechRequest && speechKey(true) === key) spokenWord.value = word
    })
    if (audio) await speakFlashcardText(text, language, '', audio)
    else await speakFlashcardText(text, language)
    if (request === speechRequest) speechPlaybackWarning.value = ''
  } catch {
    if (request === speechRequest) spokenWord.value = undefined
    if (request === speechRequest && !speechFailureWarnedSessionIds.has(value.id)) {
      speechFailureWarnedSessionIds.add(value.id)
      speechFailureSnackbar.value = true
    }
  }
}

function retrySpeech() {
  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  void speakCurrentSide()
}

function replayCurrentSide() {
  if (
    !canReplayCurrentSide.value
    || document.visibilityState !== 'visible'
  ) return false

  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  void speakCurrentSide(true)
  return true
}

async function toggleSpeechOverAmplification() {
  if (speechOverAmplificationBusy.value) return
  speechOverAmplificationBusy.value = true
  try {
    speechOverAmplified.value = await toggleFlashcardSpeechOverAmplification()
    if (session.value?.status === 'running') await syncNativeBackground()
  } catch {
    speechPlaybackWarning.value = 'TTS over-amplification could not be changed.'
  } finally {
    speechOverAmplificationBusy.value = false
  }
}

function handleManualCardTap() {
  if (suppressManualCardTap) {
    suppressManualCardTap = false
    return
  }
  if (replayCurrentSide()) return
  if (
    session.value?.cardSides === 'both'
    && !revealed.value
    && session.value.status === 'running'
    && !busy.value
  ) revealed.value = true
}

function beginReviewCardSwipe(event: PointerEvent) {
  if (
    !session.value
    || !['running', 'paused'].includes(session.value.status)
    || (!canNavigateCards.value && session.value.cardSides !== 'both')
    || busy.value
    || (event.pointerType === 'mouse' && event.button !== 0)
  ) return

  const response = (event.target as Element | null)?.closest('.flashcard-response-text')
  const scrollElement = response instanceof HTMLElement ? response : undefined
  manualSwipeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollElement,
    scrollTop: scrollElement?.scrollTop || 0,
    maxScrollTop: scrollElement
      ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      : 0,
  }
  const startedFromTagControl = (event.target as Element | null)
    ?.closest('.review-card__tag-actions')
  try {
    if (!startedFromTagControl) {
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
    }
  } catch {
    // Pointer capture is optional; touch input still reports its final position without it.
  }
}

function moveReviewCardSwipe(event: PointerEvent) {
  const start = manualSwipeStart
  if (!start?.scrollElement || start.pointerId !== event.pointerId) return
  const deltaX = event.clientX - start.x
  const deltaY = event.clientY - start.y
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return
  start.scrollElement.scrollTop = Math.min(
    start.maxScrollTop,
    Math.max(0, start.scrollTop - deltaY),
  )
}

function suppressNextManualCardTap() {
  suppressManualCardTap = true
  if (manualCardTapResetTimer) window.clearTimeout(manualCardTapResetTimer)
  manualCardTapResetTimer = window.setTimeout(() => {
    suppressManualCardTap = false
    manualCardTapResetTimer = undefined
  }, 250)
}

function finishReviewCardSwipe(event: PointerEvent) {
  const start = manualSwipeStart
  if (!start || start.pointerId !== event.pointerId) return
  manualSwipeStart = undefined

  const gesture = flashcardReviewActionFromSwipe(start, { x: event.clientX, y: event.clientY })
  if (!gesture) {
    if (start.scrollElement && Math.abs(start.scrollElement.scrollTop - start.scrollTop) > 1) {
      suppressNextManualCardTap()
    }
    return
  }

  const responseConsumedGesture = start.scrollElement && (
    (gesture.action === 'next' && start.scrollTop < start.maxScrollTop)
    || (gesture.action === 'previous' && start.scrollTop > 0)
  )
  suppressNextManualCardTap()
  if (responseConsumedGesture) return
  confirmSwipeHint(REVIEW_SET_CARD_SWIPE_HINT.id)
  if (gesture.action === 'previous') void navigateLeft(gesture.transition)
  else if (gesture.action === 'next') void navigateRight(gesture.transition)
  else showReviewCardSide(gesture.action, gesture.transition)
}

function cancelReviewCardSwipe(event: PointerEvent) {
  if (manualSwipeStart?.pointerId === event.pointerId) manualSwipeStart = undefined
}

async function showReviewCardSide(
  side: FlashcardReviewSide,
  transitionDirection: ReviewCardTransitionDirection = side === 'back' ? 'next' : 'previous',
) {
  const value = session.value
  if (
    !value
    || value.cardSides !== 'both'
    || currentSpeechSide.value === side
    || !['running', 'paused'].includes(value.status)
    || busy.value
  ) return

  const speakAfterNavigation = value.status === 'paused'
  reviewCardTransitionDirection.value = transitionDirection
  lastSpokenKey = ''
  if (value.mode === 'manual') {
    revealed.value = side !== firstReviewSide.value
  } else {
    passiveSide.value = side
    passiveRemainingMs.value = passiveDurationMs.value
    savePassiveState()
    void syncNativeBackground()
  }

  if (speakAfterNavigation) {
    await nextTick()
    await stopFlashcardSpeech()
    await speakCurrentSide(true)
  }
}

function handlePassiveCardTap() {
  if (suppressManualCardTap) {
    suppressManualCardTap = false
    return
  }
  replayCurrentSide()
}

function handleReviewCardTap() {
  if (session.value?.mode === 'manual') handleManualCardTap()
  else handlePassiveCardTap()
}

function finishReviewCardTransition() {
  reviewCardTransitionDirection.value = undefined
}

async function syncNativeBackground() {
  const value = session.value
  if (!value || !canUseNativeBackground.value) {
    nativeBackgroundReady.value = false
    backgroundSpeechWarning.value = ''
    return false
  }
  const started = await syncBackgroundFlashcardReview(
    value,
    passiveSide.value,
    passiveRemainingMs.value,
    localElapsedMs.value,
  )
  nativeBackgroundReady.value = started
  backgroundSpeechWarning.value = started
    ? ''
    : 'Speech will pause if BackOnTrack is sent to the background on this device.'
  return started
}

async function reconcileBackgroundReview(
  providedState?: BackgroundFlashcardReviewState,
) {
  const value = session.value
  if (!value || !nativeFlashcardBackgroundIsAvailable()) return false
  let state = providedState || await backgroundFlashcardReviewState()
  if (!state) return false
  if (state.sessionId !== value.id) {
    await stopBackgroundFlashcardReview()
    nativeBackgroundReady.value = false
    return false
  }
  if (value.mode !== 'passive' || !value.speechEnabled || value.status !== 'running') {
    await stopBackgroundFlashcardReview()
    nativeBackgroundReady.value = false
    return false
  }

  reconcilingBackground.value = true
  applyBackgroundProgressSnapshot(value, state)
  if (document.visibilityState === 'visible') {
    await waitForFlashcardSpeechHandoff(async () => {
      const currentState = await backgroundFlashcardReviewState()
      if (currentState?.sessionId !== value.id) return
      state = currentState
      applyBackgroundProgressSnapshot(value, currentState)
    })
    if (document.visibilityState !== 'visible') {
      reconcilingBackground.value = false
      return true
    }
    state = await backgroundFlashcardReviewState() || state
    applyBackgroundProgressSnapshot(value, state)
  }

  nativeBackgroundReady.value = false
  await stopFlashcardSpeech()
  await stopBackgroundFlashcardReview(false)
  localElapsedMs.value = Math.max(localElapsedMs.value, state.elapsedMs)
  lastTickAt = Date.now()

  const completed = value.indefinite
    ? Math.max(0, state.completedCards)
    : Math.min(Math.max(0, state.completedCards), value.queue.length)
  const previousViewedCount = value.viewedCount
  const replayedAll = completed === 0 || await performAction('view', {
    syncNative: false,
    playCompletionCue: false,
    viewCount: completed,
  })
  const reconciledAllViews = replayedAll
    && (session.value?.viewedCount || 0) >= previousViewedCount + completed

  if (
    reconciledAllViews
    && state.finished
    && session.value?.status === 'running'
    && timeLimitReached.value
  ) {
    await performAction('end', { syncNative: false, playCompletionCue: false })
  } else if (reconciledAllViews && session.value?.status === 'running' && currentCard.value) {
    passiveSide.value = state.side
    passiveRemainingMs.value = Math.max(1, state.remainingMs)
    savePassiveState()
  }
  reconcilingBackground.value = false
  backgroundViewedTarget.value = undefined
  backgroundVisualSnapshotReady.value = false

  if (!reconciledAllViews) return true
  await stopBackgroundFlashcardReview()
  if (session.value?.status === 'running') {
    lastSpokenKey = speechKey()
    await syncNativeBackground()
  }
  return true
}

function applyBackgroundProgressSnapshot(
  value: FlashcardReviewSession,
  state: BackgroundFlashcardReviewState,
) {
  backgroundViewedTarget.value = value.viewedCount + Math.max(0, state.completedCards)
  localElapsedMs.value = Math.max(localElapsedMs.value, state.elapsedMs)
  backgroundPassiveRemainingMs.value = Math.max(0, state.remainingMs)
  backgroundPassiveDurationMs.value = state.side === 'front'
    ? Math.max(1000, value.frontSeconds * 1000)
    : flashcardBackDurationMs(value.backSeconds, value.backSpeechRepeatCount)
  lastTickAt = Date.now()
  backgroundVisualSnapshotReady.value = true
  tickVersion.value++
}

function copySessionSettings(value: FlashcardReviewSession) {
  Object.assign(sessionSettingsDraft, {
    mode: value.mode,
    cardSides: value.cardSides,
    invertFaces: value.invertFaces === true,
    indefinite: value.indefinite,
    timeLimitSeconds: value.timeLimitSeconds || 0,
    maxCards: value.maxCards,
    ejectBehavior: value.ejectBehavior,
    ejectExcludeAfter: value.ejectExcludeAfter,
    frontSeconds: value.frontSeconds,
    backSeconds: value.backSeconds,
    backSpeechRepeatCount: value.backSpeechRepeatCount,
    backDisplay: value.backDisplay || 'back',
    speechEnabled: value.speechEnabled,
    frontLanguage: value.frontLanguage,
    backLanguage: value.backLanguage,
    sortMode: value.sortMode,
    sortDirection: value.sortDirection,
  })
}

async function openSessionSettings() {
  const value = session.value
  if (!value || busy.value) return
  resumeAfterSessionSettings = resumeAfterSessionSettings
    || (value.mode === 'passive' && value.status === 'running')
  if (resumeAfterSessionSettings) await pauseReview(false)
  if (!session.value || isFinished.value) return
  copySessionSettings(session.value)
  sessionSettingsOriginal.value = flashcardReviewSettingsSignature(sessionSettingsDraft)
  sessionSettingsError.value = ''
  sessionSettingsDialog.value = true
  sessionSpeechLoading.value = true
  try {
    sessionSpeechSupport.value = await loadFlashcardSpeechSupport()
  } finally {
    sessionSpeechLoading.value = false
  }
}

async function closeSessionSettings() {
  sessionSettingsApplyMenu.value = false
  sessionSettingsDialog.value = false
  sessionSettingsError.value = ''
  if (
    session.value?.status === 'paused'
    && (resumeAfterSessionSettings || session.value.mode === 'manual')
  ) {
    await resumeReview()
  }
  resumeAfterSessionSettings = false
}

async function saveSessionSettings(target: FlashcardSettingsApplyTarget = 'session') {
  const result = await sessionSettingsForm.value?.validate()
  if (!result?.valid || !canSaveSessionSettings.value || !session.value) return
  sessionSettingsSaving.value = true
  sessionSettingsError.value = ''
  try {
    if (target === 'review-set' || target === 'both') {
      const reviewSet = currentReviewSet.value
      if (!reviewSet) throw new Error('This review session is not linked to a Review set.')
      const settings = { ...reviewSet, ...sessionSettingsDraft }
      if (reviewSet.accessRole === 'owner') {
        await store.saveReviewSet(settings)
      } else {
        await store.saveReviewSetPreferences(reviewSet.id, settings)
        showSavedSnackbar('Review set', reviewSet.name)
      }
    }

    if (target === 'session' || target === 'both') {
      const updated = await store.updateSessionSettings(session.value.id, sessionSettingsDraft)
      currentQueueIndex.value = 0
      ejectedQueueIndexes.length = 0
      localElapsedMs.value = updated.elapsedSeconds * 1000
      lastTickAt = Date.now()
      lastSpokenKey = ''
      speechPlaybackWarning.value = ''
      resetCurrentCardPhase()
    }
    await closeSessionSettings()
  } catch (cause) {
    sessionSettingsError.value = cause instanceof Error
      ? cause.message
      : 'Could not update this review session.'
  } finally {
    sessionSettingsSaving.value = false
  }
}

function applySessionSettingsTo(target: FlashcardSettingsApplyTarget) {
  sessionSettingsApplyMenu.value = false
  void saveSessionSettings(target)
}

async function openCardEditor(action: 'add' | 'edit') {
  if (!session.value || busy.value || !canManageCurrentCard.value) return
  resumeAfterCardEditor = resumeAfterCardEditor
    || (session.value.mode === 'passive' && session.value.status === 'running')
  if (resumeAfterCardEditor) await pauseReview(false)
  try {
    if (currentReviewSet.value && currentReviewSet.value.accessRole !== 'owner') {
      await store.loadReviewSetCards(currentReviewSet.value.id)
    }
    cardEditorCard.value = action === 'edit' ? currentSourceCard.value : undefined
    if (action === 'edit' && !cardEditorCard.value) throw new Error('That flashcard could not be found.')
    cardEditorDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await closeCardEditor(false)
  }
}

async function closeCardEditor(open: boolean) {
  cardEditorDialog.value = open
  if (!open && resumeAfterCardEditor && session.value?.status === 'paused') await resumeReview()
  if (!open) resumeAfterCardEditor = false
}

function currentCardHasTag(tagId: string) {
  return Boolean(currentCard.value?.tags.includes(tagId))
}

async function toggleCurrentCardTag(tag: FlashcardTag | { name: string }) {
  const cardId = currentCard.value?.id
  if (!cardId || !canTagCurrentCard.value || cardTagSaving.value) return
  cardTagSaving.value = 'id' in tag ? tag.id : tag.name
  try {
    const resolvedTag = 'id' in tag ? tag : await store.createTag(tag.name)
    const update = flashcardTagToggleUpdate(currentCard.value?.tags || [], resolvedTag, store.tags)
    const updatedCards = await store.bulkUpdateCards(update.action, [cardId], update.values)
    const updatedCard = updatedCards.find(card => card.id === cardId)
    if (!updatedCard) throw new Error('The flashcard could not be updated.')
    handleCardSaved(updatedCard)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update this flashcard tag.'
  } finally {
    cardTagSaving.value = ''
  }
}

function handleCardSaved(card: Flashcard) {
  const value = session.value
  if (!value) return
  const snapshot = {
    id: card.id,
    front: card.front,
    back: card.back,
    transliteration: card.transliteration || '',
    note: card.note,
    frontAudio: card.frontAudio,
    backAudio: card.backAudio,
    image: card.image,
    tags: [...card.tags],
  }
  const index = value.queue.findIndex(item => item.id === card.id)
  if (index >= 0) value.queue.splice(index, 1, snapshot)
  else if (value.queue.length < value.maxCards) {
    value.queue.push(snapshot)
    value.totalCards += 1
  }
}

function requestCurrentCardDeletion() {
  if (!canManageCurrentCard.value) return
  deleteCardId.value = currentCard.value?.id || ''
  deleteCardDialog.value = Boolean(deleteCardId.value)
}

async function deleteCurrentCard() {
  const cardId = deleteCardId.value
  if (!cardId || !session.value || deletingCard.value) return
  const restorePaused = session.value.status === 'paused'
  deletingCard.value = true
  try {
    if (restorePaused) await resumeReview()
    const removed = await performAction('eject')
    if (!removed) return
    if (currentReviewSet.value?.accessRole && currentReviewSet.value.accessRole !== 'owner') {
      await store.deleteReviewSetCard(currentReviewSet.value.id, cardId)
    } else {
      await store.deleteCard(cardId)
    }
    deleteCardDialog.value = false
    deleteCardId.value = ''
    if (restorePaused && session.value?.status === 'running') await pauseReview(false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this flashcard.'
  } finally {
    deletingCard.value = false
  }
}

async function handleSessionMenuAction(action: FlashcardContextAction) {
  if (action === 'add' || action === 'edit') {
    resumeAfterCardEditor = resumeAfterCardEditor || resumeAfterSessionActions
    resumeAfterSessionActions = false
    await openCardEditor(action)
  } else if (action === 'settings') {
    resumeAfterSessionSettings = resumeAfterSessionSettings || resumeAfterSessionActions
    resumeAfterSessionActions = false
    await openSessionSettings()
  } else if (action === 'remove') {
    await finishSessionActions()
    requestCurrentCardDeletion()
  } else if (action === 'eject') {
    await finishSessionActions()
    await ejectCurrentCard()
  } else if (action === 'undo_eject') {
    await finishSessionActions()
    await undoLastEject()
  }
}

async function handleRunnerSessionAction(action: RunnerSessionAction) {
  if (
    action === 'add'
    || action === 'edit'
    || action === 'settings'
    || action === 'remove'
    || action === 'eject'
    || action === 'undo_eject'
  ) await handleSessionMenuAction(action)
  else {
    await finishSessionActions()
    if (action === 'amplification') await toggleSpeechOverAmplification()
    else if (action === 'restart') await restartReview()
    else if (action === 'end') endDialog.value = true
  }
}

async function ejectCurrentCard() {
  if (!session.value || busy.value) return
  const restorePaused = session.value.status === 'paused'
  if (restorePaused) await resumeReview()
  await performAction('eject')
  if (restorePaused && session.value?.status === 'running') await pauseReview(false)
}

async function undoLastEject() {
  if (!session.value || session.value.ejectedCount <= 0 || busy.value) return
  const restorePaused = session.value.status === 'paused'
  if (restorePaused) await resumeReview()
  await performAction('undo_eject')
  if (restorePaused && session.value?.status === 'running') await pauseReview(false)
}

async function finishEarly() {
  endDialog.value = false
  await performAction('end')
}

async function leaveRunner() {
  await pauseReview(false)
  await router.replace(exitDestination.value)
}
</script>

<template>
  <main class="review-runner safe-bottom">
    <div v-if="loading" class="runner-state">
      <v-progress-circular indeterminate color="secondary" size="42" />
      <p>Preparing your cards…</p>
    </div>

    <div v-else-if="error && !session" class="runner-state px-5">
      <v-icon icon="mdi-alert-circle-outline" color="error" size="46" />
      <h1 class="text-h5 font-weight-black">Review unavailable</h1>
      <p class="muted text-center">{{ error }}</p>
      <v-btn color="secondary" @click="router.replace(exitDestination)">Back to Flashcards</v-btn>
    </div>

    <div v-else-if="session" class="review-screen">
      <header v-if="!isReviewSetPreview" class="runner-header">
        <v-btn
          icon="mdi-chevron-down"
          variant="text"
          aria-label="Leave review"
          @click="leaveRunner"
        />
        <div class="runner-header__title min-width-0">
          <strong class="text-truncate">{{ session.name }}</strong>
          <span v-if="session.indefinite">{{ displayedViewedCount }} viewed · looping</span>
          <span v-else>{{ completedCards }} of {{ session.totalCards }}</span>
        </div>
        <div class="runner-header__actions">
          <v-btn
            icon="mdi-dots-vertical"
            variant="text"
            class="runner-actions-button"
            aria-label="Review actions"
            @touchstart.stop
            @click.stop="openSessionActions"
          />
        </div>
      </header>

      <v-progress-linear
        v-if="!isReviewSetPreview"
        class="review-progress"
        :model-value="progress"
        color="primary"
        bg-color="white"
        :bg-opacity="0.14"
        height="5"
        :aria-label="session.indefinite
          ? `${progress}% through the current loop or time limit`
          : `${progress}% of review complete`"
      />

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="runner-alert">
        {{ error }}
      </v-alert>
      <v-alert
        v-else-if="!isReviewSetPreview && speechWarning"
        type="warning"
        variant="tonal"
        density="compact"
        class="runner-alert runner-alert--speech"
      >
        {{ speechWarning }}
        <template v-if="speechPlaybackWarning" #append>
          <v-btn variant="text" @click="retrySpeech">Try again</v-btn>
        </template>
      </v-alert>

      <RunnerStartScreen
        v-if="isReviewSetPreview"
        class="px-4"
        :title="session.name"
        :summary="previewSummary"
        icon="mdi-cards-playing-outline"
        primary-label="Start review"
        cancel-label="Cancel review"
        :busy="busy"
        @start="startPreviewReview()"
        @cancel="leaveRunner"
      />

      <section v-else-if="isFinished" class="completion-panel">
        <div class="completion-panel__icon">
          <v-icon :icon="session.status === 'completed' ? 'mdi-check-bold' : 'mdi-stop'" size="48" />
        </div>
        <h1 class="display-title">{{ session.status === 'completed' ? 'Review complete' : 'Review ended' }}</h1>
        <p class="muted">
          {{ session.status === 'completed'
            ? timeLimitReached && session.queue.length
              ? 'You reached the time limit.'
              : session.indefinite
              ? 'Your looping review has been completed.'
              : 'You reached the end of the queue.'
            : 'Your partial progress has been saved.' }}
        </p>
        <div class="completion-stats">
          <div><strong>{{ formatReviewDuration(session.elapsedSeconds) }}</strong><span>Active time</span></div>
          <div><strong>{{ session.viewedCount }}</strong><span>Viewed</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.successCount }}</strong><span>Success</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.errorCount }}</strong><span>Errors</span></div>
          <div v-if="accuracy !== undefined"><strong>{{ accuracy }}%</strong><span>Accuracy</span></div>
          <div><strong>{{ session.ejectedCount }}</strong><span>Ejected</span></div>
        </div>
        <v-btn class="completion-panel__done" size="x-large" color="secondary" @click="router.replace(exitDestination)">Done</v-btn>
      </section>

      <section v-else-if="currentCard" class="runner-body">
        <div class="runner-meta">
          <div>
            <v-icon :icon="session.mode === 'passive' ? 'mdi-play-speed' : 'mdi-gesture-tap'" size="18" />
            <span>{{ session.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
          </div>
          <span class="runner-meta__card-count">{{ currentCardPosition }} of {{ session.queue.length }}</span>
          <span class="runner-meta__elapsed">
            {{ formatReviewDuration(elapsedSeconds) }}<template v-if="session.timeLimitSeconds">
              / {{ formatReviewDuration(session.timeLimitSeconds) }}
            </template>
          </span>
        </div>

        <ReviewSetCard
          ref="reviewCardPane"
          :card="displayedCard || currentCard"
          :side="currentSpeechSide"
          :mode="session.mode"
          :card-sides="session.cardSides"
          :invert-faces="session.invertFaces"
          :back-display="currentBackDisplay"
          :disabled="busy"
          :revealed="revealed"
          :speech-enabled="session.speechEnabled"
          :speech-language="currentSpeechLanguage"
          :spoken-word="spokenWord"
          :can-replay="canReplayCurrentSide"
          :transition-direction="reviewCardTransitionDirection"
          :progress="passiveProgress"
          :show-tag-actions="Boolean(store.tags)"
          :quick-tags="quickTags"
          :can-tag="canTagCurrentCard"
          ejectable
          :eject-disabled="isReviewSetPreview || !currentCard"
          @pointer-down="beginReviewCardSwipe"
          @pointer-move="moveReviewCardSwipe"
          @pointer-up="finishReviewCardSwipe"
          @pointer-cancel="cancelReviewCardSwipe"
          @lost-pointer-capture="cancelReviewCardSwipe"
          @activate="handleReviewCardTap"
          @replay="replayCurrentSide"
          @after-enter="finishReviewCardTransition"
          @toggle-tag="toggleCurrentCardTag({ name: $event })"
          @eject="ejectCurrentCard"
          @previous="navigateLeft"
          @next="navigateRight"
          @flip="showReviewCardSide"
          @toggle-playback="session.mode === 'passive'
            && (session.status === 'paused' ? resumeReview() : pauseReview(false))"
        />

        <div v-if="session.mode === 'manual'" class="grading-actions">
          <v-btn
            v-if="session.cardSides === 'both' && !revealed"
            size="large"
            color="secondary"
            prepend-icon="mdi-eye-outline"
            :disabled="busy || session.status === 'paused'"
            @click="revealed = true"
          >
            {{ session.invertFaces ? 'Show front' : 'Show answer' }}
          </v-btn>
          <template v-else>
            <v-btn
              size="large"
              color="error"
              variant="tonal"
              prepend-icon="mdi-close-thick"
              :loading="busy"
              :disabled="session.status !== 'running'"
              @click="performAction('error')"
            >
              Error
            </v-btn>
            <v-btn
              size="large"
              color="success"
              prepend-icon="mdi-check-bold"
              :loading="busy"
              :disabled="session.status !== 'running'"
              @click="performAction('success')"
            >
              Success
            </v-btn>
          </template>
        </div>

        <footer
          class="review-navigation"
          :class="{ 'review-navigation--manual': session.mode === 'manual' }"
          aria-label="Review navigation"
        >
          <div class="review-navigation__control">
            <v-btn
              icon="mdi-skip-previous"
              variant="tonal"
              size="large"
              aria-label="Previous card"
              :disabled="!canNavigateCards"
              @click="navigateLeft"
            />
          </div>
          <div v-if="session.mode === 'passive'" class="review-navigation__control">
            <v-btn
              :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
              color="secondary"
              size="x-large"
              :aria-label="isReviewSetPreview
                ? 'Start review'
                : session.status === 'paused' ? 'Resume review' : 'Pause review'"
              @touchstart.stop
              @click.stop="isReviewSetPreview
                ? startPreviewReview()
                : session.status === 'paused' ? resumeReview() : pauseReview(false)"
            />
          </div>
          <div class="review-navigation__control">
            <v-btn
              icon="mdi-skip-next"
              variant="tonal"
              size="large"
              aria-label="Next card"
              :disabled="!canNavigateCards"
              @click="navigateRight"
            />
          </div>
        </footer>

      </section>
    </div>

    <RunnerSessionActions
      v-if="session && !isReviewSetPreview && !loading"
      v-model="sessionActionsSheet"
      title="Review actions"
      aria-label="Review session actions"
      :items="sessionActionItems"
      @action="handleRunnerSessionAction"
    />

    <FlashcardCardDialog
      :model-value="cardEditorDialog"
      :card="cardEditorCard"
      :review-set-id="currentReviewSet?.accessRole === 'owner' ? undefined : currentReviewSet?.id"
      :initial-tags="session?.tags"
      @update:model-value="closeCardEditor"
      @saved="handleCardSaved"
    />

    <v-snackbar
      v-model="speechFailureSnackbar"
      class="runner-speech-snackbar"
      color="warning"
      location="bottom"
      :timeout="5000"
    >
      <div class="d-flex align-center ga-2">
        <v-icon icon="mdi-alert-outline" />
        <span>This card could not be spoken in the selected language.</span>
      </div>
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Dismiss speech warning"
          @click="speechFailureSnackbar = false"
        />
      </template>
    </v-snackbar>

    <AppDialog
      v-model="sessionSettingsDialog"
      persistent
      scrollable
      fullscreen
    >
      <v-card class="session-settings-card" rounded="0">
        <v-card-title class="session-settings-header d-flex align-center ga-3">
          <v-icon icon="mdi-tune-variant" color="secondary" />
          <span>Session settings</span>
        </v-card-title>
        <v-card-text class="px-5 py-4">
          <v-alert
            v-if="sessionSettingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ sessionSettingsError }}
          </v-alert>
          <AppForm ref="sessionSettingsForm" @submit.prevent="saveSessionSettings">
            <FlashcardReviewSettingsFields
              :model-value="sessionSettingsDraft"
              :speech-support="sessionSpeechSupport"
              :speech-loading="sessionSpeechLoading"
              :min-cards="sessionSettingsMinimumCards"
              :available-cards="sessionSettingsAvailableCards"
              :elapsed-seconds="elapsedSeconds"
              session
            />
          </AppForm>
        </v-card-text>
        <v-divider />
        <v-card-actions class="session-settings-actions ga-2">
          <v-btn
            class="session-settings-actions__cancel"
            variant="text"
            :disabled="sessionSettingsSaving"
            @click="closeSessionSettings"
          >
            Cancel
          </v-btn>
          <v-btn
            class="session-settings-actions__primary apply-settings-menu"
            color="secondary"
            variant="flat"
            :loading="sessionSettingsSaving"
            :disabled="!canSaveSessionSettings || sessionSettingsSaving"
            @click="sessionSettingsApplyMenu = true"
          >
            Apply to...
          </v-btn>
        </v-card-actions>
        <ActionBottomSheet
          v-model="sessionSettingsApplyMenu"
          title="Apply to..."
          aria-label="Choose where to apply session settings"
        >
          <v-list-item
            v-for="item in FLASHCARD_SETTINGS_APPLY_MENU_ITEMS"
            :key="item.target"
            :class="`apply-settings-target--${item.target}`"
            :title="item.title"
            :prepend-icon="item.icon"
            rounded="lg"
            @click="applySessionSettingsTo(item.target)"
          />
        </ActionBottomSheet>
      </v-card>
    </AppDialog>

    <ConfirmDialog
      v-model="replaceActiveReviewDialog"
      title="End the active review?"
      :message="`${activeReviewName || 'Another review'} is already in progress. End it and start ${previewSession?.name || 'this review'} instead?`"
      confirm-text="End and continue"
      confirm-color="warning"
      icon="mdi-alert-outline"
      :loading="replacingActiveReview || busy"
      @confirm="replaceActiveReview"
    />
    <ConfirmDialog
      v-model="endDialog"
      title="End this review?"
      message="Partial statistics will be saved, but an attached task will remain incomplete."
      confirm-text="End review"
      confirm-color="error"
      icon="mdi-stop-circle-outline"
      :loading="busy"
      @confirm="finishEarly"
    />
    <ConfirmDialog
      v-model="deleteCardDialog"
      title="Delete this flashcard?"
      message="The current card will be removed from this session and from future reviews. Existing review history keeps its saved faces."
      confirm-text="Delete flashcard"
      confirm-color="error"
      icon="mdi-delete-outline"
      :loading="busy || deletingCard"
      @confirm="deleteCurrentCard"
    />
  </main>
</template>

<style scoped>
.review-runner { position: fixed; z-index: 1003; inset: 0; display: flex; width: 100%; max-width: 100vw; height: 100dvh; min-height: 0; flex-direction: column; overflow: hidden; background: radial-gradient(circle at 50% 26%, rgba(var(--v-theme-secondary), .08), transparent 34rem), rgb(var(--v-theme-background)); color: rgb(var(--v-theme-on-background)); }
.review-screen { display: flex; width: 100%; min-height: 0; flex: 1 1 auto; flex-direction: column; }
.review-screen > .review-progress { position: relative; z-index: 1; flex: 0 0 auto; }
.review-progress,
.review-progress :deep(.v-progress-linear__determinate) { transition: none; }
.runner-header { display: grid; width: 100%; max-width: 54.25rem; min-height: calc(4rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem))); margin-inline: auto; padding: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)) 1rem 0; grid-template-columns: 2.75rem minmax(0, 1fr) auto; align-items: center; gap: .75rem; }
.runner-header__title { display: flex; flex-direction: column; align-items: center; }
.runner-header__title strong { max-width: 100%; font-size: .88rem; }
.runner-header__title span { color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; font-weight: 800; }
.runner-header__actions { display: flex; align-items: center; justify-content: flex-end; gap: .125rem; }
.runner-actions-button { min-width: 2.75rem; min-height: 2.75rem; }
.runner-state { display: flex; min-height: 100dvh; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; }
.runner-alert { width: min(44rem, calc(100% - 2rem)); flex: 0 0 auto; margin: 1rem auto 0; }
.runner-alert--speech { width: fit-content; max-width: calc(100% - 2rem); margin-top: .5rem; padding: .25rem .5rem !important; font-size: .7rem; line-height: 1.35; }
.runner-alert--speech :deep(.v-alert__prepend) { min-height: 1rem; margin-inline-end: .4rem; }
.runner-alert--speech :deep(.v-alert__prepend > .v-icon) { width: 1rem; height: 1rem; font-size: 1rem; }
.runner-alert--speech :deep(.v-alert__append) { align-self: center; margin-inline-start: .5rem; }
.runner-speech-snackbar { z-index: 1004 !important; }
.runner-body { display: flex; width: 100%; max-width: 44rem; min-height: 0; margin: 0 auto; padding: 1rem 1rem .5rem; flex: 1 1 auto; flex-direction: column; gap: .875rem; overflow-y: auto; overscroll-behavior: contain; }
.runner-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; gap: 1rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 850; }
.runner-meta > div { display: flex; align-items: center; gap: .4rem; }
.runner-meta__card-count { justify-self: center; }
.runner-meta__elapsed { justify-self: end; }
.review-navigation { display: grid; width: 100%; max-width: 54.25rem; margin: auto auto 0; padding-top: .25rem; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; justify-items: center; gap: 1rem; }
.review-navigation--manual { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.review-navigation__control { display: flex; min-width: 0; align-items: center; }
.grading-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.grading-actions > .v-btn:only-child { grid-column: 1 / -1; }
.grading-actions .v-btn { min-height: 3.25rem; }
.session-settings-card { min-height: 100dvh; }
.session-settings-header {
  padding:
    calc(1.25rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)))
    calc(1.25rem + env(safe-area-inset-right, 0rem))
    1rem
    calc(1.25rem + env(safe-area-inset-left, 0rem)) !important;
}
.session-settings-actions {
  display: flex;
  align-items: center;
  padding:
    1rem
    calc(1rem + env(safe-area-inset-right, 0rem))
    calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)))
    calc(1rem + env(safe-area-inset-left, 0rem)) !important;
}
.session-settings-actions > .v-btn { height: 3rem; }

@media (min-width: 60rem) {
  .session-settings-actions > .v-btn { height: 2.25rem; }
}
.session-settings-actions__cancel,
.session-settings-actions__primary {
  min-width: 0;
  flex: 1 1 0;
}
@media (min-width: 60rem) {
  .session-settings-actions { justify-content: flex-end; }
  .session-settings-actions__cancel,
  .session-settings-actions__primary { max-width: 10rem; }
}
.completion-panel { display: flex; width: min(42rem, calc(100% - 2rem)); min-height: 0; margin: 0 auto; padding: 2rem 0; align-items: center; justify-content: center; flex: 1 1 auto; flex-direction: column; gap: 1.25rem; overflow-y: auto; text-align: center; }
.completion-panel__icon { display: grid; width: 6rem; height: 6rem; place-items: center; border-radius: 2rem; background: rgba(var(--v-theme-secondary), .16); color: rgb(var(--v-theme-secondary)); }
.completion-panel h1 { font-size: clamp(2.6rem, 10vw, 5rem); }
.completion-panel__done { width: 100%; flex: 0 0 auto; }
.completion-stats { display: grid; width: 100%; margin: 1rem 0; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .6rem; }
.completion-stats > div { display: flex; padding: 1rem .5rem; border-radius: 1rem; grid-column: span 2; flex-direction: column; background: rgba(var(--v-theme-on-surface), .06); }
.completion-stats > div:last-child:nth-child(3n + 1) { grid-column: 1 / -1; }
.completion-stats > div:nth-last-child(2):nth-child(3n + 1),
.completion-stats > div:last-child:nth-child(3n + 2) { grid-column: span 3; }
.completion-stats strong { font-size: 1.25rem; }
.completion-stats span { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .52); font-size: .65rem; font-weight: 800; text-transform: uppercase; }
@media (orientation: portrait) {
  .runner-body {
    padding-bottom: 0;
  }
}

@media (orientation: landscape) and (max-height: 43.75rem) {
  .runner-header {
    max-width: none;
    min-height: calc(3rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)));
    padding-right: max(1rem, env(safe-area-inset-right));
    padding-left: max(1rem, env(safe-area-inset-left));
  }

  .runner-body {
    display: grid;
    max-width: 75rem;
    padding:
      .75rem
      max(1rem, env(safe-area-inset-right))
      max(.5rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    grid-template-columns: minmax(0, 1.3fr) minmax(15rem, .7fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: .375rem 1rem;
    overflow: hidden;
  }

  .runner-meta {
    display: flex;
    padding-left: 1rem;
    grid-column: 2;
    grid-row: 1;
    align-items: center;
    justify-content: space-between;
    flex-direction: row;
    gap: .375rem;
  }

  .runner-meta__card-count,
  .runner-meta__elapsed {
    justify-self: auto;
  }

  .grading-actions,
  .review-navigation {
    padding-left: 1rem;
    border-left: .0625rem solid rgb(var(--v-theme-on-surface) / .12);
  }

  .grading-actions {
    grid-column: 2;
    grid-row: 2;
    gap: .5rem;
  }

  .grading-actions .v-btn {
    min-width: 0;
    min-height: 2.75rem;
  }

  .review-navigation {
    max-width: none;
    margin: 0;
    padding-top: 2.375rem;
    grid-column: 2;
    grid-row: 3;
    align-content: end;
    gap: 0;
  }

  .review-navigation :deep(.v-btn) {
    width: clamp(2.75rem, 11dvh, 3.5rem);
    height: clamp(2.75rem, 11dvh, 3.5rem);
  }

  .review-navigation:not(.review-navigation--manual) .review-navigation__control:nth-child(2) :deep(.v-btn) {
    width: clamp(3rem, 13dvh, 4rem);
    height: clamp(3rem, 13dvh, 4rem);
  }

}
</style>
