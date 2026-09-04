export const INTERVAL_TEMPLATE_ACTIONS = [
  { action: 'play', title: 'Play', icon: 'mdi-play', color: 'secondary' },
  { action: 'edit', title: 'Edit', icon: 'mdi-pencil-outline', divider: true },
  { action: 'duplicate', title: 'Duplicate', icon: 'mdi-content-copy' },
] as const

export type IntervalTemplateAction = typeof INTERVAL_TEMPLATE_ACTIONS[number]['action']
