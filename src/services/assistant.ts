import { api } from '@/lib/api'
import { cardMatchesReviewSet } from '@/services/flashcards'
import type {
  AssistantConversationItem,
  AssistantFlashcardDraft,
  AssistantToolCallItem,
  AssistantToolOutputItem,
  AssistantWritePlan,
} from '@/types/domain'
import type { useFlashcardStore } from '@/stores/flashcards'

type FlashcardStore = ReturnType<typeof useFlashcardStore>

const MAX_ASSISTANT_CARDS = 100

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
  if (call.name !== 'create_flashcard_review_set' && call.name !== 'add_flashcards_to_review_set') {
    return undefined
  }
  const accountId = api.authStore.record?.id || ''
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
  const reviewSet = store.reviewSets.find(set => (
    set.id === reviewSetId && set.owner === accountId && set.accessRole === 'owner'
  ))
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
