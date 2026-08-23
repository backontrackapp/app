<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { format } from 'date-fns'

const DISPLAY_DURATION_MS = 650
const displayedDate = ref<Date>()
const visible = ref(false)
let hideTimer: number | undefined

const dateTime = computed(() => displayedDate.value
  ? format(displayedDate.value, 'yyyy-MM-dd')
  : '')
const dateLabel = computed(() => displayedDate.value
  ? format(displayedDate.value, 'EEEE, MMMM d, yyyy')
  : '')

function show(date: Date) {
  displayedDate.value = new Date(date)
  visible.value = true
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    visible.value = false
    hideTimer = undefined
  }, DISPLAY_DURATION_MS)
}

onBeforeUnmount(() => {
  if (hideTimer) window.clearTimeout(hideTimer)
})

defineExpose({ show })
</script>

<template>
  <div
    class="date-swipe-feedback"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <Transition name="date-swipe-feedback">
      <v-card
        v-if="visible"
        class="date-swipe-feedback__card surface-card px-6 py-5 text-center"
      >
        <strong>
          <time :datetime="dateTime">{{ dateLabel }}</time>
        </strong>
      </v-card>
    </Transition>
  </div>
</template>

<style scoped>
.date-swipe-feedback {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: grid;
  padding: 1rem;
  pointer-events: none;
  place-items: center;
}
.date-swipe-feedback__card {
  width: min(20rem, 100%);
  border-color: rgb(var(--v-theme-secondary) / .28);
  background: rgb(var(--v-theme-surface) / .96);
  backdrop-filter: blur(.75rem);
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
  font-weight: 900;
  line-height: 1.2;
}
.date-swipe-feedback-enter-active { transition: opacity 160ms ease; }
.date-swipe-feedback-leave-active { transition: opacity 240ms ease; }
.date-swipe-feedback-enter-from,
.date-swipe-feedback-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .date-swipe-feedback-enter-active,
  .date-swipe-feedback-leave-active { transition-duration: .01ms; }
}
</style>
