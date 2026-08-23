import { apiAssetUrl } from '@/lib/api'
import type { CuratedReviewSetDetail, Flashcard, FlashcardReviewSettings } from '@/types/domain'

type CuratedTextField = 'front' | 'back' | 'transliteration' | 'notes'

function valueFor(values: Record<string, string>, field: CuratedTextField, language: string) {
  const localized = language ? values[`${field}_${language}`] : values[field]
  return (localized ?? values[field] ?? '').trim()
}

export function curatedCards(
  detail: CuratedReviewSetDetail,
  frontLanguage: string,
  backLanguage: string,
): Flashcard[] {
  const timestamp = new Date(0).toISOString()
  return detail.rows.map(row => ({
    id: row.id,
    front: valueFor(row.values, 'front', frontLanguage),
    back: valueFor(row.values, 'back', backLanguage),
    transliteration: valueFor(row.values, 'transliteration', backLanguage),
    note: valueFor(row.values, 'notes', backLanguage),
    image: apiAssetUrl(row.image),
    imageSource: row.image ? 'url' : 'none',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  }))
}

export function curatedReviewSettings(
  detail: CuratedReviewSetDetail,
  frontLanguage: string,
  backLanguage: string,
): FlashcardReviewSettings {
  return {
    ...detail.settings,
    frontLanguage,
    backLanguage,
    speechEnabled: detail.settings.speechEnabled && Boolean(frontLanguage && backLanguage),
  }
}
