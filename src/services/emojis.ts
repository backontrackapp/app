import type { EmojiDataRecord, EmojiOption } from '@/types/emoji'

let emojiOptionsPromise: Promise<EmojiOption[]> | undefined

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function capitalize(value: string) {
  return value.replace(/^\p{Ll}/u, character => character.toLocaleUpperCase())
}

export function formatEmojiLabel(label: string) {
  return label
    .replace(/_/g, ' ')
    .split(':')
    .map(part => capitalize(part.replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .join(' · ')
}

export function buildEmojiOptions(records: EmojiDataRecord[]) {
  return records
    .filter(record => record.group !== undefined)
    .flatMap((record) => {
      const searchTerms = [record.label, ...(record.tags || [])]

      return [record, ...(record.skins || [])].map((variant): EmojiOption => ({
        hexcode: variant.hexcode,
        label: formatEmojiLabel(variant.label),
        searchText: normalizeSearchText([
          ...searchTerms,
          variant.label,
          variant.unicode,
        ].join(' ')),
        value: variant.unicode,
      }))
    })
}

export function filterEmojiOptions(options: EmojiOption[], query: string) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!terms.length) return options

  return options.filter(option => terms.every(term => option.searchText.includes(term)))
}

export function loadEmojiOptions() {
  emojiOptionsPromise ||= import('emojibase-data/en/compact.json')
    .then(module => buildEmojiOptions(module.default as EmojiDataRecord[]))
    .catch((error) => {
      emojiOptionsPromise = undefined
      throw error
    })

  return emojiOptionsPromise
}
