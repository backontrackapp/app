<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import {
  filterExerciseOptions,
  groupExerciseOptions,
  loadExerciseOptions,
} from '@/services/exercises'
import type { ExerciseLocale, ExerciseOption } from '@/types/exercise'

type ExerciseVirtualItem = {
  type: 'header'
  key: string
  bodyPart: string
  label: string
  count: number
} | {
  type: 'exercise'
  key: string
  exercise: ExerciseOption
}

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  dialogTitle?: string
  clearable?: boolean
  disabled?: boolean
  locale?: ExerciseLocale
}>(), {
  modelValue: '',
  label: 'Exercise',
  placeholder: 'Choose an exercise',
  dialogTitle: 'Choose an exercise',
  clearable: true,
  disabled: false,
  locale: 'en',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectorId = useId()
const activatorId = `exercise-selector-activator-${selectorId}`
const dialogTitleId = `exercise-selector-title-${selectorId}`
const dialogOpen = ref(false)
const loading = ref(false)
const loadError = ref('')
const query = ref('')
const exerciseOptions = shallowRef<ExerciseOption[]>([])
const failedExerciseImageUrls = ref(new Set<string>())
const searchField = ref<{ focus: () => void }>()
const virtualList = ref<{ scrollToIndex: (index: number) => void }>()
const activeBodyPart = ref('')
let loadRequestId = 0
let stickyHeaderFrame = 0
const filteredOptions = computed(() => filterExerciseOptions(exerciseOptions.value, query.value))
const hasSearchQuery = computed(() => Boolean(query.value.trim()))
const groupedOptions = computed(() => groupExerciseOptions(filteredOptions.value))
const virtualItems = computed<ExerciseVirtualItem[]>(() => {
  if (hasSearchQuery.value) {
    return filteredOptions.value.map(exercise => ({
      type: 'exercise' as const,
      key: `exercise:${exercise.id}`,
      exercise,
    }))
  }

  const items: ExerciseVirtualItem[] = []
  for (const group of groupedOptions.value) {
    items.push({
      type: 'header',
      key: `header:${group.bodyPart}`,
      bodyPart: group.bodyPart,
      label: group.label,
      count: group.exercises.length,
    })
    items.push(...group.exercises.map(exercise => ({
      type: 'exercise' as const,
      key: `exercise:${exercise.id}`,
      exercise,
    })))
  }
  return items
})
const selectedOption = computed(() => (
  exerciseOptions.value.find(option => option.id === props.modelValue)
))
const activeBodyPartGroup = computed(() => (
  groupedOptions.value.find(group => group.bodyPart === activeBodyPart.value)
  || groupedOptions.value[0]
))

function difficultyLevel(exercise: ExerciseOption) {
  if (exercise.difficulty === 'advanced') return 3
  if (exercise.difficulty === 'intermediate') return 2
  return 1
}

function difficultyLabel(exercise: ExerciseOption) {
  return exercise.difficulty === 'beginner' ? 'Easy' : exercise.difficultyLabel
}

function exerciseImageFailed(imageUrl: string) {
  failedExerciseImageUrls.value = new Set(failedExerciseImageUrls.value).add(imageUrl)
}

async function ensureExerciseOptions(force = false) {
  if (!force && (exerciseOptions.value.length || loading.value)) return

  const requestId = ++loadRequestId
  const locale = props.locale
  loading.value = true
  loadError.value = ''
  try {
    const options = await loadExerciseOptions(locale)
    if (requestId === loadRequestId) exerciseOptions.value = options
  } catch {
    if (requestId === loadRequestId) loadError.value = 'Exercises could not be loaded.'
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

async function openSelector() {
  if (props.disabled) return
  query.value = ''
  dialogOpen.value = true
  await ensureExerciseOptions()
  await nextTick()
  activeBodyPart.value = groupedOptions.value[0]?.bodyPart || ''
  virtualList.value?.scrollToIndex(0)
}

function selectExercise(exercise: ExerciseOption) {
  emit('update:modelValue', exercise.id)
  dialogOpen.value = false
}

function clearSelection() {
  emit('update:modelValue', '')
  dialogOpen.value = false
}

function focusSearch() {
  searchField.value?.focus()
}

function exerciseOptionId(exerciseId: string) {
  return `exercise-selector-option-${selectorId}-${exerciseId}`
}

function updateActiveBodyPart(event: Event) {
  const list = event.target
  if (!(list instanceof HTMLElement)) return
  cancelAnimationFrame(stickyHeaderFrame)
  stickyHeaderFrame = requestAnimationFrame(() => {
    const listTop = list.getBoundingClientRect().top
    const headerHeight = list.parentElement
      ?.querySelector<HTMLElement>('.exercise-selector__sticky-category')
      ?.offsetHeight || 0
    const firstVisibleExercise = Array.from(
      list.querySelectorAll<HTMLElement>('[data-exercise-body-part]'),
    ).find(element => element.getBoundingClientRect().bottom > listTop + headerHeight)
    const bodyPart = firstVisibleExercise?.dataset.exerciseBodyPart
    if (bodyPart) activeBodyPart.value = bodyPart
  })
}

watch(query, async () => {
  await nextTick()
  activeBodyPart.value = groupedOptions.value[0]?.bodyPart || ''
  virtualList.value?.scrollToIndex(0)
})

watch(() => props.locale, () => {
  exerciseOptions.value = []
  if (dialogOpen.value || props.modelValue) void ensureExerciseOptions(true)
})

watch(() => props.modelValue, (value) => {
  if (value && !exerciseOptions.value.length) void ensureExerciseOptions()
}, { immediate: true })

onBeforeUnmount(() => cancelAnimationFrame(stickyHeaderFrame))
</script>

<template>
  <div class="exercise-selector">
    <label :for="activatorId" class="exercise-selector__label">{{ label }}</label>
    <v-btn
      :id="activatorId"
      v-bind="$attrs"
      class="exercise-selector__activator"
      variant="outlined"
      size="large"
      block
      type="button"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="dialogOpen"
      @click="openSelector"
    >
      <v-img
        v-if="selectedOption"
        class="exercise-selector__selected-image"
        :src="selectedOption.imageUrl"
        :alt="`${selectedOption.name} exercise`"
        cover
      >
        <template #placeholder>
          <span class="exercise-selector__image-placeholder" aria-hidden="true" />
        </template>
        <template #error>
          <span class="exercise-selector__image-fallback">
            <v-icon icon="mdi-dumbbell" />
          </span>
        </template>
      </v-img>
      <span v-else class="exercise-selector__selected-image exercise-selector__selected-image--empty" aria-hidden="true">
        <v-icon icon="mdi-dumbbell" />
      </span>

      <span class="exercise-selector__selected-copy">
        <strong :class="{ 'exercise-selector__placeholder': !selectedOption }">
          {{ selectedOption?.name || placeholder }}
        </strong>
        <span v-if="selectedOption" class="exercise-selector__selected-meta">
          {{ selectedOption.bodyPartLabel }}
        </span>
      </span>
      <v-icon class="exercise-selector__activator-chevron" icon="mdi-chevron-down" />
    </v-btn>
  </div>

  <AppDialog
    v-model="dialogOpen"
    fullscreen
    :aria-labelledby="dialogTitleId"
    @after-enter="focusSearch"
  >
    <v-card class="exercise-selector__dialog surface-card" rounded="0">
      <v-card-title class="exercise-selector__header">
        <span :id="dialogTitleId">{{ dialogTitle }}</span>
        <div class="exercise-selector__header-actions">
          <v-btn
            v-if="clearable && modelValue"
            icon="mdi-delete-outline"
            variant="text"
            size="small"
            aria-label="Remove selected exercise"
            @click="clearSelection"
          />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="Close exercise selector"
            @click="dialogOpen = false"
          />
        </div>
      </v-card-title>

      <div class="px-5 pb-4">
        <v-text-field
          ref="searchField"
          :model-value="query"
          label="Search exercises"
          prepend-inner-icon="mdi-magnify"
          clearable
          :disabled="Boolean(loadError)"
          @update:model-value="query = $event || ''"
        />
      </div>

      <div v-if="loading" class="exercise-selector__state" aria-live="polite">
        <v-progress-circular indeterminate color="secondary" />
        <p>Loading exercises…</p>
      </div>

      <div v-else-if="loadError" class="exercise-selector__state" role="alert">
        <v-icon icon="mdi-alert-circle-outline" color="error" size="2rem" />
        <p>{{ loadError }}</p>
        <v-btn color="secondary" variant="tonal" @click="ensureExerciseOptions(true)">Try again</v-btn>
      </div>

      <div v-else-if="!filteredOptions.length" class="exercise-selector__state" aria-live="polite">
        <v-icon icon="mdi-dumbbell" size="2rem" />
        <div>
          <p class="font-weight-bold">No exercises found</p>
          <p class="text-body-2 muted mt-1">Try another category, equipment, body part, or name.</p>
        </div>
      </div>

      <div
        v-else
        class="exercise-selector__list-shell"
        @scroll.capture.passive="updateActiveBodyPart"
      >
        <h3
          v-if="!hasSearchQuery && activeBodyPartGroup"
          class="exercise-selector__group-title exercise-selector__sticky-category"
          aria-hidden="true"
        >
          {{ activeBodyPartGroup.label }}
          <span>{{ activeBodyPartGroup.exercises.length }}</span>
        </h3>

        <v-virtual-scroll
          ref="virtualList"
          class="exercise-selector__list"
          :items="virtualItems"
          item-key="key"
          :item-height="144"
          role="listbox"
          aria-label="Exercises"
        >
          <template #default="{ item }">
            <h3
              v-if="item.type === 'header'"
              :id="`${selectorId}-${item.bodyPart}`"
              class="exercise-selector__group-title"
              role="presentation"
            >
              {{ item.label }}
              <span>{{ item.count }}</span>
            </h3>

            <v-list-item
              v-else
              :id="exerciseOptionId(item.exercise.id)"
              class="exercise-selector__option"
              :data-exercise-body-part="item.exercise.bodyPart"
              :active="item.exercise.id === modelValue"
              color="secondary"
              :aria-label="`${item.exercise.name}, ${item.exercise.bodyPartLabel}`"
              :aria-selected="item.exercise.id === modelValue"
              link
              role="option"
              @click="selectExercise(item.exercise)"
            >
              <template #prepend>
                <div class="exercise-selector__option-image">
                  <img
                    v-if="item.exercise.imageUrl && !failedExerciseImageUrls.has(item.exercise.imageUrl)"
                    :src="item.exercise.imageUrl"
                    :alt="`${item.exercise.name} exercise`"
                    decoding="async"
                    loading="eager"
                    @error="exerciseImageFailed(item.exercise.imageUrl)"
                  >
                  <span v-else class="exercise-selector__image-fallback">
                    <v-icon icon="mdi-dumbbell" size="2rem" />
                  </span>
                </div>
              </template>

              <div class="exercise-selector__option-copy">
                <strong>{{ item.exercise.name }}</strong>
                <p>{{ item.exercise.description }}</p>
                <div class="exercise-selector__option-meta">
                  <span
                    class="exercise-selector__difficulty"
                    :class="`exercise-selector__difficulty--${item.exercise.difficulty}`"
                    role="img"
                    :aria-label="`Difficulty: ${difficultyLabel(item.exercise)}, ${difficultyLevel(item.exercise)} of 3`"
                  >
                    <span class="exercise-selector__difficulty-bars" aria-hidden="true">
                      <span
                        v-for="level in 3"
                        :key="level"
                        class="exercise-selector__difficulty-bar"
                        :class="{ 'exercise-selector__difficulty-bar--active': level <= difficultyLevel(item.exercise) }"
                      />
                    </span>
                    <span aria-hidden="true">{{ difficultyLabel(item.exercise) }}</span>
                  </span>
                </div>
              </div>

              <template #append>
                <v-icon
                  v-if="item.exercise.id === modelValue"
                  icon="mdi-check-circle"
                  color="secondary"
                  aria-label="Selected"
                />
              </template>
            </v-list-item>
          </template>
        </v-virtual-scroll>
      </div>

      <footer class="exercise-selector__attribution">
        Exercise data by
        <a href="https://repdb.co" target="_blank" rel="noopener noreferrer">RepDB (repdb.co)</a>
      </footer>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.exercise-selector {
  min-width: 0;
}

.exercise-selector__label {
  display: block;
  margin-bottom: .5rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .75rem;
  font-weight: 750;
}

.exercise-selector__activator {
  width: 100%;
  min-width: 0;
  min-height: 5rem;
  overflow: hidden;
  padding: .5rem .75rem;
  border-color: rgb(var(--v-theme-on-surface) / .38);
}

.exercise-selector__activator :deep(.v-btn__content) {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  justify-content: flex-start;
  gap: .75rem;
}

.exercise-selector__selected-image {
  width: 4rem;
  height: 4rem;
  flex: 0 0 auto;
  border-radius: .875rem;
  background: rgb(var(--v-theme-surface-variant));
}

.exercise-selector__selected-image--empty,
.exercise-selector__image-fallback {
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-on-surface) / .56);
}

.exercise-selector__image-fallback {
  width: 100%;
  height: 100%;
  background: rgb(var(--v-theme-surface-variant));
}

.exercise-selector__image-placeholder {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    100deg,
    rgb(var(--v-theme-surface-variant)) 30%,
    rgb(var(--v-theme-on-surface) / .12) 50%,
    rgb(var(--v-theme-surface-variant)) 70%
  );
  background-size: 200% 100%;
  animation: exercise-image-placeholder 1.1s ease-in-out infinite;
}

.exercise-selector__selected-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  align-items: flex-start;
  flex-direction: column;
  text-align: start;
}

.exercise-selector__selected-copy strong,
.exercise-selector__selected-meta {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exercise-selector__selected-meta {
  margin-top: .25rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .75rem;
  font-weight: 600;
}

.exercise-selector__placeholder {
  color: rgb(var(--v-theme-on-surface) / .56);
}

.exercise-selector__activator-chevron {
  flex: 0 0 auto;
  margin-left: auto;
  color: rgb(var(--v-theme-on-surface) / .68);
}

.exercise-selector__dialog {
  display: flex;
  height: 100%;
  max-height: none;
  overflow: hidden;
  padding-top: max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem));
  padding-bottom: max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem));
  flex-direction: column;
}

.exercise-selector__header {
  display: flex;
  min-height: 4rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: .75rem 1rem .75rem 1.25rem;
  font-weight: 900;
}

.exercise-selector__header-actions {
  display: flex;
  align-items: center;
}

.exercise-selector__list {
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface));
}

.exercise-selector__list-shell {
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.exercise-selector__group-title {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  padding: .75rem 1.25rem;
  border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .76);
  font-size: .75rem;
  font-weight: 850;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.exercise-selector__group-title span {
  color: rgb(var(--v-theme-on-surface) / .48);
}

.exercise-selector__sticky-category {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  pointer-events: none;
}

.exercise-selector__option {
  min-height: 9rem;
  padding: .5rem 1rem;
  border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .06);
}

.exercise-selector__option:focus-visible {
  outline: .125rem solid rgb(var(--v-theme-secondary));
  outline-offset: -.1875rem;
}

.exercise-selector__option :deep(.v-list-item__prepend) {
  align-self: center;
}

.exercise-selector__option :deep(.v-list-item__prepend > .v-list-item__spacer) {
  width: .75rem;
}

.exercise-selector__option :deep(.v-list-item__append) {
  align-self: center;
}

.exercise-selector__option-image {
  display: grid;
  width: 8rem;
  height: 8rem;
  flex: 0 0 auto;
  overflow: hidden;
  place-items: center;
  border-radius: 1rem;
  background: rgb(var(--v-theme-surface-variant));
}

.exercise-selector__option-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.exercise-selector__option-copy {
  min-width: 0;
  padding: .25rem 0;
  white-space: normal;
}

.exercise-selector__option-copy strong {
  display: block;
  line-height: 1.25;
}

.exercise-selector__option-copy p {
  display: -webkit-box;
  overflow: hidden;
  margin: .375rem 0 0;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .8125rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.exercise-selector__option-meta {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 0;
}

.exercise-selector__difficulty {
  --exercise-difficulty-color: rgb(var(--v-theme-success));
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  gap: .375rem;
  color: var(--exercise-difficulty-color);
  font-size: .6875rem;
  font-weight: 800;
}

.exercise-selector__difficulty--intermediate {
  --exercise-difficulty-color: rgb(var(--v-theme-warning));
}

.exercise-selector__difficulty--advanced {
  --exercise-difficulty-color: rgb(var(--v-theme-error));
}

.exercise-selector__difficulty-bars {
  display: inline-flex;
  height: 1rem;
  align-items: flex-end;
  gap: .1875rem;
}

.exercise-selector__difficulty-bar {
  width: .25rem;
  height: .375rem;
  border-radius: .125rem;
  background: rgba(var(--v-theme-on-surface), .28);
}

.exercise-selector__difficulty-bar:nth-child(2) {
  height: .625rem;
}

.exercise-selector__difficulty-bar:nth-child(3) {
  height: .875rem;
}

.exercise-selector__difficulty-bar--active {
  background: currentColor;
}

@keyframes exercise-image-placeholder {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.exercise-selector__state {
  display: flex;
  min-height: min(28rem, 54dvh);
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  text-align: center;
}

.exercise-selector__attribution {
  flex: 0 0 auto;
  padding: .625rem 1rem;
  border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .6875rem;
  text-align: center;
}

.exercise-selector__attribution a {
  color: rgb(var(--v-theme-secondary));
}

@media (max-width: 37.5rem) {
  .exercise-selector__header {
    min-height: 3.5rem;
  }

  .exercise-selector__list,
  .exercise-selector__state {
    min-height: 0;
    flex: 1 1 auto;
  }

  .exercise-selector__option {
    padding-right: .5rem;
    padding-left: .5rem;
  }

  .exercise-selector__option :deep(.v-list-item__append) {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .exercise-selector__image-placeholder {
    animation: none;
  }
}
</style>
