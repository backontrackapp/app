<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { format, parseISO, subDays, subMonths } from 'date-fns'
import { api } from '@/lib/api'
import ContentIcon from '@/components/ContentIcon.vue'
import DatePickerField from '@/components/DatePickerField.vue'
import EmptyStateCard from '@/components/EmptyStateCard.vue'
import TrackingChartSkeleton from '@/components/TrackingChartSkeleton.vue'
import TrackingRelationshipChart from '@/components/TrackingRelationshipChart.vue'
import TrackingTimelineChart from '@/components/TrackingTimelineChart.vue'
import {
  buildTrackingInsight,
  dateRangeKeys,
  defaultTrackingInsightRangePreset,
  trackingDurationUnitSeconds,
  trackingDailyValuesForRange,
  type TrackingInsightResult,
} from '@/services/tracking'
import {
  taskInsightDailyValues,
  taskInsightProfile,
} from '@/services/taskInsights'
import { taskGoalTracker } from '@/services/taskTrackers'
import {
  reviewSetInsightDailyValues,
  reviewSetInsightRangeBounds,
} from '@/services/reviewSetInsights'
import { INTERVAL_INSIGHT_PROFILE, intervalInsightDailyValues } from '@/services/intervalInsights'
import { isNativeHealthConnectSupported, readHealthConnectStepsForDates, readScreenTimeForDates } from '@/services/healthConnect'
import { taskDisplayIcon, TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type {
  FlashcardReviewSession,
  FlashcardReviewSet,
  IntervalSession,
  Task,
  TrackingAnalysisSource,
  TrackingDailyValue,
} from '@/types/domain'

type DatePreset = '7' | '14' | '1-month' | '3-months' | '6-months' | 'custom'
type TrackingFactorSource = Omit<TrackingAnalysisSource, 'source'> & {
  source: TrackingAnalysisSource['source'] | 'review_set' | 'health_connect'
}

const tracking = useTrackingStore()
const tasks = useTaskStore()
const intervals = useIntervalStore()
const { insightFactorId: factorId, insightOutcomeId: outcomeId } = storeToRefs(tracking)
const reviewSets = ref<Array<Pick<FlashcardReviewSet, 'id' | 'name' | 'icon' | 'color' | 'archived'>>>([])
const datePreset = ref<DatePreset>('7')
const rangeStart = ref(format(subDays(new Date(), 6), 'yyyy-MM-dd'))
const rangeEnd = ref(format(new Date(), 'yyyy-MM-dd'))
const insight = ref<TrackingInsightResult>()
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
let analysisTimer: number | undefined
let analysisRequest = 0

const datePresets: Array<{ title: string; value: DatePreset }> = [
  { title: '1 week', value: '7' },
  { title: '2 weeks', value: '14' },
  { title: '1 month', value: '1-month' },
  { title: '3 months', value: '3-months' },
  { title: '6 months', value: '6-months' },
  { title: 'Custom', value: 'custom' },
]

function taskFactorIcon(task: Task) {
  const interval = intervals.templates.find((template) => template.id === task.intervalTemplate)
  const reviewSet = reviewSets.value.find((item) => item.id === task.flashcardReviewSet)
  return taskDisplayIcon(task, {
    intervalIcon: interval ? interval.icon || 'mdi-timer-outline' : undefined,
    reviewSetIcon: reviewSet ? reviewSet.icon || 'mdi-cards-outline' : undefined,
  })
}

function trackerScale(tracker: { kind: string; scaleMin: number; scaleMax: number }) {
  const hasFixedScale = tracker.kind === 'rating' || tracker.kind === 'yes_no'
  return {
    scaleMin: hasFixedScale && tracker.scaleMax > tracker.scaleMin ? tracker.scaleMin : undefined,
    scaleMax: hasFixedScale && tracker.scaleMax > tracker.scaleMin ? tracker.scaleMax : undefined,
  }
}

const healthConnectFactorSources: TrackingFactorSource[] = isNativeHealthConnectSupported() ? [
  {
    id: 'health_connect:steps',
    source: 'health_connect',
    name: 'Steps',
    role: 'factor',
    favorableDirection: 'neutral',
    unit: 'steps',
    color: 'rgb(var(--v-theme-secondary))',
    factorMode: 'quantity',
    scaleMin: 0,
  },
  {
    id: 'health_connect:screen_time',
    source: 'health_connect',
    name: 'Screen time',
    role: 'factor',
    favorableDirection: 'neutral',
    unit: 'minutes',
    color: 'rgb(var(--v-theme-info))',
    factorMode: 'quantity',
    scaleMin: 0,
  },
] : []

const factorSources = computed<TrackingFactorSource[]>(() => [
  ...healthConnectFactorSources,
  ...tracking.activeTrackers.filter((tracker) => tracker.role === 'factor').map((tracker) => ({
    id: `tracker:${tracker.id}`,
    source: 'tracker' as const,
    name: tracker.name,
    icon: tracker.icon || 'mdi-checkbox-marked-circle-outline',
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: tracker.unit,
    color: tracker.color,
    factorMode: ['number', 'duration', 'rating'].includes(tracker.kind) ? 'quantity' as const : 'presence' as const,
    ...trackerScale(tracker),
  })),
  ...tasks.activeTasks.filter(task => !taskGoalTracker(task, tracking.trackers)).map((task) => ({
    id: `task:${task.id}`,
    source: 'task' as const,
    name: `Task · ${task.name}`,
    icon: taskFactorIcon(task),
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    color: task.color || TASK_TYPE_PRESENTATION[task.type].color,
    ...taskInsightProfile(task),
  })),
  ...intervals.templates.filter((template) => !template.archived).map((template) => ({
    id: `interval:${template.id}`,
    source: 'interval' as const,
    name: `Interval · ${template.name}`,
    icon: template.icon || 'mdi-timer-outline',
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    color: template.color,
    ...INTERVAL_INSIGHT_PROFILE,
  })),
  ...reviewSets.value.filter((reviewSet) => !reviewSet.archived).map((reviewSet) => ({
    id: `review_set:${reviewSet.id}`,
    source: 'review_set' as const,
    name: `Review set · ${reviewSet.name}`,
    icon: reviewSet.icon || 'mdi-cards-outline',
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: 'cards',
    color: reviewSet.color || 'rgb(var(--v-theme-secondary))',
    factorMode: 'quantity' as const,
    scaleMin: 0,
  })),
])

const outcomeSources = computed<TrackingAnalysisSource[]>(() =>
  tracking.activeTrackers.filter((tracker) => tracker.role === 'outcome').map((tracker) => ({
    id: tracker.id,
    source: 'tracker',
    name: tracker.name,
    icon: tracker.icon || 'mdi-checkbox-marked-circle-outline',
    role: tracker.role,
    favorableDirection: tracker.favorableDirection,
    unit: tracker.unit,
    color: tracker.color,
    factorMode: 'quantity',
    ...trackerScale(tracker),
  })),
)

const factorItems = computed(() => [
  { title: 'Health Connect', source: 'health_connect' as const },
  { title: 'Trackers', source: 'tracker' as const },
  { title: 'Tasks', source: 'task' as const },
  { title: 'Intervals', source: 'interval' as const },
  { title: 'Review sets', source: 'review_set' as const },
].flatMap((group) => {
  const items = factorSources.value
    .filter((source) => source.source === group.source)
    .map((source) => ({
      title: source.name,
      value: source.id,
      icon: source.icon || '',
      color: source.color,
    }))

  return items.length
    ? [{ type: 'subheader' as const, title: group.title, icon: '', color: '' }, ...items]
    : []
}))
const outcomeItems = computed(() => outcomeSources.value.map((source) => ({
  title: source.name,
  value: source.id,
  icon: source.icon || '',
  color: source.color,
})))
const selectedFactor = computed(() => factorSources.value.find((source) => source.id === factorId.value))
const selectedOutcome = computed(() => outcomeSources.value.find((source) => source.id === outcomeId.value))
const dateRangeValid = computed(() => Boolean(rangeStart.value && rangeEnd.value && rangeStart.value <= rangeEnd.value))
const rangeLabel = computed(() => dateRangeValid.value
  ? `${format(parseISO(rangeStart.value), 'MMM d, yyyy')} – ${format(parseISO(rangeEnd.value), 'MMM d, yyyy')}`
  : 'Choose a valid date range')
const hasTimelineData = computed(() => insight.value?.points.some((point) =>
  point.factorValue !== null || point.outcomeValue !== null,
) || false)
const relationshipLabel = computed(() => selectedFactor.value?.factorMode === 'quantity'
  ? 'Amount compared with outcome'
  : 'Present compared with absent')

onMounted(async () => {
  await Promise.all([
    tracking.loaded ? Promise.resolve() : tracking.load(),
    tasks.tasks.length ? Promise.resolve() : tasks.load(),
    intervals.loaded ? Promise.resolve() : intervals.load(),
    api.getAccessibleFlashcardReviewSets().then((records) => {
      reviewSets.value = records.map((record) => ({
        id: String(record.id),
        name: String(record.name),
        icon: String(record.icon || ''),
        color: String(record.color || '#C7F464'),
        archived: record.archived === true,
      }))
    }),
  ]).catch((cause) => {
    error.value = cause instanceof Error ? cause.message : 'Could not load insight sources.'
  })
  if (!factorSources.value.some((source) => source.id === factorId.value)) {
    factorId.value = factorSources.value[0]?.id || ''
  }
  if (!outcomeSources.value.some((source) => source.id === outcomeId.value)) {
    outcomeId.value = outcomeSources.value[0]?.id || ''
  }
  setDefaultDateRange()
  initialized.value = true
  if (factorId.value && outcomeId.value) await analyze()
})

watch(datePreset, (preset) => {
  if (preset === 'custom') return
  setPresetDateRange(preset)
})

watch([factorId, outcomeId, rangeStart, rangeEnd], () => {
  if (!initialized.value) return
  scheduleAnalysis()
})

onBeforeUnmount(() => {
  if (analysisTimer !== undefined) window.clearTimeout(analysisTimer)
  analysisRequest += 1
})

function scheduleAnalysis() {
  analysisRequest += 1
  if (analysisTimer !== undefined) window.clearTimeout(analysisTimer)
  loading.value = Boolean(selectedFactor.value && selectedOutcome.value && dateRangeValid.value)
  analysisTimer = window.setTimeout(() => {
    analysisTimer = undefined
    void analyze()
  }, 120)
}

function setDefaultDateRange() {
  const today = new Date()
  const end = format(today, 'yyyy-MM-dd')
  const start = format(subMonths(today, 6), 'yyyy-MM-dd')
  const dataPointCount = outcomeId.value
    ? trackerDailyValues(outcomeId.value, start, end).length
    : 0
  const preset = defaultTrackingInsightRangePreset(dataPointCount)
  datePreset.value = preset
  setPresetDateRange(preset, today)
}

function setPresetDateRange(preset: Exclude<DatePreset, 'custom'>, today = new Date()) {
  rangeEnd.value = format(today, 'yyyy-MM-dd')
  if (preset === '7' || preset === '14') {
    rangeStart.value = format(subDays(today, Number(preset) - 1), 'yyyy-MM-dd')
    return
  }
  rangeStart.value = format(subMonths(today, Number.parseInt(preset, 10)), 'yyyy-MM-dd')
}

async function analyze() {
  const factor = selectedFactor.value
  const outcome = selectedOutcome.value
  const request = ++analysisRequest
  error.value = ''
  if (!factor || !outcome) {
    insight.value = undefined
    loading.value = false
    return
  }
  if (!dateRangeValid.value) {
    insight.value = undefined
    error.value = 'The start date must be on or before the end date.'
    loading.value = false
    return
  }

  loading.value = true
  try {
    await tracking.loadRange(rangeStart.value, rangeEnd.value)
    const factorValues = await factorDailyValues(factor.id, rangeStart.value, rangeEnd.value)
    const outcomeValues = trackerDailyValues(outcome.id, rangeStart.value, rangeEnd.value)
    const result = buildTrackingInsight(
      factorValues,
      outcomeValues,
      { start: rangeStart.value, end: rangeEnd.value },
      factor.factorMode,
      outcome.favorableDirection,
      { factor: factor.name, outcome: outcome.name },
      {
        missingMeansAbsent: factor.source === 'tracker'
          && tracking.trackers.some((tracker) => `tracker:${tracker.id}` === factor.id && tracker.kind === 'event'),
      },
    )
    if (request === analysisRequest) insight.value = result
  } catch (cause) {
    if (request !== analysisRequest) return
    insight.value = undefined
    error.value = cause instanceof Error ? cause.message : 'Could not build these insights.'
  } finally {
    if (request === analysisRequest) loading.value = false
  }
}

async function factorDailyValues(sourceId: string, start: string, end: string): Promise<TrackingDailyValue[]> {
  const [source, id] = sourceId.split(':', 2)
  if (source === 'health_connect') {
    const dates = dateRangeKeys(start, end)
    const values = id === 'steps'
      ? await readHealthConnectStepsForDates(dates)
      : await readScreenTimeForDates(dates)
    return dates.map((date) => ({ date, value: values[date] || 0 }))
  }
  if (source === 'tracker') {
    return trackerDailyValues(id || '', start, end)
  }
  if (source === 'task') {
    const task = tasks.tasks.find((item) => item.id === id)
    if (!task) return []
    await tasks.loadProgressRange(start, end)
    return taskInsightDailyValues(
      task,
      tasks.entries,
      tasks.occurrences,
      start,
      end,
    )
  }
  if (source === 'interval') {
    const records = await api.collection('interval_sessions').getFullList({
      filter: `template = "${id}" && task_date >= "${start}" && task_date <= "${end}"`,
      sort: 'task_date',
    })
    return intervalInsightDailyValues(
      id || '',
      records.map((record) => ({
        template: String(record.template || ''),
        taskDate: String(record.task_date || ''),
        status: record.status as IntervalSession['status'],
        elapsedSeconds: Number(record.elapsed_seconds || 0),
      })),
      start,
      end,
    )
  }
  if (source === 'review_set') {
    const bounds = reviewSetInsightRangeBounds(start, end)
    const records = await api.collection('flashcard_review_sessions').getFullList({
      filter: `review_set = "${id}" && started_at >= "${bounds.startAt}" && started_at < "${bounds.endAt}"`,
      sort: 'started_at',
    })
    const sessions: Array<Pick<FlashcardReviewSession, 'reviewSet' | 'startedAt' | 'viewedCount'>> = records
      .map((record) => ({
        reviewSet: String(record.review_set || ''),
        startedAt: String(record.started_at || ''),
        viewedCount: Number(record.viewed_count || 0),
      }))
    return reviewSetInsightDailyValues(id || '', sessions, start, end)
  }
  return []
}

function trackerDailyValues(trackerId: string, start: string, end: string) {
  const tracker = tracking.trackers.find((item) => item.id === trackerId)
  if (!tracker) return []
  return trackingDailyValuesForRange(tracker, tracking.entries, start, end)
    .map((item) => tracker.kind === 'duration'
      ? { ...item, value: item.value / trackingDurationUnitSeconds(tracker.unit) }
      : item)
}
</script>

<template>
  <main class="app-page insights-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-card class="filter-card surface-card pa-5 mb-4">
      <div>
        <h2>Choose what to compare</h2>
        <p>Select one factor and one outcome. Graphs update automatically.</p>
      </div>

      <v-row>
        <v-col cols="12" sm="6">
          <v-select
            v-model="factorId"
            label="Factor"
            :items="factorItems"
            :disabled="!factorSources.length"
            no-data-text="Create a factor, task, interval, or Review set first"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template v-if="item.raw.icon" #prepend>
                  <span class="insight-source-icon mr-3" :style="{ background: item.raw.color }">
                    <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <span class="insight-source-selection">
                <span
                  v-if="item.raw.icon"
                  class="insight-source-selection__icon"
                  :style="{ background: item.raw.color }"
                >
                  <ContentIcon :icon="item.raw.icon" size=".875rem" />
                </span>
                <span class="text-truncate">{{ item.title }}</span>
              </span>
            </template>
          </v-select>
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="outcomeId"
            label="Outcome"
            :items="outcomeItems"
            :disabled="!outcomeSources.length"
            no-data-text="Create an outcome tracker first"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <span class="insight-source-icon mr-3" :style="{ background: item.raw.color }">
                    <ContentIcon :icon="item.raw.icon" size="1.125rem" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <span class="insight-source-selection">
                <span class="insight-source-selection__icon" :style="{ background: item.raw.color }">
                  <ContentIcon :icon="item.raw.icon" size=".875rem" />
                </span>
                <span class="text-truncate">{{ item.title }}</span>
              </span>
            </template>
          </v-select>
        </v-col>
      </v-row>

      <div>
        <strong class="filter-label">Date range</strong>
        <v-btn-toggle v-model="datePreset" mandatory color="secondary" size="default" class="date-presets mt-2 ga-1">
          <v-btn
            v-for="preset in datePresets"
            :key="preset.value"
            :value="preset.value"
            variant="tonal"
          >
            {{ preset.title }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <v-row v-if="datePreset === 'custom'">
        <v-col cols="12" sm="6">
          <DatePickerField v-model="rangeStart" label="From" :max="rangeEnd" />
        </v-col>
        <v-col cols="12" sm="6">
          <DatePickerField v-model="rangeEnd" label="To" :min="rangeStart" :max="format(new Date(), 'yyyy-MM-dd')" />
        </v-col>
      </v-row>

      <div class="range-note">
        <v-icon icon="mdi-calendar-range-outline" size="18" />
        <span>{{ rangeLabel }}</span>
        <span>Daily values are matched on the same date.</span>
      </div>
    </v-card>

    <EmptyStateCard
      v-if="initialized && (!factorSources.length || !outcomeSources.length)"
      icon="mdi-chart-timeline-variant-shimmer"
      title="More tracking data is needed"
      :subtitle="!outcomeSources.length
        ? 'Create an outcome tracker, such as Mood or Energy, before exploring insights.'
        : 'Create a factor tracker, task, interval, or Review set to compare with an outcome.'"
    >
      <template #button>
        <v-btn color="secondary" to="/tracking/new" prepend-icon="mdi-plus">Create tracker</v-btn>
      </template>
    </EmptyStateCard>

    <section v-else-if="!initialized || loading" class="insight-results" aria-busy="true">
      <v-card class="chart-card surface-card pa-5 mb-4">
        <div class="chart-heading">
          <div><h2>Over time</h2><p>Both lines share one date plot, with independent scales on the left and right.</p></div>
          <v-icon icon="mdi-chart-timeline-variant" color="secondary" />
        </div>
        <TrackingChartSkeleton class="mt-4" />
      </v-card>

      <v-card class="chart-card surface-card pa-5">
        <div class="chart-heading">
          <div><h2>Relationship</h2><p>Factor and outcome values compared across matching dates.</p></div>
          <v-icon icon="mdi-scatter-plot" color="secondary" />
        </div>
        <TrackingChartSkeleton class="mt-4" />
      </v-card>
    </section>

    <section v-else-if="insight && selectedFactor && selectedOutcome" class="insight-results">

      <v-card class="chart-card surface-card pa-5 mb-4">
        <div class="chart-heading">
          <div><h2>Over time</h2><p>Both lines share one date plot, with independent scales on the left and right.</p></div>
          <v-icon icon="mdi-chart-timeline-variant" color="secondary" />
        </div>
        <TrackingTimelineChart
          v-if="hasTimelineData"
          class="mt-4"
          :points="insight.points"
          :factor-name="selectedFactor.name"
          :factor-unit="selectedFactor.unit"
          :factor-scale-min="selectedFactor.scaleMin"
          :factor-scale-max="selectedFactor.scaleMax"
          :outcome-name="selectedOutcome.name"
          :outcome-unit="selectedOutcome.unit"
          :outcome-scale-min="selectedOutcome.scaleMin"
          :outcome-scale-max="selectedOutcome.scaleMax"
        />
        <div v-else class="chart-empty py-8 text-center">
          <v-icon icon="mdi-chart-line-variant" size="36" />
          <p>No factor or outcome values were logged in this range.</p>
        </div>
      </v-card>

      <v-card class="chart-card surface-card pa-5">
        <div class="chart-heading">
          <div><h2>Relationship</h2><p>{{ relationshipLabel }} across dates containing both values.</p></div>
          <v-icon icon="mdi-scatter-plot" color="secondary" />
        </div>
        <TrackingRelationshipChart
          v-if="insight.matched.length >= 2"
          class="mt-4"
          :insight="insight"
          :factor-name="selectedFactor.name"
          :factor-unit="selectedFactor.unit"
          :factor-scale-min="selectedFactor.scaleMin"
          :factor-scale-max="selectedFactor.scaleMax"
          :outcome-name="selectedOutcome.name"
          :outcome-unit="selectedOutcome.unit"
          :outcome-scale-min="selectedOutcome.scaleMin"
          :outcome-scale-max="selectedOutcome.scaleMax"
        />
        <div v-else class="chart-empty py-8 text-center">
          <v-icon icon="mdi-link-variant-off" size="36" />
          <p>At least two dates need both {{ selectedFactor.name }} and {{ selectedOutcome.name }} values.</p>
          <span>Log both on the same day or choose a wider range.</span>
        </div>
      </v-card>
    </section>

    <EmptyStateCard
      v-else-if="!loading && factorSources.length && outcomeSources.length"
      icon="mdi-chart-box-outline"
      icon-color="medium-emphasis"
      subtitle="Select a factor, outcome, and valid date range to see insights."
    />
  </main>
</template>

<style scoped>
.insights-page { max-width: 56.25rem; }
.filter-card { display: grid; gap: 1rem; }
.filter-card h2,
.chart-card h2 { font-size: 1rem; font-weight: 900; }
.filter-card > div:first-child p { margin-top: .2rem; color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; line-height: 1.45; }
.chart-heading p { margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; line-height: 1.45; }
.insight-source-icon { display: grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; border-radius: .65rem; color: #191c19; }
.insight-source-selection { display: flex; min-width: 0; align-items: center; gap: .5rem; }
.insight-source-selection__icon { display: grid; width: 1.5rem; height: 1.5rem; flex: 0 0 auto; place-items: center; border-radius: .5rem; color: #191c19; }
.filter-label { color: rgb(var(--v-theme-on-surface) / .72); font-size: .75rem; }
.date-presets { display: grid; width: 100%; height: auto !important; grid-template-columns: repeat(6, 1fr); }
.date-presets :deep(.v-btn) { min-width: 0; padding-inline: .5rem; }
.range-note { display: flex; align-items: center; gap: .5rem .75rem; flex-wrap: wrap; color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; }
.range-note span:first-of-type { color: rgb(var(--v-theme-on-surface) / .78); font-weight: 800; }
.insight-results { position: relative; }
.chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.chart-empty { color: rgb(var(--v-theme-on-surface) / .5); }
.chart-empty p { margin-top: .75rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .78rem; font-weight: 800; }
.chart-empty span { display: block; margin-top: .25rem; font-size: .7rem; }

@media (max-width: 37.5rem) {
  .date-presets { grid-template-columns: repeat(2, 1fr); }
}

</style>
