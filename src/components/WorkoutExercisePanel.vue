<script setup lang="ts">
import { ref, watch } from 'vue'
import ExerciseDetailsPanel from '@/components/ExerciseDetailsPanel.vue'
import ExerciseSetEditor from '@/components/ExerciseSetEditor.vue'
import type { ExerciseOption, ExerciseSet } from '@/types/exercise'

const props = withDefaults(defineProps<{
  exercise?: ExerciseOption
  modelValue?: ExerciseSet[]
  lockedSetCount?: number
  active?: boolean
  error?: string
}>(), {
  modelValue: () => [],
  active: true,
  error: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: ExerciseSet[]]
  'show-progress': []
}>()

const activeTab = ref<'repetitions' | 'exercise'>('repetitions')

watch(() => props.exercise?.id, () => {
  activeTab.value = 'repetitions'
})
</script>

<template>
  <article
    class="workout-exercise-panel surface-card mt-4"
    :aria-label="exercise ? `Workout details for ${exercise.name}` : 'Workout details'"
  >
    <v-tabs
      v-model="activeTab"
      color="secondary"
      density="comfortable"
      grow
      class="workout-exercise-panel__tabs"
    >
      <v-tab value="repetitions" prepend-icon="mdi-weight-lifter" tile>
        Repetitions
      </v-tab>
      <v-tab value="exercise" prepend-icon="mdi-dumbbell" :disabled="!exercise" tile>
        Details
      </v-tab>
    </v-tabs>

    <v-divider />

    <v-window
      v-model="activeTab"
      :touch="false"
      class="workout-exercise-panel__window"
    >
      <v-window-item value="repetitions" class="workout-exercise-panel__window-item">
        <div class="workout-exercise-panel__repetitions pa-4">
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ error }}
          </v-alert>
          <ExerciseSetEditor
            :model-value="modelValue"
            label="Confirm reps and weight"
            :locked-set-count="lockedSetCount"
            @update:model-value="emit('update:modelValue', $event)"
          />
        </div>
      </v-window-item>

      <v-window-item value="exercise" class="workout-exercise-panel__window-item">
        <ExerciseDetailsPanel
          v-if="exercise"
          :exercise="exercise"
          :active="active && activeTab === 'exercise'"
          embedded
          @show-progress="emit('show-progress')"
        />
      </v-window-item>
    </v-window>
  </article>
</template>

<style scoped>
.workout-exercise-panel {
  display: flex;
  width: 100%;
  max-width: 54.25rem;
  height: 100%;
  min-height: 0;
  margin-inline: auto;
  flex-direction: column;
  overflow: hidden;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface) / .72);
  color: rgb(var(--v-theme-on-surface));
}

.workout-exercise-panel__tabs {
  min-height: 3rem;
  flex: 0 0 auto;
}

.workout-exercise-panel__tabs :deep(.v-btn) {
  min-width: 0;
  min-height: 3rem;
  padding-inline: .5rem;
}

.workout-exercise-panel__window {
  min-height: 0;
  flex: 1;
}

.workout-exercise-panel__window :deep(.v-window__container),
.workout-exercise-panel__window-item {
  height: 100%;
  min-height: 0;
}

.workout-exercise-panel__window :deep(.v-window-item) {
  transition-duration: 200ms !important;
}

.workout-exercise-panel__repetitions {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

@media (prefers-reduced-motion: reduce) {
  .workout-exercise-panel__window :deep(.v-window-item) {
    transition-duration: 0s !important;
  }
}
</style>
