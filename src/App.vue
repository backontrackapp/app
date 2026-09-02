<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { containCardButtonClicks } from '@/services/cardButtonPropagation'

const route = useRoute()
const router = useRouter()
const transitioning = ref(false)
const sessionTransitionStage = ref<HTMLElement>()
const enteringApp = computed(() => route.name !== 'auth')
const transitionName = computed(() => enteringApp.value ? 'session-forward' : 'session-back')
let removeCardButtonContainment: (() => void) | undefined

function pinLeavingSessionPage() {
  const page = sessionTransitionStage.value?.firstElementChild
  if (!(page instanceof HTMLElement) || getComputedStyle(page).position === 'fixed') return
  const bounds = page.getBoundingClientRect()
  page.style.setProperty('--session-leave-top', `${bounds.top}px`)
  page.style.setProperty('--session-leave-left', `${bounds.left}px`)
  page.style.setProperty('--session-leave-width', `${bounds.width}px`)
  page.classList.add('session-route-leaving-pinned')
}

function releaseLeavingSessionPage(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.classList.remove('session-route-leaving-pinned')
  element.style.removeProperty('--session-leave-top')
  element.style.removeProperty('--session-leave-left')
  element.style.removeProperty('--session-leave-width')
}

function cancelSessionTransition(element: Element) {
  transitioning.value = false
  releaseLeavingSessionPage(element)
}

const removeTransitionGuard = router.beforeEach((to, from) => {
  const toKey = to.meta.auth ? 'app' : to.fullPath
  const fromKey = from.meta.auth ? 'app' : from.fullPath
  if (toKey !== fromKey) pinLeavingSessionPage()
})

onMounted(() => {
  removeCardButtonContainment = containCardButtonClicks()
})

onBeforeUnmount(() => {
  removeTransitionGuard()
  removeCardButtonContainment?.()
})
</script>

<template>
  <div ref="sessionTransitionStage" class="session-transition-stage">
    <router-view v-slot="{ Component, route: viewRoute }">
      <transition
        :name="transitionName"
        @before-leave="transitioning = true"
        @after-enter="transitioning = false"
        @after-leave="releaseLeavingSessionPage"
        @leave-cancelled="cancelSessionTransition"
      >
        <component :is="Component" :key="viewRoute.meta.auth ? 'app' : viewRoute.fullPath" />
      </transition>
    </router-view>
  </div>

  <transition name="session-loader">
    <div v-if="transitioning" class="session-loading" role="status" aria-live="polite">
      <v-progress-circular indeterminate color="secondary" size="30" width="3" />
      <span>{{ enteringApp ? 'Opening BackOnTrack…' : 'Signing out…' }}</span>
    </div>
  </transition>
</template>

<style>
.session-transition-stage {
  display: grid;
  min-height: var(--app-viewport-height, 100dvh);
}

.session-transition-stage > * {
  min-width: 0;
  grid-area: 1 / 1;
}

.session-route-leaving-pinned {
  position: fixed !important;
  z-index: 1;
  top: var(--session-leave-top) !important;
  right: auto !important;
  left: var(--session-leave-left) !important;
  width: var(--session-leave-width) !important;
  margin: 0 !important;
}

.session-forward-enter-active,
.session-forward-leave-active,
.session-back-enter-active,
.session-back-leave-active {
  transition:
    opacity 240ms ease,
    transform 300ms cubic-bezier(.22, 1, .36, 1);
}

.session-forward-leave-active,
.session-back-leave-active {
  pointer-events: none;
}

.session-forward-enter-from {
  opacity: 0;
  transform: translateX(2rem);
}

/* AppShell contains viewport-fixed chrome. Translating its root makes those
   elements use the moving shell as their containing block until the
   transition ends, which causes the bottom navigation to snap sideways. */
.session-forward-enter-active.v-application,
.session-back-leave-active.v-application {
  transition: opacity 240ms ease;
}

.session-forward-enter-from.v-application,
.session-back-leave-to.v-application {
  transform: none;
}

.session-forward-leave-to {
  opacity: 0;
  transform: translateX(-1.5rem);
}

.session-back-enter-from {
  opacity: 0;
  transform: translateX(-1.5rem);
}

.session-back-leave-to {
  opacity: 0;
  transform: translateX(2rem);
}

.session-loading {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  background: rgba(16, 19, 16, .58);
  color: #f1f4ec;
  backdrop-filter: blur(3px);
}

.session-loading span {
  font-size: .78rem;
  font-weight: 800;
  letter-spacing: .04em;
}

.session-loader-enter-active,
.session-loader-leave-active {
  transition: opacity 180ms ease;
}

.session-loader-enter-from,
.session-loader-leave-to {
  opacity: 0;
}

</style>
