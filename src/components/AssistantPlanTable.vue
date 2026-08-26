<script setup lang="ts">
import { computed } from 'vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  AssistantPlanCardRow,
  AssistantPlanChangeRow,
  AssistantPlanEntry,
} from '@/types/domain'

const props = defineProps<{
  entry: AssistantPlanEntry
  busy?: boolean
}>()
const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
const flashcards = useFlashcardStore()

const plan = computed(() => props.entry.plan)
const changeRows = computed<AssistantPlanChangeRow[]>(() => [
  ...(plan.value.changes || []).map((change, index) => ({
    ...change,
    id: `review-set-${index}`,
    item: plan.value.destinationName,
  })),
  ...(plan.value.updatedCards || []).flatMap(card => card.changes.map((change, index) => ({
    ...change,
    id: `${card.id}-${index}`,
    item: card.label,
  }))),
])
const cardRows = computed<AssistantPlanCardRow[]>(() => {
  if (changeRows.value.length) return []
  const existingCards = new Map(flashcards.cards.map(card => [card.id, card]))
  return [
    ...plan.value.newCards.map((card, index) => ({
      ...card,
      id: `new-${index}`,
      source: 'New' as const,
    })),
    ...plan.value.existingCardIds.flatMap((id) => {
      const card = existingCards.get(id)
      return card ? [{
        id: `existing-${id}`,
        source: 'Existing' as const,
        front: card.front,
        back: card.back,
        transliteration: card.transliteration || '',
        note: card.note || '',
      }] : []
    }),
  ]
})
</script>

<template>
  <section class="assistant-plan" aria-label="Proposed assistant changes">
    <div>
      <strong>{{ plan.title }}</strong>
      <p class="text-body-2 text-medium-emphasis mt-1 mb-0">{{ plan.description }}</p>
    </div>
    <v-alert
      v-if="plan.convertsTagSelection"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-3"
    >
      This tag-based set will become a fixed card list while keeping its current cards.
    </v-alert>
    <div
      class="assistant-plan__table mt-3"
      role="region"
      aria-label="Proposed changes table"
      tabindex="0"
    >
      <v-table density="compact" bg-color="transparent">
        <colgroup>
          <col><col><col><col>
        </colgroup>
        <template v-if="changeRows.length">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="change in changeRows" :key="change.id">
              <th scope="row">{{ change.item }}</th>
              <td>{{ change.label }}</td>
              <td>{{ change.before || '—' }}</td>
              <td>{{ change.after || '—' }}</td>
            </tr>
          </tbody>
        </template>
        <template v-else>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Front</th>
              <th scope="col">Back</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cardRows" :key="card.id">
              <td>
                <v-chip size="x-small" :color="card.source === 'New' ? 'secondary' : undefined" variant="tonal">
                  {{ card.source }}
                </v-chip>
              </td>
              <th scope="row">{{ card.front }}</th>
              <td>{{ card.back }}</td>
              <td>
                <span v-if="card.transliteration" class="d-block">{{ card.transliteration }}</span>
                <span v-if="card.note" class="d-block text-medium-emphasis">{{ card.note }}</span>
                <span v-if="!card.transliteration && !card.note">—</span>
              </td>
            </tr>
          </tbody>
        </template>
      </v-table>
    </div>
    <div class="assistant-plan__actions d-flex justify-end align-center ga-2 pt-3">
      <template v-if="entry.status === 'pending'">
        <v-btn variant="text" :disabled="busy" @click="emit('cancel')">Cancel</v-btn>
        <v-btn color="secondary" :loading="busy" @click="emit('confirm')">Confirm</v-btn>
      </template>
      <v-chip
        v-else
        :color="entry.status === 'applied' ? 'success' : undefined"
        :prepend-icon="entry.status === 'applied' ? 'mdi-check' : 'mdi-cancel'"
        size="small"
        variant="tonal"
      >
        {{ entry.status === 'applied' ? 'Applied' : 'Cancelled' }}
      </v-chip>
    </div>
  </section>
</template>

<style scoped>
.assistant-plan {
  display: flex;
  min-height: min-content;
  flex: 0 0 auto;
  flex-direction: column;
}
.assistant-plan__table {
  overflow-x: auto;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .1);
  border-radius: .75rem;
  background: rgb(var(--v-theme-surface));
}
.assistant-plan__table :deep(table) {
  min-width: 28rem;
  table-layout: fixed;
}
.assistant-plan__table :deep(col) { width: 25%; }
.assistant-plan__table :deep(th),
.assistant-plan__table :deep(td) {
  overflow-wrap: anywhere;
  vertical-align: middle;
  white-space: pre-wrap;
}
.assistant-plan__table :deep(thead th) {
  color: rgb(var(--v-theme-on-surface) / .64);
  font-size: .7rem;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.assistant-plan__table :deep(tbody th) {
  color: rgb(var(--v-theme-on-surface));
  font-size: .75rem;
  text-align: left;
}
.assistant-plan__actions {
  min-height: 3.5rem;
  border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
}
</style>
