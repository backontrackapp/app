import { ref } from 'vue'
import { defineStore, getActivePinia } from 'pinia'

export const useSnackbarStore = defineStore('snackbar', () => {
  const visible = ref(false)
  const message = ref('')
  const revision = ref(0)

  function showDeletion(subject: string) {
    message.value = `${subject} deleted.`
    revision.value += 1
    visible.value = true
  }

  function showSaved(subject: string, name: string) {
    const normalizedName = name.replace(/\s+/g, ' ').trim() || 'Untitled'
    const displayName = normalizedName.length > 56
      ? `${normalizedName.slice(0, 55).trimEnd()}…`
      : normalizedName
    message.value = `${subject} “${displayName}” saved.`
    revision.value += 1
    visible.value = true
  }

  function dismiss() {
    visible.value = false
  }

  return { visible, message, revision, showDeletion, showSaved, dismiss }
})

export function showSavedSnackbar(subject: string, name: string) {
  const pinia = getActivePinia()
  if (pinia) useSnackbarStore(pinia).showSaved(subject, name)
}
