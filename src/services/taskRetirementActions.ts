export const TASK_RETIREMENT_ACTIONS = [
  {
    id: 'archive',
    title: 'Archive task',
    subtitle: 'Remove it from your schedule while keeping its settings and history.',
    icon: 'mdi-archive-arrow-down-outline',
    color: 'warning',
  },
  {
    id: 'delete',
    title: 'Delete permanently',
    subtitle: 'Permanently remove the task and its task-owned history.',
    icon: 'mdi-delete-forever-outline',
    color: 'error',
    divider: true,
  },
] as const

export type TaskRetirementActionId = typeof TASK_RETIREMENT_ACTIONS[number]['id']
