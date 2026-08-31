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
  keypadValue.value = String(set[field])
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
    <div class="exercise-set-editor__header">
      <div>
        <h3 :id="labelId">{{ label }}</h3>
        <p>{{ modelValue.length ? `${modelValue.length} ${modelValue.length === 1 ? 'set' : 'sets'}` : 'Add a set to get started.' }}</p>
      </div>
      <v-btn
        class="exercise-set-editor__add"
        color="secondary"
        variant="tonal"
        prepend-icon="mdi-plus"
        :disabled="disabled"
        @click="addSet"
      >
        Add set
      </v-btn>
    </div>

    <div v-if="modelValue.length" class="exercise-set-editor__list mt-3">
      <div
        v-for="(set, index) in modelValue"
        :key="index"
        class="exercise-set-editor__set"
      >
        <div class="exercise-set-editor__set-header">
          <strong>Set {{ index + 1 }}</strong>
          <v-btn
            class="exercise-set-editor__remove"
            icon="mdi-close"
            variant="text"
            :disabled="disabled"
            :aria-label="`Remove set ${index + 1}`"
            @click="removeSet(index)"
          />
        </div>
        <v-row no-gutters>
          <v-col cols="6" class="pr-2">
            <v-btn
              class="exercise-set-editor__value"
              block
              variant="tonal"
              :disabled="disabled"
              @click="openKeypad(index, 'repetitions')"
            >
              <span>Reps</span>
              <strong>{{ set.repetitions }}</strong>
            </v-btn>
          </v-col>
          <v-col cols="6" class="pl-2">
            <v-btn
              class="exercise-set-editor__value"
              block
              variant="tonal"
              :disabled="disabled"
              @click="openKeypad(index, 'weight')"
            >
              <span>{{ weightLabel }}</span>
              <strong>{{ set.weight }} {{ effectiveUnit }}</strong>
            </v-btn>
          </v-col>
        </v-row>
      </div>
    </div>

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
.exercise-set-editor__header { display: flex; min-height: 2.75rem; align-items: center; justify-content: space-between; gap: 1rem; }
.exercise-set-editor__header h3 { font-size: .875rem; font-weight: 800; }
.exercise-set-editor__header p { margin-top: .125rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.exercise-set-editor__add { min-height: 2.75rem; flex: 0 0 auto; }
.exercise-set-editor__list { display: grid; gap: .75rem; }
.exercise-set-editor__set { padding: .75rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .1); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant) / .28); }
.exercise-set-editor__set-header { display: flex; min-height: 2.75rem; align-items: center; justify-content: space-between; gap: .75rem; }
.exercise-set-editor__set-header strong { font-size: .75rem; font-weight: 800; }
.exercise-set-editor__remove { min-width: 2.75rem; min-height: 2.75rem; }
.exercise-set-editor__value { min-height: 4rem; align-items: stretch; flex-direction: column; gap: .125rem; }
.exercise-set-editor__value span { color: rgb(var(--v-theme-on-surface) / .6); font-size: .6875rem; }
.exercise-set-editor__value strong { font-size: 1.125rem; }
.exercise-set-editor__keypad-actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.exercise-set-editor__keypad-actions :deep(.v-btn) { min-height: 3.25rem; }
</style>
