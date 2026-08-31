<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  decimal?: boolean
  allowNegative?: boolean
  maxLength?: number
}>(), {
  decimal: true,
  allowNegative: false,
  maxLength: 10,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const keys = computed(() => [
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ...(props.decimal ? ['.'] : []),
  '0', 'backspace',
])

function press(key: string) {
  if (key === 'backspace') {
    emit('update:modelValue', props.modelValue.slice(0, -1))
    return
  }
  if (key === '.') {
    if (!props.modelValue.includes('.')) {
      emit('update:modelValue', `${props.modelValue || '0'}.`)
    }
    return
  }
  if (props.modelValue.replace('-', '').length >= props.maxLength) return
  emit('update:modelValue', props.modelValue === '0' ? key : `${props.modelValue}${key}`)
}

function toggleSign() {
  if (!props.allowNegative || !props.modelValue || props.modelValue === '0') return
  emit('update:modelValue', props.modelValue.startsWith('-')
    ? props.modelValue.slice(1)
    : `-${props.modelValue}`)
}
</script>

<template>
  <div class="number-pad">
    <div class="number-pad__display">
      <v-btn
        v-if="allowNegative"
        icon="mdi-plus-minus-variant"
        variant="text"
        aria-label="Change amount sign"
        @click="toggleSign"
      />
      <output aria-live="polite">{{ modelValue || '0' }}</output>
    </div>
    <div class="number-pad__keys">
      <v-btn
        v-for="key in keys"
        :key="key"
        size="large"
        variant="tonal"
        :aria-label="key === 'backspace' ? 'Delete last digit' : key === '.' ? 'Decimal point' : key"
        :disabled="key === '.' && modelValue.includes('.')"
        @click="press(key)"
      >
        <v-icon v-if="key === 'backspace'" icon="mdi-backspace-outline" />
        <template v-else>{{ key }}</template>
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.number-pad { display: grid; gap: 1rem; }
.number-pad__display { display: flex; min-height: 4.5rem; align-items: center; justify-content: space-between; padding: .75rem 1rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .16); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant)); font-size: 2rem; font-weight: 900; line-height: 1; }
.number-pad__display output { margin-left: auto; }
.number-pad__keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65rem; }
.number-pad__keys :deep(.v-btn) { min-width: 0; height: 3.375rem; font-size: 1.05rem; font-weight: 850; }
</style>
