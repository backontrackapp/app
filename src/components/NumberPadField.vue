<script setup lang="ts">
import { computed, ref } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import NumberPad from '@/components/NumberPad.vue'

const props = withDefaults(defineProps<{
  title: string
  disabled?: boolean
  min?: number
  decimal?: boolean
  maxLength?: number
}>(), {
  disabled: false,
  min: 0,
  decimal: true,
  maxLength: 10,
})

const model = defineModel<number>({ required: true })
const dialog = ref(false)
const input = ref('')
const value = computed(() => {
  if (!input.value) return undefined
  if (input.value === '.') return undefined
  const parsed = Number(input.value)
  return Number.isFinite(parsed) && parsed >= props.min ? parsed : undefined
})

function open() {
  if (props.disabled) return
  input.value = ''
  dialog.value = true
}

function save() {
  if (value.value === undefined) return
  model.value = value.value
  dialog.value = false
}
</script>

<template>
  <v-btn
    class="number-pad-field"
    block
    variant="outlined"
    :disabled="props.disabled"
    :aria-label="`${props.title}: ${model}. Open number pad.`"
    @click="open"
  >
    <span class="number-pad-field__title">{{ props.title }}</span>
    <strong class="number-pad-field__value">{{ model }}</strong>
  </v-btn>

  <AppDialog
    v-model="dialog"
    max-width="27.5rem"
    transition="digit-pad-scale-transition"
  >
    <v-card class="pa-5">
      <div class="d-flex align-center justify-space-between mb-5">
        <h2 class="text-h6 font-weight-black">{{ props.title }}</h2>
        <v-btn icon="mdi-close" variant="text" aria-label="Close number pad" @click="dialog = false" />
      </div>
      <NumberPad
        v-model="input"
        :decimal="props.decimal"
        :allow-negative="props.min < 0"
        :max-length="props.maxLength"
        :placeholder="String(model)"
      />
      <div class="number-pad-field__actions mt-5">
        <v-btn variant="tonal" size="large" @click="dialog = false">Cancel</v-btn>
        <v-btn color="secondary" size="large" :disabled="value === undefined" @click="save">Set value</v-btn>
      </div>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.number-pad-field { min-height: 3.5rem; justify-content: flex-start; padding: .625rem 1rem; text-align: left; text-transform: none; }
.number-pad-field :deep(.v-btn__content) { display: flex; width: 100%; flex-direction: column; align-items: flex-start; gap: .125rem; }
.number-pad-field__title { color: rgb(var(--v-theme-on-surface) / .7); font-size: .7rem; font-weight: 700; line-height: 1.1; }
.number-pad-field__value { font-size: 1.05rem; line-height: 1.2; }
.number-pad-field__actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.number-pad-field__actions :deep(.v-btn) { min-height: 3.25rem; }
</style>
