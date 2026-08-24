import type { FlashcardSpeechWord } from '@/types/domain'

export interface FlashcardSpeechTextPart {
  value: string
  start: number
  end: number
  wordIndex?: number
}

const HAN_CHARACTER = /\p{Script=Han}/u
const SPEECH_WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u
const PINYIN_CHARACTER = /[\p{Script=Latin}\p{M}1-5]/u
const PINYIN_TONE_MARK = /[\u0300\u0301\u0304\u030c]/gu
const PINYIN_SYLLABLES = new Set(`
  a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
  ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou
  chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
  da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
  e ei en eng er fa fan fang fei fen feng fo fou fu
  ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
  ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
  ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
  ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
  la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve
  ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
  n na nai nan nang nao ne nei nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve
  o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
  qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
  ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo
  sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou
  shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo
  ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
  wa wai wan wang wei wen weng wo wu
  xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
  ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
  za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi
  zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo
`.trim().split(/\s+/u))
let pendingSpeechWordHandler: ((word?: FlashcardSpeechWord) => void) | undefined
let activeSpeechWordHandler: ((word?: FlashcardSpeechWord) => void) | undefined
export type FlashcardSpeechWordHandler = (word?: FlashcardSpeechWord) => void

export function prepareFlashcardSpeechWordTracking(
  handler: (word?: FlashcardSpeechWord) => void,
) {
  pendingSpeechWordHandler = handler
}

export function takePreparedFlashcardSpeechWordTracking() {
  const handler = pendingSpeechWordHandler
  pendingSpeechWordHandler = undefined
  return handler
}

export function beginFlashcardSpeechWordTracking(handler?: FlashcardSpeechWordHandler) {
  activeSpeechWordHandler?.(undefined)
  activeSpeechWordHandler = handler
  activeSpeechWordHandler?.(undefined)
}

export function updateFlashcardSpeechWord(word?: FlashcardSpeechWord) {
  activeSpeechWordHandler?.(word)
}

export function flashcardSpeechWordTrackingIsActive() {
  return Boolean(activeSpeechWordHandler)
}

export function clearFlashcardSpeechWordTracking() {
  pendingSpeechWordHandler = undefined
  activeSpeechWordHandler?.(undefined)
  activeSpeechWordHandler = undefined
}

export function speechLanguageUsesPinyin(language: string) {
  const base = language.trim().toLocaleLowerCase().replaceAll('_', '-').split('-')[0]
  return base === 'zh' || base === 'cmn'
}

export function flashcardSpeechTextParts(text: string, language = ''): FlashcardSpeechTextPart[] {
  if (!text) return []
  const chinese = speechLanguageUsesPinyin(language)
  const parts: FlashcardSpeechTextPart[] = []
  let wordIndex = 0
  let partStart = 0
  let partIsWord: boolean | undefined

  const appendPart = (end: number) => {
    if (end <= partStart || partIsWord === undefined) return
    parts.push({
      value: text.slice(partStart, end),
      start: partStart,
      end,
      ...(partIsWord ? { wordIndex: wordIndex++ } : {}),
    })
  }

  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index)
    if (point === undefined) break
    const character = String.fromCodePoint(point)
    const size = character.length
    const isHan = chinese && HAN_CHARACTER.test(character)
    const isWord = SPEECH_WORD_CHARACTER.test(character)
    if (isHan) {
      appendPart(index)
      parts.push({ value: character, start: index, end: index + size, wordIndex: wordIndex++ })
      partStart = index + size
      partIsWord = undefined
    } else if (partIsWord === undefined) {
      partStart = index
      partIsWord = isWord
    } else if (partIsWord !== isWord) {
      appendPart(index)
      partStart = index
      partIsWord = isWord
    }
    index += size
  }
  appendPart(text.length)
  return parts
}

function normalizedPinyinSyllable(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/u\u0308/gu, 'v')
    .replace(/\p{M}/gu, '')
    .replace(/[1-5]/gu, '')
}

function pinyinToneCount(value: string) {
  const normalized = value.normalize('NFD')
  return (normalized.match(PINYIN_TONE_MARK) || []).length
    + (normalized.match(/[1-5]/gu) || []).length
}

function splitPinyinChunk(value: string) {
  const offsets = [0]
  for (const character of value) offsets.push(offsets[offsets.length - 1] + character.length)
  const solutions = new Map<number, { ends: number[]; neutral: number } | undefined>()

  function solve(startIndex: number): { ends: number[]; neutral: number } | undefined {
    if (startIndex === offsets.length - 1) return { ends: [], neutral: 0 }
    if (solutions.has(startIndex)) return solutions.get(startIndex)
    let best: { ends: number[]; neutral: number } | undefined

    for (let endIndex = startIndex + 1; endIndex < offsets.length; endIndex += 1) {
      const candidate = value.slice(offsets[startIndex], offsets[endIndex])
      const toneCount = pinyinToneCount(candidate)
      if (toneCount > 1 || /[1-5]./u.test(candidate)) continue
      if (!PINYIN_SYLLABLES.has(normalizedPinyinSyllable(candidate))) continue
      const remainder = solve(endIndex)
      if (!remainder) continue
      const solution = {
        ends: [offsets[endIndex], ...remainder.ends],
        neutral: remainder.neutral + (toneCount === 0 ? 1 : 0),
      }
      if (
        !best
        || solution.neutral < best.neutral
        || (solution.neutral === best.neutral && solution.ends.length < best.ends.length)
      ) best = solution
    }

    solutions.set(startIndex, best)
    return best
  }

  return solve(0)?.ends || [value.length]
}

export function pinyinTextParts(text: string): FlashcardSpeechTextPart[] {
  if (!text) return []
  const parts: FlashcardSpeechTextPart[] = []
  let wordIndex = 0
  let chunkStart = 0
  let chunkIsPinyin: boolean | undefined

  const appendChunk = (end: number) => {
    if (end <= chunkStart || chunkIsPinyin === undefined) return
    const value = text.slice(chunkStart, end)
    if (!chunkIsPinyin) {
      parts.push({ value, start: chunkStart, end })
      return
    }
    let syllableStart = 0
    splitPinyinChunk(value).forEach((syllableEnd) => {
      parts.push({
        value: value.slice(syllableStart, syllableEnd),
        start: chunkStart + syllableStart,
        end: chunkStart + syllableEnd,
        wordIndex: wordIndex++,
      })
      syllableStart = syllableEnd
    })
  }

  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index)
    if (point === undefined) break
    const character = String.fromCodePoint(point)
    const isPinyin = PINYIN_CHARACTER.test(character)
    if (chunkIsPinyin === undefined) {
      chunkStart = index
      chunkIsPinyin = isPinyin
    } else if (chunkIsPinyin !== isPinyin) {
      appendChunk(index)
      chunkStart = index
      chunkIsPinyin = isPinyin
    }
    index += character.length
  }
  appendChunk(text.length)
  return parts
}

export function pinyinTone(value: string) {
  const normalized = value.normalize('NFC').toLocaleLowerCase()
  if (/[āēīōūǖ]/u.test(normalized) || /1(?:\D|$)/u.test(normalized)) return 1
  if (/[áéíóúǘ]/u.test(normalized) || /2(?:\D|$)/u.test(normalized)) return 2
  if (/[ǎěǐǒǔǚ]/u.test(normalized) || /3(?:\D|$)/u.test(normalized)) return 3
  if (/[àèìòùǜ]/u.test(normalized) || /4(?:\D|$)/u.test(normalized)) return 4
  return 5
}
