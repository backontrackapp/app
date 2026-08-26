import type { ObjectDirective } from 'vue'
import {
  isSwipeHintConfirmed,
  SWIPE_HINT_CONFIRMED_EVENT,
} from '@/services/swipeHints'
import type {
  SwipeHintDirection,
  SwipeHintItem,
  SwipeHintOptions,
} from '@/types/swipeHint'
import '@/styles/swipeHint.scss'

interface NormalizedSwipeHintOptions {
  id: string
  items: SwipeHintItem[]
  repeat: boolean
}

interface SwipeHintState {
  element: HTMLElement
  options: NormalizedSwipeHintOptions
  signature: string
  overlay?: HTMLElement
  hand?: HTMLElement
  label?: HTMLElement
  timer?: number
  addedHostPosition: boolean
  onConfirmed: (event: Event) => void
  onStorage: () => void
}

const ITEM_DURATION_MS = 1500
const SEQUENCE_PAUSE_MS = 600
const EXIT_DURATION_MS = 200
const directions = new Set<SwipeHintDirection>(['up', 'right', 'down', 'left'])
const states = new WeakMap<HTMLElement, SwipeHintState>()

function normalizeOptions(options: SwipeHintOptions): NormalizedSwipeHintOptions {
  const items = Array.isArray(options?.items)
    ? options.items.flatMap((item) => {
        if (
          !item
          || !directions.has(item.direction)
          || typeof item.label !== 'string'
          || !item.label.trim()
        ) return []
        return [{ direction: item.direction, label: item.label.trim() }]
      })
    : []

  return {
    id: typeof options?.id === 'string' ? options.id.trim() : '',
    items,
    repeat: options?.repeat === true,
  }
}

function optionsSignature(options: NormalizedSwipeHintOptions) {
  return JSON.stringify(options)
}

function accessibleLabel(items: SwipeHintItem[]) {
  return items
    .map(item => `Swipe ${item.direction}: ${item.label}.`)
    .join(' ')
}

function clearTimer(state: SwipeHintState) {
  if (state.timer === undefined) return
  window.clearTimeout(state.timer)
  state.timer = undefined
}

function removeOverlay(state: SwipeHintState) {
  clearTimer(state)
  state.overlay?.remove()
  state.overlay = undefined
  state.hand = undefined
  state.label = undefined
  if (state.addedHostPosition) {
    state.element.classList.remove('swipe-hint-host--positioned')
    state.addedHostPosition = false
  }
}

function finishSequence(state: SwipeHintState) {
  if (!state.overlay) return
  if (state.options.repeat) {
    state.overlay.classList.add('swipe-hint--between-sequences')
    state.timer = window.setTimeout(() => {
      state.timer = undefined
      state.overlay?.classList.remove('swipe-hint--between-sequences')
      showItem(state, 0)
    }, SEQUENCE_PAUSE_MS)
    return
  }

  state.overlay.classList.add('swipe-hint--leaving')
  state.timer = window.setTimeout(() => removeOverlay(state), EXIT_DURATION_MS)
}

function showItem(state: SwipeHintState, index: number) {
  const item = state.options.items[index]
  if (!item || !state.hand || !state.label) {
    finishSequence(state)
    return
  }

  state.hand.className = 'swipe-hint__hand'
  // Reflow restarts the cue when consecutive items use the same direction.
  void state.hand.offsetWidth
  state.hand.className = [
    'swipe-hint__hand',
    'mdi',
    `mdi-gesture-swipe-${item.direction}`,
    `swipe-hint__hand--${item.direction}`,
  ].join(' ')
  state.label.textContent = item.label

  state.timer = window.setTimeout(() => {
    state.timer = undefined
    showItem(state, index + 1)
  }, ITEM_DURATION_MS)
}

function start(state: SwipeHintState) {
  removeOverlay(state)
  if (
    !state.options.id
    || state.options.items.length === 0
    || isSwipeHintConfirmed(state.options.id)
  ) return

  if (window.getComputedStyle(state.element).position === 'static') {
    state.element.classList.add('swipe-hint-host--positioned')
    state.addedHostPosition = true
  }

  const overlay = document.createElement('div')
  overlay.className = 'swipe-hint'
  overlay.setAttribute('role', 'status')
  overlay.setAttribute('aria-live', 'polite')
  overlay.setAttribute('aria-atomic', 'true')
  overlay.setAttribute('aria-label', accessibleLabel(state.options.items))

  const cue = document.createElement('div')
  cue.className = 'swipe-hint__cue'

  const hand = document.createElement('i')
  hand.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = 'swipe-hint__label'
  label.setAttribute('aria-hidden', 'true')

  cue.append(hand, label)
  overlay.append(cue)
  state.element.append(overlay)
  state.overlay = overlay
  state.hand = hand
  state.label = label
  showItem(state, 0)
}

function createState(element: HTMLElement, options: SwipeHintOptions): SwipeHintState {
  const normalized = normalizeOptions(options)
  const state: SwipeHintState = {
    element,
    options: normalized,
    signature: optionsSignature(normalized),
    addedHostPosition: false,
    onConfirmed: () => undefined,
    onStorage: () => undefined,
  }

  state.onConfirmed = (event) => {
    if (
      event instanceof CustomEvent
      && event.detail === state.options.id
    ) removeOverlay(state)
  }
  state.onStorage = () => {
    if (isSwipeHintConfirmed(state.options.id)) removeOverlay(state)
  }
  return state
}

export const swipeHint: ObjectDirective<HTMLElement, SwipeHintOptions> = {
  mounted(element, binding) {
    const state = createState(element, binding.value)
    states.set(element, state)
    window.addEventListener(SWIPE_HINT_CONFIRMED_EVENT, state.onConfirmed)
    window.addEventListener('storage', state.onStorage)
    start(state)
  },
  updated(element, binding) {
    const state = states.get(element)
    if (!state) return
    const options = normalizeOptions(binding.value)
    const signature = optionsSignature(options)
    if (signature === state.signature) return
    state.options = options
    state.signature = signature
    start(state)
  },
  beforeUnmount(element) {
    const state = states.get(element)
    if (!state) return
    removeOverlay(state)
    window.removeEventListener(SWIPE_HINT_CONFIRMED_EVENT, state.onConfirmed)
    window.removeEventListener('storage', state.onStorage)
    states.delete(element)
  },
}
