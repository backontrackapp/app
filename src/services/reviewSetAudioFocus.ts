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

const activeScopes = new Set<string>()
let nativeIntervalOwnsAudioFocus = false
let nativeActive = false
let syncWork: Promise<void> = Promise.resolve()
export const reviewSetBluetoothAudioActive = ref(false)

function isNativePhone() {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'android' || platform === 'ios')
}

function queueNativeState() {
  if (!isNativePhone()) return Promise.resolve()
  const requestedActive = hasForegroundAudioFocusScope()
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

export async function reapplyReviewSetAudioFocus() {
  if (!isNativePhone() || !hasForegroundAudioFocusScope()) return
  await syncWork.catch(() => undefined)
  if (!hasForegroundAudioFocusScope()) return
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
