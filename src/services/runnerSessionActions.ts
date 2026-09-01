import { FLASHCARD_REVIEW_SESSION_MENU_ITEMS } from '@/services/flashcards'
import type { FlashcardContextAction, RunnerSessionMenuItem } from '@/types/domain'

interface RunnerSessionMenuState {
  speechAvailable: boolean
  amplified: boolean
  busy: boolean
  preview: boolean
}

interface ReviewRunnerSessionMenuState extends RunnerSessionMenuState {
  finished: boolean
  canRestart: boolean
  canManageCard: boolean
  canAddCard: boolean
  canEjectCard: boolean
  canUndoEject: boolean
}

function reviewCardActionDisabled(
  action: FlashcardContextAction,
  state: ReviewRunnerSessionMenuState,
) {
  if (state.preview || state.finished || state.busy) return true
  if (action === 'add') return !state.canAddCard
  if (action === 'edit' || action === 'remove') return !state.canManageCard
  if (action === 'eject') return !state.canEjectCard
  if (action === 'undo_eject') return !state.canUndoEject
  return false
}

function amplificationItem(amplified: boolean, disabled: boolean): RunnerSessionMenuItem {
  return {
    action: 'amplification',
    title: amplified ? 'Disable TTS amplification' : 'Enable TTS amplification',
    icon: amplified ? 'mdi-volume-plus' : 'mdi-volume-high',
    active: amplified,
    disabled,
    toggle: true,
  }
}

export function intervalRunnerSessionMenuItems(
  state: RunnerSessionMenuState,
): RunnerSessionMenuItem[] {
  return [
    ...(state.speechAvailable ? [amplificationItem(state.amplified, state.busy)] : []),
    {
      action: 'settings' as const,
      title: 'Settings',
      icon: 'mdi-tune-variant',
      disabled: state.preview || state.busy,
      divider: state.speechAvailable,
    },
    {
      action: 'restart' as const,
      title: 'Restart interval',
      icon: 'mdi-restart',
      disabled: state.preview || state.busy,
    },
    {
      action: 'end' as const,
      title: 'End session',
      icon: 'mdi-stop-circle-outline',
      color: 'error',
      disabled: state.preview || state.busy,
    },
  ]
}

export function programRunnerSessionMenuItems(busy: boolean): RunnerSessionMenuItem[] {
  return [{
    action: 'end',
    title: 'End program',
    icon: 'mdi-stop-circle-outline',
    color: 'error',
    disabled: busy,
  }]
}

export function reviewRunnerSessionMenuItems(
  state: ReviewRunnerSessionMenuState,
): RunnerSessionMenuItem[] {
  const sessionUnavailable = state.preview || state.finished || state.busy
  const cardItems = FLASHCARD_REVIEW_SESSION_MENU_ITEMS
    .filter(item => item.action !== 'eject')
    .map(item => ({
      ...item,
      disabled: reviewCardActionDisabled(item.action, state),
    }))
  return [
    ...cardItems,
    ...(state.speechAvailable
      ? [{
          ...amplificationItem(state.amplified, state.finished || state.busy),
          divider: true,
        }]
      : []),
    {
      action: 'restart',
      title: 'Restart review',
      icon: 'mdi-restart',
      disabled: sessionUnavailable || !state.canRestart,
      divider: !state.speechAvailable,
    },
    {
      action: 'end',
      title: 'End review',
      icon: 'mdi-stop-circle-outline',
      color: 'error',
      disabled: sessionUnavailable,
    },
  ]
}
