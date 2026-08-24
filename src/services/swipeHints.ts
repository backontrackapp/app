import type { SwipeHintOptions } from '@/types/swipeHint'

const SWIPE_HINT_STORAGE_KEY = 'backontrack-understood-swipe-hints'
export const SWIPE_HINT_CONFIRMED_EVENT = 'backontrack:swipe-hint-confirmed'
export const REVIEW_SET_CARD_SWIPE_HINT = {
  id: 'review-set-card-navigation',
  items: [
    { direction: 'up', label: 'Next card' },
    { direction: 'down', label: 'Previous card' },
    { direction: 'left', label: 'Flip card' },
    { direction: 'right', label: 'Flip card' },
  ],
  repeat: true,
} satisfies SwipeHintOptions

function normalizedId(id: string) {
  return id.trim()
}

function readConfirmedIds(storage?: Pick<Storage, 'getItem'>): string[] {
  if (!storage) return []
  try {
    const stored = JSON.parse(storage.getItem(SWIPE_HINT_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return [...new Set(stored.filter((id): id is string => (
      typeof id === 'string' && id.trim().length > 0
    )))]
  } catch {
    return []
  }
}

function browserStorage() {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

export function isSwipeHintConfirmed(
  id: string,
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
) {
  const hintId = normalizedId(id)
  return hintId.length > 0 && readConfirmedIds(storage).includes(hintId)
}

export function confirmSwipeHint(
  id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = browserStorage(),
) {
  const hintId = normalizedId(id)
  if (!hintId) return false

  const confirmedIds = readConfirmedIds(storage)
  if (!confirmedIds.includes(hintId)) {
    try {
      storage?.setItem(SWIPE_HINT_STORAGE_KEY, JSON.stringify([...confirmedIds, hintId]))
    } catch {
      // The active hint can still be dismissed when device storage is unavailable.
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>(SWIPE_HINT_CONFIRMED_EVENT, {
      detail: hintId,
    }))
  }
  return true
}
