<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import ContentIcon from '@/components/ContentIcon.vue'
import EmptyStateCard from '@/components/EmptyStateCard.vue'
import { nextScheduledDates } from '@/services/schedule'
import { taskDisplayIcon, TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { taskGoalTracker } from '@/services/taskTrackers'
import { formatTrackingValue } from '@/services/tracking'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import type { Task } from '@/types/domain'

const store = useTaskStore()
const trackingStore = useTrackingStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const router = useRouter()
const { tasks, steps, loading, error } = storeToRefs(store)
const reorderingTasks = ref(false)
const visibleTasks = computed(() => tasks.value.filter(task => !task.archived))

onMounted(() => {
  if (!tasks.value.length) store.load().catch(() => undefined)
  if (!intervalStore.loaded) intervalStore.load().catch(() => undefined)
  if (!flashcardStore.loaded) flashcardStore.load().catch(() => undefined)
  if (!trackingStore.loaded) trackingStore.load().catch(() => undefined)
})

function attachedIntervalName(task: Task) {
  return intervalStore.templates.find((item) => item.id === task.intervalTemplate)?.name || 'Attached interval'
}

function attachedReviewSetName(task: Task) {
  return flashcardStore.reviewSets.find(item => item.id === task.flashcardReviewSet)?.name || 'Attached Review set'
}

function taskIcon(task: Task) {
  const interval = intervalStore.templates.find(item => item.id === task.intervalTemplate)
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === task.flashcardReviewSet)
  return taskDisplayIcon(task, {
    intervalIcon: interval?.icon || (interval ? 'mdi-timer-outline' : undefined),
    reviewSetIcon: reviewSet?.icon || (reviewSet ? 'mdi-cards-outline' : undefined),
  })
}

function scheduleLabel(task: Task) {
  if (task.type === 'program') return `${task.cycleLength}-day ${task.programRepeat ? 'repeating' : 'one-off'} cycle`
  if (task.recurrenceType === 'daily') return 'Every day'
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = task.weekdays.map((day) => dayNames[day]).join(', ')
  return task.recurrenceType === 'interval_weeks' ? `${days} · every ${task.intervalWeeks} weeks` : days
}

function nextLabel(task: Task) {
  const next = nextScheduledDates(task, 1)[0]
  return next ? format(next, 'EEE, MMM d') : 'No upcoming dates'
}

function goalTracker(task: Task) {
  return taskGoalTracker(task, trackingStore.trackers)
}

function targetLabel(task: Task) {
  const tracker = goalTracker(task)
  if (tracker) return formatTrackingValue(tracker, tracker.targetValue)
  return `${task.targetValue} ${task.customUnit || task.unit || ''}`.trim()
}

async function reorderVisibleTasks(result: LongPressDragResult) {
  reorderingTasks.value = true
  try {
    await store.reorderTasks(result.orderedIds)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reorderingTasks.value = false
  }
}
</script>

<template>
  <main class="app-page manage-tasks-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>

    <div class="manage-controls mb-4">
      <span class="text-caption muted">{{ visibleTasks.length }} total</span>
      <v-btn
        icon="mdi-plus"
        color="secondary"
        aria-label="Create task"
        to="/tasks/new"
      />
    </div>

    <div v-if="visibleTasks.length" class="manage-list">
      <v-card
        v-for="task in visibleTasks"
        :key="task.id"
        v-long-press-drag="{
          id: task.id,
          group: 'manage-tasks',
          disabled: visibleTasks.length < 2 || reorderingTasks,
          onDrop: reorderVisibleTasks,
        }"
        class="manage-card surface-card pa-4"
        @click="router.push(`/tasks/${task.id}`)"
      >
        <div class="d-flex align-start ga-3">
          <div class="type-icon" :style="{ background: task.color || TASK_TYPE_PRESENTATION[task.type].color }">
            <ContentIcon :icon="taskIcon(task)" size="1.3125rem" />
          </div>
          <div class="flex-grow-1 min-width-0">
            <div class="d-flex align-center ga-2">
              <h2 class="text-body-1 font-weight-black text-truncate">{{ task.name }}</h2>
              <v-icon v-if="task.mandatory" icon="mdi-shield-check" color="primary" size="15" />
            </div>
            <p class="text-caption muted mt-1">{{ TASK_TYPE_PRESENTATION[task.type].title }} · {{ scheduleLabel(task) }}</p>
            <div v-if="task.type === 'program'" class="step-preview mt-3">
              <span
                v-for="step in steps.filter(item => item.active && item.task === task.id).slice(0, 4)"
                :key="step.id"
              >
                {{ step.name }}
              </span>
            </div>
            <p v-else-if="task.type === 'interval'" class="target-copy mt-3">
              <v-icon icon="mdi-timer-play-outline" size="15" class="mr-1" />
              {{ attachedIntervalName(task) }}
            </p>
            <p v-else-if="task.type === 'flashcards'" class="target-copy mt-3">
              <v-icon icon="mdi-cards-playing-outline" size="15" class="mr-1" />
              {{ attachedReviewSetName(task) }}
            </p>
            <p v-else-if="goalTracker(task) || task.targetValue" class="target-copy mt-3">
              Target: <strong>{{ targetLabel(task) }}</strong>
              <span v-if="goalTracker(task)?.trackingWindow === 'week' || task.goalPeriod === 'week'"> / week</span>
            </p>
          </div>
        </div>
        <v-divider class="my-3" />
        <div class="text-caption">
          <span class="muted">
            <v-icon icon="mdi-calendar-blank-outline" size="15" class="mr-1" />
            Next: {{ nextLabel(task) }}
          </span>
        </div>
      </v-card>
    </div>

    <EmptyStateCard
      v-else-if="!loading"
      icon="mdi-clipboard-plus-outline"
      title="Build your first routine"
      subtitle="Choose a task style and make it yours."
    >
      <template #button>
        <v-btn
          color="secondary"
          to="/tasks/new"
        >
          Create task
        </v-btn>
      </template>
    </EmptyStateCard>
  </main>
</template>

<style scoped>
.manage-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: .75rem;
}

.type-icon {
  display: grid;
  width: 39px;
  height: 39px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 13px;
  color: #191c19;
}

.manage-list {
  display: grid;
  gap: .75rem;
}

.manage-card {
  cursor: pointer;
  transition: box-shadow .18s ease;
}

.manage-card:hover {
  box-shadow: 0 16px 34px rgba(0, 0, 0, .32) !important;
}

.step-preview {
  display: flex;
  gap: .35rem;
  overflow: hidden;
}

.step-preview span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: .62rem;
  white-space: nowrap;
}

.target-copy {
  color: rgb(var(--v-theme-on-surface) / .6);
  font-size: .73rem;
}

@media (min-width: 700px) {
  .manage-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
