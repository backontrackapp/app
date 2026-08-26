<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import { flashcardDuplicateColumns } from '@/services/flashcardDuplicates'
import type {
  FlashcardDuplicateAction,
  FlashcardDuplicateColumn,
  FlashcardDuplicateResolution,
} from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: boolean
  duplicateCount?: number
  front?: string
  loading?: boolean
  tagsAvailable?: boolean
  imageAvailable?: boolean
}>(), {
  duplicateCount: 1,
  front: '',
  loading: false,
  tagsAvailable: true,
  imageAvailable: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  resolve: [resolution: FlashcardDuplicateResolution]
}>()

const action = ref<FlashcardDuplicateAction>('skip')
const columns = ref<FlashcardDuplicateColumn[]>([])
const plural = computed(() => props.duplicateCount !== 1)
const availableColumns = computed(() => flashcardDuplicateColumns.filter(column => (
  (column.id !== 'tags' || props.tagsAvailable)
  && (column.id !== 'image' || props.imageAvailable)
)))
const canContinue = computed(() => action.value !== 'update' || columns.value.some(column => (
  availableColumns.value.some(available => available.id === column)
)))

watch([
  () => props.modelValue,
  () => props.tagsAvailable,
  () => props.imageAvailable,
], ([open]) => {
  if (!open) return
  action.value = 'skip'
  columns.value = availableColumns.value.map(column => column.id)
}, { immediate: true })

function resolve() {
  if (!canContinue.value || props.loading) return
  emit('resolve', { action: action.value, columns: [...columns.value] })
}
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    persistent
    scrollable
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card prepend-icon="mdi-content-duplicate" :title="plural ? `${duplicateCount} duplicate cards found` : 'Duplicate card found'">

      <v-alert v-if="front && !plural" tile class="text-body-2 muted mt-1">“{{ front.trim() }}” already exists.</v-alert>
      <v-alert v-else tile class="text-body-2 muted mt-1">
        Front faces are matched after trimming spaces and ignoring letter case.
      </v-alert>

      <v-divider></v-divider>
      <v-card-text>
        <v-radio-group v-model="action" hide-details="auto">
            <v-radio value="skip" label="Skip the incoming duplicate" />
            <p class="flashcard-duplicate-description text-disabled">Keep the existing card unchanged and do not add this duplicate.</p>
            <v-radio value="replace" label="Replace the existing card" class="mt-3" />
            <p class="flashcard-duplicate-description text-disabled">Keep its identity and history, but use all incoming card content.</p>
            <v-radio value="duplicate" label="Create a duplicate" class="mt-3" />
            <p class="flashcard-duplicate-description text-disabled">Keep the existing card and create the incoming card separately.</p>
            <v-radio value="update" label="Update selected columns" class="mt-3" />
            <p class="flashcard-duplicate-description text-disabled">Keep unselected content on the existing card.</p>
        </v-radio-group>

        <v-expand-transition>
            <div v-if="action === 'update'">
            <div class="flashcard-duplicate-columns mt-3">
                <v-checkbox
                v-for="column in flashcardDuplicateColumns"
                :key="column.id"
                v-model="columns"
                :value="column.id"
                :label="column.title"
                :disabled="(column.id === 'tags' && !tagsAvailable)
                  || (column.id === 'image' && !imageAvailable)"
                hide-details="auto"
                density="compact"
                />
                <p v-if="!canContinue" class="text-caption text-error mt-2">Select at least one column.</p>
            </div>
            </div>
        </v-expand-transition>
      </v-card-text>

      <v-divider></v-divider>
      <v-card-actions class="d-flex align-center">
        <v-btn
        variant="text"
        :disabled="loading"
        style="flex: 1"
        size="large"
        @click="emit('update:modelValue', false)"
        >
            Cancel
        </v-btn>
        <v-btn
          color="secondary"
          size="large"
          variant="flat"
          style="flex: 1"
          :loading="loading"
          :disabled="!canContinue"
          @click="resolve"
        >
          Continue
        </v-btn>
      </v-card-actions>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.flashcard-duplicate-heading { display: flex; align-items: flex-start; gap: .75rem; }
.flashcard-duplicate-heading__icon { display: grid; width: 3rem; height: 3rem; flex: 0 0 auto; place-items: center; border-radius: .9375rem; background: rgb(var(--v-theme-warning) / .16); color: rgb(var(--v-theme-warning)); }
.flashcard-duplicate-description { margin-left: 2.5rem; font-size: .8125rem; }
.flashcard-duplicate-columns { margin-left: 2.5rem; padding: .75rem 1rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .08); border-radius: .75rem; background: rgb(var(--v-theme-on-surface) / .04); }
.flashcard-duplicate-actions { display: flex; align-items: center; justify-content: flex-end; gap: .5rem; }

@media (max-width: 37.4375rem) {
  .flashcard-duplicate-actions { flex-direction: column-reverse; }
  .flashcard-duplicate-actions .v-btn { width: 100%; }
}
</style>
