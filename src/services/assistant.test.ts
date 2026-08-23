import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assistantReadToolResult,
  assistantWritePlan,
  executeAssistantWritePlan,
} from '@/services/assistant'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'account-1' } },
    applyAssistantFlashcards: vi.fn(),
    assistantRespond: vi.fn(),
  },
}))

function store() {
  return {
    cards: [
      {
        id: 'card-1', front: 'hello', back: 'مرحبا', transliteration: '', note: '',
        tags: ['tag-1'], errorCount: 8, successCount: 2, passiveViews: 0,
        lastReviewedAt: '2026-08-22T12:00:00Z', createdAt: '', updatedAt: '',
      },
      {
        id: 'card-2', front: 'goodbye', back: 'مع السلامة', transliteration: '', note: '',
        tags: ['tag-1'], errorCount: 3, successCount: 4, passiveViews: 0,
        lastReviewedAt: '2026-08-21T12:00:00Z', createdAt: '', updatedAt: '',
      },
    ],
    reviewSets: [
      {
        id: 'set-1', owner: 'account-1', accessRole: 'owner', name: 'Arabic',
        selectionMode: 'tags', tags: ['tag-1'], includedCards: [], matchingCardCount: 2,
        maxCards: 20,
      },
      {
        id: 'set-shared', owner: 'account-2', accessRole: 'editor', name: 'Shared',
        selectionMode: 'cards', tags: [], includedCards: ['card-1'], matchingCardCount: 1,
        maxCards: 20,
      },
    ],
    load: vi.fn(),
  } as any
}

describe('flashcard assistant tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('only returns owned Review sets and sorts error cards from highest to lowest', () => {
    const flashcards = store()
    const sets = assistantReadToolResult({
      type: 'function_call', callId: 'call-1', name: 'list_owned_review_sets',
      arguments: { query: '', limit: 20 },
    }, flashcards)
    expect(sets?.output.review_sets).toEqual([
      expect.objectContaining({ id: 'set-1', name: 'Arabic' }),
    ])

    const cards = assistantReadToolResult({
      type: 'function_call', callId: 'call-2', name: 'get_owned_review_set_cards',
      arguments: { review_set_id: 'set-1', limit: 20, minimum_error_count: 1 },
    }, flashcards)
    expect((cards?.output.cards as Array<{ id: string }>).map(card => card.id)).toEqual([
      'card-1', 'card-2',
    ])
  })

  it('reuses matching owned cards and requires confirmation through a write plan', () => {
    const plan = assistantWritePlan({
      type: 'function_call', callId: 'call-3', name: 'create_flashcard_review_set',
      arguments: {
        name: 'Arabic basics', max_cards: 20, existing_card_ids: [],
        cards: [
          { front: 'Hello', back: 'مرحبا', transliteration: '', note: '' },
          { front: 'Thanks', back: 'شكرا', transliteration: '', note: '' },
        ],
      },
    }, store())
    expect(plan).toEqual(expect.objectContaining({
      destinationName: 'Arabic basics',
      existingCardIds: ['card-1'],
      newCards: [{ front: 'Thanks', back: 'شكرا', transliteration: '', note: '' }],
    }))
  })

  it('does not allow writes to a Review set the current user does not own', () => {
    expect(() => assistantWritePlan({
      type: 'function_call', callId: 'call-4', name: 'add_flashcards_to_review_set',
      arguments: {
        review_set_id: 'set-shared', existing_card_ids: ['card-1'], cards: [],
      },
    }, store())).toThrow('Choose one of your Review sets.')
  })

  it('executes a confirmed plan as one assistant flashcard operation', async () => {
    const flashcards = store()
    vi.mocked(api.applyAssistantFlashcards).mockResolvedValue({
      cards: [{ id: 'new-card' }],
      review_set: { id: 'new-set', name: 'Arabic basics' },
    } as any)
    const plan = assistantWritePlan({
      type: 'function_call', callId: 'call-5', name: 'create_flashcard_review_set',
      arguments: {
        name: 'Arabic basics', max_cards: 20, existing_card_ids: [],
        cards: [{ front: 'Thanks', back: 'شكرا', transliteration: '', note: '' }],
      },
    }, flashcards)!

    const output = await executeAssistantWritePlan(plan, flashcards)
    expect(api.applyAssistantFlashcards).toHaveBeenCalledOnce()
    expect(flashcards.load).toHaveBeenCalledOnce()
    expect(output.output).toEqual(expect.objectContaining({
      status: 'completed',
      review_set: { id: 'new-set', name: 'Arabic basics' },
    }))
  })
})
