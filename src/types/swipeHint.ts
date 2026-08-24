export type SwipeHintDirection = 'up' | 'right' | 'down' | 'left'

export interface SwipeHintItem {
  direction: SwipeHintDirection
  label: string
}

export interface SwipeHintOptions {
  id: string
  items: SwipeHintItem[]
  repeat?: boolean
}
