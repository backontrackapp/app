export function contentRetirementActions(noun: string, archiveSubtitle: string, deleteSubtitle: string) {
  return [
    {
      id: 'archive',
      title: `Archive ${noun}`,
      subtitle: archiveSubtitle,
      icon: 'mdi-archive-arrow-down-outline',
      color: 'warning',
    },
    {
      id: 'delete',
      title: 'Delete permanently',
      subtitle: deleteSubtitle,
      icon: 'mdi-delete-forever-outline',
      color: 'error',
      divider: true,
    },
  ] as const
}

export type ContentRetirementActionId = 'archive' | 'delete'
