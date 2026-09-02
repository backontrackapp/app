import { api } from '@/lib/api'
import {
  cardMatchesReviewSet,
  DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
  DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
  flashcardEjectBehavior,
  flashcardEjectExcludes,
  flashcardEjectLoadsNext,
  flashcardReviewSettingsAreValid,
  normalizeFlashcardBackSpeechRate,
} from '@/services/flashcards'
import { isSupportedEmoji, notoEmojiImageUrl } from '@/services/emojis'
import type {
  AssistantCardUpdate,
  AssistantChoice,
  AssistantConversationItem,
  AssistantFlashcardDraft,
  AssistantReviewSetChange,
  AssistantToolCallItem,
  AssistantToolOutputItem,
  AssistantWritePlan,
  AssistantResponseStreamEvent,
  FlashcardReviewSet,
  FlashcardReviewSetDraft,
  SquareImageSourceValue,
} from '@/types/domain'
import type { useFlashcardStore } from '@/stores/flashcards'

type FlashcardStore = ReturnType<typeof useFlashcardStore>

const MAX_ASSISTANT_CARDS = 100
const MAX_ASSISTANT_CHOICES = 5

function normalizedText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maximum)
}

function normalizedCard(value: unknown): AssistantFlashcardDraft | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const front = normalizedText(record.front, 4000)
  const back = normalizedText(record.back, 4000)
  if (!front || !back) return undefined
  const imageEmoji = nullableText(record.image, 64, 'Image')
  const image = imageEmoji ? notoEmojiImageUrl(imageEmoji) : ''
  if (imageEmoji && !image) throw new Error('Choose one Noto Emoji for the card image.')
  return {
    front,
    back,
    transliteration: normalizedText(record.transliteration, 4000),
    note: normalizedText(record.note, 2000),
    ...(image ? { image } : {}),
  }
}

function normalizedEmoji(value: unknown, field: string) {
  const emoji = nullableText(value, 64, field)
  if (!emoji) return ''
  if (!isSupportedEmoji(emoji)) throw new Error(`${field} must be one supported emoji.`)
  return emoji
}

function nullableText(value: unknown, maximum: number, field: string) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be text.`)
  return value.trim().slice(0, maximum)
}

function cardKey(front: string, back: string) {
  return `${front.trim().toLocaleLowerCase()}\u0000${back.trim().toLocaleLowerCase()}`
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))]
    : []
}

function integer(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

function nullableBoolean(value: unknown, field: string) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false.`)
  return value
}

function nullableInteger(value: unknown, minimum: number, maximum: number, field: string) {
  if (value === null || value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be a whole number from ${minimum} to ${maximum}.`)
  }
  return parsed
}

function nullableNumber(value: unknown, minimum: number, maximum: number, field: string) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function nullableChoice<T extends string>(value: unknown, choices: readonly T[], field: string) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`The assistant returned an invalid ${field}.`)
  }
  return value as T
}

function reviewSetDraft(reviewSet: FlashcardReviewSet): FlashcardReviewSetDraft {
  return {
    id: reviewSet.id,
    name: reviewSet.name,
    icon: reviewSet.icon || '',
    color: reviewSet.color,
    tags: [...reviewSet.tags],
    assignedCards: [...(reviewSet.assignedCards || [])],
    excludedCards: [...(reviewSet.excludedCards || [])],
    mode: reviewSet.mode,
    cardSides: 'both',
    invertFaces: false,
    indefinite: reviewSet.indefinite,
    timeLimitSeconds: reviewSet.timeLimitSeconds || 0,
    maxCards: reviewSet.maxCards,
    ejectBehavior: reviewSet.ejectBehavior,
    ejectExcludeAfter: reviewSet.ejectExcludeAfter,
    frontSeconds: reviewSet.frontSeconds,
    backSeconds: reviewSet.backSeconds,
    backSpeechRepeatCount: reviewSet.backSpeechRepeatCount,
    frontDisplay: reviewSet.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
    backDisplay: reviewSet.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
    speechEnabled: reviewSet.speechEnabled,
    backSpeechRate: reviewSet.backSpeechRate,
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    sortMode: reviewSet.sortMode,
    sortDirection: reviewSet.sortDirection,
    sortOrder: reviewSet.sortOrder,
  }
}

function reviewSetChanges(
  current: FlashcardReviewSet,
  draft: FlashcardReviewSetDraft,
): AssistantReviewSetChange[] {
  const changes: AssistantReviewSetChange[] = []
  const add = (label: string, before: string | number | boolean, after: string | number | boolean) => {
    if (before === after) return
    const display = (value: string | number | boolean) => typeof value === 'boolean'
      ? value ? 'Yes' : 'No'
      : String(value || 'None')
    changes.push({ label, before: display(before), after: display(after) })
  }
  add('Name', current.name, draft.name)
  add('Mode', current.mode, draft.mode)
  add('Run indefinitely', current.indefinite, draft.indefinite)
  add('Time limit', `${(current.timeLimitSeconds || 0) / 60} min`, `${(draft.timeLimitSeconds || 0) / 60} min`)
  add('Max cards', current.maxCards, draft.maxCards)
  add('Inject a new card', flashcardEjectLoadsNext(current.ejectBehavior), flashcardEjectLoadsNext(draft.ejectBehavior))
  add('Exclude after ejections', current.ejectExcludeAfter, draft.ejectExcludeAfter)
  add('Exclude after threshold', flashcardEjectExcludes(current.ejectBehavior), flashcardEjectExcludes(draft.ejectBehavior))
  add('Front duration', `${current.frontSeconds} sec`, `${draft.frontSeconds} sec`)
  add('Back duration', `${current.backSeconds} sec`, `${draft.backSeconds} sec`)
  add('Back speech repeats', current.backSpeechRepeatCount, draft.backSpeechRepeatCount)
  add('Front value', current.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY, draft.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY)
  add('Back value', current.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY, draft.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY)
  add('Read aloud', current.speechEnabled, draft.speechEnabled)
  add('Back speech speed', `${current.backSpeechRate}×`, `${draft.backSpeechRate}×`)
  add('Front language', current.frontLanguage, draft.frontLanguage)
  add('Back language', current.backLanguage, draft.backLanguage)
  add('Card order', current.sortMode, draft.sortMode)
  add('Sort direction', current.sortDirection, draft.sortDirection)
  return changes
}

function cardChanges(
  current: { front: string; back: string; transliteration?: string; note: string },
  draft: { front: string; back: string; transliteration?: string; note: string },
) {
  const changes: AssistantReviewSetChange[] = []
  const add = (label: string, before: string, after: string) => {
    if (before === after) return
    changes.push({ label, before: before || 'None', after: after || 'None' })
  }
  add('Front', current.front, draft.front)
  add('Back', current.back, draft.back)
  add('Transliteration', current.transliteration || '', draft.transliteration || '')
  add('Note', current.note, draft.note)
  return changes
}

export function assistantChoice(call: AssistantToolCallItem): AssistantChoice | undefined {
  if (call.name !== 'present_choices') return undefined
  const prompt = normalizedText(call.arguments.prompt, 500)
  const choices = [...new Set(
    stringArray(call.arguments.choices)
      .map(choice => choice.trim().slice(0, 160))
      .filter(Boolean),
  )].slice(0, MAX_ASSISTANT_CHOICES)
  if (!prompt || choices.length < 2) throw new Error('The assistant returned invalid choices.')
  return { call, prompt, choices }
}

export function selectedAssistantChoice(callId: string, choice: string): AssistantToolOutputItem {
  return {
    type: 'function_call_output',
    callId,
    output: { selected_choice: choice },
  }
}

export function assistantReadToolResult(
  call: AssistantToolCallItem,
  store: FlashcardStore,
): AssistantToolOutputItem | undefined {
  const accountId = api.authStore.record?.id || ''
  const ownedSets = store.reviewSets.filter(set => set.owner === accountId && set.accessRole === 'owner')

  if (call.name === 'list_owned_review_sets') {
    const query = normalizedText(call.arguments.query, 160).toLocaleLowerCase()
    const limit = Math.min(100, Math.max(1, integer(call.arguments.limit, 20)))
    return {
      type: 'function_call_output',
      callId: call.callId,
      output: {
        review_sets: ownedSets
          .filter(set => !query || set.name.toLocaleLowerCase().includes(query))
          .slice(0, limit)
          .map(set => ({
            id: set.id,
            name: set.name,
            card_count: set.matchingCardCount,
            settings: {
              mode: set.mode,
              run_indefinitely: set.indefinite,
              time_limit_minutes: (set.timeLimitSeconds || 0) / 60,
              max_cards: set.maxCards,
              load_next_on_eject: flashcardEjectLoadsNext(set.ejectBehavior),
              exclude_on_eject: flashcardEjectExcludes(set.ejectBehavior),
              exclude_after_ejections: set.ejectExcludeAfter,
              front_seconds: set.frontSeconds,
              back_seconds: set.backSeconds,
              back_speech_repeat_count: set.backSpeechRepeatCount,
              front_display: set.frontDisplay || DEFAULT_FLASHCARD_REVIEW_FRONT_DISPLAY,
              back_display: set.backDisplay || DEFAULT_FLASHCARD_REVIEW_BACK_DISPLAY,
              speech_enabled: set.speechEnabled,
              back_speech_rate: set.backSpeechRate,
              front_language: set.frontLanguage,
              back_language: set.backLanguage,
              sort_mode: set.sortMode,
              sort_direction: set.sortDirection,
            },
          })),
      },
    }
  }

  if (call.name === 'list_owned_flashcards') {
    const query = normalizedText(call.arguments.query, 160).toLocaleLowerCase()
    const limit = Math.min(100, Math.max(1, integer(call.arguments.limit, 20)))
    const cards = store.cards
      .filter(card => !query || [card.front, card.back, card.transliteration || '', card.note]
        .some(value => value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => left.front.localeCompare(right.front) || left.id.localeCompare(right.id))
      .slice(0, limit)
    return {
      type: 'function_call_output',
      callId: call.callId,
      output: {
        cards: cards.map(card => ({
          id: card.id,
          front: card.front,
          back: card.back,
          transliteration: card.transliteration || '',
          note: card.note,
          image: card.image,
          success_count: card.successCount,
          error_count: card.errorCount,
          last_reviewed_at: card.lastReviewedAt || '',
        })),
      },
    }
  }

  if (call.name !== 'get_owned_review_set_cards') return undefined
  const reviewSetId = normalizedText(call.arguments.review_set_id, 64)
  const reviewSet = ownedSets.find(set => set.id === reviewSetId)
  if (!reviewSet) {
    return {
      type: 'function_call_output',
      callId: call.callId,
      output: { error: 'Review set not found.' },
    }
  }
  const limit = Math.min(100, Math.max(1, integer(call.arguments.limit, 20)))
  const minimumErrors = Math.max(0, integer(call.arguments.minimum_error_count, 0))
  const cards = store.cards
    .filter(card => cardMatchesReviewSet(card, reviewSet) && card.errorCount >= minimumErrors)
    .sort((left, right) => (
      right.errorCount - left.errorCount
      || String(right.lastReviewedAt || '').localeCompare(String(left.lastReviewedAt || ''))
      || left.id.localeCompare(right.id)
    ))
    .slice(0, limit)
  return {
    type: 'function_call_output',
    callId: call.callId,
    output: {
      review_set: { id: reviewSet.id, name: reviewSet.name },
      cards: cards.map(card => ({
        id: card.id,
        front: card.front,
        back: card.back,
        transliteration: card.transliteration || '',
        note: card.note,
        image: card.image,
        success_count: card.successCount,
        error_count: card.errorCount,
        last_reviewed_at: card.lastReviewedAt || '',
      })),
    },
  }
}

export function assistantWritePlan(
  call: AssistantToolCallItem,
  store: FlashcardStore,
): AssistantWritePlan | undefined {
  if (
    call.name !== 'create_flashcard_review_set'
    && call.name !== 'add_flashcards_to_review_set'
    && call.name !== 'update_flashcard_review_set'
    && call.name !== 'update_flashcards'
  ) {
    return undefined
  }
  const accountId = api.authStore.record?.id || ''
  const ownedSets = store.reviewSets.filter(set => (
    set.owner === accountId && set.accessRole === 'owner'
  ))

  if (call.name === 'update_flashcards') {
    const reviewSetId = call.arguments.review_set_id === null
      || call.arguments.review_set_id === undefined
      ? ''
      : normalizedText(call.arguments.review_set_id, 64)
    const reviewSet = reviewSetId ? ownedSets.find(set => set.id === reviewSetId) : undefined
    if (reviewSetId && !reviewSet) throw new Error('Choose one of your Review sets.')
    if (!Array.isArray(call.arguments.cards) || !call.arguments.cards.length) {
      throw new Error('Choose at least one card to update.')
    }
    if (call.arguments.cards.length > MAX_ASSISTANT_CARDS) {
      throw new Error('An assistant action cannot update more than 100 cards.')
    }
    const cardsById = new Map(store.cards
      .filter(card => !reviewSet || cardMatchesReviewSet(card, reviewSet))
      .map(card => [card.id, card]))
    const updates: AssistantCardUpdate[] = []
    const seen = new Set<string>()
    for (const value of call.arguments.cards) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The assistant returned an invalid card update.')
      }
      const record = value as Record<string, unknown>
      const cardId = normalizedText(record.card_id, 64)
      if (!cardId || seen.has(cardId)) throw new Error('Each card can only be updated once.')
      seen.add(cardId)
      const current = cardsById.get(cardId)
      if (!current) throw new Error(reviewSet
        ? 'Choose cards from the selected owned Review set.'
        : 'Choose cards from your Card library.')
      const front = nullableText(record.front, 4000, 'Front') ?? current.front
      const back = nullableText(record.back, 4000, 'Back') ?? current.back
      const transliteration = nullableText(record.transliteration, 4000, 'Transliteration')
        ?? current.transliteration ?? ''
      const note = nullableText(record.note, 2000, 'Note') ?? current.note
      const imageEmoji = nullableText(record.image, 64, 'Image')
      const imageUrl = imageEmoji === undefined ? undefined : imageEmoji ? notoEmojiImageUrl(imageEmoji) : ''
      if (imageEmoji && !imageUrl) throw new Error('Choose one Noto Emoji for the card image.')
      if (!front || !back) throw new Error('Card fronts and backs cannot be empty.')
      const draft = {
        id: current.id,
        front,
        back,
        ttsFront: current.ttsFront || '',
        ttsBack: current.ttsBack || '',
        transliteration,
        note,
        tags: [...current.tags],
      }
      const changes = cardChanges(current, draft)
      let image: SquareImageSourceValue | undefined
      const currentImage = current.image || ''
      const currentImageSource = current.imageSource || (currentImage ? 'url' : 'none')
      if (
        imageUrl !== undefined
        && (imageUrl !== currentImage || currentImageSource !== (imageUrl ? 'url' : 'none'))
      ) {
        image = {
          source: imageUrl ? 'url' : 'none',
          url: imageUrl,
          existingUrl: currentImage,
          existingSource: currentImageSource,
        }
        changes.push({
          label: 'Image',
          before: currentImage ? 'Current image' : 'None',
          after: imageEmoji || 'None',
        })
      }
      if (changes.length) updates.push({ id: current.id, label: current.front, draft, image, changes })
    }
    if (!updates.length) throw new Error('The requested content already matches these cards.')
    return {
      call,
      title: reviewSet ? `Update cards in ${reviewSet.name}?` : 'Update existing cards?',
      description: `${updates.length} card${updates.length === 1 ? '' : 's'} will change.`,
      destinationName: reviewSet?.name || 'Card library',
      newCards: [],
      existingCardIds: [],
      reusedCardIds: [],
      convertsTagSelection: false,
      maxCards: reviewSet?.maxCards || MAX_ASSISTANT_CARDS,
      updatedCards: updates,
    }
  }

  if (call.name === 'update_flashcard_review_set') {
    const reviewSetId = normalizedText(call.arguments.review_set_id, 64)
    const current = ownedSets.find(set => set.id === reviewSetId)
    if (!current) throw new Error('Choose one of your Review sets.')
    const draft = reviewSetDraft(current)
    if (call.arguments.name !== null && call.arguments.name !== undefined) {
      const name = normalizedText(call.arguments.name, 160)
      if (!name) throw new Error('Review set name is required.')
      draft.name = name
    }
    draft.mode = nullableChoice(call.arguments.mode, ['manual', 'passive'], 'review mode') ?? draft.mode
    draft.indefinite = nullableBoolean(call.arguments.run_indefinitely, 'Run indefinitely')
      ?? draft.indefinite
    const timeLimitMinutes = nullableInteger(
      call.arguments.time_limit_minutes, 0, 1439, 'Time limit',
    )
    if (timeLimitMinutes !== undefined) draft.timeLimitSeconds = timeLimitMinutes * 60
    draft.maxCards = nullableInteger(call.arguments.max_cards, 1, 100, 'Max cards')
      ?? draft.maxCards
    const loadNext = nullableBoolean(call.arguments.load_next_on_eject, 'Load next on eject')
    const exclude = nullableBoolean(call.arguments.exclude_on_eject, 'Exclude on eject')
    draft.ejectExcludeAfter = nullableInteger(
      call.arguments.exclude_after_ejections,
      1,
      20,
      'Ejections before exclusion',
    ) ?? draft.ejectExcludeAfter
    draft.ejectBehavior = flashcardEjectBehavior(
      loadNext ?? flashcardEjectLoadsNext(draft.ejectBehavior),
      exclude ?? flashcardEjectExcludes(draft.ejectBehavior),
    )
    draft.frontSeconds = nullableInteger(call.arguments.front_seconds, 1, 60, 'Front duration')
      ?? draft.frontSeconds
    draft.backSeconds = nullableInteger(call.arguments.back_seconds, 1, 60, 'Back duration')
      ?? draft.backSeconds
    draft.backSpeechRepeatCount = nullableInteger(
      call.arguments.back_speech_repeat_count, 1, 5, 'Back speech repeat count',
    ) ?? draft.backSpeechRepeatCount
    draft.frontDisplay = nullableChoice(
      call.arguments.front_display,
      ['front', 'back', 'transliteration', 'note', 'image', 'empty'] as const,
      'Front value',
    ) ?? draft.frontDisplay
    draft.backDisplay = nullableChoice(
      call.arguments.back_display,
      ['front', 'back', 'transliteration', 'note', 'image', 'empty'] as const,
      'Back value',
    ) ?? draft.backDisplay
    draft.speechEnabled = nullableBoolean(call.arguments.speech_enabled, 'Read aloud')
      ?? draft.speechEnabled
    const backSpeechRate = nullableNumber(
      call.arguments.back_speech_rate, 0.25, 1, 'Back speech speed',
    )
    draft.backSpeechRate = backSpeechRate === undefined
      ? draft.backSpeechRate
      : normalizeFlashcardBackSpeechRate(backSpeechRate)
    if (call.arguments.front_language !== null && call.arguments.front_language !== undefined) {
      if (typeof call.arguments.front_language !== 'string') throw new Error('The front language is invalid.')
      draft.frontLanguage = call.arguments.front_language.trim().slice(0, 35)
    }
    if (call.arguments.back_language !== null && call.arguments.back_language !== undefined) {
      if (typeof call.arguments.back_language !== 'string') throw new Error('The back language is invalid.')
      draft.backLanguage = call.arguments.back_language.trim().slice(0, 35)
    }
    draft.sortMode = nullableChoice(
      call.arguments.sort_mode,
      ['difficult', 'easiest', 'never_reviewed', 'least_recent', 'recently_added', 'random'],
      'card order',
    ) ?? draft.sortMode
    draft.sortDirection = nullableChoice(call.arguments.sort_direction, ['asc', 'desc'], 'sort direction')
      ?? draft.sortDirection
    if (draft.mode !== 'passive') {
      draft.indefinite = false
      draft.timeLimitSeconds = 0
    }
    if (!flashcardReviewSettingsAreValid(draft)) {
      throw new Error('The requested Review set settings are not valid together.')
    }
    const changes = reviewSetChanges(current, draft)
    if (!changes.length) throw new Error('The requested settings already match this Review set.')
    return {
      call,
      title: `Update ${current.name}?`,
      description: `${changes.length} setting${changes.length === 1 ? '' : 's'} will change.`,
      destinationName: draft.name,
      newCards: [],
      existingCardIds: [],
      reusedCardIds: [],
      convertsTagSelection: false,
      maxCards: draft.maxCards,
      updatedReviewSet: draft,
      changes,
    }
  }

  const requestedCards = Array.isArray(call.arguments.cards)
    ? call.arguments.cards.map(normalizedCard).filter(Boolean) as AssistantFlashcardDraft[]
    : []
  const existingKeys = new Map(store.cards.map(card => [cardKey(card.front, card.back), card.id]))
  const reusedCardIds: string[] = []
  const newCards: AssistantFlashcardDraft[] = []
  const seen = new Set<string>()
  for (const card of requestedCards.slice(0, MAX_ASSISTANT_CARDS)) {
    const key = cardKey(card.front, card.back)
    if (seen.has(key)) continue
    seen.add(key)
    const existingId = existingKeys.get(key)
    if (existingId) reusedCardIds.push(existingId)
    else newCards.push(card)
  }
  const requestedIds = stringArray(call.arguments.existing_card_ids).slice(0, MAX_ASSISTANT_CARDS)
  const ownedIds = new Set(store.cards.map(card => card.id))
  const existingCardIds = [...new Set([...requestedIds.filter(id => ownedIds.has(id)), ...reusedCardIds])]
  const total = newCards.length + existingCardIds.length
  if (!total || total > MAX_ASSISTANT_CARDS) throw new Error('An assistant action must contain between 1 and 100 cards.')

  if (call.name === 'create_flashcard_review_set') {
    const name = normalizedText(call.arguments.name, 160)
    if (!name) throw new Error('Review set name is required.')
    const icon = normalizedEmoji(call.arguments.icon, 'Review set icon')
    return {
      call,
      title: `Create ${name}?`,
      description: `${total} card${total === 1 ? '' : 's'} will be included.`,
      destinationName: name,
      newCards,
      existingCardIds,
      reusedCardIds,
      convertsTagSelection: false,
      maxCards: Math.min(100, Math.max(1, integer(call.arguments.max_cards, 20))),
      icon: icon || undefined,
    }
  }

  const reviewSetId = normalizedText(call.arguments.review_set_id, 64)
  const reviewSet = ownedSets.find(set => set.id === reviewSetId)
  if (!reviewSet) throw new Error('Choose one of your Review sets.')
  return {
    call,
    title: `Add cards to ${reviewSet.name}?`,
    description: `${total} card${total === 1 ? '' : 's'} will be added.`,
    destinationName: reviewSet.name,
    newCards,
    existingCardIds,
    reusedCardIds,
    convertsTagSelection: false,
    maxCards: reviewSet.maxCards,
  }
}

export async function executeAssistantWritePlan(plan: AssistantWritePlan, store: FlashcardStore) {
  if (plan.updatedCards) {
    for (const update of plan.updatedCards) await store.saveCard(update.draft, update.image)
    return {
      type: 'function_call_output' as const,
      callId: plan.call.callId,
      output: {
        status: 'completed',
        scope: {
          type: plan.call.arguments.review_set_id ? 'review_set' : 'card_library',
          ...(plan.call.arguments.review_set_id ? {
            id: String(plan.call.arguments.review_set_id),
            name: plan.destinationName,
          } : {}),
        },
        updated_cards: plan.updatedCards.map(update => ({
          id: update.id,
          updated_fields: update.changes.map(change => change.label),
        })),
      },
    }
  }
  if (plan.updatedReviewSet) {
    const reviewSet = await store.saveReviewSet(plan.updatedReviewSet)
    return {
      type: 'function_call_output' as const,
      callId: plan.call.callId,
      output: {
        status: 'completed',
        review_set: { id: reviewSet.id, name: reviewSet.name },
        updated_settings: (plan.changes || []).map(change => change.label),
      },
    }
  }
  const result = await api.applyAssistantFlashcards({
    mode: plan.call.name === 'create_flashcard_review_set' ? 'create' : 'add',
    cards: plan.newCards,
    existingCardIds: plan.existingCardIds,
    reviewSetId: plan.call.name === 'add_flashcards_to_review_set'
      ? String(plan.call.arguments.review_set_id || '')
      : undefined,
    name: plan.destinationName,
    icon: plan.icon,
    maxCards: plan.maxCards,
  })
  await store.load()
  return {
    type: 'function_call_output' as const,
    callId: plan.call.callId,
    output: {
      status: 'completed',
      review_set: { id: result.review_set.id, name: result.review_set.name },
      created_cards: result.cards.length,
      reused_cards: plan.existingCardIds.length,
      total_cards_added: plan.newCards.length + plan.existingCardIds.length,
    },
  }
}

export function cancelledAssistantToolOutput(callId: string): AssistantToolOutputItem {
  return { type: 'function_call_output', callId, output: { status: 'cancelled' } }
}

export async function requestAssistantResponse(
  items: AssistantConversationItem[],
  onTextDelta: (delta: string) => void,
  onActivity: (event: Extract<AssistantResponseStreamEvent, { type: 'activity_delta' | 'activity' }>) => void,
  signal?: AbortSignal,
) {
  return api.assistantRespond(items, onTextDelta, onActivity, signal)
}
