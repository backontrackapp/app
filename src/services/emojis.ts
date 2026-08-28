import type { EmojiDataRecord, EmojiOption } from '@/types/emoji'
import supportedEmoji from 'emojibase-data/meta/unicode.json'

let emojiOptionsPromise: Promise<EmojiOption[]> | undefined
const supportedEmojiValues = new Set(supportedEmoji)
const NOTO_EMOJI_ROOT = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main'

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

export function isSupportedEmoji(value: string) {
  return supportedEmojiValues.has(value)
}

export function notoEmojiImageUrl(value: string) {
  if (!isSupportedEmoji(value)) return ''

  const codepoints = [...value]
    .map(character => character.codePointAt(0) || 0)
    .filter(codepoint => codepoint !== 0xfe0e && codepoint !== 0xfe0f)
  const regionalIndicators = codepoints.filter(codepoint => (
    codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff
  ))
  if (codepoints.length === 2 && regionalIndicators.length === 2) {
    const region = regionalIndicators
      .map(codepoint => String.fromCharCode(codepoint - 0x1f1e6 + 65))
      .join('')
    return `${NOTO_EMOJI_ROOT}/third_party/region-flags/png/${region}.png`
  }

  const filename = codepoints
    .map(codepoint => codepoint.toString(16).padStart(4, '0'))
    .join('_')
  return `${NOTO_EMOJI_ROOT}/png/512/emoji_u${filename}.png`
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
