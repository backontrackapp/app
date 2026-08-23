<script setup lang="ts">
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import {
  INTERVAL_CUE_SOUND_OPTIONS,
  INTERVAL_STEP_TYPES,
} from '@/services/intervalTypes'
import type {
  IntervalCueSound,
  IntervalStepKind,
  IntervalTypeSoundSettings,
} from '@/types/domain'

defineProps<{
  modelValue: IntervalTypeSoundSettings
  disabled?: boolean
  previewing?: IntervalStepKind
}>()

const emit = defineEmits<{
  change: [kind: IntervalStepKind, sound: IntervalCueSound]
  preview: [kind: IntervalStepKind, sound: IntervalCueSound]
}>()

function changeSound(kind: IntervalStepKind, value: unknown) {
  const sound = INTERVAL_CUE_SOUND_OPTIONS.find(option => option.value === value)?.value
  if (sound) emit('change', kind, sound)
}
</script>

<template>
  <div class="interval-sound-list">
    <div
      v-for="type in INTERVAL_STEP_TYPES"
      :key="type.value"
      class="interval-sound-controls"
    >
      <v-select
        :model-value="modelValue[type.value]"
        :items="INTERVAL_CUE_SOUND_OPTIONS"
        :label="`${type.title} sound`"
        density="compact"
        hide-details="auto"
        :disabled="disabled"
        @update:model-value="changeSound(type.value, $event)"
      >
        <template #prepend-inner>
          <IntervalTypeIcon :kind="type.value" />
        </template>
      </v-select>
      <v-btn
        icon="mdi-volume-high"
        variant="tonal"
        color="secondary"
        :aria-label="`Preview ${type.title} sound`"
        :loading="previewing === type.value"
        :disabled="disabled || modelValue[type.value] === 'none'"
        @touchstart.stop
        @click.stop="emit('preview', type.value, modelValue[type.value])"
      />
    </div>
  </div>
</template>

<style scoped>
.interval-sound-list {
  display: grid;
  gap: .75rem;
  margin-top: 1.25rem;
}

.interval-sound-controls {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 2.75rem;
  align-items: center;
  gap: .5rem;
}

.interval-sound-controls :deep(.v-btn) {
  width: 2.75rem;
  height: 2.75rem;
}
</style>
