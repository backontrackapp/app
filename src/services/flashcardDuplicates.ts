import type { Flashcard, FlashcardDuplicateColumn, FlashcardImportRow } from '@/types/domain'

export function normalizeFlashcardFront(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

export function findDuplicateFlashcard(
  cards: readonly Flashcard[],
  front: string,
  excludeId = '',
) {
  const key = normalizeFlashcardFront(front)
  if (!key) return undefined
  return cards.find(card => card.id !== excludeId && normalizeFlashcardFront(card.front) === key)
}

export function countFlashcardImportDuplicates(
  rows: readonly FlashcardImportRow[],
  cards: readonly Flashcard[],
) {
  const known = new Set(cards.map(card => normalizeFlashcardFront(card.front)))
  let count = 0
  rows.forEach((row) => {
    const key = normalizeFlashcardFront(row.front)
    if (known.has(key)) count += 1
    else known.add(key)
  })
  return count
}

export const flashcardDuplicateColumns: Array<{
  id: FlashcardDuplicateColumn
  title: string
}> = [
  { id: 'back', title: 'Back' },
  { id: 'transliteration', title: 'Transliteration' },
  { id: 'note', title: 'Note' },
  { id: 'tags', title: 'Tags' },
  { id: 'image', title: 'Image' },
]
