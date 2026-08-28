const GESTURE_DISTANCE = 10
const CLICK_WAIT_MS = 32
const LATE_CLICK_WINDOW_MS = 500
const DISABLED_CONTROL_WAIT_MS = 500
const RECOVERY_OPT_OUT_ATTRIBUTE = 'data-post-gesture-click-recovery'
const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

interface ActivePointer {
  id: number
  x: number
  y: number
  moved: boolean
  control?: HTMLElement
}

function controlCanRecover(control: HTMLElement) {
  return !control.matches(`[${RECOVERY_OPT_OUT_ATTRIBUTE}="off"]`)
}

function controlIsEnabled(control: HTMLElement) {
  return controlCanRecover(control)
    && !control.matches(':disabled, [aria-disabled="true"]')
}

function controlIsReady(control: HTMLElement) {
  return controlIsEnabled(control)
    && control.ownerDocument.defaultView?.getComputedStyle(control).pointerEvents !== 'none'
}

function controlAtCoordinates(
  ownerDocument: Document,
  surface: Element,
  x: number,
  y: number,
) {
  let closestControl: HTMLElement | undefined
  let closestArea = Number.POSITIVE_INFINITY

  for (const control of ownerDocument.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
    if (!surface.contains(control) || !controlCanRecover(control)) continue
    const bounds = control.getBoundingClientRect()
    if (
      bounds.width <= 0
      || bounds.height <= 0
      || x < bounds.left
      || x > bounds.right
      || y < bounds.top
      || y > bounds.bottom
    ) continue
    const style = ownerDocument.defaultView?.getComputedStyle(control)
    if (
      style?.display === 'none'
      || style?.visibility === 'hidden'
    ) continue
    const area = bounds.width * bounds.height
    if (area >= closestArea) continue
    closestControl = control
    closestArea = area
  }

  return closestControl
}

function recoverableControlFromEvent(event: Event) {
  const target = event.target
  if (!(target instanceof Element)) return
  let control = target.closest<HTMLElement>(CONTROL_SELECTOR)
  if (!control && event instanceof PointerEvent) {
    const hitTarget = typeof target.ownerDocument.elementFromPoint === 'function'
      ? target.ownerDocument.elementFromPoint(event.clientX, event.clientY)
      : null
    control = hitTarget?.closest<HTMLElement>(CONTROL_SELECTOR) ?? null
    control ||= controlAtCoordinates(
      target.ownerDocument,
      hitTarget ?? target,
      event.clientX,
      event.clientY,
    ) ?? null
  }
  if (!control || !controlCanRecover(control)) return
  return control
}

export function installPostGestureClickRecovery(
  root: Document = document,
) {
  const runtimeWindow = root.defaultView || window
  let activePointer: ActivePointer | undefined
  let recoveryArmed = false
  let pendingTarget: HTMLElement | undefined
  let pendingTimer: number | undefined
  let recoveredTarget: HTMLElement | undefined
  let recoveredTimer: number | undefined
  let dispatchingRecovery = false

  const clearRecoveredTarget = () => {
    recoveredTarget = undefined
    if (recoveredTimer !== undefined) runtimeWindow.clearTimeout(recoveredTimer)
    recoveredTimer = undefined
  }

  const clearPendingRecovery = () => {
    recoveryArmed = false
    pendingTarget = undefined
    if (pendingTimer !== undefined) runtimeWindow.clearTimeout(pendingTimer)
    pendingTimer = undefined
  }

  const armRecovery = () => {
    clearPendingRecovery()
    clearRecoveredTarget()
    recoveryArmed = true
  }

  const movedFarEnough = (pointer: ActivePointer, event: PointerEvent) => (
    Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= GESTURE_DISTANCE
  )

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return
    clearRecoveredTarget()
    const control = recoveryArmed ? recoverableControlFromEvent(event) : undefined
    activePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      control,
    }
    if (recoveryArmed && !control) clearPendingRecovery()
  }

  const onPointerMove = (event: PointerEvent) => {
    const pointer = activePointer
    if (!pointer || pointer.id !== event.pointerId || pointer.moved) return
    if (!movedFarEnough(pointer, event)) return
    pointer.moved = true
    pointer.control = undefined
    clearPendingRecovery()
  }

  const scheduleClickRecovery = (control: HTMLElement) => {
    pendingTarget = control
    const deadline = runtimeWindow.performance.now() + DISABLED_CONTROL_WAIT_MS
    const recoverClick = () => {
      pendingTimer = undefined
      if (pendingTarget !== control) return
      if (!control.isConnected || !controlCanRecover(control)) {
        clearPendingRecovery()
        return
      }
      if (!controlIsReady(control)) {
        if (runtimeWindow.performance.now() < deadline) {
          pendingTimer = runtimeWindow.setTimeout(recoverClick, CLICK_WAIT_MS)
        } else {
          clearPendingRecovery()
        }
        return
      }
      clearPendingRecovery()

      recoveredTarget = control
      recoveredTimer = runtimeWindow.setTimeout(clearRecoveredTarget, LATE_CLICK_WINDOW_MS)
      dispatchingRecovery = true
      try {
        control.click()
      } finally {
        dispatchingRecovery = false
      }
    }
    pendingTimer = runtimeWindow.setTimeout(recoverClick, CLICK_WAIT_MS)
  }

  const onPointerUp = (event: PointerEvent) => {
    const pointer = activePointer
    if (!pointer || pointer.id !== event.pointerId) return
    activePointer = undefined
    if (pointer.moved || movedFarEnough(pointer, event)) {
      armRecovery()
      return
    }
    if (recoveryArmed && pointer.control) {
      scheduleClickRecovery(pointer.control)
      return
    }
    clearPendingRecovery()
  }

  const onPointerCancel = (event: PointerEvent) => {
    const pointer = activePointer
    if (!pointer || pointer.id !== event.pointerId) return
    activePointer = undefined
    if (pointer.moved || movedFarEnough(pointer, event)) armRecovery()
    else clearPendingRecovery()
  }

  const onClick = (event: MouseEvent) => {
    const control = recoverableControlFromEvent(event)
    if (!control || dispatchingRecovery) return
    if (recoveredTarget === control && event.isTrusted) {
      clearRecoveredTarget()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (pendingTarget === control && event.isTrusted) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  root.addEventListener('pointerdown', onPointerDown, true)
  root.addEventListener('pointermove', onPointerMove, true)
  root.addEventListener('pointerup', onPointerUp, true)
  root.addEventListener('pointercancel', onPointerCancel, true)
  root.addEventListener('click', onClick, true)

  return () => {
    activePointer = undefined
    clearPendingRecovery()
    clearRecoveredTarget()
    root.removeEventListener('pointerdown', onPointerDown, true)
    root.removeEventListener('pointermove', onPointerMove, true)
    root.removeEventListener('pointerup', onPointerUp, true)
    root.removeEventListener('pointercancel', onPointerCancel, true)
    root.removeEventListener('click', onClick, true)
  }
}
