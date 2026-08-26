import { apiAssetUrl } from '@/lib/api'
import { normalizeSpeechLanguage } from '@/services/flashcardSpeech'
import type {
  CuratedLanguageOption,
  CuratedReviewSetDetail,
  Flashcard,
  FlashcardReviewSettings,
  FlashcardSpeechLanguage,
} from '@/types/domain'

type CuratedTextField = 'front' | 'back' | 'transliteration' | 'notes'

function valueFor(values: Record<string, string>, field: CuratedTextField, language: string) {
  const localized = language ? values[`${field}_${language}`] : values[field]
  return (localized ?? values[field] ?? '').trim()
}

export function closestSupportedTtsLanguage(
  requestedLanguage: string,
  supportedLanguages: FlashcardSpeechLanguage[],
) {
  const requested = normalizeSpeechLanguage(requestedLanguage)
  if (!requested) return ''
  const exact = supportedLanguages.find(
    language => normalizeSpeechLanguage(language.tag) === requested,
  )
  if (exact) return exact.tag
  const requestedBase = requested.split('-')[0]
  return supportedLanguages.find(
    language => normalizeSpeechLanguage(language.tag).split('-')[0] === requestedBase,
  )?.tag || ''
}

export function preferredCuratedContentLanguage(
  options: CuratedLanguageOption[],
  defaultLanguage: string,
  supportedLanguages: FlashcardSpeechLanguage[],
) {
  const fallback = options.find(option => option.value === defaultLanguage)?.value
    ?? options[0]?.value
    ?? ''
  if (!supportedLanguages.length) return fallback

  const candidates = [
    ...options.filter(option => option.value === defaultLanguage),
    ...options.filter(option => option.value !== defaultLanguage),
  ]
  for (const option of candidates) {
    if (closestSupportedTtsLanguage(option.value, supportedLanguages)) return option.value
  }
  return fallback
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
    ejectCount: 0,
  }))
}

export function curatedReviewSettings(
  detail: CuratedReviewSetDetail,
  frontLanguage: string,
  backLanguage: string,
  supportedLanguages: FlashcardSpeechLanguage[] = [],
): FlashcardReviewSettings {
  return {
    ...detail.settings,
    frontLanguage: closestSupportedTtsLanguage(frontLanguage, supportedLanguages) || frontLanguage,
    backLanguage: closestSupportedTtsLanguage(backLanguage, supportedLanguages) || backLanguage,
    speechEnabled: detail.settings.speechEnabled && Boolean(frontLanguage && backLanguage),
  }
}
