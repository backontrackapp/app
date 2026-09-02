import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import {
  beginFlashcardSpeechWordTracking,
  clearFlashcardSpeechWordTracking,
  flashcardSpeechTextParts,
  flashcardSpeechWordTrackingIsActive,
  speechLanguageUsesPinyin,
  takePreparedFlashcardSpeechWordTracking,
  type FlashcardSpeechTextPart,
  updateFlashcardSpeechWord,
} from '@/services/spokenText'
import {
  flashcardReviewCardBackSpeechRepeatCount,
  flashcardReviewCardBackSpeechRate,
  flashcardReviewCardFaceDurationSeconds,
  flashcardReviewFaceCanSpeak,
  flashcardReviewFaceValue,
  normalizeFlashcardBackSpeechRate,
} from '@/services/flashcards'
import { updateReviewSetBluetoothAudioActive } from '@/services/reviewSetAudioFocus'
import type {
  BackgroundFlashcardReviewState,
  FlashcardReviewSession,
  FlashcardReviewCardSides,
  FlashcardReviewSide,
  FlashcardSpeechLanguage,
  FlashcardSpeechSupport,
  FlashcardSpeechWord,
} from '@/types/domain'

interface NativeSpeechSupport {
  available: boolean
  languages: string[]
}

interface FlashcardSpeechPlugin {
  addListener?(
    eventName: 'speechPlayback',
    listener: (event: {
      state: 'prepare' | 'start' | 'end'
      utteranceId: string
      durationMs?: number
      speechRanges?: Array<{ start: number; end: number; offsetMs: number }>
      wordAnimationLeadMs?: number
    }) => void,
  ): Promise<PluginListenerHandle>
  getLanguages(): Promise<NativeSpeechSupport>
  speak(options: {
    text: string
    language: string
    overAmplified: boolean
    speechRate?: number
    backgroundIntervalSpeechKey?: string
  }): Promise<{ utteranceId?: string }>
  playRecording(options: {
    url: string
    backgroundIntervalSpeechKey?: string
  }): Promise<{ durationMs?: number }>
  setOverAmplification(options: { enabled: boolean }): Promise<void>
  isSpeechActive?(): Promise<{ active: boolean }>
  stopSpeaking(): Promise<void>
  startBackground(options: {
    sessionId: string
    sessionName: string
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
    indefinite: boolean
    timeLimitSeconds: number
    cardSides: FlashcardReviewCardSides
    invertFaces: boolean
    side: FlashcardReviewSide
    remainingMs: number
    frontSeconds: number
    backSeconds: number
    backSpeechRepeatCount: number
    frontDisplay: string
    backDisplay: string
    frontLanguage: string
    backLanguage: string
    elapsedMs: number
    overAmplified: boolean
    backSpeechRate?: number
  }): Promise<void>
  getBackgroundState(): Promise<{ state?: BackgroundFlashcardReviewState }>
  stopBackground(options: { clearState: boolean }): Promise<void>
}

const NativeFlashcardSpeech = registerPlugin<FlashcardSpeechPlugin>('FlashcardSpeech')
const SPEECH_OVER_AMPLIFICATION_STORAGE_KEY = 'backontrack-flashcard-speech:over-amplification'
let nativeBackgroundActive = false
let activeBrowserUtterance: SpeechSynthesisUtterance | undefined
let activeRecordedAudio: HTMLAudioElement | undefined
let browserVoiceLoad: Promise<SpeechSynthesisVoice[]> | undefined
let nativeSpeechPlaybackListener: Promise<PluginListenerHandle> | undefined
let estimatedSpeechTimers: number[] = []
let activeNativeSpeechText = ''
let activeNativeSpeechLanguage = ''
let activeNativeSpeechRate = 1
let activeNativeSpeechUtteranceId = ''
let activeNativeSpeechPlaybackStart: ((durationMs: number) => void) | undefined
const NATIVE_WORD_ANIMATION_LEAD_MS = 100

function speechWordRanges(text: string, language: string) {
  return flashcardSpeechTextParts(text, language)
    .filter((part): part is FlashcardSpeechTextPart & { wordIndex: number } => part.wordIndex !== undefined)
}

export function estimatedFlashcardSpeechDurationMs(
  text: string,
  language: string,
  speechRate = 1,
) {
  const wordCount = speechWordRanges(text, language).length
  if (!wordCount) return 0
  return Math.round(
    (speechLanguageUsesPinyin(language) ? 260 : 340)
      / normalizeFlashcardBackSpeechRate(speechRate) * wordCount,
  )
}

function clearEstimatedSpeech() {
  if (typeof window !== 'undefined') {
    estimatedSpeechTimers.forEach(timer => window.clearTimeout(timer))
  }
  estimatedSpeechTimers = []
}

function speechWordForRange(
  ranges: Array<FlashcardSpeechTextPart & { wordIndex: number }>,
  start: number,
  length = 0,
): FlashcardSpeechWord | undefined {
  const end = Math.max(start + length, start + 1)
  const matches = ranges.filter(range => range.end > start && range.start < end)
  const first = matches[0] || ranges.find(range => range.start <= start && range.end > start)
  if (!first) return undefined
  const last = matches[matches.length - 1] || first
  return {
    start: Math.max(start, first.start),
    end: length > 0 ? Math.min(end, last.end) : first.end,
    wordStart: first.wordIndex,
    wordEnd: last.wordIndex + 1,
  }
}

function startEstimatedSpeech(
  text: string,
  language: string,
  speechRate = 1,
  playbackDurationMs?: number,
  speechRanges?: Array<{ start: number; end: number; offsetMs: number }>,
  playbackLeadMs = 0,
) {
  clearEstimatedSpeech()
  const words = speechWordRanges(text, language)
  if (!flashcardSpeechWordTrackingIsActive() || !words.length || typeof window === 'undefined') return
  const timedWords = (speechRanges || [])
    .map(range => ({
      word: speechWordForRange(words, range.start, range.end - range.start),
      offsetMs: range.offsetMs,
    }))
    .filter((timing): timing is { word: FlashcardSpeechWord; offsetMs: number } => (
      Boolean(timing.word)
      && Number.isFinite(timing.offsetMs)
      && timing.offsetMs >= 0
    ))
  if (timedWords.length) {
    timedWords.forEach(({ word, offsetMs }) => {
      estimatedSpeechTimers.push(window.setTimeout(() => {
        updateFlashcardSpeechWord(word)
      }, offsetMs))
    })
    return
  }
  const estimatedDurationMs = (speechLanguageUsesPinyin(language) ? 260 : 340)
    / normalizeFlashcardBackSpeechRate(speechRate) * words.length
  const durationMs = Number.isFinite(playbackDurationMs) && playbackDurationMs! > 0
    ? playbackDurationMs!
    : estimatedDurationMs
  words.forEach((word, index) => {
    estimatedSpeechTimers.push(window.setTimeout(() => {
      updateFlashcardSpeechWord({
        start: word.start,
        end: word.end,
        wordStart: word.wordIndex,
        wordEnd: word.wordIndex + 1,
      })
    }, index * durationMs / words.length))
  })
  estimatedSpeechTimers.push(window.setTimeout(() => {
    updateFlashcardSpeechWord(undefined)
  }, durationMs + playbackLeadMs))
}

async function ensureNativeSpeechPlaybackListener() {
  if (nativeSpeechPlaybackListener) return nativeSpeechPlaybackListener
  if (!NativeFlashcardSpeech.addListener) return undefined
  nativeSpeechPlaybackListener = NativeFlashcardSpeech.addListener('speechPlayback', event => {
    if (!activeNativeSpeechUtteranceId || event.utteranceId !== activeNativeSpeechUtteranceId) return
    if (event.state === 'prepare' && event.wordAnimationLeadMs) {
      startEstimatedSpeech(
        activeNativeSpeechText,
        activeNativeSpeechLanguage,
        activeNativeSpeechRate,
        event.durationMs,
        event.speechRanges,
        event.wordAnimationLeadMs,
      )
    } else if (event.state === 'start') {
      activeNativeSpeechPlaybackStart?.(event.durationMs || 0)
      if (!event.wordAnimationLeadMs) {
        startEstimatedSpeech(
          activeNativeSpeechText,
          activeNativeSpeechLanguage,
          activeNativeSpeechRate,
          event.durationMs,
          event.speechRanges,
        )
      }
    } else {
      clearEstimatedSpeech()
      clearFlashcardSpeechWordTracking()
    }
  })
  return nativeSpeechPlaybackListener
}

function storedSpeechOverAmplificationIsEnabled() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(SPEECH_OVER_AMPLIFICATION_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function storeSpeechOverAmplification(enabled: boolean) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SPEECH_OVER_AMPLIFICATION_STORAGE_KEY, String(enabled))
  } catch {
    // Speech remains usable for the current session if device storage is unavailable.
  }
}

let speechOverAmplificationEnabled = storedSpeechOverAmplificationIsEnabled()

function isNativeAndroid() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
}

export function nativeFlashcardBackgroundIsAvailable() {
  return isNativeAndroid()
}

export function resolveFlashcardAudioPlaybackUrl(value: string) {
  if (!value || /^(?:data:|blob:)/i.test(value) || typeof window === 'undefined') return value
  return new URL(value, window.location.href).href
}

export function flashcardSpeechOverAmplificationIsEnabled() {
  return speechOverAmplificationEnabled
}

export async function setFlashcardSpeechOverAmplification(enabled: boolean) {
  const previous = speechOverAmplificationEnabled
  speechOverAmplificationEnabled = enabled
  if (!isNativeAndroid()) {
    storeSpeechOverAmplification(enabled)
    return enabled
  }

  try {
    await NativeFlashcardSpeech.setOverAmplification({ enabled })
    storeSpeechOverAmplification(enabled)
    return enabled
  } catch (cause) {
    speechOverAmplificationEnabled = previous
    throw cause
  }
}

export function toggleFlashcardSpeechOverAmplification() {
  return setFlashcardSpeechOverAmplification(!speechOverAmplificationEnabled)
}

export function normalizeSpeechLanguage(value: string) {
  const candidate = value.trim().replaceAll('_', '-')
  if (!candidate) return ''
  try {
    return Intl.getCanonicalLocales(candidate)[0] || candidate
  } catch {
    return candidate
  }
}

export function speechLanguageOptions(
  values: string[],
  displayLocale = typeof navigator === 'undefined' ? 'en' : navigator.language,
): FlashcardSpeechLanguage[] {
  const tags = [...new Set(values.map(normalizeSpeechLanguage).filter(Boolean))]
  let names: Intl.DisplayNames | undefined
  try {
    names = new Intl.DisplayNames([displayLocale], { type: 'language' })
  } catch {
    // Language tags remain understandable when localized display names are unavailable.
  }
  return tags
    .map(tag => ({ tag, title: names?.of(tag) || tag }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([])
  const synthesis = window.speechSynthesis
  const current = synthesis.getVoices()
  if (current.length) return Promise.resolve(current)
  if (browserVoiceLoad) return browserVoiceLoad

  browserVoiceLoad = new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synthesis.removeEventListener('voiceschanged', finish)
      window.clearTimeout(timeout)
      resolve(synthesis.getVoices())
    }
    const timeout = window.setTimeout(finish, 1000)
    synthesis.addEventListener('voiceschanged', finish, { once: true })
  }).finally(() => {
    browserVoiceLoad = undefined
  })
  return browserVoiceLoad
}

async function browserVoiceLanguages() {
  return (await loadBrowserVoices()).map(voice => voice.lang)
}

function browserVoiceForLanguage(voices: SpeechSynthesisVoice[], language: string) {
  const requested = normalizeSpeechLanguage(language)
  const exact = voices.find(voice => normalizeSpeechLanguage(voice.lang) === requested)
  if (exact) return exact
  const base = requested.split('-')[0]
  return voices.find(voice => voice.default && normalizeSpeechLanguage(voice.lang).split('-')[0] === base)
    || voices.find(voice => normalizeSpeechLanguage(voice.lang).split('-')[0] === base)
}

export async function loadFlashcardSpeechSupport(): Promise<FlashcardSpeechSupport> {
  if (isNativeAndroid()) {
    try {
      const result = await NativeFlashcardSpeech.getLanguages()
      return {
        available: result.available && result.languages.length > 0,
        languages: speechLanguageOptions(result.languages),
      }
    } catch {
      return { available: false, languages: [] }
    }
  }

  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof window.SpeechSynthesisUtterance === 'undefined'
  ) return { available: false, languages: [] }

  const languages = speechLanguageOptions(await browserVoiceLanguages())
  return { available: languages.length > 0, languages }
}

export function defaultFlashcardSpeechLanguage(languages: FlashcardSpeechLanguage[]) {
  const preferred = normalizeSpeechLanguage(
    typeof navigator === 'undefined' ? 'en-US' : navigator.language,
  )
  return languages.find(language => language.tag === preferred)?.tag
    || languages.find(language => language.tag.split('-')[0] === preferred.split('-')[0])?.tag
    || languages[0]?.tag
    || ''
}

export async function speakFlashcardText(
  text: string,
  language: string,
  backgroundIntervalSpeechKey = '',
  audioUrl = '',
  speechRate = 1,
  onPlaybackStart?: (durationMs: number) => void,
  wordAnimationLeadMs = 0,
) {
  const wordHandler = takePreparedFlashcardSpeechWordTracking()
  const content = text.trim()
  const recording = audioUrl.trim()
  clearEstimatedSpeech()
  activeNativeSpeechText = ''
  activeNativeSpeechLanguage = ''
  activeNativeSpeechRate = 1
  activeNativeSpeechUtteranceId = ''
  activeNativeSpeechPlaybackStart = undefined
  if (recording) {
    try {
      if (isNativeAndroid()) {
        const result = await NativeFlashcardSpeech.playRecording({
          url: resolveFlashcardAudioPlaybackUrl(recording),
          ...(backgroundIntervalSpeechKey ? { backgroundIntervalSpeechKey } : {}),
        })
        onPlaybackStart?.(result?.durationMs || 0)
      } else {
        onPlaybackStart?.(await playFlashcardRecording(recording))
      }
      clearFlashcardSpeechWordTracking()
      return
    } catch {
      // Fall back to synthesis if a saved recording is temporarily unavailable.
    }
  }
  if (!content || !language) {
    clearFlashcardSpeechWordTracking()
    return
  }
  await updateReviewSetBluetoothAudioActive()
  if (isNativeAndroid()) {
    clearFlashcardSpeechWordTracking()
    activeNativeSpeechText = content
    activeNativeSpeechLanguage = language
    activeNativeSpeechRate = normalizeFlashcardBackSpeechRate(speechRate)
    activeNativeSpeechPlaybackStart = onPlaybackStart
    try {
      await ensureNativeSpeechPlaybackListener()
      const result = await NativeFlashcardSpeech.speak({
        text: content,
        language,
        overAmplified: speechOverAmplificationEnabled,
        ...(activeNativeSpeechRate === 1 ? {} : { speechRate: activeNativeSpeechRate }),
        ...(wordAnimationLeadMs > 0
          ? { wordAnimationLeadMs: Math.min(NATIVE_WORD_ANIMATION_LEAD_MS, wordAnimationLeadMs) }
          : {}),
        ...(backgroundIntervalSpeechKey ? { backgroundIntervalSpeechKey } : {}),
      })
      activeNativeSpeechUtteranceId = result?.utteranceId || ''
      beginFlashcardSpeechWordTracking(wordHandler)
    } catch (cause) {
      clearFlashcardSpeechWordTracking()
      throw cause
    }
    return
  }
  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof window.SpeechSynthesisUtterance === 'undefined'
  ) {
    clearFlashcardSpeechWordTracking()
    throw new Error('Speech synthesis is not available in this browser.')
  }

  const synthesis = window.speechSynthesis
  const voice = browserVoiceForLanguage(await loadBrowserVoices(), language)
  if (!voice) {
    clearFlashcardSpeechWordTracking()
    throw new Error(`No browser voice is available for ${language}.`)
  }
  await stopFlashcardSpeech()
  beginFlashcardSpeechWordTracking(wordHandler)

  const utterance = new window.SpeechSynthesisUtterance(content)
  const wordRanges = speechWordRanges(content, language)
  let receivedBoundary = false
  utterance.lang = voice.lang
  utterance.voice = voice
  utterance.rate = normalizeFlashcardBackSpeechRate(speechRate)
  if (speechOverAmplificationEnabled) utterance.volume = 1
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (cause?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(startTimeout)
      if (cause) reject(cause)
      else resolve()
    }
    const clearActive = () => {
      if (activeBrowserUtterance === utterance) activeBrowserUtterance = undefined
    }
    const startTimeout = window.setTimeout(() => {
      clearActive()
      synthesis.cancel()
      clearEstimatedSpeech()
      clearFlashcardSpeechWordTracking()
      settle(new Error('The browser did not start speech synthesis.'))
    }, 2000)
    utterance.onstart = () => {
      onPlaybackStart?.(estimatedFlashcardSpeechDurationMs(content, language, speechRate))
      startEstimatedSpeech(content, language, speechRate)
      settle()
    }
    utterance.onboundary = event => {
      if (event.name && event.name !== 'word') return
      if (!receivedBoundary) {
        receivedBoundary = true
        clearEstimatedSpeech()
      }
      updateFlashcardSpeechWord(speechWordForRange(
        wordRanges,
        event.charIndex,
        event.charLength,
      ))
    }
    utterance.onend = () => {
      clearActive()
      clearEstimatedSpeech()
      clearFlashcardSpeechWordTracking()
      settle()
    }
    utterance.onerror = event => {
      clearActive()
      clearEstimatedSpeech()
      clearFlashcardSpeechWordTracking()
      settle(new Error(`Browser speech synthesis failed: ${event.error}.`))
    }
    activeBrowserUtterance = utterance
    try {
      synthesis.resume()
      synthesis.speak(utterance)
    } catch (cause) {
      clearActive()
      clearEstimatedSpeech()
      clearFlashcardSpeechWordTracking()
      settle(cause instanceof Error ? cause : new Error('Browser speech synthesis failed.'))
    }
  })
}

async function playFlashcardRecording(url: string) {
  if (typeof Audio === 'undefined') throw new Error('Recorded audio is not available.')
  await stopFlashcardSpeech()
  const audio = new Audio(url)
  audio.preload = 'auto'
  activeRecordedAudio = audio
  return new Promise<number>((resolve, reject) => {
    let settled = false
    const cleanupStartListeners = () => {
      window.clearTimeout(startTimeout)
      audio.removeEventListener('playing', handlePlaying)
      audio.removeEventListener('error', handleError)
    }
    const handlePlaying = () => {
      if (settled) return
      settled = true
      cleanupStartListeners()
      resolve(Math.max(0, Math.round(audio.duration * 1000)))
    }
    const handleError = () => {
      if (settled) return
      settled = true
      cleanupStartListeners()
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (activeRecordedAudio === audio) activeRecordedAudio = undefined
      reject(new Error('The card recording could not be played.'))
    }
    const startTimeout = window.setTimeout(handleError, 3000)
    audio.addEventListener('playing', handlePlaying, { once: true })
    audio.addEventListener('error', handleError, { once: true })
    audio.addEventListener('ended', () => {
      if (activeRecordedAudio === audio) activeRecordedAudio = undefined
    }, { once: true })
    void audio.play().catch(handleError)
  })
}

export async function stopFlashcardSpeech() {
  clearEstimatedSpeech()
  clearFlashcardSpeechWordTracking()
  activeNativeSpeechText = ''
  activeNativeSpeechLanguage = ''
  activeNativeSpeechRate = 1
  activeNativeSpeechUtteranceId = ''
  activeNativeSpeechPlaybackStart = undefined
  if (activeRecordedAudio) {
    activeRecordedAudio.pause()
    activeRecordedAudio.removeAttribute('src')
    activeRecordedAudio.load()
    activeRecordedAudio = undefined
  }
  if (isNativeAndroid()) {
    await NativeFlashcardSpeech.stopSpeaking().catch(() => undefined)
    return
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synthesis = window.speechSynthesis
    if (activeBrowserUtterance || synthesis.speaking || synthesis.pending || synthesis.paused) {
      synthesis.cancel()
    }
    activeBrowserUtterance = undefined
  }
}

export async function waitForFlashcardSpeechCompletion() {
  while (true) {
    const active = isNativeAndroid()
      ? await NativeFlashcardSpeech.isSpeechActive?.()
        .then(result => result.active)
        .catch(() => false) || false
      : Boolean(activeBrowserUtterance || activeRecordedAudio)
    if (!active) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

export async function waitForFlashcardSpeechHandoff(
  refreshProgress?: () => void | Promise<void>,
) {
  if (
    !isNativeAndroid()
    || typeof document === 'undefined'
    || !NativeFlashcardSpeech.isSpeechActive
  ) return
  while (document.visibilityState === 'visible') {
    const active = await NativeFlashcardSpeech.isSpeechActive()
      .then(result => result.active)
      .catch(() => false)
    if (!active) return
    await refreshProgress?.()
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
}

export async function syncBackgroundFlashcardReview(
  session: FlashcardReviewSession,
  side: FlashcardReviewSide,
  remainingMs: number,
  elapsedMs: number,
) {
  if (
    !isNativeAndroid()
    || session.mode !== 'passive'
    || !session.speechEnabled
    || (flashcardReviewFaceCanSpeak(flashcardReviewFaceValue(session, 'front'))
      && !session.frontLanguage)
    || (flashcardReviewFaceCanSpeak(flashcardReviewFaceValue(session, 'back'))
      && !session.backLanguage)
    || session.status !== 'running'
  ) return false

  try {
    await NativeFlashcardSpeech.startBackground({
      sessionId: session.id,
      sessionName: session.name,
      cards: session.queue.map(card => ({
        front: card.front,
        back: card.back,
        ttsFront: card.ttsFront || '',
        ttsBack: card.ttsBack || '',
        transliteration: card.transliteration || '',
        note: card.note || '',
        frontAudio: resolveFlashcardAudioPlaybackUrl(card.frontAudio || ''),
        backAudio: resolveFlashcardAudioPlaybackUrl(card.backAudio || ''),
        frontSeconds: flashcardReviewCardFaceDurationSeconds(session, card, 'front'),
        backSeconds: flashcardReviewCardFaceDurationSeconds(session, card, 'back'),
        backSpeechRepeatCount: flashcardReviewCardBackSpeechRepeatCount(session, card),
        backSpeechRate: flashcardReviewCardBackSpeechRate(session, card),
      })),
      indefinite: session.indefinite,
      timeLimitSeconds: session.timeLimitSeconds || 0,
      cardSides: 'both',
      invertFaces: false,
      side,
      remainingMs: Math.max(1, Math.round(remainingMs)),
      frontSeconds: session.frontSeconds,
      backSeconds: session.backSeconds,
      backSpeechRepeatCount: session.backSpeechRepeatCount,
      frontDisplay: session.frontDisplay || 'front',
      backDisplay: session.backDisplay || 'back',
      frontLanguage: session.frontLanguage,
      backLanguage: session.backLanguage,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      overAmplified: speechOverAmplificationEnabled,
      ...(normalizeFlashcardBackSpeechRate(session.backSpeechRate) === 1
        ? {}
        : { backSpeechRate: normalizeFlashcardBackSpeechRate(session.backSpeechRate) }),
    })
    nativeBackgroundActive = true
    return true
  } catch {
    nativeBackgroundActive = false
    return false
  }
}

export async function backgroundFlashcardReviewState() {
  if (!isNativeAndroid()) return undefined
  try {
    const result = await NativeFlashcardSpeech.getBackgroundState()
    if (!result.state?.sessionId) return undefined
    nativeBackgroundActive = result.state.running
    return result.state
  } catch {
    return undefined
  }
}

export async function stopBackgroundFlashcardReview(clearState = true) {
  if (!isNativeAndroid()) return
  try {
    await NativeFlashcardSpeech.stopBackground({ clearState })
  } finally {
    nativeBackgroundActive = false
  }
}

export function nativeBackgroundFlashcardReviewIsActive() {
  return nativeBackgroundActive
}
