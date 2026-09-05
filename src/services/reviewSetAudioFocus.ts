import { Capacitor, registerPlugin } from '@capacitor/core'
import { ref } from 'vue'

interface NativeReviewSetAudioFocusPlugin {
  setActive(options: { active: boolean }): Promise<void>
  reapply(): Promise<void>
  isBluetoothAudioActive(): Promise<{ active: boolean }>
}

const NativeReviewSetAudioFocus = registerPlugin<NativeReviewSetAudioFocusPlugin>(
  'ReviewSetAudioFocus',
)

const REVIEW_SET_AUDIO_FOCUS_STORAGE_KEY = 'backontrack-flashcard-speech:audio-focus'
const activeScopes = new Set<string>()
let nativeIntervalOwnsAudioFocus = false
let nativeActive = false
let syncWork: Promise<void> = Promise.resolve()
export const reviewSetBluetoothAudioActive = ref(false)

function storedReviewSetAudioFocusIsEnabled() {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(REVIEW_SET_AUDIO_FOCUS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function storeReviewSetAudioFocus(enabled: boolean) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(REVIEW_SET_AUDIO_FOCUS_STORAGE_KEY, String(enabled))
  } catch {
    // Audio playback keeps the selected behavior for this session if storage is unavailable.
  }
}

export const reviewSetAudioFocusEnabled = ref(storedReviewSetAudioFocusIsEnabled())

function isNativePhone() {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'android' || platform === 'ios')
}

function queueNativeState() {
  if (!isNativePhone()) return Promise.resolve()
  const requestedActive = reviewSetAudioFocusEnabled.value && hasForegroundAudioFocusScope()
  if (requestedActive === nativeActive) return syncWork
  nativeActive = requestedActive
  syncWork = syncWork
    .catch(() => undefined)
    .then(() => NativeReviewSetAudioFocus.setActive({ active: requestedActive }))
    .catch(() => {
      nativeActive = !requestedActive
    })
  return syncWork
}

export function setReviewSetAudioFocus(scope: string, active: boolean) {
  if (active) activeScopes.add(scope)
  else activeScopes.delete(scope)
  return queueNativeState()
}

function hasForegroundAudioFocusScope() {
  // The Android timer advances even when the WebView is suspended. A second interval
  // lease here could outlive its step and prevent Android from restoring other media.
  return [...activeScopes].some(scope => (
    !nativeIntervalOwnsAudioFocus || !scope.startsWith('interval-review:')
  ))
}

export function setNativeIntervalAudioFocusOwnership(active: boolean) {
  nativeIntervalOwnsAudioFocus = active && Capacitor.getPlatform() === 'android'
  return queueNativeState()
}

export function reviewSetAudioFocusIsAvailable() {
  return isNativePhone()
}

export function reviewSetAudioFocusIsEnabled() {
  return reviewSetAudioFocusEnabled.value
}

export async function setReviewSetAudioFocusEnabled(enabled: boolean) {
  reviewSetAudioFocusEnabled.value = enabled
  storeReviewSetAudioFocus(enabled)
  await queueNativeState()
  return enabled
}

export function toggleReviewSetAudioFocus() {
  return setReviewSetAudioFocusEnabled(!reviewSetAudioFocusEnabled.value)
}

export async function reapplyReviewSetAudioFocus() {
  if (!isNativePhone() || !reviewSetAudioFocusEnabled.value || !hasForegroundAudioFocusScope()) return
  await syncWork.catch(() => undefined)
  if (!reviewSetAudioFocusEnabled.value || !hasForegroundAudioFocusScope()) return
  await NativeReviewSetAudioFocus.reapply().catch(() => undefined)
}

export async function updateReviewSetBluetoothAudioActive() {
  if (!isNativePhone()) {
    reviewSetBluetoothAudioActive.value = false
    return false
  }

  try {
    const { active } = await NativeReviewSetAudioFocus.isBluetoothAudioActive()
    reviewSetBluetoothAudioActive.value = active === true
  } catch {
    reviewSetBluetoothAudioActive.value = false
  }
  return reviewSetBluetoothAudioActive.value
}
