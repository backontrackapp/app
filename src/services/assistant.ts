import { api } from '@/lib/api'
import {
  cardMatchesReviewSet,
  flashcardEjectBehavior,
  flashcardEjectExcludes,
  flashcardEjectLoadsNext,
  flashcardReviewSettingsAreValid,
} from '@/services/flashcards'
import type {
  AssistantChoice,
  AssistantConversationItem,
  AssistantFlashcardDraft,
  AssistantReviewSetChange,
  AssistantToolCallItem,
  AssistantToolOutputItem,
  AssistantWritePlan,
  FlashcardReviewSet,
  FlashcardReviewSetDraft,
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
  return {
    front,
    back,
    transliteration: normalizedText(record.transliteration, 4000),
    note: normalizedText(record.note, 2000),
  }
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
    tags: [...reviewSet.tags],
    selectionMode: reviewSet.selectionMode || 'tags',
    includedCards: [...(reviewSet.includedCards || [])],
    excludedCards: [...(reviewSet.excludedCards || [])],
    mode: reviewSet.mode,
    cardSides: reviewSet.cardSides,
    indefinite: reviewSet.indefinite,
    timeLimitSeconds: reviewSet.timeLimitSeconds || 0,
    maxCards: reviewSet.maxCards,
    ejectBehavior: reviewSet.ejectBehavior,
    frontSeconds: reviewSet.frontSeconds,
    backSeconds: reviewSet.backSeconds,
    backSpeechRepeatCount: reviewSet.backSpeechRepeatCount,
    noteBeforeBack: reviewSet.noteBeforeBack,
    speechEnabled: reviewSet.speechEnabled,
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
  add('Faces', current.cardSides, draft.cardSides)
  add('Run indefinitely', current.indefinite, draft.indefinite)
  add('Time limit', `${(current.timeLimitSeconds || 0) / 60} min`, `${(draft.timeLimitSeconds || 0) / 60} min`)
  add('Max cards', current.maxCards, draft.maxCards)
  add('Load next on eject', flashcardEjectLoadsNext(current.ejectBehavior), flashcardEjectLoadsNext(draft.ejectBehavior))
  add('Exclude on eject', flashcardEjectExcludes(current.ejectBehavior), flashcardEjectExcludes(draft.ejectBehavior))
  add('Front duration', `${current.frontSeconds} sec`, `${draft.frontSeconds} sec`)
  add('Back duration', `${current.backSeconds} sec`, `${draft.backSeconds} sec`)
  add('Back speech repeats', current.backSpeechRepeatCount, draft.backSpeechRepeatCount)
  add('Show note before answer', current.noteBeforeBack, draft.noteBeforeBack)
  add('Read aloud', current.speechEnabled, draft.speechEnabled)
  add('Front language', current.frontLanguage, draft.frontLanguage)
  add('Back language', current.backLanguage, draft.backLanguage)
  add('Card order', current.sortMode, draft.sortMode)
  add('Sort direction', current.sortDirection, draft.sortDirection)
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
            selection_mode: set.selectionMode || 'tags',
            card_count: set.matchingCardCount,
            settings: {
              mode: set.mode,
              card_sides: set.cardSides,
              run_indefinitely: set.indefinite,
              time_limit_minutes: (set.timeLimitSeconds || 0) / 60,
              max_cards: set.maxCards,
              load_next_on_eject: flashcardEjectLoadsNext(set.ejectBehavior),
              exclude_on_eject: flashcardEjectExcludes(set.ejectBehavior),
              front_seconds: set.frontSeconds,
              back_seconds: set.backSeconds,
              back_speech_repeat_count: set.backSpeechRepeatCount,
              show_note_before_answer: set.noteBeforeBack,
              speech_enabled: set.speechEnabled,
              front_language: set.frontLanguage,
              back_language: set.backLanguage,
              sort_mode: set.sortMode,
              sort_direction: set.sortDirection,
            },
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
  ) {
    return undefined
  }
  const accountId = api.authStore.record?.id || ''
  const ownedSets = store.reviewSets.filter(set => (
    set.owner === accountId && set.accessRole === 'owner'
  ))

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
    draft.cardSides = nullableChoice(call.arguments.card_sides, ['both', 'front', 'back'], 'card faces')
      ?? draft.cardSides
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
    draft.noteBeforeBack = nullableBoolean(
      call.arguments.show_note_before_answer, 'Show note before answer',
    ) ?? draft.noteBeforeBack
    draft.speechEnabled = nullableBoolean(call.arguments.speech_enabled, 'Read aloud')
      ?? draft.speechEnabled
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
      ['difficult', 'never_reviewed', 'least_recent', 'recently_added', 'random'],
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
    convertsTagSelection: reviewSet.selectionMode !== 'cards',
    maxCards: reviewSet.maxCards,
  }
}

export async function executeAssistantWritePlan(plan: AssistantWritePlan, store: FlashcardStore) {
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

export async function requestAssistantResponse(items: AssistantConversationItem[]) {
  return api.assistantRespond(items)
}
