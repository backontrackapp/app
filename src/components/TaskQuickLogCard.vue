<script setup lang="ts">
import { computed } from 'vue'
import { Ripple } from 'vuetify/directives'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import type { TaskProgress } from '@/types/domain'

const props = defineProps<{
  progress: TaskProgress
}>()
const emit = defineEmits<{
  actions: [progress: TaskProgress]
}>()
const vRipple = Ripple

const task = computed(() => props.progress.task)
const title = computed(() => props.progress.programStep?.name || task.value.name)
const presentation = computed(() => TASK_TYPE_PRESENTATION[task.value.type])
const taskColor = computed(() => task.value.color || presentation.value.color)
const completionItems = computed(() => props.progress.completionItems || [])
const hasMultipleCompletions = computed(() => completionItems.value.length > 1)
const singleCompletion = computed(() => completionItems.value.length === 1
  ? completionItems.value[0]
  : undefined)
const isSessionDuration = computed(() => (
  !props.progress.programStep
  && ['interval', 'flashcards'].includes(task.value.type)
  && task.value.sessionGoalType === 'duration'
))
const hasProgress = computed(() => {
  if (hasMultipleCompletions.value || isSessionDuration.value) return true
  if (!props.progress.programStep && task.value.type === 'tracking') return true
  const type = singleCompletion.value?.type || task.value.type
  return ['quantity', 'duration', 'daily_total', 'step_counter'].includes(type)
})
const cardInk = computed(() => {
  const hex = taskColor.value.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return '#17200F'

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#17200F' : '#FFFFFF'
})
</script>

<template>
  <v-card
    class="task-quick-log surface-card"
    :class="{ 'task-quick-log--complete': progress.complete }"
    :style="{ '--quick-log-color': taskColor, '--quick-log-ink': cardInk }"
  >
    <button
      v-ripple
      type="button"
      class="task-quick-log__action"
      :aria-label="`Open actions for ${title}`"
      @click="emit('actions', progress)"
    >
      <span class="task-quick-log__color">
        <v-icon :icon="progress.complete ? 'mdi-check-bold' : presentation.icon" size="28" />
      </span>
      <span class="task-quick-log__content">
        <strong>{{ title }}</strong>
        <v-progress-linear
          v-if="hasProgress"
          class="task-quick-log__progress"
          :model-value="progress.percent"
          :color="taskColor"
          bg-color="grey-darken-2"
          rounded
          :aria-label="`${title}: ${Math.round(progress.percent)}% complete`"
        />
      </span>
    </button>
  </v-card>
</template>

<style scoped>
.task-quick-log {
  width: 8rem;
  min-width: 8rem;
  overflow: hidden;
}

.task-quick-log--complete {
  filter: grayscale(1);
  opacity: .55;
}

.task-quick-log__action {
  display: flex;
  width: 100%;
  min-height: 7rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  flex-direction: column;
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.task-quick-log__action:focus-visible {
  outline: .125rem solid currentColor;
  outline-offset: -.1875rem;
}

.task-quick-log__color {
  display: grid;
  width: 100%;
  min-height: 4rem;
  place-items: center;
  background: var(--quick-log-color);
  color: var(--quick-log-ink);
}

.task-quick-log--complete .task-quick-log__color {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .52);
}

.task-quick-log__content {
  display: flex;
  width: 100%;
  min-height: 3rem;
  padding: .6rem .7rem .7rem;
  justify-content: center;
  flex: 1 1 auto;
  flex-direction: column;
  gap: .5rem;
}

.task-quick-log__content strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: .78rem;
  font-weight: 900;
  line-height: 1.2;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.task-quick-log--complete .task-quick-log__content strong {
  color: rgb(var(--v-theme-on-surface) / .58);
}

.task-quick-log__progress {
  height: .35rem !important;
  flex: 0 0 .35rem;
}
</style>
