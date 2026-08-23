import type { ObjectDirective } from 'vue'

export interface DateSwipeOptions {
  onPrevious: () => void
  onNext: () => void
  ignore?: string
  transitionTarget?: string
}

interface DateSwipeGesture {
  input: 'pointer' | 'touch'
  pointerId: number
  startX: number
  startY: number
}

interface DateSwipeState {
  element: HTMLElement
  options: DateSwipeOptions
  gesture?: DateSwipeGesture
  transitionAnimation?: Animation
  transitionFrame?: number
  suppressClick: boolean
  suppressClickTimer?: number
  onPointerDown: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
  onPointerCancel: (event: PointerEvent) => void
  onTouchStart: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
  onTouchCancel: (event: TouchEvent) => void
  onClick: (event: MouseEvent) => void
  onBlur: () => void
}

const states = new WeakMap<HTMLElement, DateSwipeState>()
const MIN_SWIPE_DISTANCE = 56
const SWIPE_AXIS_RATIO = 1.2
const CLICK_SUPPRESSION_MS = 350

function ignoredTarget(target: EventTarget | null, selector?: string) {
  return Boolean(selector && target instanceof Element && target.closest(selector))
}

function clearGesture(state: DateSwipeState) {
  state.gesture = undefined
}

function animateDateChange(state: DateSwipeState, direction: 'previous' | 'next') {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (state.transitionFrame !== undefined) window.cancelAnimationFrame(state.transitionFrame)
  state.transitionAnimation?.cancel()
  state.transitionFrame = window.requestAnimationFrame(() => {
    state.transitionFrame = undefined
    const target = state.options.transitionTarget
      ? state.element.querySelector<HTMLElement>(state.options.transitionTarget)
      : state.element
    if (!target?.animate) return
    state.transitionAnimation = target.animate([
      {
        opacity: 0.72,
        transform: `translate3d(${direction === 'next' ? '2rem' : '-2rem'}, 0, 0)`,
      },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ], {
      duration: 220,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
    })
    state.transitionAnimation.addEventListener('finish', () => {
      state.transitionAnimation = undefined
    }, { once: true })
  })
}

function touchWithId(touches: TouchList, id: number) {
  return Array.from(touches).find(touch => touch.identifier === id)
}

function finishSwipe(state: DateSwipeState, endX: number, endY: number) {
  const gesture = state.gesture
  if (!gesture) return
  clearGesture(state)
  if (document.body.classList.contains('long-press-drag-active')) return

  const horizontalDistance = endX - gesture.startX
  const verticalDistance = endY - gesture.startY
  const horizontalMagnitude = Math.abs(horizontalDistance)
  if (
    horizontalMagnitude < MIN_SWIPE_DISTANCE
    || horizontalMagnitude < Math.abs(verticalDistance) * SWIPE_AXIS_RATIO
  ) return

  state.suppressClick = true
  if (state.suppressClickTimer) window.clearTimeout(state.suppressClickTimer)
  state.suppressClickTimer = window.setTimeout(() => {
    state.suppressClick = false
    state.suppressClickTimer = undefined
  }, CLICK_SUPPRESSION_MS)

  const direction = horizontalDistance < 0 ? 'next' : 'previous'
  if (direction === 'next') state.options.onNext()
  else state.options.onPrevious()
  animateDateChange(state, direction)
}

function createState(element: HTMLElement, options: DateSwipeOptions): DateSwipeState {
  const state: DateSwipeState = {
    element,
    options,
    suppressClick: false,
    onPointerDown: () => undefined,
    onPointerUp: () => undefined,
    onPointerCancel: () => undefined,
    onTouchStart: () => undefined,
    onTouchEnd: () => undefined,
    onTouchCancel: () => undefined,
    onClick: () => undefined,
    onBlur: () => undefined,
  }

  state.onPointerDown = (event) => {
    if (
      state.gesture
      || !event.isPrimary
      || event.pointerType === 'touch'
      || (event.pointerType === 'mouse' && event.button !== 0)
      || ignoredTarget(event.target, state.options.ignore)
    ) return

    state.gesture = {
      input: 'pointer',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  state.onPointerUp = (event) => {
    const gesture = state.gesture
    if (!gesture || gesture.input !== 'pointer' || gesture.pointerId !== event.pointerId) return
    finishSwipe(state, event.clientX, event.clientY)
  }

  state.onPointerCancel = (event) => {
    if (
      state.gesture?.input === 'pointer'
      && state.gesture.pointerId === event.pointerId
    ) clearGesture(state)
  }

  state.onTouchStart = (event) => {
    if (
      state.gesture
      || event.touches.length !== 1
      || ignoredTarget(event.target, state.options.ignore)
    ) return
    const touch = event.changedTouches[0]
    if (!touch) return
    state.gesture = {
      input: 'touch',
      pointerId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
    }
  }

  state.onTouchEnd = (event) => {
    const gesture = state.gesture
    if (!gesture || gesture.input !== 'touch') return
    const touch = touchWithId(event.changedTouches, gesture.pointerId)
    if (touch) finishSwipe(state, touch.clientX, touch.clientY)
  }

  state.onTouchCancel = (event) => {
    const gesture = state.gesture
    if (
      gesture?.input === 'touch'
      && (
        event.changedTouches.length === 0
        || touchWithId(event.changedTouches, gesture.pointerId)
      )
    ) clearGesture(state)
  }

  state.onClick = (event) => {
    if (!state.suppressClick) return
    state.suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  state.onBlur = () => clearGesture(state)
  return state
}

function removeListeners(element: HTMLElement, state: DateSwipeState) {
  element.removeEventListener('pointerdown', state.onPointerDown, true)
  element.removeEventListener('touchstart', state.onTouchStart, true)
  element.removeEventListener('click', state.onClick, true)
  window.removeEventListener('pointerup', state.onPointerUp, true)
  window.removeEventListener('pointercancel', state.onPointerCancel, true)
  window.removeEventListener('touchend', state.onTouchEnd, true)
  window.removeEventListener('touchcancel', state.onTouchCancel, true)
  window.removeEventListener('blur', state.onBlur)
  if (state.transitionFrame !== undefined) window.cancelAnimationFrame(state.transitionFrame)
  state.transitionAnimation?.cancel()
  if (state.suppressClickTimer) window.clearTimeout(state.suppressClickTimer)
}

export const dateSwipe: ObjectDirective<HTMLElement, DateSwipeOptions> = {
  mounted(element, binding) {
    const state = createState(element, binding.value)
    states.set(element, state)
    element.addEventListener('pointerdown', state.onPointerDown, { capture: true, passive: true })
    element.addEventListener('touchstart', state.onTouchStart, { capture: true, passive: true })
    element.addEventListener('click', state.onClick, true)
    window.addEventListener('pointerup', state.onPointerUp, true)
    window.addEventListener('pointercancel', state.onPointerCancel, true)
    window.addEventListener('touchend', state.onTouchEnd, true)
    window.addEventListener('touchcancel', state.onTouchCancel, true)
    window.addEventListener('blur', state.onBlur)
  },
  updated(element, binding) {
    const state = states.get(element)
    if (state) state.options = binding.value
  },
  beforeUnmount(element) {
    const state = states.get(element)
    if (!state) return
    removeListeners(element, state)
    states.delete(element)
  },
}
