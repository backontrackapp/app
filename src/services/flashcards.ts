import type {
  Flashcard,
  FlashcardBulkAction,
  FlashcardBulkSwapColumn,
  FlashcardReviewQueueCard,
  FlashcardReviewSession,
  FlashcardReviewSet,
  FlashcardReviewCardSides,
  FlashcardReviewFaceValue,
  FlashcardReviewEjectBehavior,
  FlashcardReviewSettings,
  FlashcardReviewSide,
  FlashcardReviewSort,
  FlashcardSelectionAction,
  FlashcardSettingsApplyTarget,
  FlashcardTag,
  IntervalFlashcardReviewSnapshot,
} from '@/types/domain'

export const MIN_FLASHCARD_SESSION_CARDS = 1
export const MAX_FLASHCARD_SESSION_CARDS = 100
export const DEFAULT_FLASHCARD_SESSION_CARDS = 12
export const DEFAULT_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS = 60 * 60
export const MIN_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS = 60
export const MAX_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS = 23 * 3600 + 59 * 60
export const MIN_FLASHCARD_FACE_DURATION_SECONDS = 1
export const MAX_FLASHCARD_FACE_DURATION_SECONDS = 10
export const MIN_FLASHCARD_BACK_SPEECH_REPEATS = 1
export const MAX_FLASHCARD_BACK_SPEECH_REPEATS = 5
export const DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS = 1
export const MIN_FLASHCARD_BACK_SPEECH_RATE = 0.25
export const MAX_FLASHCARD_BACK_SPEECH_RATE = 1
export const DEFAULT_FLASHCARD_BACK_SPEECH_RATE = 1
export const DEFAULT_FLASHCARD_REVIEW_CARD_SIDES: FlashcardReviewCardSides = 'both'
export const DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY: FlashcardReviewFaceValue = 'front'
export const DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY: FlashcardReviewFaceValue = 'back'
export const MIN_FLASHCARD_EJECT_EXCLUDE_AFTER = 1
export const MAX_FLASHCARD_EJECT_EXCLUDE_AFTER = 20
export const DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER = 3

export const INTERVAL_FLASHCARD_QUICK_TAGS = [
  { name: 'easy', color: 'success' },
  { name: 'hard', color: 'error' },
] as const

export function flashcardTagToggleUpdate(
  currentTagIds: readonly string[],
  selectedTag: FlashcardTag,
  availableTags: readonly FlashcardTag[],
): { action: 'add_tags' | 'remove_tags' | 'set_tags'; values: string[] } {
  if (currentTagIds.includes(selectedTag.id)) {
    return { action: 'remove_tags', values: [selectedTag.id] }
  }

  const quickTagNames = new Set(
    INTERVAL_FLASHCARD_QUICK_TAGS.map(tag => tag.name.toLocaleLowerCase()),
  )
  if (!quickTagNames.has(selectedTag.name.toLocaleLowerCase())) {
    return { action: 'add_tags', values: [selectedTag.id] }
  }

  const quickTagIds = new Set(availableTags
    .filter(tag => quickTagNames.has(tag.name.toLocaleLowerCase()))
    .map(tag => tag.id))
  return {
    action: 'set_tags',
    values: [
      ...currentTagIds.filter(tagId => !quickTagIds.has(tagId)),
      selectedTag.id,
    ],
  }
}

export const FLASHCARD_REVIEW_CARD_SIDE_OPTIONS: Array<{
  title: string
  value: FlashcardReviewCardSides
  icon: string
  hint: string
}> = [
  {
    title: 'Both',
    value: 'both',
    icon: 'mdi-card-multiple-outline',
    hint: 'Show the front first, then the back.',
  },
  {
    title: 'Front',
    value: 'front',
    icon: 'mdi-card-outline',
    hint: 'Show only the front of each card.',
  },
  {
    title: 'Back',
    value: 'back',
    icon: 'mdi-card-text-outline',
    hint: 'Show only the back of each card.',
  },
]

export const FLASHCARD_REVIEW_FACE_VALUE_OPTIONS: Array<{
  title: string
  value: FlashcardReviewFaceValue
  icon: string
}> = [
  { title: 'Front', value: 'front', icon: 'mdi-card-outline' },
  { title: 'Back', value: 'back', icon: 'mdi-card-text-outline' },
  { title: 'Transliteration', value: 'transliteration', icon: 'mdi-format-letter-matches' },
  { title: 'Note', value: 'note', icon: 'mdi-note-text-outline' },
  { title: 'Image', value: 'image', icon: 'mdi-image-outline' },
  { title: 'Empty', value: 'empty', icon: 'mdi-card-off-outline' },
]

export function normalizeFlashcardReviewFaceValue(
  value: unknown,
  fallback: FlashcardReviewFaceValue,
): FlashcardReviewFaceValue {
  return FLASHCARD_REVIEW_FACE_VALUE_OPTIONS.some(option => option.value === value)
    ? value as FlashcardReviewFaceValue
    : fallback
}

export function flashcardReviewFaceValue(
  settings: Pick<FlashcardReviewSettings, 'frontDisplay' | 'backDisplay'>,
  side: FlashcardReviewSide,
) {
  return side === 'front'
    ? normalizeFlashcardReviewFaceValue(settings.frontDisplay, DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY)
    : normalizeFlashcardReviewFaceValue(settings.backDisplay, DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY)
}

export function flashcardReviewFaceTitle(value: FlashcardReviewFaceValue) {
  return FLASHCARD_REVIEW_FACE_VALUE_OPTIONS.find(option => option.value === value)?.title || value
}

export function flashcardReviewFaceCanSpeak(value: FlashcardReviewFaceValue) {
  return value !== 'image' && value !== 'empty'
}

export function flashcardReviewFaceText(
  card: Pick<FlashcardReviewQueueCard, 'front' | 'back' | 'transliteration' | 'note'>,
  value: FlashcardReviewFaceValue,
) {
  if (value === 'front') return card.front
  if (value === 'back') return card.back
  if (value === 'transliteration') return card.transliteration || ''
  if (value === 'note') return card.note || ''
  return ''
}

export function flashcardReviewFaceSpeech(
  card: Pick<FlashcardReviewQueueCard, 'front' | 'back' | 'ttsFront' | 'ttsBack' | 'transliteration' | 'note' | 'frontAudio' | 'backAudio'>,
  value: FlashcardReviewFaceValue,
) {
  if (value === 'front') {
    return { text: card.ttsFront?.trim() || card.front, audio: card.frontAudio || '' }
  }
  if (value === 'back') {
    return { text: card.ttsBack?.trim() || card.back, audio: card.backAudio || '' }
  }
  return { text: flashcardReviewFaceText(card, value), audio: '' }
}

export function flashcardReviewSpeechFaceValue(
  side: FlashcardReviewSide,
  displayedValue: FlashcardReviewFaceValue,
) {
  // Transliteration is a reading aid for the Back value; retain the Back
  // pronunciation, speech override, and recording when it is displayed.
  return side === 'back' && displayedValue === 'transliteration'
    ? 'back'
    : displayedValue
}

export const FLASHCARD_REVIEW_SESSION_MENU_ITEMS = [
  { action: 'add', title: 'Add card', icon: 'mdi-card-plus-outline', permission: 'add' },
  { action: 'edit', title: 'Edit card', icon: 'mdi-pencil-outline', permission: 'manage' },
  {
    action: 'eject',
    title: 'Eject card',
    icon: 'mdi-eject-outline',
    color: 'warning',
    permission: 'eject',
  },
  {
    action: 'undo_eject',
    title: 'Undo last eject',
    icon: 'mdi-undo-variant',
    permission: 'undo_eject',
  },
  {
    action: 'remove',
    title: 'Remove card',
    icon: 'mdi-delete-outline',
    color: 'error',
    permission: 'manage',
  },
  {
    action: 'settings',
    title: 'Settings',
    icon: 'mdi-tune-variant',
    divider: true,
  },
] as const

export function flashcardReviewSessionMenuItems(options: {
  showUndoEject: boolean
  showTtsToggle: boolean
  ttsPaused: boolean
}) {
  const settingsItem = FLASHCARD_REVIEW_SESSION_MENU_ITEMS.find(item => item.action === 'settings')!
  const cardItems = FLASHCARD_REVIEW_SESSION_MENU_ITEMS.filter(item => (
    item.action !== 'settings'
    && (item.action !== 'undo_eject' || options.showUndoEject)
  ))

  return [
    ...cardItems,
    ...(options.showTtsToggle ? [{
      action: 'toggle_tts' as const,
      title: options.ttsPaused ? 'Resume' : 'Pause',
      icon: options.ttsPaused ? 'mdi-play-circle-outline' : 'mdi-pause-circle-outline',
      divider: true,
    }] : []),
    {
      ...settingsItem,
      divider: !options.showTtsToggle,
    },
  ]
}

export const FLASHCARD_SETTINGS_APPLY_MENU_ITEMS: Array<{
  target: FlashcardSettingsApplyTarget
  title: string
  icon: string
}> = [
  { target: 'session', title: 'Current session', icon: 'mdi-timer-outline' },
  { target: 'review-set', title: 'Review set', icon: 'mdi-cards-outline' },
  { target: 'both', title: 'Both', icon: 'mdi-check-all' },
]

export const FLASHCARD_REVIEW_SELECTION_MENU_ITEMS = [
  {
    action: 'exclude',
    title: 'Exclude',
    icon: 'mdi-minus-circle-outline',
    color: 'warning',
  },
  {
    action: 'include',
    title: 'Include',
    icon: 'mdi-check-circle-outline',
    color: 'success',
  },
] as const

export function flashcardEjectLoadsNext(behavior: FlashcardReviewEjectBehavior) {
  return behavior === 'replace' || behavior === 'replace_exclude'
}

export function flashcardEjectExcludes(behavior: FlashcardReviewEjectBehavior) {
  return behavior === 'exclude' || behavior === 'replace_exclude'
}

export function flashcardEjectBehavior(
  loadNext: boolean,
  exclude: boolean,
): FlashcardReviewEjectBehavior {
  if (loadNext && exclude) return 'replace_exclude'
  if (loadNext) return 'replace'
  if (exclude) return 'exclude'
  return 'remove'
}

export function normalizeFlashcardEjectExcludeAfter(value: unknown) {
  const count = Number(value)
  if (!Number.isInteger(count)) return DEFAULT_FLASHCARD_EJECT_EXCLUDE_AFTER
  return Math.min(
    MAX_FLASHCARD_EJECT_EXCLUDE_AFTER,
    Math.max(MIN_FLASHCARD_EJECT_EXCLUDE_AFTER, count),
  )
}

export function flashcardEjectReachesExclusionThreshold(
  ejectCount: number,
  ejectExcludeAfter: number,
) {
  return ejectCount >= normalizeFlashcardEjectExcludeAfter(ejectExcludeAfter)
}

export function flashcardWasEjectedToday(card: Pick<Flashcard, 'lastEjectedAt'>, now = new Date()) {
  if (!card.lastEjectedAt) return false
  const ejectedAt = new Date(card.lastEjectedAt)
  if (Number.isNaN(ejectedAt.getTime())) return false
  return ejectedAt.getFullYear() === now.getFullYear()
    && ejectedAt.getMonth() === now.getMonth()
    && ejectedAt.getDate() === now.getDate()
}

export function updateFlashcardReviewExclusions(
  excludedCards: readonly string[],
  action: FlashcardSelectionAction,
  cardIds: readonly string[],
) {
  const exclusions = new Set(excludedCards)
  cardIds.forEach(id => action === 'exclude' ? exclusions.add(id) : exclusions.delete(id))
  return [...exclusions]
}

export function flashcardReviewSettingsSignature(settings: FlashcardReviewSettings) {
  return JSON.stringify({
    mode: settings.mode,
    cardSides: DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    invertFaces: false,
    frontDisplay: normalizeFlashcardReviewFaceValue(
      settings.frontDisplay,
      DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
    ),
    indefinite: settings.indefinite,
    timeLimitSeconds: settings.mode === 'passive' ? settings.timeLimitSeconds || 0 : 0,
    maxCards: settings.maxCards,
    ejectBehavior: settings.ejectBehavior || 'remove',
    ejectExcludeAfter: normalizeFlashcardEjectExcludeAfter(settings.ejectExcludeAfter),
    frontSeconds: settings.frontSeconds,
    backSeconds: settings.backSeconds,
    backSpeechRepeatCount: settings.backSpeechRepeatCount,
    backDisplay: normalizeFlashcardReviewFaceValue(
      settings.backDisplay,
      DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
    ),
    speechEnabled: settings.speechEnabled,
    backSpeechRate: normalizeFlashcardBackSpeechRate(settings.backSpeechRate),
    frontLanguage: settings.frontLanguage,
    backLanguage: settings.backLanguage,
    sortMode: settings.sortMode,
    sortDirection: settings.sortDirection,
  })
}

export function flashcardReviewSettingsAreValid(
  settings: FlashcardReviewSettings,
  minCards = MIN_FLASHCARD_SESSION_CARDS,
) {
  return Number.isInteger(settings.maxCards)
    && settings.maxCards >= minCards
    && settings.maxCards <= MAX_FLASHCARD_SESSION_CARDS
    && Number.isInteger(settings.ejectExcludeAfter)
    && settings.ejectExcludeAfter >= MIN_FLASHCARD_EJECT_EXCLUDE_AFTER
    && settings.ejectExcludeAfter <= MAX_FLASHCARD_EJECT_EXCLUDE_AFTER
    && Number.isInteger(settings.frontSeconds)
    && settings.frontSeconds >= MIN_FLASHCARD_FACE_DURATION_SECONDS
    && settings.frontSeconds <= MAX_FLASHCARD_FACE_DURATION_SECONDS
    && Number.isInteger(settings.backSeconds)
    && settings.backSeconds >= MIN_FLASHCARD_FACE_DURATION_SECONDS
    && settings.backSeconds <= MAX_FLASHCARD_FACE_DURATION_SECONDS
    && Number.isInteger(settings.backSpeechRepeatCount)
    && settings.backSpeechRepeatCount >= MIN_FLASHCARD_BACK_SPEECH_REPEATS
    && settings.backSpeechRepeatCount <= MAX_FLASHCARD_BACK_SPEECH_REPEATS
    && settings.backSpeechRate >= MIN_FLASHCARD_BACK_SPEECH_RATE
    && settings.backSpeechRate <= MAX_FLASHCARD_BACK_SPEECH_RATE
    && normalizeFlashcardBackSpeechRate(settings.backSpeechRate) === settings.backSpeechRate
    && Number.isInteger(settings.timeLimitSeconds || 0)
    && (settings.timeLimitSeconds || 0) >= 0
    && (settings.timeLimitSeconds || 0) <= MAX_FLASHCARD_REVIEW_TIME_LIMIT_SECONDS
    && (settings.timeLimitSeconds || 0) % 60 === 0
    && (!settings.speechEnabled || Boolean(
      (!flashcardReviewFaceCanSpeak(flashcardReviewFaceValue(settings, 'front'))
        || settings.frontLanguage)
      && (!flashcardReviewFaceCanSpeak(flashcardReviewFaceValue(settings, 'back'))
        || settings.backLanguage),
    ))
}

export const FLASHCARD_BULK_MENU_ITEMS = [
  {
    action: 'inject_into_review_set',
    title: 'Assign to Review set',
    icon: 'mdi-playlist-plus',
  },
  { action: 'swap_columns', title: 'Swap column content', icon: 'mdi-swap-horizontal' },
  { action: 'add_tags', title: 'Add tags', icon: 'mdi-tag-plus-outline', divider: true },
  { action: 'set_tags', title: 'Set tags', icon: 'mdi-tag-check-outline' },
  { action: 'remove_tags', title: 'Remove tags', icon: 'mdi-tag-minus-outline', requiresTags: true },
  { action: 'clear_tags', title: 'Clear tags', icon: 'mdi-tag-off-outline', requiresTags: true },
  {
    action: 'export_clipboard',
    title: 'Export cards to clipboard',
    icon: 'mdi-clipboard-arrow-up-outline',
    divider: true,
  },
  { action: 'remove_from_review_set', title: 'Remove cards from set', icon: 'mdi-playlist-remove', divider: true },
  { action: 'delete', title: 'Delete cards', icon: 'mdi-delete-outline', color: 'error' },
] as const satisfies ReadonlyArray<{
  action: FlashcardBulkAction
  title: string
  icon: string
  requiresTags?: boolean
  color?: 'error'
  divider?: boolean
}>

export const FLASHCARD_BULK_SWAP_COLUMN_OPTIONS: ReadonlyArray<{
  title: string
  value: FlashcardBulkSwapColumn
}> = [
  { title: 'Front', value: 'front' },
  { title: 'Back', value: 'back' },
  { title: 'Transliteration', value: 'transliteration' },
  { title: 'Note', value: 'note' },
]

const FLASHCARD_BULK_SWAP_COLUMN_RULES: Record<FlashcardBulkSwapColumn, {
  required: boolean
  maxLength: number
}> = {
  front: { required: true, maxLength: 5000 },
  back: { required: true, maxLength: 5000 },
  transliteration: { required: false, maxLength: 5000 },
  note: { required: false, maxLength: 2000 },
}

function flashcardBulkColumnLabel(column: FlashcardBulkSwapColumn) {
  return FLASHCARD_BULK_SWAP_COLUMN_OPTIONS.find(option => option.value === column)?.title
    || column
}

function flashcardBulkColumnValue(card: Flashcard, column: FlashcardBulkSwapColumn) {
  return card[column] || ''
}

export function flashcardSwapColumnsError(
  cards: readonly Flashcard[],
  columns: readonly FlashcardBulkSwapColumn[],
) {
  const [firstColumn, secondColumn] = columns
  if (!firstColumn || !secondColumn || firstColumn === secondColumn) {
    return 'Choose two different columns.'
  }
  for (const [target, source] of [
    [firstColumn, secondColumn],
    [secondColumn, firstColumn],
  ] as const) {
    const rules = FLASHCARD_BULK_SWAP_COLUMN_RULES[target]
    const invalidRequired = cards.some(card => !flashcardBulkColumnValue(card, source).trim())
    if (rules.required && invalidRequired) {
      return `Every selected card needs ${flashcardBulkColumnLabel(source).toLocaleLowerCase()} content because it will become the ${flashcardBulkColumnLabel(target).toLocaleLowerCase()}.`
    }
    const tooLong = cards.some(card => (
      [...flashcardBulkColumnValue(card, source)].length > rules.maxLength
    ))
    if (tooLong) {
      return `${flashcardBulkColumnLabel(source)} content must be ${rules.maxLength.toLocaleString()} characters or fewer to become the ${flashcardBulkColumnLabel(target).toLocaleLowerCase()}.`
    }
  }
  return ''
}

export function swapFlashcardColumns(
  card: Flashcard,
  columns: readonly [FlashcardBulkSwapColumn, FlashcardBulkSwapColumn],
) {
  const [firstColumn, secondColumn] = columns
  const firstValue = flashcardBulkColumnValue(card, firstColumn)
  card[firstColumn] = flashcardBulkColumnValue(card, secondColumn)
  card[secondColumn] = firstValue
  return card
}

const MIN_FLASHCARD_SWIPE_DISTANCE = 56
const FLASHCARD_SWIPE_AXIS_RATIO = 1.2

export const FLASHCARD_REVIEW_SORT_OPTIONS: Array<{
  title: string
  value: FlashcardReviewSort
  subtitle: string
}> = [
  { title: 'Most difficult', value: 'difficult', subtitle: 'Hard-tagged cards, then highest error rates' },
  { title: 'Easiest', value: 'easiest', subtitle: 'Easy-tagged cards, then lowest error rates' },
  { title: 'Never reviewed first', value: 'never_reviewed', subtitle: 'Start with cards you have not seen yet' },
  { title: 'Least recently reviewed', value: 'least_recent', subtitle: 'Return to the cards waiting longest' },
  { title: 'Recently added', value: 'recently_added', subtitle: 'Newest cards first' },
  { title: 'Random', value: 'random', subtitle: 'Shuffle once when the review starts' },
]

export function flashcardSideFromSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
): FlashcardReviewSide | undefined {
  const direction = flashcardSwipeDirection(start, end)
  if (direction !== 'left' && direction !== 'right') return undefined
  return direction === 'left' ? 'back' : 'front'
}

export function flashcardSwipeDirection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): 'left' | 'right' | 'up' | 'down' | undefined {
  const horizontalDistance = end.x - start.x
  const verticalDistance = end.y - start.y
  const horizontalMagnitude = Math.abs(horizontalDistance)
  const verticalMagnitude = Math.abs(verticalDistance)

  if (
    horizontalMagnitude >= MIN_FLASHCARD_SWIPE_DISTANCE
    && horizontalMagnitude >= verticalMagnitude * FLASHCARD_SWIPE_AXIS_RATIO
  ) return horizontalDistance < 0 ? 'left' : 'right'

  if (
    verticalMagnitude >= MIN_FLASHCARD_SWIPE_DISTANCE
    && verticalMagnitude >= horizontalMagnitude * FLASHCARD_SWIPE_AXIS_RATIO
  ) return verticalDistance < 0 ? 'up' : 'down'

  return undefined
}

export function flashcardReviewActionFromSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
): {
  action: 'previous' | 'next' | FlashcardReviewSide
  transition: 'previous' | 'next' | FlashcardReviewSide
} | undefined {
  const direction = flashcardSwipeDirection(start, end)
  if (direction === 'left') return { action: 'back', transition: 'next' }
  if (direction === 'right') return { action: 'front', transition: 'previous' }
  if (direction === 'up') return { action: 'next', transition: 'back' }
  if (direction === 'down') return { action: 'previous', transition: 'front' }
  return undefined
}

export function flashcardTextFontSize(
  value: string,
  role: 'face' | 'note' = 'face',
  density: 'full' | 'compact' = 'full',
) {
  const length = [...value.trim().replace(/\s+/g, ' ')].length
  const settings = role === 'note'
    ? density === 'compact'
      ? { maximum: .9, minimum: .68, startsShrinkingAt: 24, reachesMinimumAt: 360 }
      : { maximum: 1.25, minimum: .72, startsShrinkingAt: 24, reachesMinimumAt: 420 }
    : density === 'compact'
      ? { maximum: 2, minimum: 1, startsShrinkingAt: 8, reachesMinimumAt: 240 }
      : { maximum: 3.6, minimum: 1.1, startsShrinkingAt: 8, reachesMinimumAt: 280 }
  const range = settings.reachesMinimumAt - settings.startsShrinkingAt
  const progress = Math.max(0, Math.min(1, (length - settings.startsShrinkingAt) / range))
  const size = settings.maximum - (settings.maximum - settings.minimum) * Math.sqrt(progress)
  return `${Number(size.toFixed(3))}rem`
}

export function flashcardDifficulty(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? card.errorCount / attempts : undefined
}

export function flashcardAccuracy(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? Math.round(card.successCount / attempts * 100) : undefined
}

export function sessionAccuracy(
  session: Pick<FlashcardReviewSession, 'successCount' | 'errorCount'>,
) {
  const attempts = session.successCount + session.errorCount
  return attempts ? Math.round(session.successCount / attempts * 100) : undefined
}

export function cardMatchesTags(card: Pick<Flashcard, 'tags' | 'archived'>, selectedTags: string[]) {
  return card.archived !== true
    && (!selectedTags.length || card.tags.some(tag => selectedTags.includes(tag)))
}

export function cardMatchesReviewSet(
  card: Pick<Flashcard, 'id' | 'archived'>,
  reviewSet: Pick<FlashcardReviewSet, 'assignedCards'>,
) {
  return card.archived !== true && (reviewSet.assignedCards || []).includes(card.id)
}

export function cardMatchesSearch(
  card: Pick<Flashcard, 'front' | 'back' | 'transliteration' | 'note'>,
  tagNames: readonly string[],
  query: string,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const searchableText = [card.front, card.back, card.transliteration || '', card.note, ...tagNames]
    .join('\n')
    .toLocaleLowerCase()
  return terms.every(term => searchableText.includes(term))
}

export function formatReviewDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (!minutes) return `${remainder}s`
  if (!remainder) return `${minutes}m`
  return `${minutes}m ${remainder}s`
}

export function reviewSortTitle(value: FlashcardReviewSort) {
  return FLASHCARD_REVIEW_SORT_OPTIONS.find(option => option.value === value)?.title || value
}

export function reviewSetCardCount(
  reviewSet: Pick<FlashcardReviewSet, 'matchingCardCount' | 'maxCards'>,
) {
  return Math.min(reviewSet.matchingCardCount, reviewSet.maxCards)
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function flashcardHasNamedTag(card: Flashcard, name: string) {
  const normalizedName = name.toLocaleLowerCase()
  return card.tags.some(tag => tag.toLocaleLowerCase() === normalizedName)
    || (card.tagDetails || []).some(tag => tag.name.toLocaleLowerCase() === normalizedName)
}

export function sortFlashcardsForReview(
  cards: Flashcard[],
  sortMode: FlashcardReviewSort,
  sortDirection: FlashcardReviewSettings['sortDirection'] = 'asc',
  random = Math.random,
) {
  const sorted = [...cards]
  if (sortMode === 'random') {
    for (let index = sorted.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1))
      const current = sorted[index]
      const replacement = sorted[target]
      if (current && replacement) [sorted[index], sorted[target]] = [replacement, current]
    }
    return sortDirection === 'desc' ? sorted.reverse() : sorted
  }

  sorted.sort((left, right) => {
    if (sortMode === 'recently_added') {
      return compareText(right.createdAt, left.createdAt) || compareText(left.id, right.id)
    }
    if (sortMode === 'least_recent') {
      if (Boolean(left.lastReviewedAt) !== Boolean(right.lastReviewedAt)) {
        return left.lastReviewedAt ? 1 : -1
      }
      return compareText(left.lastReviewedAt || '', right.lastReviewedAt || '')
        || compareText(right.createdAt, left.createdAt)
    }
    if (sortMode === 'never_reviewed') {
      if (Boolean(left.lastReviewedAt) !== Boolean(right.lastReviewedAt)) {
        return left.lastReviewedAt ? 1 : -1
      }
      return !left.lastReviewedAt
          ? compareText(right.createdAt, left.createdAt)
          : compareText(left.lastReviewedAt, right.lastReviewedAt || '')
    }

    const priorityTag = sortMode === 'easiest' ? 'easy' : 'hard'
    const leftHasPriorityTag = flashcardHasNamedTag(left, priorityTag)
    const rightHasPriorityTag = flashcardHasNamedTag(right, priorityTag)
    if (leftHasPriorityTag !== rightHasPriorityTag) return leftHasPriorityTag ? -1 : 1

    if (sortMode === 'easiest') {
      const leftDifficulty = flashcardDifficulty(left)
      const rightDifficulty = flashcardDifficulty(right)
      if ((leftDifficulty === undefined) !== (rightDifficulty === undefined)) {
        return leftDifficulty === undefined ? 1 : -1
      }
      return (leftDifficulty || 0) - (rightDifficulty || 0)
        || left.errorCount - right.errorCount
        || compareText(left.lastReviewedAt || '', right.lastReviewedAt || '')
        || compareText(left.id, right.id)
    }

    const leftDifficulty = flashcardDifficulty(left) ?? -1
    const rightDifficulty = flashcardDifficulty(right) ?? -1
    return rightDifficulty - leftDifficulty
      || right.errorCount - left.errorCount
      || compareText(left.lastReviewedAt || '', right.lastReviewedAt || '')
      || compareText(left.id, right.id)
  })
  return sortDirection === 'desc' ? sorted.reverse() : sorted
}

export function flashcardReviewQueue(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
) {
  return flashcardReviewQueueState(reviewSet, cards, random).queue
}

export function flashcardReviewQueueState(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
) {
  const candidates = sortFlashcardsForReview(
    cards.filter(card => (
      cardMatchesReviewSet(card, reviewSet)
      && !(reviewSet.excludedCards || []).includes(card.id)
      && !flashcardWasEjectedToday(card)
    )),
    reviewSet.sortMode,
    reviewSet.sortDirection,
    random,
  )
    .map(card => ({
      id: card.id,
      front: card.front,
      back: card.back,
      ttsFront: card.ttsFront || '',
      ttsBack: card.ttsBack || '',
      transliteration: card.transliteration || '',
      note: card.note,
      frontAudio: card.frontAudio,
      backAudio: card.backAudio,
      image: card.image,
      tags: [...card.tags],
      ejectCount: card.ejectCount,
    }))
  const queue = candidates.slice(0, reviewSet.maxCards)
  return {
    queue,
    reserveCardIds: flashcardEjectLoadsNext(reviewSet.ejectBehavior)
      ? candidates.slice(queue.length).map(card => card.id)
      : [],
  }
}

export function createFlashcardReviewPreviewSession(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
  startedAt = new Date(),
): FlashcardReviewSession | undefined {
  const { queue, reserveCardIds } = flashcardReviewQueueState(reviewSet, cards, random)
  if (!queue.length) return undefined

  const timestamp = startedAt.toISOString()
  return {
    id: `review-set-preview-${reviewSet.id}`,
    reviewSet: reviewSet.id,
    status: 'paused',
    name: reviewSet.name,
    mode: reviewSet.mode,
    cardSides: DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    invertFaces: false,
    indefinite: reviewSet.mode === 'passive' && reviewSet.indefinite,
    timeLimitSeconds: reviewSet.mode === 'passive' ? reviewSet.timeLimitSeconds || 0 : 0,
    maxCards: reviewSet.maxCards,
    ejectBehavior: reviewSet.ejectBehavior || 'remove',
    ejectExcludeAfter: normalizeFlashcardEjectExcludeAfter(reviewSet.ejectExcludeAfter),
    sortMode: reviewSet.sortMode,
    sortDirection: reviewSet.sortDirection,
    tags: [...reviewSet.tags],
    excludedCards: [...(reviewSet.excludedCards || [])],
    frontSeconds: normalizeFlashcardFaceDurationSeconds(reviewSet.frontSeconds),
    backSeconds: normalizeFlashcardFaceDurationSeconds(reviewSet.backSeconds),
    backSpeechRepeatCount: reviewSet.mode === 'passive' && reviewSet.speechEnabled
      ? normalizeFlashcardBackSpeechRepeatCount(reviewSet.backSpeechRepeatCount)
      : DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    frontDisplay: normalizeFlashcardReviewFaceValue(
      reviewSet.frontDisplay,
      DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
    ),
    backDisplay: normalizeFlashcardReviewFaceValue(
      reviewSet.backDisplay,
      DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
    ),
    speechEnabled: reviewSet.speechEnabled,
    backSpeechRate: normalizeFlashcardBackSpeechRate(reviewSet.backSpeechRate),
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    queue,
    reserveCardIds,
    startedAt: timestamp,
    updatedAt: timestamp,
    elapsedSeconds: 0,
    totalCards: queue.length,
    viewedCount: 0,
    successCount: 0,
    errorCount: 0,
    ejectedCount: 0,
  }
}

export function createIntervalFlashcardReviewSnapshot(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
): IntervalFlashcardReviewSnapshot | undefined {
  const { queue, reserveCardIds } = flashcardReviewQueueState(reviewSet, cards, random)
  if (!queue.length) return undefined
  const effectiveSeconds = reviewSet.mode === 'passive'
    ? {
        front: normalizeFlashcardFaceDurationSeconds(reviewSet.frontSeconds),
        back: normalizeFlashcardFaceDurationSeconds(reviewSet.backSeconds),
      }
    : { front: 5, back: 5 }

  return {
    reviewSet: reviewSet.id,
    name: reviewSet.name,
    tags: [...reviewSet.tags],
    sortMode: reviewSet.sortMode,
    sortDirection: reviewSet.sortDirection,
    ejectBehavior: reviewSet.ejectBehavior || 'remove',
    ejectExcludeAfter: normalizeFlashcardEjectExcludeAfter(reviewSet.ejectExcludeAfter),
    maxCards: reviewSet.maxCards,
    cardSides: DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    invertFaces: false,
    frontSeconds: effectiveSeconds.front,
    backSeconds: effectiveSeconds.back,
    backSpeechRepeatCount: reviewSet.mode === 'passive' && reviewSet.speechEnabled
      ? normalizeFlashcardBackSpeechRepeatCount(reviewSet.backSpeechRepeatCount)
      : DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    frontDisplay: normalizeFlashcardReviewFaceValue(
      reviewSet.frontDisplay,
      DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
    ),
    backDisplay: normalizeFlashcardReviewFaceValue(
      reviewSet.backDisplay,
      DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
    ),
    speechEnabled: reviewSet.speechEnabled,
    backSpeechRate: normalizeFlashcardBackSpeechRate(reviewSet.backSpeechRate),
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    cards: queue,
    reserveCardIds,
  }
}

export interface IntervalFlashcardPhase {
  card: IntervalFlashcardReviewSnapshot['cards'][number]
  cardIndex: number
  cycle: number
  side: FlashcardReviewSide
  progress: number
  remainingMs: number
  key: string
}

export function normalizeFlashcardBackSpeechRepeatCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS
  return Math.min(
    MAX_FLASHCARD_BACK_SPEECH_REPEATS,
    Math.max(MIN_FLASHCARD_BACK_SPEECH_REPEATS, Math.round(value)),
  )
}

export function normalizeFlashcardFaceDurationSeconds(value: number) {
  if (!Number.isFinite(value)) return 5
  return Math.min(
    MAX_FLASHCARD_FACE_DURATION_SECONDS,
    Math.max(MIN_FLASHCARD_FACE_DURATION_SECONDS, Math.round(value)),
  )
}

export function normalizeFlashcardBackSpeechRate(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_FLASHCARD_BACK_SPEECH_RATE
  return Math.min(
    MAX_FLASHCARD_BACK_SPEECH_RATE,
    Math.max(MIN_FLASHCARD_BACK_SPEECH_RATE, Math.round(value * 4) / 4),
  )
}

export function flashcardBackDurationMs(backSeconds: number, repeatCount: number) {
  const durationMs = normalizeFlashcardFaceDurationSeconds(backSeconds) * 1000
  return durationMs * normalizeFlashcardBackSpeechRepeatCount(repeatCount)
}

type FlashcardReviewTiming = Pick<
  FlashcardReviewSession,
  | 'frontSeconds'
  | 'backSeconds'
  | 'backSpeechRepeatCount'
  | 'frontDisplay'
  | 'backDisplay'
  | 'speechEnabled'
  | 'backSpeechRate'
  | 'frontLanguage'
  | 'backLanguage'
>

export function flashcardReviewFaceSpeechDurationMs(
  review: FlashcardReviewTiming,
  card: FlashcardReviewQueueCard,
  side: FlashcardReviewSide,
) {
  if (!review.speechEnabled) return 0
  const displayedValue = side === 'front' ? review.frontDisplay : review.backDisplay
  const faceValue = flashcardReviewSpeechFaceValue(side, displayedValue)
  if (!flashcardReviewFaceCanSpeak(faceValue)) return 0
  const { text } = flashcardReviewFaceSpeech(card, faceValue)
  const language = side === 'front' ? review.frontLanguage : review.backLanguage
  const content = text.trim()
  if (!content || !language) return 0
  const isChinese = language.toLocaleLowerCase().startsWith('zh')
  const unitCount = isChinese ? [...content].length : content.split(/\s+/).length
  const speechRate = side === 'back' ? normalizeFlashcardBackSpeechRate(review.backSpeechRate) : 1
  return Math.round((isChinese ? 260 : 340) / speechRate * unitCount)
}

export function flashcardReviewFaceDurationMs(
  review: FlashcardReviewTiming,
  card: FlashcardReviewQueueCard,
  side: FlashcardReviewSide,
) {
  const configuredDurationMs = normalizeFlashcardFaceDurationSeconds(
    side === 'front' ? review.frontSeconds : review.backSeconds,
  ) * 1000
  const repetitions = side === 'back'
    ? normalizeFlashcardBackSpeechRepeatCount(review.backSpeechRepeatCount)
    : 1
  return repetitions * (
    configuredDurationMs + flashcardReviewFaceSpeechDurationMs(review, card, side)
  )
}

export function flashcardReviewShowsSide(
  _cardSides: FlashcardReviewCardSides,
  _side: FlashcardReviewSide,
) {
  return true
}

export function firstFlashcardReviewSide(
  _cardSides: FlashcardReviewCardSides,
  _invertFaces = false,
): FlashcardReviewSide {
  return 'front'
}

export function otherFlashcardReviewSide(side: FlashcardReviewSide): FlashcardReviewSide {
  return side === 'front' ? 'back' : 'front'
}

function intervalFlashcardCardDurationMs(
  review: IntervalFlashcardReviewSnapshot,
  card: FlashcardReviewQueueCard,
) {
  const showsFront = flashcardReviewShowsSide(review.cardSides, 'front')
  const showsBack = flashcardReviewShowsSide(review.cardSides, 'back')
  const frontMs = flashcardReviewFaceDurationMs(review, card, 'front')
  const backMs = flashcardReviewFaceDurationMs(review, card, 'back')
  return (showsFront ? frontMs : 0) + (showsBack ? backMs : 0)
}

function intervalFlashcardCycleDurationMs(review: IntervalFlashcardReviewSnapshot) {
  return review.cards.reduce(
    (durationMs, card) => durationMs + intervalFlashcardCardDurationMs(review, card),
    0,
  )
}

function intervalFlashcardCardStartMs(review: IntervalFlashcardReviewSnapshot, cardIndex: number) {
  return review.cards
    .slice(0, Math.max(0, cardIndex))
    .reduce((durationMs, card) => durationMs + intervalFlashcardCardDurationMs(review, card), 0)
}

function intervalFlashcardPlaybackElapsedMs(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : 0
  const playbackOffsetMs = Number.isFinite(review.playbackOffsetMs) ? review.playbackOffsetMs! : 0
  return Math.max(0, safeElapsedMs + playbackOffsetMs)
}

export function intervalFlashcardNavigationOffsetMs(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
  direction: 'previous' | 'next',
) {
  const currentOffsetMs = Number.isFinite(review.playbackOffsetMs) ? review.playbackOffsetMs! : 0
  if (!review.cards.length) return currentOffsetMs
  const phase = intervalFlashcardPhase(review, elapsedMs)
  if (!phase) return currentOffsetMs
  const cycleDurationMs = intervalFlashcardCycleDurationMs(review)
  const movesPastCycle = direction === 'next'
    ? phase.cardIndex === review.cards.length - 1
    : phase.cardIndex === 0
  const targetCardIndex = direction === 'next'
    ? (phase.cardIndex + 1) % review.cards.length
    : (phase.cardIndex - 1 + review.cards.length) % review.cards.length
  const targetCycle = direction === 'next'
    ? phase.cycle + (movesPastCycle ? 1 : 0)
    : Math.max(0, phase.cycle - (movesPastCycle ? 1 : 0))
  return targetCycle * cycleDurationMs + intervalFlashcardCardStartMs(review, targetCardIndex) - elapsedMs
}

export function intervalFlashcardEjectionOffsetMs(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
  ejectedCardId: string,
  remainingCards: FlashcardReviewQueueCard[],
) {
  const currentPhase = intervalFlashcardPhase(review, elapsedMs)
  if (!currentPhase || !remainingCards.length) {
    return Number.isFinite(review.playbackOffsetMs) ? review.playbackOffsetMs! : 0
  }

  const ejectedCardIndex = review.cards.findIndex(card => card.id === ejectedCardId)
  const originalCardIds = new Set(review.cards.map(card => card.id))
  const remainingCardIds = new Set(remainingCards.map(card => card.id))
  const orderedCandidates = ejectedCardIndex >= 0
    ? [
        ...review.cards.slice(ejectedCardIndex + 1),
        ...remainingCards.filter(card => !originalCardIds.has(card.id)),
        ...review.cards.slice(0, ejectedCardIndex),
      ]
    : remainingCards
  const nextCardId = orderedCandidates.find(card => remainingCardIds.has(card.id))?.id
  const nextCardIndex = Math.max(0, remainingCards.findIndex(card => card.id === nextCardId))
  const remainingReview = { ...review, cards: remainingCards }
  return intervalFlashcardCardStartMs(remainingReview, nextCardIndex) - elapsedMs
}

export function intervalFlashcardSideOffsetMs(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
  side: FlashcardReviewSide,
) {
  const currentOffsetMs = Number.isFinite(review.playbackOffsetMs) ? review.playbackOffsetMs! : 0
  if (!review.cards.length || !flashcardReviewShowsSide(review.cardSides, side)) {
    return currentOffsetMs
  }

  const phase = intervalFlashcardPhase(review, elapsedMs)
  if (!phase) return currentOffsetMs
  const cycleDurationMs = intervalFlashcardCycleDurationMs(review)
  const firstSide = firstFlashcardReviewSide(review.cardSides, review.invertFaces)
  const firstSideDurationMs = flashcardReviewFaceDurationMs(review, phase.card, firstSide)
  const sideOffsetMs = side === firstSide ? 0 : firstSideDurationMs
  return phase.cycle * cycleDurationMs
    + intervalFlashcardCardStartMs(review, phase.cardIndex)
    + sideOffsetMs
    - elapsedMs
}

export function intervalFlashcardPhase(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
): IntervalFlashcardPhase | undefined {
  if (!review.cards.length) return undefined
  const cycleDurationMs = intervalFlashcardCycleDurationMs(review)
  if (!cycleDurationMs) return undefined
  const safeElapsedMs = intervalFlashcardPlaybackElapsedMs(review, elapsedMs)
  const cycle = Math.floor(safeElapsedMs / cycleDurationMs)
  let elapsedInCycleMs = safeElapsedMs % cycleDurationMs
  let cardIndex = 0
  let card = review.cards[cardIndex]
  while (card && elapsedInCycleMs >= intervalFlashcardCardDurationMs(review, card)) {
    elapsedInCycleMs -= intervalFlashcardCardDurationMs(review, card)
    cardIndex += 1
    card = review.cards[cardIndex]
  }
  if (!card) return undefined
  const firstSide = firstFlashcardReviewSide(review.cardSides, review.invertFaces)
  const firstSideDurationMs = flashcardReviewFaceDurationMs(review, card, firstSide)
  const side = elapsedInCycleMs < firstSideDurationMs
    ? firstSide
    : otherFlashcardReviewSide(firstSide)
  const sideElapsedMs = side === firstSide ? elapsedInCycleMs : elapsedInCycleMs - firstSideDurationMs
  const sideDurationMs = flashcardReviewFaceDurationMs(review, card, side)
  const configuredBackDurationMs = normalizeFlashcardFaceDurationSeconds(review.backSeconds) * 1000
  const speechDurationMs = flashcardReviewFaceSpeechDurationMs(review, card, 'back')
  const backRepeatDurationMs = configuredBackDurationMs + speechDurationMs
  const backSpeechRepeatIndex = side === 'back'
    ? Math.min(
      normalizeFlashcardBackSpeechRepeatCount(review.backSpeechRepeatCount) - 1,
        Math.floor(sideElapsedMs / backRepeatDurationMs),
      )
    : 0

  return {
    card,
    cardIndex,
    cycle,
    side,
    progress: Math.min(100, Math.max(0, sideElapsedMs / sideDurationMs * 100)),
    remainingMs: Math.max(0, sideDurationMs - sideElapsedMs),
    key: `${cycle}:${cardIndex}:${side}:${backSpeechRepeatIndex}`,
  }
}
