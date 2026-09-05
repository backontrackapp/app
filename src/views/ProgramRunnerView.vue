<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ContentIcon from '@/components/ContentIcon.vue'
import NumberPadField from '@/components/NumberPadField.vue'
import ProgramRequirementList from '@/components/ProgramRequirementList.vue'
import RunnerStartScreen from '@/components/RunnerStartScreen.vue'
import RunnerSessionActions from '@/components/RunnerSessionActions.vue'
import WorkoutExercisePanel from '@/components/WorkoutExercisePanel.vue'
import { stopBackgroundInterval } from '@/services/backgroundInterval'
import { exercisePresentationById } from '@/services/exercisePresentations'
import { loadExerciseOptions } from '@/services/exercises'
import { stopFlashcardSpeech } from '@/services/flashcardSpeech'
import { createIntervalFlashcardReviewSnapshot } from '@/services/flashcards'
import { playIntervalGoCue, prepareIntervalCues } from '@/services/intervalCues'
import {
  formatIntervalDuration,
  intervalDuration,
  intervalStepKindCount,
  resolveIntervalStep,
} from '@/services/intervals'
import {
  programStepRequirementName,
  workoutSetsForCount,
} from '@/services/programStepCompletions'
import {
  programRunnerRequirementMenuItems,
  programRunnerSessionMenuItems,
} from '@/services/runnerSessionActions'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import type {
  ProgramStepCompletionProgress,
  ProgramStepRequirementListItem,
  RunnerSessionAction,
  TaskProgress,
} from '@/types/domain'
import type { ExerciseOption, ExerciseSet } from '@/types/exercise'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const loading = ref(true)
const error = ref('')
const screen = ref<'start' | 'list' | 'requirement' | 'finished'>('start')
const activeIndex = ref(0)
const working = ref(false)
const sessionActionsSheet = ref(false)
const requirementActionsSheet = ref(false)
const selectedRequirementId = ref('')
const endDialog = ref(false)
const replaceActiveIntervalDialog = ref(false)
const replacingActiveInterval = ref(false)
const activeIntervalName = ref('')
const amount = ref(0)
const sets = ref<ExerciseSet[]>([])
const exercise = shallowRef<ExerciseOption>()

const taskId = computed(() => typeof route.params.taskId === 'string' ? route.params.taskId : '')
const dateKey = computed(() => typeof route.query.date === 'string' ? route.query.date : '')
const scheduledTime = computed(() => typeof route.query.time === 'string' ? route.query.time : '')
const stepId = computed(() => typeof route.query.step === 'string' ? route.query.step : '')
const focusCompletionId = computed(() => typeof route.query.focus === 'string' ? route.query.focus : '')
const task = computed(() => taskStore.tasks.find(item => item.id === taskId.value))
const progress = computed<TaskProgress | undefined>(() => {
  if (!task.value || !dateKey.value) return undefined
  return taskStore.progressForDate(parseISO(dateKey.value)).find(item => (
    item.task.id === taskId.value
    && item.programStep?.id === stepId.value
    && (!scheduledTime.value || item.scheduledTime === scheduledTime.value)
  ))
})
const requirements = computed(() => progress.value?.completionItems || [])
const current = computed<ProgramStepCompletionProgress | undefined>(() => requirements.value[activeIndex.value])
const currentPresentation = computed(() => exercisePresentationById(current.value?.exercise))
const requirementName = computed(() => programStepRequirementName(
  current.value,
  exercise.value?.name || currentPresentation.value?.name,
  current.value?.type === 'workout' ? 'Workout' : 'Requirement',
))
const runnerReturnTo = computed(() => router.resolve({
  name: 'program-runner',
  params: { taskId: taskId.value },
  query: {
    date: dateKey.value,
    step: stepId.value,
    ...(scheduledTime.value ? { time: scheduledTime.value } : {}),
    ...(current.value ? { focus: current.value.id } : {}),
    ...(current.value?.type === 'interval' && !current.value.exercise
      ? { intervalPreview: current.value.id }
      : {}),
    resume: '1',
  },
}).fullPath)
const workoutIntervalReturnTo = computed(() => router.resolve({
  name: 'program-runner',
  params: { taskId: taskId.value },
  query: {
    date: dateKey.value,
    step: stepId.value,
    ...(scheduledTime.value ? { time: scheduledTime.value } : {}),
    ...(current.value ? { focus: current.value.id, intervalCompleted: current.value.id } : {}),
    resume: '1',
  },
}).fullPath)
const workoutIntervalAdvanceTo = computed(() => router.resolve({
  name: 'program-runner',
  params: { taskId: taskId.value },
  query: {
    date: dateKey.value,
    step: stepId.value,
    ...(scheduledTime.value ? { time: scheduledTime.value } : {}),
    ...(current.value ? { focus: current.value.id, intervalCompleted: current.value.id } : {}),
    advance: '1',
    resume: '1',
  },
}).fullPath)
const completedCount = computed(() => requirements.value.filter(item => item.complete).length)
const runnerAdvanceTo = computed(() => router.resolve({
  name: 'program-runner',
  params: { taskId: taskId.value },
  query: {
    date: dateKey.value,
    step: stepId.value,
    ...(scheduledTime.value ? { time: scheduledTime.value } : {}),
    advance: '1',
    resume: '1',
  },
}).fullPath)
const startSummary = computed(() => {
  const total = requirements.value.length
  return `${total} ${total === 1 ? 'requirement' : 'requirements'} · ${completedCount.value} complete`
})
const attachedInterval = computed(() => intervalStore.templates.find(
  item => item.id === current.value?.intervalTemplate,
))
const attachedReviewSet = computed(() => flashcardStore.reviewSets.find(
  item => item.id === current.value?.flashcardReviewSet,
))
const requirementListItems = computed<ProgramStepRequirementListItem[]>(() => requirements.value.map((item, index) => {
  const exercisePresentation = exercisePresentationById(item.exercise)
  const exercise = exercisePresentation
    ? { image: exercisePresentation.imageUrl, imageAlt: exercisePresentation.name }
    : {}
  const title = requirements.value.length > 1
    ? `${index + 1}. ${programStepRequirementName(item, exercisePresentation?.name, item.type === 'workout' ? 'Workout' : 'Requirement')}`
    : programStepRequirementName(item, exercisePresentation?.name, item.type === 'workout' ? 'Workout' : 'Requirement')

  if (item.type === 'check') {
    return {
      id: item.id,
      title,
      subtitle: item.complete ? 'Checked off' : 'Not checked off',
      icon: item.complete ? 'mdi-check-circle' : 'mdi-check-circle-outline',
      ...exercise,
      complete: item.complete,
      disabled: Boolean(progress.value?.locked),
    }
  }

  if (item.type === 'workout') {
    const interval = intervalStore.templates.find(template => template.id === item.intervalTemplate)
    return {
      id: item.id,
      title,
      subtitle: [
        item.complete ? 'Complete' : '',
        exercisePresentation ? 'Confirm reps and weight' : 'Exercise optional',
        interval ? `${formatIntervalDuration(intervalDuration(interval.definition))} interval` : '',
      ].filter(Boolean).join(' · '),
      icon: item.complete ? 'mdi-check-circle' : 'mdi-dumbbell',
      ...exercise,
      color: TASK_TYPE_PRESENTATION.program.color,
      complete: item.complete,
      disabled: Boolean(progress.value?.locked),
    }
  }

  if (item.type === 'quantity') {
    const unit = item.customUnit || item.unit || ''
    return {
      id: item.id,
      title,
      subtitle: `${Number(item.value.toFixed(2))} of ${item.targetValue ?? 0}${unit ? ` ${unit}` : ''}`,
      icon: 'mdi-plus-minus-variant',
      ...exercise,
      complete: item.complete,
      disabled: Boolean(progress.value?.locked),
    }
  }

  if (item.type === 'interval') {
    const interval = intervalStore.templates.find(template => template.id === item.intervalTemplate)
    return {
      id: item.id,
      title,
      subtitle: [
        item.complete ? 'Complete' : '',
        interval ? `${formatIntervalDuration(intervalDuration(interval.definition))} total` : 'Saved interval unavailable',
      ].filter(Boolean).join(' · '),
      icon: item.complete ? 'mdi-check-circle' : interval?.icon || 'mdi-timer-play-outline',
      ...exercise,
      color: interval?.color || TASK_TYPE_PRESENTATION.interval.color,
      complete: item.complete,
      disabled: Boolean(progress.value?.locked) || (!item.complete && !interval),
    }
  }

  const reviewSet = flashcardStore.reviewSets.find(set => set.id === item.flashcardReviewSet)
  const cardLabel = reviewSet?.matchingCardCount === 1 ? 'card' : 'cards'
  return {
    id: item.id,
    title,
    subtitle: [
      item.complete ? 'Complete' : '',
      reviewSet ? `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSet.matchingCardCount} ${cardLabel}` : 'Review set unavailable',
    ].filter(Boolean).join(' · '),
    icon: item.complete ? 'mdi-check-circle' : 'mdi-cards-playing-outline',
    ...exercise,
    color: TASK_TYPE_PRESENTATION.flashcards.color,
    complete: item.complete,
    disabled: Boolean(progress.value?.locked) || (!item.complete && !reviewSet?.matchingCardCount),
  }
}))
const sessionActionItems = computed(() => programRunnerSessionMenuItems(working.value))
const requirementActionItems = computed(() => programRunnerRequirementMenuItems(working.value))
const selectedRequirement = computed(() => requirements.value.find(
  item => item.id === selectedRequirementId.value,
))
const selectedRequirementTitle = computed(() => requirementListItems.value.find(
  item => item.id === selectedRequirementId.value,
)?.title || 'Requirement actions')
const workoutIntervalPending = computed(() => (
  current.value?.type === 'workout'
  && Boolean(current.value.intervalTemplate)
  && route.query.intervalCompleted !== current.value.id
))
const isCompletionConfirmation = computed(() => !workoutIntervalPending.value)
const primaryActionLabel = computed(() => {
  if (workoutIntervalPending.value) return 'Start interval'
  return 'Confirm and finish'
})
const lockedWorkoutSetCount = computed(() => {
  if (current.value?.type !== 'workout' || !attachedInterval.value) return undefined
  return intervalStepKindCount(attachedInterval.value.definition, 'train')
})

function firstOpenRequirementIndex(preferredId = '') {
  const preferred = requirements.value.findIndex(item => item.id === preferredId && !item.complete)
  if (preferred >= 0) return preferred
  return requirements.value.findIndex(item => !item.complete)
}

async function loadExercise() {
  exercise.value = undefined
  if (current.value?.type !== 'workout' || !current.value.exercise) return
  try {
    exercise.value = (await loadExerciseOptions()).find(item => item.id === current.value?.exercise)
  } catch {
    // The synchronous presentation is still enough to identify this workout.
  }
}

async function showRequirement(index: number) {
  activeIndex.value = Math.max(0, index)
  amount.value = current.value?.type === 'quantity'
    ? Math.max(0, (current.value.targetValue || 0) - current.value.value)
    : 0
  const workoutSets = current.value?.type === 'workout'
    ? progress.value?.occurrence?.workoutSets?.[current.value.id] ?? current.value.exerciseSets ?? []
    : []
  sets.value = workoutSetsForCount(workoutSets, lockedWorkoutSetCount.value)
  if (current.value?.type === 'workout' && sets.value.length !== workoutSets.length) {
    updateWorkoutSets(sets.value)
  }
  await loadExercise()
  screen.value = 'requirement'
}

function updateWorkoutSets(value: ExerciseSet[]) {
  const item = current.value
  const currentProgress = progress.value
  const nextSets = workoutSetsForCount(value, lockedWorkoutSetCount.value)
  sets.value = nextSets
  if (!item || item.type !== 'workout' || !currentProgress) return
  void taskStore.saveProgramStepWorkoutSets(currentProgress, item.id, nextSets).catch((cause) => {
    error.value = cause instanceof Error ? cause.message : 'Could not save workout sets.'
  })
}

async function start() {
  const currentProgress = progress.value
  const completedWorkout = requirements.value.find(item => (
    item.id === route.query.intervalCompleted
    && item.id === focusCompletionId.value
    && item.type === 'workout'
    && Boolean(item.intervalTemplate)
  ))
  if (route.query.advance === '1' && currentProgress && completedWorkout && !completedWorkout.complete) {
    await taskStore.setProgramStepCompletion(currentProgress, completedWorkout.id, true)
  }

  const index = firstOpenRequirementIndex(focusCompletionId.value)
  if (index < 0) {
    screen.value = 'finished'
    return
  }
  if (route.query.advance === '1') {
    await openNextRequirement()
    return
  }
  if (route.query.direct === '1' && requirements.value[index]?.id === focusCompletionId.value) {
    await openRequirement(focusCompletionId.value)
    return
  }
  screen.value = 'list'
}

async function openRequirement(completionId: string) {
  const index = requirements.value.findIndex(item => item.id === completionId)
  if (index < 0) return
  const requirement = requirements.value[index]
  if (requirement?.complete) {
    if (requirement.type === 'quantity') return
    selectedRequirementId.value = requirement.id
    requirementActionsSheet.value = true
    return
  }
  activeIndex.value = index
  if (
    current.value?.type === 'interval'
    && !current.value.exercise
    && route.query.intervalPreview !== current.value.id
  ) {
    await runInterval()
    return
  }
  await showRequirement(index)
}

async function openNextRequirement() {
  const index = firstOpenRequirementIndex()
  if (index < 0) {
    screen.value = 'finished'
    return
  }
  activeIndex.value = index
  if (current.value?.type === 'interval' && attachedInterval.value) {
    await runInterval()
    return
  }
  if (
    current.value?.type === 'flashcards'
    && attachedReviewSet.value?.matchingCardCount
  ) {
    await runReviewSet()
    return
  }
  await openRequirement(requirements.value[index]!.id)
}

function next() {
  screen.value = firstOpenRequirementIndex() < 0 ? 'finished' : 'list'
}

async function continueRequirement() {
  const item = current.value
  const currentProgress = progress.value
  if (!item || !currentProgress || working.value) return
  working.value = true
  error.value = ''
  try {
    if (item.type === 'quantity') {
      if (amount.value > 0) await taskStore.addEntry(currentProgress, amount.value, undefined, item.id)
    } else {
      await taskStore.setProgramStepCompletion(currentProgress, item.id, true)
    }
    next()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this requirement.'
  } finally {
    working.value = false
  }
}

async function completePrimaryAction() {
  if (workoutIntervalPending.value) {
    await runInterval()
    return
  }
  await continueRequirement()
}

async function skipRequirement() {
  if (working.value) return
  next()
}

function minimizeProgram() {
  void router.replace('/tasks')
}

async function undoRequirement() {
  const currentProgress = progress.value
  const requirement = selectedRequirement.value
  if (!currentProgress || !requirement?.complete || requirement.type === 'quantity' || working.value) return

  working.value = true
  error.value = ''
  try {
    await taskStore.setProgramStepCompletion(currentProgress, requirement.id, false)
    if (route.query.intervalCompleted === requirement.id) {
      const query = { ...route.query }
      delete query.intervalCompleted
      await router.replace({ query })
    }
    selectedRequirementId.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not mark this requirement incomplete.'
    requirementActionsSheet.value = true
  } finally {
    working.value = false
  }
}

function handleRunnerSessionAction(action: RunnerSessionAction) {
  if (action === 'end') endDialog.value = true
}

function handleRequirementAction(action: RunnerSessionAction) {
  if (action === 'undo_requirement') void undoRequirement()
}

function endProgram() {
  endDialog.value = false
  minimizeProgram()
}

async function startWorkoutInterval(replaceActive = false) {
  const item = current.value
  const currentProgress = progress.value
  const template = attachedInterval.value
  if (!item || item.type !== 'workout' || !currentProgress || !template || working.value) return
  if (intervalStore.activeSession && !replaceActive) {
    activeIntervalName.value = intervalStore.activeSession.name
    replaceActiveIntervalDialog.value = true
    return
  }

  working.value = true
  error.value = ''
  try {
    if (currentProgress.status === 'missed') {
      await taskStore.setStatus(currentProgress, 'pending')
    }
    await prepareIntervalCues(template.cues)
    let flashcardReview
    if (template.flashcardReviewSet) {
      const reviewSet = flashcardStore.reviewSets.find(set => set.id === template.flashcardReviewSet)
      if (!reviewSet) throw new Error('The Review set attached to this interval could not be found.')
      const cards = reviewSet.accessRole === 'owner'
        ? flashcardStore.cards
        : await flashcardStore.loadReviewSetCards(reviewSet.id)
      flashcardReview = createIntervalFlashcardReviewSnapshot(reviewSet, cards)
      if (!flashcardReview) {
        throw new Error('The Review set attached to this interval has no matching cards.')
      }
    }
    const session = await intervalStore.startSession({
      name: template.name,
      source: 'template',
      definition: template.definition,
      cues: template.cues,
      template: template.id,
      task: currentProgress.task.id,
      programStep: currentProgress.programStep?.id,
      taskDate: currentProgress.scheduledDate,
      taskScheduledTime: currentProgress.scheduledTime,
      flashcardReview,
      presentation: {
        icon: template.icon || 'mdi-timer-outline',
        color: template.color || '#C7F464',
        ...(item.exercise ? { exercise: item.exercise } : {}),
      },
    })
    if (
      session.task !== currentProgress.task.id
      || session.programStep !== currentProgress.programStep?.id
      || session.programStepCompletion
      || session.taskDate !== currentProgress.scheduledDate
      || (session.taskScheduledTime || '') !== (currentProgress.scheduledTime || '')
    ) {
      activeIntervalName.value = session.name
      replaceActiveIntervalDialog.value = true
      return
    }
    const firstStep = resolveIntervalStep(session.definition, session.runtime.stepIndex)?.step
    if (session.status === 'running' && firstStep) {
      playIntervalGoCue(session.cues, firstStep.kind, firstStep.name)
    }
    await router.replace({
      name: 'interval-runner',
      params: { sessionId: session.id },
      query: {
        from: 'program',
        returnTo: workoutIntervalReturnTo.value,
        doneTo: workoutIntervalAdvanceTo.value,
      },
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the interval.'
  } finally {
    working.value = false
  }
}

async function replaceActiveInterval() {
  if (replacingActiveInterval.value) return
  replacingActiveInterval.value = true
  error.value = ''
  try {
    await intervalStore.endActiveSession()
    await stopBackgroundInterval()
    await stopFlashcardSpeech()
    replaceActiveIntervalDialog.value = false
    await startWorkoutInterval(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not end the active interval.'
  } finally {
    replacingActiveInterval.value = false
  }
}

async function runInterval() {
  if (!current.value?.intervalTemplate || !progress.value) return
  if (current.value.type === 'workout') {
    await startWorkoutInterval()
    return
  }
  await router.replace({
    name: 'interval-template-runner',
    params: { templateId: current.value.intervalTemplate },
    query: {
      task: progress.value.task.id,
      step: progress.value.programStep?.id || '',
      ...(current.value?.type === 'interval' ? { completion: current.value.id } : {}),
      date: progress.value.scheduledDate,
      ...(progress.value.scheduledTime ? { time: progress.value.scheduledTime } : {}),
      from: 'program',
      returnTo: runnerReturnTo.value,
      doneTo: runnerAdvanceTo.value,
    },
  })
}

async function runReviewSet() {
  if (!current.value?.flashcardReviewSet || !progress.value) return
  await router.replace({
    name: 'flashcard-review-set-runner',
    params: { reviewSetId: current.value.flashcardReviewSet },
    query: {
      task: progress.value.task.id,
      step: progress.value.programStep?.id || '',
      completion: current.value.id,
      date: progress.value.scheduledDate,
      ...(progress.value.scheduledTime ? { time: progress.value.scheduledTime } : {}),
      from: 'program',
      returnTo: runnerReturnTo.value,
      doneTo: runnerAdvanceTo.value,
    },
  })
}

onMounted(async () => {
  try {
    await Promise.all([
      taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
      intervalStore.loaded ? Promise.resolve() : intervalStore.load(),
      flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
    ])
    if (!task.value || task.value.type !== 'program' || !progress.value?.programStep) {
      throw new Error('That program step could not be found.')
    }
    if (route.query.resume === '1') await start()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this program.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="program-runner safe-bottom">
    <div v-if="loading" class="program-runner__state">
      <v-progress-circular indeterminate color="secondary" size="42" />
      <p>Preparing your program…</p>
    </div>
    <div v-else-if="error && !progress" class="program-runner__state">
      <v-icon icon="mdi-alert-circle-outline" color="error" size="46" />
      <h1 class="text-h5 font-weight-black">Program unavailable</h1>
      <p class="muted text-center">{{ error }}</p>
      <v-btn color="secondary" to="/tasks">Back to Tasks</v-btn>
    </div>
    <template v-else-if="progress && task">
      <v-alert v-if="error" type="error" variant="tonal" class="program-runner__alert">{{ error }}</v-alert>
      <div class="runner-screen-stage program-runner__stage">
        <transition name="runner-screen">
          <RunnerStartScreen
            v-if="screen === 'start'"
            key="start"
            class="runner-screen px-4"
            :title="progress.programStep?.name || task.name"
            :summary="startSummary"
            :task-name="task.name"
            :icon="task.icon || 'mdi-repeat-variant'"
            :color="task.color || '#C7F464'"
            primary-label="Start program"
            cancel-label="Cancel program"
            @start="start"
            @cancel="router.replace('/tasks')"
          />

          <section v-else-if="screen === 'finished'" key="finished" class="program-runner__finish runner-screen">
            <div class="program-runner__finish-icon" :style="{ background: task.color || '#C7F464' }">
              <ContentIcon :icon="task.icon || 'mdi-repeat-variant'" size="2.75rem" />
            </div>
            <h1 class="display-title">Program <span class="text-secondary">complete</span>.</h1>
            <p class="muted">{{ completedCount }} of {{ requirements.length }} requirements completed.</p>
            <v-btn color="secondary" size="x-large" prepend-icon="mdi-check-bold" to="/tasks">Done</v-btn>
          </section>

          <section v-else-if="screen === 'list'" key="list" class="program-runner__requirement runner-screen">
            <header class="program-runner__header">
              <v-btn
                class="program-runner__minimize"
                icon="mdi-chevron-down"
                variant="text"
                aria-label="Minimize program"
                @click="minimizeProgram"
              />
              <div class="program-runner__header-title min-width-0 text-center">
                <strong class="text-truncate d-block">{{ task.name }}</strong>
                <span>{{ progress.programStep?.name }} · {{ completedCount }} of {{ requirements.length }} complete</span>
              </div>
              <div class="program-runner__header-actions">
                <v-btn
                  icon="mdi-dots-vertical"
                  variant="text"
                  aria-label="Program actions"
                  @touchstart.stop
                  @click.stop="sessionActionsSheet = true"
                />
              </div>
            </header>
            <v-progress-linear
              :model-value="requirements.length ? completedCount / requirements.length * 100 : 0"
              color="secondary"
              bg-color="white"
              :bg-opacity=".14"
              height=".3125rem"
            />
            <div class="program-runner__list">
              <ProgramRequirementList
                :items="requirementListItems"
                :color="task.color || TASK_TYPE_PRESENTATION.program.color"
                :busy="working"
                :aria-label="`${progress.programStep?.name || task.name} requirements`"
                @select="openRequirement"
              />
            </div>
            <footer class="program-runner__actions program-runner__actions--single page-action-area">
              <v-btn
                color="secondary"
                size="large"
                :disabled="working"
                @click="openNextRequirement"
              >
                Next
              </v-btn>
            </footer>
          </section>

          <section v-else-if="current" :key="current.id" class="program-runner__requirement runner-screen">
            <header class="program-runner__header">
              <v-btn
                class="program-runner__minimize"
                icon="mdi-chevron-down"
                variant="text"
                aria-label="Minimize program"
                @click="minimizeProgram"
              />
              <div class="program-runner__header-title min-width-0 text-center">
                <strong class="text-truncate d-block">{{ task.name }}</strong>
                <span>Requirement {{ activeIndex + 1 }} of {{ requirements.length }}</span>
              </div>
              <div class="program-runner__header-actions">
                <v-btn
                  icon="mdi-dots-vertical"
                  variant="text"
                  aria-label="Program actions"
                  @touchstart.stop
                  @click.stop="sessionActionsSheet = true"
                />
              </div>
            </header>
            <v-progress-linear
              :model-value="requirements.length ? completedCount / requirements.length * 100 : 0"
              color="secondary"
              bg-color="white"
              :bg-opacity=".14"
              height=".3125rem"
            />
            <div class="program-runner__body">
              <div class="program-runner__identity">
                <div class="program-runner__icon" :style="{ background: task.color || '#C7F464' }">
                  <v-img v-if="currentPresentation?.imageUrl" :src="currentPresentation.imageUrl" :alt="currentPresentation.name" cover eager />
                  <ContentIcon v-else :icon="current.type === 'workout' ? 'mdi-dumbbell' : current.type === 'check' ? 'mdi-check-circle-outline' : current.type === 'quantity' ? 'mdi-plus-minus-variant' : current.type === 'interval' ? 'mdi-timer-play-outline' : 'mdi-cards-playing-outline'" size="1.5rem" />
                </div>
                <div class="min-width-0">
                  <p>{{ current.type === 'workout' ? 'Workout' : current.type === 'check' ? 'Check-off' : current.type === 'quantity' ? 'Quantity target' : current.type === 'interval' ? 'Interval' : 'Review set' }}</p>
                  <h1>{{ requirementName }}</h1>
                </div>
              </div>

              <WorkoutExercisePanel
                v-if="current.type === 'workout'"
                :exercise="exercise"
                :model-value="sets"
                :locked-set-count="lockedWorkoutSetCount"
                class="program-runner__exercise-details"
                @update:model-value="updateWorkoutSets"
              />

              <v-card v-else-if="current.type === 'check'" class="surface-card pa-5 program-runner__simple-card">
                <v-icon icon="mdi-check-circle-outline" color="secondary" size="40" />
                <p>Confirm this check-off when you are ready to continue.</p>
              </v-card>

              <v-card v-else-if="current.type === 'quantity'" class="surface-card pa-5 program-runner__simple-card">
                <p class="mb-4">Target: {{ current.targetValue }} {{ current.customUnit || current.unit || '' }}</p>
                <NumberPadField
                  v-model="amount"
                  :title="current.customUnit || current.unit
                    ? `Amount to log (${current.customUnit || current.unit})`
                    : 'Amount to log'"
                  :min="0"
                />
              </v-card>

              <v-card v-else-if="current.type === 'interval'" class="surface-card pa-5 program-runner__simple-card">
                <v-icon icon="mdi-timer-play-outline" color="secondary" size="40" />
                <h2>{{ attachedInterval?.name || 'Saved interval unavailable' }}</h2>
                <p>{{ attachedInterval ? formatIntervalDuration(intervalDuration(attachedInterval.definition)) : 'Return to the editor to choose an interval.' }}</p>
                <v-btn color="secondary" :disabled="!attachedInterval" prepend-icon="mdi-play" @click="runInterval">Start interval</v-btn>
              </v-card>

              <v-card v-else class="surface-card pa-5 program-runner__simple-card">
                <v-icon icon="mdi-cards-playing-outline" color="secondary" size="40" />
                <h2>{{ attachedReviewSet?.name || 'Review set unavailable' }}</h2>
                <p>{{ attachedReviewSet ? 'Finish the Review set to continue.' : 'Return to the editor to choose a Review set.' }}</p>
                <v-btn color="secondary" :disabled="!attachedReviewSet" prepend-icon="mdi-play" @click="runReviewSet">Start review</v-btn>
              </v-card>
            </div>
            <footer
              v-if="current.type === 'workout' || current.type === 'check' || current.type === 'quantity'"
              class="program-runner__actions"
              :class="{ 'program-runner__actions--single': isCompletionConfirmation }"
            >
              <v-btn v-if="!isCompletionConfirmation" variant="tonal" size="large" :disabled="working" @click="skipRequirement">Skip</v-btn>
              <v-btn
                color="secondary"
                size="large"
                :prepend-icon="workoutIntervalPending ? 'mdi-play' : undefined"
                :loading="working"
                :disabled="workoutIntervalPending && !attachedInterval"
                @click="completePrimaryAction"
              >
                {{ primaryActionLabel }}
              </v-btn>
            </footer>
          </section>
        </transition>
      </div>
    </template>

    <RunnerSessionActions
      v-if="progress && task && screen !== 'start' && screen !== 'finished'"
      v-model="sessionActionsSheet"
      title="Program actions"
      aria-label="Program session actions"
      :items="sessionActionItems"
      @action="handleRunnerSessionAction"
    />

    <RunnerSessionActions
      v-if="progress && task && selectedRequirement"
      v-model="requirementActionsSheet"
      :title="selectedRequirementTitle"
      :aria-label="`${selectedRequirementTitle} actions`"
      :items="requirementActionItems"
      @action="handleRequirementAction"
    />

    <ConfirmDialog
      v-model="endDialog"
      title="End this program?"
      message="Completed requirements will be kept, but unfinished requirements will remain incomplete."
      confirm-text="End program"
      confirm-color="error"
      icon="mdi-stop-circle-outline"
      :loading="working"
      @confirm="endProgram"
    />

    <ConfirmDialog
      v-model="replaceActiveIntervalDialog"
      title="End the active interval?"
      :message="`${activeIntervalName || 'Another interval'} is already in progress. End it and start ${attachedInterval?.name || 'this interval'} instead?`"
      confirm-text="End and continue"
      confirm-color="warning"
      icon="mdi-alert-outline"
      :loading="replacingActiveInterval || working"
      @confirm="replaceActiveInterval"
    />
  </main>
</template>

<style scoped>
.program-runner { position: fixed; z-index: 1003; inset: 0; display: flex; width: 100%; max-width: 100vw; height: var(--app-viewport-height, 100dvh); min-height: 0; flex-direction: column; overflow: hidden; background: rgb(var(--v-theme-background)); }
.program-runner__state { display: flex; min-height: var(--app-viewport-height, 100dvh); align-items: center; justify-content: center; flex-direction: column; gap: 1rem; }
.program-runner__alert { margin: 1rem; }
.program-runner__stage { min-height: 0; grid-template-rows: minmax(0, 1fr); }
.program-runner__requirement { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.program-runner__header { display: grid; min-height: calc(4rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem))); padding: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)) .75rem 0; grid-template-columns: minmax(0, 1fr) minmax(0, 4fr) minmax(0, 1fr); align-items: center; }
.program-runner__header-title { display: flex; min-width: 0; align-items: center; flex-direction: column; }
.program-runner__header-title strong { max-width: 100%; font-size: .875rem; }
.program-runner__header-title span, .program-runner__identity p { margin: 0; color: rgb(var(--v-theme-on-surface) / .54); font-size: .68rem; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
.program-runner__minimize { justify-self: start; }
.program-runner__header-actions { display: flex; justify-self: end; }
.program-runner__body { display: flex; width: min(100%, 48rem); min-height: 0; margin: 0 auto; padding: 1.25rem 0 0; flex: 1; flex-direction: column; overscroll-behavior: contain; touch-action: pan-y; }
.program-runner__list { width: min(100%, 48rem); min-height: 0; margin: 0 auto; padding: 1rem; flex: 1; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; }
.program-runner__identity { display: flex; min-width: 0; align-items: center; gap: .875rem; padding-inline: 1rem; }
.program-runner__body > .program-runner__exercise-details { height: auto; min-height: 0; flex: 1 1 0; }
.program-runner__icon, .program-runner__finish-icon { display: grid; width: 3.25rem; height: 3.25rem; overflow: hidden; flex: 0 0 auto; place-items: center; border-radius: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.program-runner__icon :deep(.v-img) { width: 100%; height: 100%; }
.program-runner__identity h1 { overflow-wrap: anywhere; font-size: clamp(1.5rem, 7vw, 2.35rem); font-weight: 900; line-height: 1; }
.program-runner__simple-card p { margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .8125rem; }
.program-runner__simple-card { display: flex; margin-top: 1.5rem; align-items: center; flex-direction: column; gap: .75rem; text-align: center; }
.program-runner__simple-card h2 { font-size: 1.125rem; font-weight: 900; }
.program-runner__actions { display: grid; padding: 1.2rem 1rem 0; flex: 0 0 auto; grid-template-columns: 1fr 1.5fr; gap: .75rem; border-top: .0625rem solid rgba(255, 255, 255, .08); background: rgba(var(--v-theme-background), .82); -webkit-backdrop-filter: blur(1rem); backdrop-filter: blur(1rem); }
.program-runner__actions--single { grid-template-columns: minmax(0, 48rem); justify-content: center; }
.program-runner__actions :deep(.v-btn) { min-height: 3.5rem; }
.program-runner__finish { display: flex; width: min(100%, 38rem); min-height: 0; margin: 0 auto; align-items: center; justify-content: center; flex: 1; flex-direction: column; gap: 1rem; padding: 1.5rem; text-align: center; }
.program-runner__finish-icon { width: 5rem; height: 5rem; border-radius: 1.5rem; }
.program-runner__finish h1 { font-size: clamp(2.5rem, 11vw, 5rem); }
.program-runner__finish :deep(.v-btn) { min-width: min(100%, 20rem); min-height: 4rem; margin-top: .5rem; }
@media (orientation: landscape) {
  .program-runner__body { display: grid; max-width: 66rem; grid-template-columns: minmax(12rem, .55fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); column-gap: 1.5rem; }
  .program-runner__identity { grid-column: 1; }
  .program-runner__body > :not(.program-runner__identity) { grid-column: 2; }
  .program-runner__body > .program-runner__exercise-details { height: 100%; }
}
</style>
