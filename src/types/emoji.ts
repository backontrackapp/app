export interface EmojiDataRecord {
  group?: number
  hexcode: string
  label: string
  order?: number
  skins?: EmojiDataRecord[]
  tags?: string[]
  unicode: string
}

export interface EmojiOption {
  hexcode: string
  label: string
  searchText: string
  value: string
}
