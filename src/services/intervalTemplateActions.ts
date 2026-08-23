export const INTERVAL_TEMPLATE_ACTIONS = [
  { action: 'play', title: 'Play', icon: 'mdi-play', color: 'secondary' },
  { action: 'edit', title: 'Edit', icon: 'mdi-pencil-outline' },
  { action: 'duplicate', title: 'Duplicate', icon: 'mdi-content-copy' },
  { action: 'delete', title: 'Delete', icon: 'mdi-delete-outline', color: 'error' },
] as const

export type IntervalTemplateAction = typeof INTERVAL_TEMPLATE_ACTIONS[number]['action']
