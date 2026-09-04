<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatExerciseTerm } from '@/services/exercises'
import type { ExerciseOption } from '@/types/exercise'

const props = withDefaults(defineProps<{
  exercise: ExerciseOption
  active?: boolean
  embedded?: boolean
}>(), {
  active: true,
  embedded: false,
})

const emit = defineEmits<{
  'show-progress': []
}>()

const activeImageIndex = ref(0)
const reducedMotion = ref(false)
let imageTimer: number | undefined
let motionPreference: MediaQueryList | undefined

const exerciseImages = computed(() => {
  const { main, start, peak } = props.exercise.imageUrls
  if (start && peak) return [start, peak]
  return [main || start || peak || props.exercise.imageUrl].filter(Boolean)
})

function stopImageAnimation() {
  if (imageTimer !== undefined) window.clearInterval(imageTimer)
  imageTimer = undefined
}

function startImageAnimation() {
  stopImageAnimation()
  activeImageIndex.value = 0
  if (!props.active || reducedMotion.value || exerciseImages.value.length < 2) return
  imageTimer = window.setInterval(() => {
    activeImageIndex.value = (activeImageIndex.value + 1) % exerciseImages.value.length
  }, 1000)
}

function updateMotionPreference(event: MediaQueryListEvent | MediaQueryList) {
  reducedMotion.value = event.matches
  startImageAnimation()
}

watch([() => props.exercise.id, () => props.active], startImageAnimation)

onMounted(() => {
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionPreference?.matches || false
  motionPreference?.addEventListener('change', updateMotionPreference)
  startImageAnimation()
})

onBeforeUnmount(() => {
  stopImageAnimation()
  motionPreference?.removeEventListener('change', updateMotionPreference)
})
</script>

<template>
  <article
    class="exercise-details pb-4"
    :class="{
      'surface-card mt-4': !embedded,
      'exercise-details--embedded': embedded,
    }"
    tabindex="0"
    :aria-label="`Exercise details for ${exercise.name}`"
  >
    <div
      class="exercise-details__image mb-4 pb-4"
      role="img"
      :aria-label="`${exercise.name} exercise demonstration`"
    >
      <v-img
        v-for="(image, index) in exerciseImages"
        :key="image"
        :src="image"
        alt=""
        eager
        :transition="false"
        :cover="false"
        v-show="index === activeImageIndex"
        class="exercise-details__image-frame"
      />
      <div v-if="!exerciseImages.length" class="exercise-details__image-empty" aria-hidden="true">
        <v-icon icon="mdi-dumbbell" size="3rem" />
      </div>
      <div v-if="exerciseImages.length > 1" class="exercise-details__image-steps" aria-hidden="true">
        <span
          v-for="(_, index) in exerciseImages"
          :key="index"
          :class="{ 'exercise-details__image-step--active': index === activeImageIndex }"
        />
      </div>
    </div>

    <div class="exercise-details__content">
      <div class="exercise-details__heading">
        <h2>{{ exercise.name }}</h2>
        <!-- <v-btn
          icon="mdi-timer-outline"
          variant="tonal"
          color="secondary"
          size="small"
          aria-label="Show interval progress"
          @click="emit('show-progress')"
        /> -->
      </div>

      <p class="exercise-details__description">{{ exercise.description }}</p>

      <section v-if="exercise.instructions.length" class="exercise-details__section">
        <h3>Instructions</h3>
        <ol class="exercise-details__list exercise-details__list--numbered">
          <li v-for="instruction in exercise.instructions" :key="instruction">
            {{ instruction }}
          </li>
        </ol>
      </section>

      <section v-if="exercise.tips.length" class="exercise-details__section">
        <h3>Tips</h3>
        <ul class="exercise-details__list">
          <li v-for="tip in exercise.tips" :key="tip">{{ tip }}</li>
        </ul>
      </section>

      <section class="exercise-details__section">
        <h3>Body part</h3>
        <div class="exercise-details__tags">
          <v-chip color="secondary" variant="tonal" size="small" label>
            {{ exercise.bodyPartLabel }}
          </v-chip>
        </div>
      </section>

      <section v-if="exercise.primaryMuscles.length" class="exercise-details__section">
        <h3>Primary muscles</h3>
        <div class="exercise-details__tags">
          <v-chip
            v-for="muscle in exercise.primaryMuscles"
            :key="muscle"
            color="secondary"
            variant="tonal"
            size="small"
            label
          >
            {{ formatExerciseTerm(muscle) }}
          </v-chip>
        </div>
      </section>

      <section v-if="exercise.secondaryMuscles.length" class="exercise-details__section">
        <h3>Secondary muscles</h3>
        <div class="exercise-details__tags">
          <v-chip
            v-for="muscle in exercise.secondaryMuscles"
            :key="muscle"
            variant="outlined"
            size="small"
            label
          >
            {{ formatExerciseTerm(muscle) }}
          </v-chip>
        </div>
      </section>

    </div>
  </article>
</template>

<style scoped>
.exercise-details {
  width: 100%;
  max-width: 54.25rem;
  height: 100%;
  min-height: 0;
  margin-inline: auto;
  padding-inline: 1rem;
  overflow-x: hidden;
  overflow-y: auto;
  color: rgb(var(--v-theme-on-surface));
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  text-align: left;
  touch-action: pan-y;
}

.exercise-details:not(.exercise-details--embedded) {
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface) / .72);
}

.exercise-details--embedded {
  max-width: none;
  padding-top: 1rem;
}

.exercise-details:focus-visible {
  outline: .125rem solid rgb(var(--v-theme-secondary));
  outline-offset: -.125rem;
}

.exercise-details__image {
  position: relative;
  display: block;
  width: 100%;
  max-width: none;
  overflow: hidden;
}

.exercise-details__image-frame {
  width: 100%;
}

.exercise-details__image-empty {
  display: grid;
  min-height: 12rem;
  place-items: center;
  color: rgb(var(--v-theme-on-surface) / .4);
}

.exercise-details__image-steps {
  position: absolute;
  right: 1rem;
  bottom: .75rem;
  left: 1rem;
  display: flex;
  justify-content: center;
  gap: .375rem;
}

.exercise-details__image-steps span {
  width: 1.5rem;
  height: .1875rem;
  border-radius: 999rem;
  background: rgb(var(--v-theme-on-surface) / .24);
  transition: background-color 160ms ease;
}

.exercise-details__image-steps .exercise-details__image-step--active {
  background: rgb(var(--v-theme-secondary));
}

.exercise-details__content {
  padding: 1rem 0 0;
}

.exercise-details__heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.exercise-details__heading h2 {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: clamp(1.5rem, 7vw, 2.25rem);
  font-weight: 900;
  line-height: 1;
}

.exercise-details__heading :deep(.v-btn) {
  min-width: 2.75rem;
  min-height: 2.75rem;
  flex: 0 0 auto;
}

.exercise-details__description {
  margin-top: .75rem;
  color: rgb(var(--v-theme-on-surface) / .7);
  font-size: .875rem;
  line-height: 1.55;
}

.exercise-details__section {
  margin-top: 1.25rem;
}

.exercise-details__section h3 {
  margin-bottom: .625rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .68rem;
  font-weight: 850;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.exercise-details__tags {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
}

.exercise-details__list {
  display: grid;
  margin: 0;
  padding-left: 1.25rem;
  gap: .625rem;
  color: rgb(var(--v-theme-on-surface) / .78);
  font-size: .875rem;
  line-height: 1.5;
}

.exercise-details__list--numbered li::marker {
  color: rgb(var(--v-theme-secondary));
  font-weight: 850;
}

@media (orientation: landscape) and (max-height: 43.75rem) {
  .exercise-details__heading h2 {
    font-size: clamp(1.35rem, 4vw, 2rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .exercise-details {
    scroll-behavior: auto;
  }

  .exercise-details__image-steps span {
    transition-duration: 0s;
  }
}
</style>
