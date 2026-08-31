<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import NumberPad from '@/components/NumberPad.vue'
import { useAuthStore } from '@/stores/auth'
import { normalizeExerciseWeightUnit } from '@/services/exerciseSettings'
import type { ExerciseSet, WeightUnit } from '@/types/exercise'

const props = withDefaults(defineProps<{
  modelValue?: ExerciseSet[]
  unit?: WeightUnit
  label?: string
  disabled?: boolean
  lockedSetCount?: number
}>(), {
  modelValue: () => [],
  label: 'Sets',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: ExerciseSet[]]
}>()

const labelId = `exercise-set-editor-label-${useId()}`
const auth = useAuthStore()
const effectiveUnit = computed<WeightUnit>(() => props.unit || normalizeExerciseWeightUnit(
  auth.user?.settings?.exerciseWeightUnit,
))
const canChangeSetCount = computed(() => props.lockedSetCount === undefined)
const weightLabel = computed(() => `Weight (${effectiveUnit.value})`)
const keypadDialog = ref(false)
const keypadValue = ref('')
const keypadTarget = ref<{ index: number; field: keyof ExerciseSet }>()
const keypadTitle = computed(() => keypadTarget.value?.field === 'weight'
  ? weightLabel.value
  : 'Reps')
const keypadDecimal = computed(() => keypadTarget.value?.field === 'weight')
const keypadNumber = computed(() => {
  if (!keypadValue.value || keypadValue.value === '.') return undefined
  const value = Number(keypadValue.value)
  return Number.isFinite(value) && value >= 0 ? value : undefined
})

function valueFor(value: unknown, integer = false) {
  const parsed = Number(value)
  const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  return integer ? Math.round(normalized) : normalized
}

function updateSet(index: number, field: keyof ExerciseSet, value: unknown) {
  const sets = props.modelValue.map((set, setIndex) => (
    setIndex === index
      ? {
          ...set,
          [field]: valueFor(value, field === 'repetitions'),
        }
      : set
  ))
  emit('update:modelValue', sets)
}

function addSet() {
  emit('update:modelValue', [
    ...props.modelValue,
    { repetitions: 8, weight: 0 },
  ])
}

function removeSet(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, setIndex) => setIndex !== index))
}

function openKeypad(index: number, field: keyof ExerciseSet) {
  const set = props.modelValue[index]
  if (!set || props.disabled) return
  keypadTarget.value = { index, field }
  keypadValue.value = ''
  keypadDialog.value = true
}

function saveKeypadValue() {
  const target = keypadTarget.value
  if (!target || keypadNumber.value === undefined) return
  updateSet(target.index, target.field, keypadNumber.value)
  keypadDialog.value = false
}
</script>

<template>
  <section class="exercise-set-editor" :aria-labelledby="labelId">
    <v-alert
      v-if="!modelValue.length"
      class="exercise-set-editor__empty"
      type="info"
      variant="tonal"
      density="comfortable"
      :icon="false"
    >
      <div class="exercise-set-editor__header">
        <h3 :id="labelId">{{ label }}</h3>
        <p>
          {{ canChangeSetCount
            ? 'No reps or weight logged. Add a set to get started.'
            : 'No reps or weight to log because this interval has no Train segments.' }}
        </p>
      </div>
      <v-btn
        v-if="canChangeSetCount"
        class="exercise-set-editor__add mt-3"
        block
        variant="outlined"
        prepend-icon="mdi-plus"
        :disabled="disabled"
        @click="addSet"
      >
        Add set
      </v-btn>
    </v-alert>

    <template v-else>
      <div class="exercise-set-editor__header">
        <h3 :id="labelId">{{ label }}</h3>
        <p>{{ `${modelValue.length} ${modelValue.length === 1 ? 'set' : 'sets'}` }}</p>
      </div>
      <div
        class="exercise-set-editor__list mt-3"
        :class="{ 'exercise-set-editor__list--locked': !canChangeSetCount }"
        role="table"
        aria-label="Exercise sets"
      >
        <div class="exercise-set-editor__table-header" role="row">
          <span v-if="canChangeSetCount" aria-hidden="true" />
          <span role="columnheader">Reps</span>
          <span role="columnheader">{{ weightLabel }}</span>
          <span aria-hidden="true" />
        </div>
        <div v-for="(set, index) in modelValue" :key="index" class="exercise-set-editor__set" role="row">
          <strong class="exercise-set-editor__set-number" role="rowheader" :aria-label="`Set ${index + 1}`">{{ index + 1 }}</strong>
          <div role="cell">
            <v-btn
              class="exercise-set-editor__value"
              block
              variant="tonal"
              :disabled="disabled"
              :aria-label="`Set ${index + 1}, ${set.repetitions} reps`"
              @click="openKeypad(index, 'repetitions')"
            >
              {{ set.repetitions }}
            </v-btn>
          </div>
          <div role="cell">
            <v-btn
              class="exercise-set-editor__value"
              block
              variant="tonal"
              :disabled="disabled"
              :aria-label="`Set ${index + 1}, ${set.weight} ${effectiveUnit}`"
              @click="openKeypad(index, 'weight')"
            >
              {{ set.weight }}
            </v-btn>
          </div>
          <div v-if="canChangeSetCount" class="exercise-set-editor__actions" role="cell">
            <v-btn
              class="exercise-set-editor__remove"
              icon="mdi-close"
              variant="text"
              :disabled="disabled"
              :aria-label="`Remove set ${index + 1}`"
              @click="removeSet(index)"
            />
          </div>
        </div>
      </div>
      <v-btn
        v-if="canChangeSetCount"
        class="exercise-set-editor__add mt-3"
        block
        color="secondary"
        variant="tonal"
        prepend-icon="mdi-plus"
        :disabled="disabled"
        @click="addSet"
      >
        Add set
      </v-btn>
    </template>

    <AppDialog
      v-model="keypadDialog"
      max-width="27.5rem"
      transition="digit-pad-scale-transition"
    >
      <v-card class="pa-5">
        <div class="d-flex align-center justify-space-between mb-5">
          <h2 class="text-h6 font-weight-black">{{ keypadTitle }}</h2>
          <v-btn icon="mdi-close" variant="text" aria-label="Close number pad" @click="keypadDialog = false" />
        </div>
        <NumberPad v-model="keypadValue" :decimal="keypadDecimal" />
        <div class="exercise-set-editor__keypad-actions mt-5">
          <v-btn variant="tonal" size="large" @click="keypadDialog = false">Cancel</v-btn>
          <v-btn color="secondary" size="large" :disabled="keypadNumber === undefined" @click="saveKeypadValue">Set value</v-btn>
        </div>
      </v-card>
    </AppDialog>
  </section>
</template>

<style scoped>
.exercise-set-editor { min-width: 0; }
.exercise-set-editor__header { min-height: 2.75rem; }
.exercise-set-editor__header h3 { font-size: .875rem; font-weight: 800; }
.exercise-set-editor__header p { margin-top: .125rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.exercise-set-editor__add { min-height: 2.75rem; }
.exercise-set-editor__list { display: grid; gap: .5rem; }
.exercise-set-editor__table-header,
.exercise-set-editor__set { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr) 2.75rem; gap: .5rem; }
.exercise-set-editor__list--locked .exercise-set-editor__table-header,
.exercise-set-editor__list--locked .exercise-set-editor__set { grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr); }
.exercise-set-editor__table-header { padding-inline: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .6875rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.exercise-set-editor__set { min-height: 3.25rem; align-items: stretch; padding: .25rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .1); border-radius: .75rem; background: rgb(var(--v-theme-surface-variant) / .28); }
.exercise-set-editor__set-number { align-self: center; color: rgb(var(--v-theme-on-surface) / .6); font-size: .75rem; text-align: center; }
.exercise-set-editor__actions { display: flex; justify-content: center; }
.exercise-set-editor__remove { min-width: 2.75rem; min-height: 2.75rem; }
.exercise-set-editor__value { width: 100%; min-width: 0; height: 100%; min-height: 2.75rem; font-size: 1rem; }
.exercise-set-editor__keypad-actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.exercise-set-editor__keypad-actions :deep(.v-btn) { min-height: 3.25rem; }
</style>
