import type {
  FlashcardReviewSetAccessRole,
  FlashcardReviewSetActionItem,
} from '@/types/domain'

export const FLASHCARD_REVIEW_SET_ACTIONS: Record<
  FlashcardReviewSetAccessRole,
  FlashcardReviewSetActionItem[]
> = {
  owner: [
    { action: 'review', title: 'Review', icon: 'mdi-play', color: 'secondary' },
    { action: 'edit', title: 'Edit', icon: 'mdi-pencil-outline', divider: true },
    { action: 'share', title: 'Share', icon: 'mdi-account-multiple-plus-outline' },
  ],
  readonly: [
    { action: 'review', title: 'Review', icon: 'mdi-play', color: 'secondary' },
    { action: 'settings', title: 'Review settings', icon: 'mdi-tune-variant', divider: true },
    { action: 'copy', title: 'Make a copy', icon: 'mdi-content-copy' },
    { action: 'leave', title: 'Leave shared set', icon: 'mdi-exit-to-app', color: 'error' },
  ],
  editor: [
    { action: 'review', title: 'Review', icon: 'mdi-play', color: 'secondary' },
    { action: 'settings', title: 'Review settings', icon: 'mdi-tune-variant', divider: true },
    { action: 'copy', title: 'Make a copy', icon: 'mdi-content-copy' },
    { action: 'leave', title: 'Leave shared set', icon: 'mdi-exit-to-app', color: 'error' },
  ],
}
