import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeReviewSetAudioFocusPlugin {
  setActive(options: { active: boolean }): Promise<void>
  reapply(): Promise<void>
}

const NativeReviewSetAudioFocus = registerPlugin<NativeReviewSetAudioFocusPlugin>(
  'ReviewSetAudioFocus',
)

const activeScopes = new Set<string>()
let nativeActive = false
let syncWork: Promise<void> = Promise.resolve()

function isNativePhone() {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'android' || platform === 'ios')
}

function queueNativeState() {
  if (!isNativePhone()) return Promise.resolve()
  const requestedActive = activeScopes.size > 0
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

export async function reapplyReviewSetAudioFocus() {
  if (!isNativePhone() || activeScopes.size === 0) return
  await syncWork.catch(() => undefined)
  if (activeScopes.size === 0) return
  await NativeReviewSetAudioFocus.reapply().catch(() => undefined)
}
