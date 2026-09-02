<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import AccountMenu from '@/components/AccountMenu.vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AssistantPanel from '@/components/AssistantPanel.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MainNavigationIcon from '@/components/MainNavigationIcon.vue'
import { localDataChangedEvent } from '@/lib/localDatabase'
import { preloadMainNavigationView } from '@/services/mainNavigationViews'
import { setForegroundSyncDeferred } from '@/services/offlineSync'
import {
  bottomNavigationFontSize,
  mainMenuTransitionDirection,
  MAIN_MENU_ORDER_CHANGED_EVENT,
  MAIN_MENU_VISIBILITY_CHANGED_EVENT,
  readStoredHiddenMainMenuItems,
  readStoredMainMenuOrder,
  visibleMainNavItems,
} from '@/services/navigation'
import {
  formatRunningSessionTitle,
  RUNNING_SESSION_TITLE_INTERVAL_MS,
} from '@/services/runningSessionTitle'
import { mobileKeyboardVisible } from '@/services/mobileKeyboardViewport'
import { requestDesktopTaskReminderPermission } from '@/services/taskReminders'
import { UnsyncedChangesError, useAuthStore } from '@/stores/auth'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useJournalStore } from '@/stores/journal'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSyncStore } from '@/stores/sync'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'

const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const flashcardStore = useFlashcardStore()
const intervalStore = useIntervalStore()
const snackbar = useSnackbarStore()
const syncStore = useSyncStore()
const taskStore = useTaskStore()
const trackingStore = useTrackingStore()
const journalStore = useJournalStore()
const logoutDialog = ref(false)
const discardLogoutDialog = ref(false)
const unsyncedLogoutCount = ref<number>()
const discardAllIssuesDialog = ref(false)
const discardingAllIssues = ref(false)
const syncSheet = ref(false)
const assistantPanel = ref(false)
const initialContentLoading = ref(true)
const pageTransition = ref('page-level-forward')
const pageTransitionStage = ref<HTMLElement>()
const pendingMainNavigationPath = ref<string>()
const isIos = Capacitor.getPlatform() === 'ios'
const isAndroid = Capacitor.getPlatform() === 'android'
const isBrowser = Capacitor.getPlatform() === 'web'
const storedMenuOrder = ref(readStoredMainMenuOrder())
const storedHiddenMenuItems = ref(readStoredHiddenMainMenuItems())
const reducedMotion = ref(
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
const documentTitle = typeof document === 'undefined'
  ? 'BackOnTrack — Build your way forward.'
  : document.title
let documentTitleFrame = 0
let documentTitleTimer: number | undefined
let localRefreshTimer: number | undefined
let localRefreshPending = false
let mainNavigationPreloadTimer: number | undefined
let pendingMainNavigationPointerId: number | undefined
let committedMainNavigationClickPath: string | undefined
let committedMainNavigationClickTimer: number | undefined
let earlyLeavingPage: HTMLElement | undefined
let earlyLeavingRoute: string | undefined
let earlyLeaveResetTimer: number | undefined
let routeScrollUnlockFrame: number | undefined
let initialContentRevealFrame: number | undefined
let shellMounted = false

const items = computed(() => visibleMainNavItems(
  storedMenuOrder.value ?? auth.user?.settings?.mainMenuOrder,
  storedHiddenMenuItems.value ?? auth.user?.settings?.mainMenuHidden,
))
const intervalIsRunning = computed(() => intervalStore.activeSession?.status === 'running')
const flashcardIsRunning = computed(() => flashcardStore.activeSession?.status === 'running')
const intervalSessionIsActive = computed(() => Boolean(intervalStore.activeSession))
const flashcardSessionIsActive = computed(() => Boolean(flashcardStore.activeSession))
const sessionIsRunning = computed(() => intervalIsRunning.value || flashcardIsRunning.value)
const syncLabel = computed(() => {
  const status = syncStore.status
  if (status.issueCount) return 'Sync needs attention'
  if (status.phase === 'auth-required') return 'Sign in to sync'
  if (status.phase === 'offline') return status.pendingCount
    ? `${status.pendingCount} saved on device`
    : 'Offline'
  if (status.phase === 'hydrating') return 'Preparing offline data'
  if (status.phase === 'syncing') return status.pendingCount ? 'Sending changes' : 'Syncing'
  if (status.pendingCount) return `${status.pendingCount} waiting to sync`
  return 'Up to date'
})
const syncIcon = computed(() => {
  if (syncStore.status.issueCount) return 'mdi-alert-circle-outline'
  if (syncStore.status.phase === 'auth-required') return 'mdi-account-alert-outline'
  if (syncStore.status.phase === 'offline') return 'mdi-cloud-off-outline'
  if (['hydrating', 'syncing'].includes(syncStore.status.phase)) return 'mdi-cloud-sync-outline'
  return 'mdi-cloud-check-outline'
})
const syncColor = computed(() => syncStore.status.issueCount
  ? 'warning'
  : syncStore.status.phase === 'offline' || syncStore.status.phase === 'auth-required'
    ? 'medium-emphasis'
    : 'secondary')
const lastSyncedLabel = computed(() => {
  if (!syncStore.status.lastSyncedAt) return 'Not synchronized yet'
  const date = new Date(syncStore.status.lastSyncedAt)
  return Number.isNaN(date.getTime())
    ? 'Not synchronized yet'
    : `Last synchronized ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
})
const visibleSyncIssues = computed(() => syncStore.issues.slice(0, 5))

const immersive = computed(() => Boolean(router.currentRoute.value.meta.immersive))
const assistantAvailable = computed(() => router.currentRoute.value.path.startsWith('/flashcards'))
const pageTitle = computed(() => String(router.currentRoute.value.meta.title || 'BackOnTrack'))
const canGoBack = computed(() => Number(router.currentRoute.value.meta.pageDepth ?? 0) > 0)

watch(assistantAvailable, (available) => {
  if (!available) assistantPanel.value = false
})

const accountName = computed(() => auth.user?.name || auth.firstName || 'You')
const accountEmail = computed(() => auth.user?.email || '')
const accountAvatar = computed(() => auth.user?.avatar || '')
const accountInitials = computed(() => {
  const source = auth.user?.name || auth.user?.email || 'A'
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'A'
})
const current = computed({
  get: () => {
    const path = router.currentRoute.value.path
    if (path.startsWith('/intervals')) return '/intervals'
    if (path.startsWith('/flashcards')) return '/flashcards'
    if (path.startsWith('/tracking')) return '/tracking'
    if (path.startsWith('/journal')) return '/journal'
    if (path.startsWith('/tasks')) return '/tasks'
    return path
  },
  set: (path: string) => router.push(path),
})
const selectedMainNavigationPath = computed(() => pendingMainNavigationPath.value ?? current.value)

function preloadMainNavigationPath(path: string) {
  const preload = preloadMainNavigationView(path)
  if (preload) void preload.catch(() => undefined)
}

function beginMainNavigationPress(path: string, event: PointerEvent) {
  if (!event.isPrimary) return
  pendingMainNavigationPointerId = event.pointerId
  pendingMainNavigationPath.value = path
  preloadMainNavigationPath(path)
}

function finishMainNavigationPress(path: string, event: PointerEvent) {
  if (pendingMainNavigationPointerId !== event.pointerId) return
  pendingMainNavigationPointerId = undefined
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const releasedInside = event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom
  if (!releasedInside) {
    cancelMainNavigationPress(path)
    return
  }
  committedMainNavigationClickPath = path
  if (committedMainNavigationClickTimer !== undefined) {
    window.clearTimeout(committedMainNavigationClickTimer)
  }
  committedMainNavigationClickTimer = window.setTimeout(() => {
    committedMainNavigationClickTimer = undefined
    committedMainNavigationClickPath = undefined
  }, 0)
  void router.push(path)
}

function activateMainNavigation(path: string) {
  if (committedMainNavigationClickPath === path) {
    committedMainNavigationClickPath = undefined
    if (committedMainNavigationClickTimer !== undefined) {
      window.clearTimeout(committedMainNavigationClickTimer)
      committedMainNavigationClickTimer = undefined
    }
    return
  }
  pendingMainNavigationPath.value = path
  preloadMainNavigationPath(path)
  void router.push(path)
}

function cancelMainNavigationPress(path: string, event?: PointerEvent) {
  if (event && pendingMainNavigationPointerId !== event.pointerId) return
  pendingMainNavigationPointerId = undefined
  if (pendingMainNavigationPath.value !== path) return
  pendingMainNavigationPath.value = undefined
  restoreEarlyPageLeave(path)
}

function preloadVisibleMainNavigationViews() {
  items.value.forEach(item => preloadMainNavigationPath(item.to))
}

function menuItemHasActiveSession(itemId: string) {
  if (itemId === 'intervals') return intervalSessionIsActive.value
  if (itemId === 'flashcards') return flashcardSessionIsActive.value
  return false
}

function menuItemLabel(item: { id: string; title: string }) {
  if (item.id === 'intervals' && intervalStore.activeSession) {
    return `${item.title}, session ${intervalStore.activeSession.status}`
  }
  if (item.id === 'flashcards' && flashcardStore.activeSession) {
    return `${item.title}, review ${flashcardStore.activeSession.status}`
  }
  return item.title
}

function stopDocumentTitleAnimation(restoreTitle = true) {
  if (documentTitleTimer !== undefined) {
    window.clearInterval(documentTitleTimer)
    documentTitleTimer = undefined
  }
  if (restoreTitle && typeof document !== 'undefined') document.title = documentTitle
}

function renderDocumentTitleFrame() {
  if (typeof document === 'undefined') return
  document.title = formatRunningSessionTitle(
    documentTitle,
    documentTitleFrame,
    reducedMotion.value,
  )
  documentTitleFrame += 1
}

function syncDocumentTitle() {
  if (!isBrowser || typeof window === 'undefined') return
  stopDocumentTitleAnimation()
  if (!sessionIsRunning.value) return
  documentTitleFrame = 0
  renderDocumentTitleFrame()
  if (!reducedMotion.value) {
    documentTitleTimer = window.setInterval(
      renderDocumentTitleFrame,
      RUNNING_SESSION_TITLE_INTERVAL_MS,
    )
  }
}

watch([sessionIsRunning, reducedMotion], syncDocumentTitle, { immediate: true })

function clearEarlyLeaveResetTimer() {
  if (earlyLeaveResetTimer === undefined) return
  window.clearTimeout(earlyLeaveResetTimer)
  earlyLeaveResetTimer = undefined
}

function beginEarlyPageLeave(route: string) {
  const page = pageTransitionStage.value?.firstElementChild
  if (!(page instanceof HTMLElement)) return
  clearEarlyLeaveResetTimer()
  if (earlyLeavingPage && earlyLeavingPage !== page) {
    earlyLeavingPage.classList.remove('page-route-early-leave', 'page-route-early-leave-resetting')
  }
  earlyLeavingPage = page
  earlyLeavingRoute = route
  page.classList.remove('page-route-early-leave-resetting')
  page.classList.add('page-route-early-leave')
}

function restoreEarlyPageLeave(route?: string) {
  if (route && earlyLeavingRoute !== route) return
  const page = earlyLeavingPage
  earlyLeavingPage = undefined
  earlyLeavingRoute = undefined
  if (!page) return
  clearEarlyLeaveResetTimer()
  page.classList.remove('page-route-early-leave')
  page.classList.add('page-route-early-leave-resetting')
  earlyLeaveResetTimer = window.setTimeout(() => {
    earlyLeaveResetTimer = undefined
    page.classList.remove('page-route-early-leave-resetting')
  }, 240)
}

function releaseRouteScrollLock() {
  if (routeScrollUnlockFrame !== undefined) {
    window.cancelAnimationFrame(routeScrollUnlockFrame)
    routeScrollUnlockFrame = undefined
  }
  document.documentElement.classList.remove('route-navigation-scroll-lock')
}

function stopDocumentMomentumScroll() {
  releaseRouteScrollLock()
  const scrollingElement = document.scrollingElement
  const scrollTop = scrollingElement?.scrollTop ?? window.scrollY
  const scrollLeft = scrollingElement?.scrollLeft ?? window.scrollX
  document.documentElement.classList.add('route-navigation-scroll-lock')
  // Recreating the root scrolling box cancels a native fling. Keep its current
  // position until Vue Router applies the destination's scroll position.
  void document.documentElement.offsetHeight
  if (scrollingElement) {
    scrollingElement.scrollTop = scrollTop
    scrollingElement.scrollLeft = scrollLeft
  }
}

function scheduleRouteScrollUnlock() {
  if (routeScrollUnlockFrame !== undefined) window.cancelAnimationFrame(routeScrollUnlockFrame)
  routeScrollUnlockFrame = window.requestAnimationFrame(() => {
    routeScrollUnlockFrame = undefined
    releaseRouteScrollLock()
  })
}

const removeTransitionGuard = router.beforeEach((to, from) => {
  if (to.meta.auth && from.meta.auth && to.path !== from.path) {
    stopDocumentMomentumScroll()
    const page = pageTransitionStage.value?.firstElementChild
    if (page) pinLeavingPage(page)
    beginEarlyPageLeave(to.fullPath)
  }

  const menuDirection = mainMenuTransitionDirection(items.value, from.path, to.path)
  if (menuDirection) {
    pageTransition.value = menuDirection === 'forward'
      ? 'page-level-forward'
      : 'page-level-back'
    return
  }

  const toDepth = Number(to.meta.pageDepth ?? 0)
  const fromDepth = Number(from.meta.pageDepth ?? 0)

  if (to.meta.pageMotion === 'horizontal' || from.meta.pageMotion === 'horizontal') {
    pageTransition.value = toDepth < fromDepth ? 'page-level-back' : 'page-level-forward'
    return
  }

  if (toDepth > fromDepth) {
    pageTransition.value = 'page-depth-deeper'
  } else if (toDepth < fromDepth) {
    pageTransition.value = 'page-depth-higher'
  } else {
    const toOrder = Number(to.meta.pageOrder ?? 0)
    const fromOrder = Number(from.meta.pageOrder ?? 0)
    pageTransition.value = toOrder >= fromOrder ? 'page-level-forward' : 'page-level-back'
  }
})
const removeNavigationFeedbackGuard = router.afterEach((to, _from, failure) => {
  pendingMainNavigationPointerId = undefined
  pendingMainNavigationPath.value = undefined
  scheduleRouteScrollUnlock()
  if (failure) {
    restoreEarlyPageLeave(to.fullPath)
  } else if (earlyLeavingRoute === to.fullPath) {
    earlyLeavingRoute = undefined
  }
})
const removeNavigationErrorHandler = router.onError(() => {
  scheduleRouteScrollUnlock()
  restoreEarlyPageLeave()
})

function refreshStoredMenuSettings() {
  storedMenuOrder.value = readStoredMainMenuOrder()
  storedHiddenMenuItems.value = readStoredHiddenMainMenuItems()
}

function scheduleLocalRefresh() {
  localRefreshPending = true
  if (localRefreshTimer !== undefined) window.clearTimeout(localRefreshTimer)
  localRefreshTimer = undefined
  if (immersive.value) return
  localRefreshTimer = window.setTimeout(() => {
    localRefreshTimer = undefined
    if (immersive.value) return
    localRefreshPending = false
    void Promise.allSettled([
      intervalStore.load({ reconcileActiveSession: false }),
      flashcardStore.load(),
      taskStore.load(),
      trackingStore.load(),
      journalStore.reloadCurrentRange(),
    ])
  }, 250)
}

function waitForTaskLoad() {
  return waitForStoreLoad(() => taskStore.loading)
}

function waitForStoreLoad(loading: () => boolean) {
  if (!loading()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const stop = watch(loading, (active) => {
      if (active) return
      stop()
      resolve()
    })
  })
}

async function loadInitialStore(
  loading: () => boolean,
  load: () => Promise<unknown>,
) {
  if (loading()) {
    await waitForStoreLoad(loading)
    return
  }
  await load()
}

async function prepareInitialContent() {
  // Child mounted hooks run first, so reuse any route-specific store requests
  // that are already in flight instead of issuing duplicates from the shell.
  const loads = [
    loadInitialStore(() => taskStore.loading, () => taskStore.load()),
    loadInitialStore(() => intervalStore.loading, () => intervalStore.load()),
    loadInitialStore(() => flashcardStore.loading, () => flashcardStore.load()),
    loadInitialStore(() => trackingStore.loading, () => trackingStore.load()),
  ]
  if (journalStore.loading) loads.push(waitForStoreLoad(() => journalStore.loading))
  await Promise.allSettled(loads)
  await nextTick()
  if (!shellMounted) return

  if (reducedMotion.value) {
    initialContentLoading.value = false
    return
  }
  initialContentRevealFrame = window.requestAnimationFrame(() => {
    initialContentRevealFrame = undefined
    if (!shellMounted) return
    initialContentLoading.value = false
  })
}

async function checkDesktopTaskNotificationPermission() {
  try {
    if (taskStore.loading) await waitForTaskLoad()
    const permitted = await requestDesktopTaskReminderPermission(taskStore.tasks)
    if (permitted) await taskStore.syncTaskReminders()
  } catch {
    // Task loading already exposes its error state; permission checks are best-effort.
  }
}

watch(immersive, (active) => {
  setForegroundSyncDeferred(active)
  if (!active && localRefreshPending) scheduleLocalRefresh()
}, { immediate: true })

onMounted(() => {
  shellMounted = true
  window.addEventListener(MAIN_MENU_ORDER_CHANGED_EVENT, refreshStoredMenuSettings)
  window.addEventListener(MAIN_MENU_VISIBILITY_CHANGED_EVENT, refreshStoredMenuSettings)
  window.addEventListener('storage', refreshStoredMenuSettings)
  window.addEventListener(localDataChangedEvent, scheduleLocalRefresh)
  void syncStore.refresh()
  void prepareInitialContent().then(() => {
    if (shellMounted && isBrowser && mdAndUp.value) void checkDesktopTaskNotificationPermission()
  })
  if (isAndroid) {
    mainNavigationPreloadTimer = window.setTimeout(() => {
      mainNavigationPreloadTimer = undefined
      preloadVisibleMainNavigationViews()
    }, 600)
  }
})

onBeforeUnmount(() => {
  shellMounted = false
  setForegroundSyncDeferred(false)
  stopDocumentTitleAnimation()
  removeTransitionGuard()
  removeNavigationFeedbackGuard()
  removeNavigationErrorHandler()
  restoreEarlyPageLeave()
  clearEarlyLeaveResetTimer()
  releaseRouteScrollLock()
  window.removeEventListener(MAIN_MENU_ORDER_CHANGED_EVENT, refreshStoredMenuSettings)
  window.removeEventListener(MAIN_MENU_VISIBILITY_CHANGED_EVENT, refreshStoredMenuSettings)
  window.removeEventListener('storage', refreshStoredMenuSettings)
  window.removeEventListener(localDataChangedEvent, scheduleLocalRefresh)
  if (localRefreshTimer !== undefined) window.clearTimeout(localRefreshTimer)
  if (mainNavigationPreloadTimer !== undefined) window.clearTimeout(mainNavigationPreloadTimer)
  if (committedMainNavigationClickTimer !== undefined) {
    window.clearTimeout(committedMainNavigationClickTimer)
  }
  if (initialContentRevealFrame !== undefined) {
    window.cancelAnimationFrame(initialContentRevealFrame)
  }
})

async function logout() {
  try {
    await auth.logout()
    logoutDialog.value = false
    await router.replace('/auth')
  } catch (cause) {
    logoutDialog.value = false
    if (cause instanceof UnsyncedChangesError) {
      unsyncedLogoutCount.value = cause.changeCount
      auth.clearError()
      discardLogoutDialog.value = true
      return
    }
    syncSheet.value = true
  }
}

async function discardUnsyncedAndLogout() {
  try {
    await auth.logout({ discardUnsynced: true })
    discardLogoutDialog.value = false
    await router.replace('/auth')
  } catch {
    discardLogoutDialog.value = false
    syncSheet.value = true
  }
}

async function discardAllIssues() {
  discardingAllIssues.value = true
  try {
    const discarded = await syncStore.discardAllIssues()
    discardAllIssuesDialog.value = false
    if (discarded) snackbar.showDeletion(`${discarded} synchronization issue${discarded === 1 ? '' : 's'}`)
  } finally {
    discardingAllIssues.value = false
  }
}

function pinLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement) || getComputedStyle(element).position === 'fixed') return
  const bounds = element.getBoundingClientRect()
  element.style.setProperty('--page-leave-top', `${bounds.top}px`)
  element.style.setProperty('--page-leave-left', `${bounds.left}px`)
  element.style.setProperty('--page-leave-width', `${bounds.width}px`)
  element.classList.add('page-route-leaving-pinned')
}

function releaseLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.classList.remove(
    'page-route-early-leave',
    'page-route-early-leave-resetting',
    'page-route-leaving-pinned',
  )
  element.style.removeProperty('--page-leave-top')
  element.style.removeProperty('--page-leave-left')
  element.style.removeProperty('--page-leave-width')
  if (earlyLeavingPage === element) earlyLeavingPage = undefined
}

</script>

<template>
  <v-app theme="forgeDark">
    <v-navigation-drawer
      v-if="mdAndUp && !immersive"
      permanent
      width="272"
      color="surface"
      class="desktop-sidebar"
    >
      <div class="desktop-sidebar__content">
        <div class="desktop-sidebar__brand px-5 pt-6 pb-5">
          <div class="brand-mark">
            <img src="/brand/backontrack-wordmark.png" alt="BackOnTrack" />
          </div>
          <p class="text-caption ml-10 mt-n2 text-medium-emphasis mb-0 mt-2">Build your way forward.</p>
        </div>

        <v-divider class="mx-4" />

        <v-list nav class="desktop-sidebar__navigation px-3 py-4" aria-label="Primary navigation">
          <v-list-item
            v-for="item in items"
            :key="item.to"
            :to="item.to"
            :aria-label="menuItemLabel(item)"
            :active="current === item.to"
            :aria-current="current === item.to ? 'page' : undefined"
            rounded="lg"
            class="desktop-sidebar__nav-item mb-1"
            color="secondary"
          >
            <template #prepend>
              <span class="desktop-sidebar__nav-icon">
                <MainNavigationIcon
                  :icon="item.icon"
                  :running="menuItemHasActiveSession(item.id)"
                  badge-surface="surface"
                />
              </span>
            </template>
            <template #title>
              <span class="desktop-sidebar__nav-label">{{ item.title }}</span>
            </template>
            <template #append>
              <v-icon
                v-if="current === item.to"
                icon="mdi-chevron-right"
                size="18"
                class="desktop-sidebar__active-arrow"
              />
            </template>
          </v-list-item>
        </v-list>

        <aside class="desktop-sidebar__ring-promo mx-3 mb-4" aria-label="BackOnTrack Ring">
          <img
            class="desktop-sidebar__ring-image"
            src="/images/backontrack-ring.png"
            alt="BackOnTrack Ring"
            width="256"
            height="256"
          />
          <div class="desktop-sidebar__ring-details">
            <p class="desktop-sidebar__ring-title mb-1">BackOnTrack Ring</p>
            <p class="desktop-sidebar__ring-copy text-medium-emphasis mb-2">
              Control flashcards and intervals at your fingertips.
            </p>
            <p class="desktop-sidebar__ring-price mb-0">$49.99</p>
          </div>
        </aside>
      </div>
    </v-navigation-drawer>

    <transition name="app-chrome" appear>
      <header
        v-if="!immersive && !mobileKeyboardVisible"
        class="app-bar"
        :class="{ 'app-bar--ios': isIos, 'app-bar--back': canGoBack }"
      >
        <div class="app-bar__inner">
          <div class="app-bar__leading">
            <transition name="app-bar-button">
              <div v-if="canGoBack" class="app-bar__back-control">
                <v-btn
                  class="app-bar__back-button"
                  icon="mdi-chevron-left"
                  variant="text"
                  aria-label="Go back"
                  @click="router.back()"
                />
              </div>
            </transition>
          </div>

          <h1 class="app-bar__title">{{ pageTitle }}</h1>

          <div class="app-bar__actions d-flex align-center ga-1">
            <v-btn
              :icon="syncIcon"
              :color="syncColor"
              variant="text"
              :aria-label="syncLabel"
              @click="syncSheet = true"
            >
              <v-icon :icon="syncIcon" />
              <v-badge
                v-if="syncStore.status.pendingCount || syncStore.status.issueCount"
                color="warning"
                dot
                floating
              />
            </v-btn>
            <div
              class="app-bar__ai-control"
              :class="{ 'app-bar__ai-control--available': assistantAvailable }"
            >
              <transition name="app-bar-ai-button">
                <v-btn
                  v-if="assistantAvailable"
                  icon="mdi-creation-outline"
                  color="secondary"
                  variant="text"
                  aria-label="Open AI flashcard assistant"
                  @click="assistantPanel = true"
                />
              </transition>
            </div>
            <AccountMenu
              :account-name="accountName"
              :account-email="accountEmail"
              :account-initials="accountInitials"
              :account-avatar="accountAvatar"
              @open-account="router.push('/account')"
              @open-settings="router.push('/settings')"
              @sign-out="logoutDialog = true"
            />
          </div>
        </div>
      </header>
    </transition>

    <AssistantPanel v-if="assistantAvailable" v-model="assistantPanel" />

    <v-main
      tag="div"
      class="app-scroll app-scroll--shell"
      :class="{
        'app-scroll--with-nav': !mdAndUp && !immersive && !mobileKeyboardVisible,
        'app-scroll--with-bar': !immersive && !mobileKeyboardVisible,
      }"
    >
      <transition name="initial-content-loader">
        <div
          v-if="initialContentLoading"
          class="initial-content-loader"
          :class="{
            'initial-content-loader--with-bar': !immersive && !mobileKeyboardVisible,
            'initial-content-loader--with-nav': !mdAndUp && !immersive && !mobileKeyboardVisible,
          }"
          role="status"
          aria-label="Loading app data"
        >
          <v-progress-circular indeterminate color="secondary" :size="48" width="4" />
        </div>
      </transition>

      <div
        ref="pageTransitionStage"
        class="page-transition-stage"
        :class="{ 'page-transition-stage--initial-loading': initialContentLoading }"
        :aria-hidden="initialContentLoading"
        :inert="initialContentLoading"
      >
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition
            :name="pageTransition"
            @before-leave="pinLeavingPage"
            @after-leave="releaseLeavingPage"
            @leave-cancelled="releaseLeavingPage"
          >
            <component :is="Component" :key="viewRoute.path" />
          </transition>
        </router-view>
      </div>
    </v-main>

    <transition name="bottom-nav" appear>
      <nav
        v-if="!mdAndUp && !immersive && !mobileKeyboardVisible"
        class="bottom-nav"
        :style="{ '--bottom-nav-font-size': bottomNavigationFontSize(items.length) }"
        aria-label="Primary navigation"
      >
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          v-slot="{ href }"
          custom
        >
          <a
            :href="href"
            class="bottom-nav__link"
            :class="{ 'bottom-nav__link--active': selectedMainNavigationPath === item.to }"
            :aria-current="current === item.to ? 'page' : undefined"
            :aria-label="menuItemLabel(item)"
            data-post-gesture-click-recovery="off"
            @pointerdown="beginMainNavigationPress(item.to, $event)"
            @pointerup="finishMainNavigationPress(item.to, $event)"
            @pointercancel="cancelMainNavigationPress(item.to, $event)"
            @click.prevent="activateMainNavigation(item.to)"
          >
            <MainNavigationIcon
              :icon="item.icon"
              :running="menuItemHasActiveSession(item.id)"
              badge-surface="surface"
            />
            <span>{{ item.title }}</span>
          </a>
        </router-link>
      </nav>
    </transition>

    <ConfirmDialog
      v-model="logoutDialog"
      title="Sign out?"
      :message="auth.error || 'Your latest changes will synchronize before offline data is removed from this device.'"
      confirm-text="Sign out"
      icon="mdi-logout"
      :loading="auth.logoutLoading"
      @confirm="logout"
    />

    <ConfirmDialog
      v-model="discardLogoutDialog"
      title="Discard unsynced changes?"
      :message="unsyncedLogoutCount === undefined
        ? 'Your local changes could not be checked. Signing out anyway permanently removes any unsynced data from this device.'
        : `${unsyncedLogoutCount} local change${unsyncedLogoutCount === 1 ? '' : 's'} could not be synchronized. Signing out anyway permanently removes ${unsyncedLogoutCount === 1 ? 'it' : 'them'} from this device.`"
      confirm-text="Discard and sign out"
      confirm-color="error"
      icon="mdi-cloud-remove-outline"
      :loading="auth.logoutLoading"
      @confirm="discardUnsyncedAndLogout"
    />

    <ConfirmDialog
      v-model="discardAllIssuesDialog"
      title="Discard all sync issues?"
      :message="`This permanently removes the local changes associated with all ${syncStore.issues.length} synchronization issues from this device.`"
      confirm-text="Discard all"
      confirm-color="error"
      icon="mdi-delete-sweep-outline"
      :loading="discardingAllIssues"
      @confirm="discardAllIssues"
    />

    <ActionBottomSheet
      v-model="syncSheet"
      title="Synchronization"
      aria-label="Synchronization status"
    >
      <template #content>
        <div class="sync-panel">
          <div class="d-flex align-center ga-3">
            <v-avatar :color="syncColor" variant="tonal" size="42">
              <v-icon :icon="syncIcon" />
            </v-avatar>
            <div class="min-width-0">
              <p class="text-body-2 font-weight-bold mb-0">{{ syncLabel }}</p>
              <p class="text-caption text-medium-emphasis mb-0">{{ lastSyncedLabel }}</p>
            </div>
          </div>
          <p v-if="syncStore.status.phase !== 'syncing' && (syncStore.status.message || auth.error)" class="text-body-2 text-medium-emphasis mb-0">
            {{ auth.error || syncStore.status.message }}
          </p>
          <p
            v-if="syncStore.issues.length > visibleSyncIssues.length"
            class="text-caption text-medium-emphasis mb-0"
          >
            Showing the 5 most recent of {{ syncStore.issues.length }} issues.
          </p>
          <v-list v-if="visibleSyncIssues.length" bg-color="transparent" class="pa-0">
            <v-list-item
              v-for="issue in visibleSyncIssues"
              :key="issue.id"
              prepend-icon="mdi-alert-outline"
              :title="issue.message"
              :subtitle="issue.resource.replaceAll('_', ' ')"
            >
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  color="warning"
                  @click="syncStore.discardIssue(issue.id)"
                >
                  Discard
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
          <v-btn
            v-if="syncStore.issues.length > 1"
            block
            color="error"
            variant="outlined"
            prepend-icon="mdi-delete-sweep-outline"
            @click="discardAllIssuesDialog = true"
          >
            Discard all
          </v-btn>
          <v-btn
            v-if="syncStore.status.phase === 'auth-required'"
            block
            color="secondary"
            prepend-icon="mdi-login"
            @click="router.push({ path: '/auth', query: { reauth: '1', redirect: router.currentRoute.value.fullPath } })"
          >
            Sign in to sync
          </v-btn>
          <v-btn
            v-else
            block
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-sync"
            :loading="syncStore.status.phase === 'syncing' || syncStore.status.phase === 'hydrating'"
            @click="syncStore.syncNow('manual')"
          >
            Sync now
          </v-btn>
        </div>
      </template>
    </ActionBottomSheet>

    <v-snackbar
      :key="snackbar.revision"
      v-model="snackbar.visible"
      color="success"
      location="bottom"
      :timeout="4000"
    >
      <div class="d-flex align-center ga-2">
        <v-icon icon="mdi-check-circle-outline" />
        <span>{{ snackbar.message }}</span>
      </div>
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Dismiss confirmation"
          @click="snackbar.dismiss"
        />
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.app-bar {
  position: fixed;
  z-index: 1002;
  top: 0;
  right: 0;
  left: 0;
  height: calc(60px + max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px)));
  padding-top: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px));
  border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .08);
  background: rgba(var(--v-theme-background) / .9);
  backdrop-filter: blur(16px);
}

.app-bar__inner {
  display: grid;
  width: 100%;
  max-width: 900px;
  height: 60px;
  margin: 0 auto;
  padding: 0 1rem;
  grid-template-columns: 0 minmax(0, 1fr) 8.75rem;
  align-items: center;
  gap: 0;
}

.app-bar__actions {
  display: flex;
  width: 8.75rem;
  align-items: center;
  justify-content: flex-end;
}

.app-bar__ai-control {
  display: grid;
  width: 0;
  flex: 0 0 auto;
  overflow: hidden;
  place-items: center;
  transition: width 220ms cubic-bezier(.22, 1, .36, 1);
}

.app-bar__ai-control--available {
  width: 3rem;
}

.sync-panel {
  display: grid;
  gap: 1rem;
}

.app-bar__leading {
  display: grid;
  width: 44px;
  place-items: center;
}

.app-bar__back-control {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
}

.app-bar__back-button {
  width: 2.75rem !important;
  min-width: 2.75rem !important;
  height: 2.75rem !important;
}

.app-bar-button-enter-active,
.app-bar-button-leave-active {
  transition:
    opacity 160ms ease,
    transform 220ms ease;
}

.app-bar-button-enter-from,
.app-bar-button-leave-to {
  opacity: 0;
  transform: translateX(-.5rem);
}

.app-bar-ai-button-enter-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(.22, 1, .36, 1);
}

.app-bar-ai-button-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms cubic-bezier(.4, 0, 1, 1);
}

.app-bar-ai-button-enter-from,
.app-bar-ai-button-leave-to {
  opacity: 0;
  transform: scale(.72);
}

.app-chrome-enter-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(.22, 1, .36, 1);
}

.app-chrome-leave-active {
  transition: opacity 160ms ease;
}

.app-chrome-enter-from {
  opacity: 0;
  transform: translateY(-100%);
}

.app-chrome-leave-to {
  opacity: 0;
}

.app-bar__title {
  overflow: hidden;
  margin: 0;
  font-size: .95rem;
  font-weight: 850;
  letter-spacing: -.01em;
  line-height: 1.2;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar--back .app-bar__inner {
  grid-template-columns: 2.75rem minmax(0, 1fr) 8.75rem;
  gap: 1rem;
}

.app-bar--ios .app-bar__inner {
  padding: 0 .5rem;
  grid-template-columns: 2.75rem minmax(0, 1fr) 8.75rem;
  gap: .5rem;
}

.app-bar--ios .app-bar__title {
  text-align: center;
}

.app-bar--ios.app-bar--back .app-bar__inner {
  gap: 1rem;
}

.brand-mark {
  width: 10.5rem;
  height: 2.25rem;
}

.brand-mark img {
  display: block;
  width: 10.5rem;
  height: 2.25rem;
  object-fit: contain;
  object-position: left center;
}

.desktop-sidebar {
  border-right: 1px solid rgba(var(--v-theme-on-surface), .14) !important;
  background:
    linear-gradient(180deg, rgba(var(--v-theme-secondary), .08), transparent 16rem),
    linear-gradient(
      90deg,
      rgba(var(--v-theme-surface-variant), .72),
      rgba(var(--v-theme-surface-variant), .32)
    ),
    rgb(var(--v-theme-surface)) !important;
  box-shadow: .75rem 0 1.5rem rgba(0, 0, 0, .1) !important;
}

.desktop-sidebar :deep(.v-navigation-drawer__content) {
  overflow: hidden;
}

.desktop-sidebar__content {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.desktop-sidebar__brand {
  flex: 0 0 auto;
}

.desktop-sidebar__navigation {
  flex: 0 0 auto;
}

.desktop-sidebar__ring-promo {
  display: flex;
  min-width: 0;
  margin-top: auto;
  align-items: center;
  gap: .5rem;
  border: 1px solid rgba(var(--v-theme-secondary), .24);
  border-radius: 1rem;
  padding: .75rem;
  background:
    linear-gradient(135deg, rgba(var(--v-theme-secondary), .16), transparent 72%),
    rgba(var(--v-theme-surface-variant), .52);
}

.desktop-sidebar__ring-image {
  display: block;
  width: 5rem;
  height: 5rem;
  flex: 0 0 auto;
  object-fit: contain;
}

.desktop-sidebar__ring-details {
  min-width: 0;
}

.desktop-sidebar__ring-title,
.desktop-sidebar__ring-price {
  color: rgb(var(--v-theme-on-surface));
  font-size: .8rem;
  font-weight: 800;
  letter-spacing: -.01em;
  line-height: 1.15;
}

.desktop-sidebar__ring-copy {
  font-size: .7rem;
  line-height: 1.3;
}

.desktop-sidebar__ring-price {
  color: rgb(var(--v-theme-secondary));
}

.desktop-sidebar__nav-item {
  min-height: 3.25rem;
  border: 1px solid transparent;
  color: rgb(var(--v-theme-on-surface) / .68);
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease;
}

.desktop-sidebar__nav-item:hover {
  background: rgb(var(--v-theme-on-surface) / .045);
  color: rgb(var(--v-theme-on-surface) / .9);
}

.desktop-sidebar__nav-item.v-list-item--active {
  border-color: rgb(var(--v-theme-secondary) / .18);
  background: rgb(var(--v-theme-secondary) / .1);
  color: rgb(var(--v-theme-secondary));
}

.desktop-sidebar__nav-item :deep(.v-list-item__prepend) {
  width: 2.75rem;
}

.desktop-sidebar__nav-item :deep(.v-list-item__append) {
  margin-inline-start: .5rem;
}

.desktop-sidebar__nav-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  border-radius: .625rem;
  background: rgb(var(--v-theme-on-surface) / .055);
  place-items: center;
  transition: background-color 180ms ease;
}

.desktop-sidebar__nav-item.v-list-item--active .desktop-sidebar__nav-icon {
  background: rgb(var(--v-theme-secondary) / .14);
}

.desktop-sidebar__nav-label {
  font-size: .85rem;
  font-weight: 800;
  letter-spacing: -.01em;
}

.desktop-sidebar__active-arrow {
  opacity: .72;
}

.bottom-nav {
  position: fixed;
  z-index: 1000;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: max(
    env(safe-area-inset-bottom, 0rem),
    var(--safe-area-inset-bottom, 0rem)
  );
  height: calc(
    72px + max(
      env(safe-area-inset-bottom, 0rem),
      var(--safe-area-inset-bottom, 0rem)
    )
  ) !important;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3) !important;
}

.bottom-nav-enter-active,
.bottom-nav-leave-active {
  transition:
    opacity 160ms ease,
    transform 200ms cubic-bezier(.22, 1, .36, 1);
}

.bottom-nav-enter-from,
.bottom-nav-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.bottom-nav__link {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: var(--bottom-nav-font-size, .68rem);
  font-weight: 800;
  line-height: 1.25;
  text-decoration: none;
  touch-action: manipulation;
  transition: font-size 160ms ease;
}

.bottom-nav__link--active {
  color: rgb(var(--v-theme-secondary));
}

.app-scroll {
  transition:
    padding-top 240ms ease,
    padding-bottom 240ms ease;
}

.app-scroll--with-nav {
  padding-bottom: calc(
    72px + max(
      env(safe-area-inset-bottom, 0rem),
      var(--safe-area-inset-bottom, 0rem)
    )
  ) !important;
}

.app-scroll--with-bar {
  padding-top: calc(60px + max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px))) !important;
}

.page-transition-stage {
  display: grid;
  min-width: 0;
  overflow-x: clip;
  opacity: 1;
  transition: opacity 220ms ease;
}

.page-transition-stage--initial-loading {
  opacity: 0;
  pointer-events: none;
}

.initial-content-loader {
  position: fixed;
  z-index: 3;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  place-items: center;
}

.initial-content-loader--with-bar {
  top: calc(3.75rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)));
}

.initial-content-loader--with-nav {
  bottom: calc(
    4.5rem + max(
      env(safe-area-inset-bottom, 0rem),
      var(--safe-area-inset-bottom, 0rem)
    )
  );
}

.initial-content-loader-leave-active {
  transition: opacity 160ms ease;
}

.initial-content-loader-leave-to {
  opacity: 0;
}

.page-transition-stage > * {
  min-width: 0;
  grid-area: 1 / 1;
  align-self: start;
}

@media (min-width: 960px) {
  .app-bar {
    left: 17rem;
  }

  .initial-content-loader {
    left: 17rem;
  }
}

</style>

<style>
:where(
  .page-level-forward-enter-active,
  .page-level-forward-leave-active,
  .page-level-back-enter-active,
  .page-level-back-leave-active,
  .page-depth-deeper-enter-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-enter-active,
  .page-depth-higher-leave-active
) {
  transition: opacity 240ms ease;
}

:where(
  .page-level-forward-enter-active,
  .page-level-forward-leave-active,
  .page-level-back-enter-active,
  .page-level-back-leave-active,
  .page-depth-deeper-enter-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-enter-active,
  .page-depth-higher-leave-active
) > :not(.page-action-area) {
  transition: transform 240ms cubic-bezier(.22, 1, .36, 1);
}

:where(
  .page-level-forward-enter-active,
  .page-level-back-enter-active,
  .page-depth-deeper-enter-active,
  .page-depth-higher-enter-active
) > .page-action-area--route-slide {
  transition: transform 220ms cubic-bezier(.22, 1, .36, 1);
}

:where(
  .page-level-forward-leave-active,
  .page-level-back-leave-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-leave-active
) > .page-action-area--route-slide {
  transition: transform 180ms cubic-bezier(.4, 0, 1, 1);
}

:where(
  .page-level-forward-leave-active,
  .page-level-back-leave-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-leave-active
) {
  pointer-events: none;
}

.page-route-leaving-pinned {
  position: fixed !important;
  z-index: 1;
  top: var(--page-leave-top) !important;
  right: auto !important;
  left: var(--page-leave-left) !important;
  width: var(--page-leave-width) !important;
  margin: 0 !important;
}

html.route-navigation-scroll-lock {
  overflow-y: hidden !important;
}

.page-route-early-leave,
.page-route-early-leave-resetting {
  transition: opacity 240ms ease !important;
}

.page-route-early-leave > .page-action-area--route-slide,
.page-route-early-leave-resetting > .page-action-area--route-slide {
  transition: transform 180ms cubic-bezier(.4, 0, 1, 1);
}

.page-route-early-leave {
  opacity: 0;
  pointer-events: none;
  will-change: opacity;
}

.page-route-early-leave > .page-action-area--route-slide {
  transform: translateY(100%);
}

:where(
  .page-level-forward-enter-from,
  .page-level-forward-leave-to,
  .page-level-back-enter-from,
  .page-level-back-leave-to,
  .page-depth-deeper-enter-from,
  .page-depth-deeper-leave-to,
  .page-depth-higher-enter-from,
  .page-depth-higher-leave-to
) {
  opacity: 0;
}

:where(
  .page-level-forward-enter-from,
  .page-level-forward-leave-to,
  .page-level-back-enter-from,
  .page-level-back-leave-to,
  .page-depth-deeper-enter-from,
  .page-depth-deeper-leave-to,
  .page-depth-higher-enter-from,
  .page-depth-higher-leave-to
) > .page-action-area--route-slide {
  transform: translateY(100%);
}

.page-level-forward-enter-from > :not(.page-action-area) { transform: translateX(1.5rem); }
.page-level-forward-leave-to > :not(.page-action-area) { transform: translateX(-1rem); }
.page-level-back-enter-from > :not(.page-action-area) { transform: translateX(-1.5rem); }
.page-level-back-leave-to > :not(.page-action-area) { transform: translateX(1rem); }
.page-depth-deeper-enter-from > :not(.page-action-area) { transform: translateY(1.5rem); }
.page-depth-deeper-leave-to > :not(.page-action-area) { transform: translateY(-1rem); }
.page-depth-higher-enter-from > :not(.page-action-area) { transform: translateY(-1.5rem); }
.page-depth-higher-leave-to > :not(.page-action-area) { transform: translateY(1rem); }

@media (prefers-reduced-motion: reduce) {
  .app-chrome-enter-active,
  .app-chrome-leave-active,
  .bottom-nav-enter-active,
  .bottom-nav-leave-active,
  .initial-content-loader-leave-active,
  .page-transition-stage,
  .app-bar__ai-control,
  .app-bar-ai-button-enter-active,
  .app-bar-ai-button-leave-active {
    transition-duration: .01ms !important;
  }

  .app-chrome-enter-from,
  .bottom-nav-enter-from,
  .bottom-nav-leave-to,
  .app-bar-ai-button-enter-from,
  .app-bar-ai-button-leave-to {
    transform: none;
  }

  .page-route-early-leave,
  .page-route-early-leave-resetting {
    transition-duration: .01ms !important;
  }

  :where(
    .page-level-forward-enter-from,
    .page-level-forward-leave-to,
    .page-level-back-enter-from,
    .page-level-back-leave-to,
    .page-depth-deeper-enter-from,
    .page-depth-deeper-leave-to,
    .page-depth-higher-enter-from,
    .page-depth-higher-leave-to
  ) > :not(.page-action-area) {
    transform: none;
  }

  :where(
    .page-level-forward-enter-from,
    .page-level-forward-leave-to,
    .page-level-back-enter-from,
    .page-level-back-leave-to,
    .page-depth-deeper-enter-from,
    .page-depth-deeper-leave-to,
    .page-depth-higher-enter-from,
    .page-depth-higher-leave-to,
    .page-route-early-leave
  ) > .page-action-area--route-slide {
    transform: none;
  }
}

</style>
