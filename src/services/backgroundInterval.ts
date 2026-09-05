import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  flashcardSpeechOverAmplificationIsEnabled,
  resolveFlashcardAudioPlaybackUrl,
} from '@/services/flashcardSpeech'
import { intervalTypeSound } from '@/services/intervalTypes'
import {
  flashcardReviewCardBackSpeechRepeatCount,
  flashcardReviewCardBackSpeechRate,
  flashcardReviewCardFaceDurationSeconds,
} from '@/services/flashcards'
import {
  reviewSetAudioFocusIsEnabled,
  setNativeIntervalAudioFocusOwnership,
} from '@/services/reviewSetAudioFocus'
import {
  intervalFlashcardReviewElapsedMs,
  intervalStepCount,
  intervalStepDurationSeconds,
  intervalStepPlaysFlashcardReview,
  intervalStepUsesStopwatch,
  reconcileIntervalRuntime,
  resolveIntervalStep,
} from '@/services/intervals'
import type { IntervalCueSound, IntervalSession } from '@/types/domain'

interface BackgroundIntervalStep {
  name: string
  durationMs: number
  stopwatch: boolean
  requiresConfirmation: boolean
  flashcardReviewEnabled: boolean
  cueSound: IntervalCueSound
}

interface BackgroundIntervalPlugin {
  start(options: {
    sessionId: string
    sessionName: string
    steps: BackgroundIntervalStep[]
    stepIndex: number
    remainingMs: number
    elapsedMs: number
    stepElapsedMs: number
    soundEnabled: boolean
    vibrationEnabled: boolean
    flashcardReview?: {
      name: string
      cards: Array<{
        front: string
        back: string
        ttsFront: string
        ttsBack: string
        transliteration: string
        note: string
        frontAudio: string
        backAudio: string
        frontSeconds: number
        backSeconds: number
        backSpeechRepeatCount: number
        backSpeechRate: number
      }>
      cardSides: 'both' | 'front' | 'back'
      invertFaces: boolean
      frontSeconds: number
      backSeconds: number
      backSpeechRepeatCount: number
      frontDisplay: string
      backDisplay: string
      speechEnabled: boolean
      backSpeechRate?: number
      frontLanguage: string
      backLanguage: string
      overAmplified: boolean
      audioFocusEnabled: boolean
    }
  }): Promise<void>
  playCue(options: { name: NativeIntervalCueName, signal?: boolean }): Promise<void>
  isSpeechActive?(): Promise<{ active: boolean }>
  getReviewState(): Promise<{ sessionId?: string; elapsedMs?: number; speechRemainingMs?: number }>
  stop(): Promise<void>
}

export type NativeIntervalCueName = Exclude<IntervalCueSound, 'none' | 'speech'> | 'eject'
const BackgroundInterval = registerPlugin<BackgroundIntervalPlugin>('BackgroundInterval')
const MAX_NATIVE_STEPS = 10_000
let nativeBackgroundIntervalActive = false

function nativeSteps(session: IntervalSession) {
  const count = intervalStepCount(session.definition)
  if (count > MAX_NATIVE_STEPS) {
    throw new Error(`Background intervals support up to ${MAX_NATIVE_STEPS.toLocaleString()} expanded steps.`)
  }

  const steps: BackgroundIntervalStep[] = []
  for (let index = 0; index < count; index += 1) {
    const resolved = resolveIntervalStep(session.definition, index)
    if (!resolved) break
    steps.push({
      name: resolved.step.name || `Interval ${index + 1}`,
      durationMs: Math.max(1, Math.round(intervalStepDurationSeconds(resolved.step) * 1000)),
      stopwatch: intervalStepUsesStopwatch(resolved.step),
      requiresConfirmation: resolved.step.kind === 'confirmation',
      flashcardReviewEnabled: intervalStepPlaysFlashcardReview(resolved.step),
      cueSound: intervalTypeSound(session.cues.typeSounds, resolved.step.kind),
    })
  }
  return steps
}

export async function syncBackgroundInterval(session: IntervalSession) {
  if (Capacitor.getPlatform() !== 'android' || session.status !== 'running') return
  try {
    const runtime = reconcileIntervalRuntime(session.definition, session.runtime).runtime
    const currentStep = resolveIntervalStep(session.definition, runtime.stepIndex)?.step
    const stepElapsedMs = currentStep && intervalStepUsesStopwatch(currentStep)
      ? Math.max(0, runtime.stepElapsedMs || 0)
      : 0
    const playbackOffsetMs = session.flashcardReview?.playbackOffsetMs
    const nativeFlashcardReviewElapsedMs = (
      runtime.flashcardReviewAccumulatedMs
        ?? intervalFlashcardReviewElapsedMs(
          session.definition,
          runtime.stepIndex,
          runtime.remainingMs,
        )
    ) + (Number.isFinite(playbackOffsetMs)
      ? playbackOffsetMs!
      : 0)
    await BackgroundInterval.start({
      sessionId: session.id,
      sessionName: session.name,
      steps: nativeSteps(session),
      stepIndex: runtime.stepIndex,
      remainingMs: Math.max(1, Math.round(runtime.remainingMs)),
      elapsedMs: Math.max(0, Math.round(nativeFlashcardReviewElapsedMs)),
      stepElapsedMs: Math.round(stepElapsedMs),
      soundEnabled: session.cues.soundEnabled,
      vibrationEnabled: session.cues.vibrationEnabled,
      ...(session.flashcardReview?.speechEnabled
        ? {
            flashcardReview: {
              name: session.flashcardReview.name,
              cards: session.flashcardReview.cards.map(card => ({
                front: card.front,
                back: card.back,
                ttsFront: card.ttsFront || '',
                ttsBack: card.ttsBack || '',
                transliteration: card.transliteration || '',
                note: card.note || '',
                frontAudio: resolveFlashcardAudioPlaybackUrl(card.frontAudio || ''),
                backAudio: resolveFlashcardAudioPlaybackUrl(card.backAudio || ''),
                frontSeconds: flashcardReviewCardFaceDurationSeconds(
                  session.flashcardReview!,
                  card,
                  'front',
                ),
                backSeconds: flashcardReviewCardFaceDurationSeconds(
                  session.flashcardReview!,
                  card,
                  'back',
                ),
                backSpeechRepeatCount: flashcardReviewCardBackSpeechRepeatCount(
                  session.flashcardReview!,
                  card,
                ),
                backSpeechRate: flashcardReviewCardBackSpeechRate(
                  session.flashcardReview!,
                  card,
                ),
              })),
              cardSides: 'both',
              invertFaces: false,
              frontSeconds: session.flashcardReview.frontSeconds,
              backSeconds: session.flashcardReview.backSeconds,
              backSpeechRepeatCount: session.flashcardReview.backSpeechRepeatCount,
              frontDisplay: session.flashcardReview.frontDisplay || 'front',
              backDisplay: session.flashcardReview.backDisplay || 'back',
              speechEnabled: !session.flashcardReview.speechPaused,
              ...(session.flashcardReview.backSpeechRate
                && session.flashcardReview.backSpeechRate !== 1
                ? { backSpeechRate: session.flashcardReview.backSpeechRate }
                : {}),
              frontLanguage: session.flashcardReview.frontLanguage,
              backLanguage: session.flashcardReview.backLanguage,
              overAmplified: flashcardSpeechOverAmplificationIsEnabled(),
              audioFocusEnabled: reviewSetAudioFocusIsEnabled(),
            },
          }
        : {}),
    })
    nativeBackgroundIntervalActive = true
    await setNativeIntervalAudioFocusOwnership(true)
  } catch (error) {
    nativeBackgroundIntervalActive = false
    await setNativeIntervalAudioFocusOwnership(false)
    throw error
  }
}

export async function stopBackgroundInterval() {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    await BackgroundInterval.stop()
  } finally {
    nativeBackgroundIntervalActive = false
    await setNativeIntervalAudioFocusOwnership(false)
  }
}

export async function waitForBackgroundIntervalSpeech(refreshProgress?: () => Promise<void>) {
  if (
    Capacitor.getPlatform() !== 'android'
    || typeof document === 'undefined'
    || !BackgroundInterval.isSpeechActive
  ) return
  while (document.visibilityState === 'visible') {
    const active = await BackgroundInterval.isSpeechActive()
      .then(result => result.active)
      .catch(() => false)
    if (!active) return
    await refreshProgress?.()
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
}

export async function backgroundIntervalReviewState() {
  if (Capacitor.getPlatform() !== 'android') return undefined
  return BackgroundInterval.getReviewState().catch(() => undefined)
}

export async function playNativeIntervalCue(name: NativeIntervalCueName, signal = false) {
  if (Capacitor.getPlatform() !== 'android') return false
  await BackgroundInterval.playCue({ name, ...(signal ? { signal: true } : {}) })
  return true
}

export function nativeBackgroundIntervalOwnsCues() {
  return nativeBackgroundIntervalActive
    && typeof document !== 'undefined'
    && document.visibilityState !== 'visible'
}

export function nativeBackgroundIntervalIsActive() {
  return nativeBackgroundIntervalActive
}
