import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import packageMetadata from '../../package.json'
import { syncClientId } from '@/lib/localDatabase'

export type ProductAnalyticsAction =
  | 'task_editor_opened'
  | 'task_created'
  | 'task_progress_logged'
  | 'task_completed'
  | 'interval_created'
  | 'interval_started'
  | 'interval_completed'
  | 'flashcard_created'
  | 'review_set_created'
  | 'review_started'
  | 'review_completed'
  | 'tracking_logged'
  | 'journal_created'
  | 'assistant_opened'
  | 'assistant_request_sent'
  | 'review_set_shared'
  | 'curated_set_cloned'

type ProductAnalyticsEventName =
  | 'session_started'
  | 'session_ended'
  | 'screen_viewed'
  | 'action_completed'

interface QueuedProductAnalyticsEvent {
  accountId: string
  id: string
  clientId: string
  sessionId: string
  name: ProductAnalyticsEventName
  screen: string
  action: string
  occurredAt: string
  durationMs: number
}

interface ProductAnalyticsOptions {
  getAccountId: () => string
  getAuthToken: () => string
  getEnabled: () => boolean
  platform: string
  router: Router
}

const STORAGE_KEY = 'backontrack-product-analytics'
const FLUSH_INTERVAL_MS = 60_000
const MAX_QUEUED_EVENTS = 500
const MAX_BATCH_SIZE = 50
const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')
const analyticsUrl = `${apiBaseUrl}/analytics/events`

const routeScreens: Record<string, string> = {
  tasks: 'tasks',
  'task-new': 'task_editor',
  'task-edit': 'task_editor',
  'task-timer': 'task_timer',
  'program-runner': 'program_runner',
  intervals: 'intervals',
  'interval-new': 'interval_editor',
  'interval-edit': 'interval_editor',
  'interval-quick': 'interval_editor',
  'interval-template-runner': 'interval_runner',
  'interval-runner': 'interval_runner',
  flashcards: 'flashcards',
  'flashcard-cards': 'card_library',
  'flashcard-tags': 'card_library',
  'flashcard-import': 'card_library',
  'flashcard-new': 'card_editor',
  'flashcard-edit': 'card_editor',
  'flashcard-review-set-card-new': 'card_editor',
  'flashcard-review-set-card-edit': 'card_editor',
  'flashcard-review-set-new': 'review_set_editor',
  'flashcard-review-set-edit': 'review_set_editor',
  'flashcard-review-set-share': 'review_set_editor',
  'flashcard-review-set-cards': 'review_set_editor',
  'flashcard-review-set-runner': 'review_runner',
  'flashcard-review-runner': 'review_runner',
  'flashcard-curated': 'curated_sets',
  'flashcard-curated-detail': 'curated_set',
  tracking: 'tracking',
  'tracking-new': 'tracking_editor',
  'tracking-edit': 'tracking_editor',
  'tracking-insights': 'tracking_insights',
  journal: 'journal',
  'journal-new': 'journal_editor',
  'journal-edit': 'journal_editor',
  account: 'account',
  settings: 'settings',
  'settings-privacy': 'settings',
  'settings-terms': 'settings',
}

const createActions: Record<string, ProductAnalyticsAction> = {
  tasks: 'task_created',
  entries: 'task_progress_logged',
  interval_templates: 'interval_created',
  interval_sessions: 'interval_started',
  flashcards: 'flashcard_created',
  flashcard_review_sets: 'review_set_created',
  tracking_entries: 'tracking_logged',
  journal_entries: 'journal_created',
}

let installed = false
let options: ProductAnalyticsOptions | null = null
let flushPromise: Promise<void> | null = null
let activeAccountId = ''
let activeSessionId = ''
let activeSessionStartedAt = 0
let foreground = typeof document === 'undefined' || document.visibilityState !== 'hidden'
let initialNavigationRecorded = false
const queue: QueuedProductAnalyticsEvent[] = []

function identifier(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function analyticsEnabled() {
  return Boolean(
    options
    && options.getAccountId()
    && options.getAuthToken()
    && options.getEnabled(),
  )
}

function persistQueue() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_EVENTS)))
  } catch {
    // Analytics remains best-effort in memory when storage is unavailable.
  }
}

function restoreQueue() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return
    for (const candidate of stored.slice(-MAX_QUEUED_EVENTS)) {
      if (
        !candidate
        || typeof candidate.accountId !== 'string'
        || typeof candidate.id !== 'string'
        || typeof candidate.sessionId !== 'string'
        || typeof candidate.name !== 'string'
        || typeof candidate.occurredAt !== 'string'
        || eventExpired(candidate.occurredAt)
      ) continue
      queue.push(candidate as QueuedProductAnalyticsEvent)
    }
  } catch {
    // Ignore inaccessible or invalid analytics queued by an older version.
  }
}

function eventExpired(timestamp: string) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 13)
  const occurredAt = new Date(timestamp)
  return Number.isNaN(occurredAt.getTime()) || occurredAt < cutoff
}

function enqueue(
  name: ProductAnalyticsEventName,
  values: { screen?: string; action?: string; durationMs?: number } = {},
) {
  if (!analyticsEnabled()) return
  ensureSession()
  if (!activeSessionId || !activeAccountId) return
  queue.push({
    accountId: activeAccountId,
    id: identifier('event'),
    clientId: syncClientId(),
    sessionId: activeSessionId,
    name,
    screen: values.screen || '',
    action: values.action || '',
    occurredAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(values.durationMs || 0)),
  })
  if (queue.length > MAX_QUEUED_EVENTS) queue.splice(0, queue.length - MAX_QUEUED_EVENTS)
  persistQueue()
  if (queue.length >= MAX_BATCH_SIZE) void flushProductAnalytics()
}

function startSession() {
  if (!analyticsEnabled() || !foreground || activeSessionId) return
  activeAccountId = options!.getAccountId()
  activeSessionId = identifier('session')
  activeSessionStartedAt = Date.now()
  enqueue('session_started')
}

function ensureSession() {
  const accountId = options?.getAccountId() || ''
  if (activeSessionId && activeAccountId !== accountId) endSession()
  if (!activeSessionId) startSession()
}

function endSession() {
  if (!activeSessionId || !activeAccountId) return
  const durationMs = Math.min(86_400_000, Math.max(0, Date.now() - activeSessionStartedAt))
  if (options?.getEnabled()) {
    queue.push({
      accountId: activeAccountId,
      id: identifier('event'),
      clientId: syncClientId(),
      sessionId: activeSessionId,
      name: 'session_ended',
      screen: '',
      action: '',
      occurredAt: new Date().toISOString(),
      durationMs,
    })
    persistQueue()
  }
  activeSessionId = ''
  activeSessionStartedAt = 0
}

function screenForRoute(route: RouteLocationNormalizedLoaded) {
  return typeof route.name === 'string' ? routeScreens[route.name] || '' : ''
}

function recordRoute(route: RouteLocationNormalizedLoaded) {
  const screen = screenForRoute(route)
  if (!screen) return
  initialNavigationRecorded = true
  enqueue('screen_viewed', { screen })
  if (route.name === 'task-new') recordProductAnalyticsAction('task_editor_opened')
}

export function recordProductAnalyticsAction(action: ProductAnalyticsAction) {
  enqueue('action_completed', { action })
}

export function recordCollectionCreateAnalytics(resource: string) {
  const action = createActions[resource]
  if (action) recordProductAnalyticsAction(action)
}

export function recordCollectionUpdateAnalytics(resource: string, body: Record<string, unknown>) {
  if (resource === 'occurrences' && body.status === 'completed') {
    recordProductAnalyticsAction('task_completed')
  }
}

export function setProductAnalyticsEnabled(enabled: boolean) {
  const accountId = options?.getAccountId() || activeAccountId
  if (!enabled) {
    if (activeAccountId === accountId) {
      activeSessionId = ''
      activeSessionStartedAt = 0
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index]?.accountId === accountId) queue.splice(index, 1)
    }
    persistQueue()
    return
  }
  startSession()
  if (options) recordRoute(options.router.currentRoute.value)
}

export function refreshProductAnalyticsIdentity() {
  ensureSession()
}

export function setProductAnalyticsForeground(isForeground: boolean) {
  if (foreground === isForeground) return
  foreground = isForeground
  if (foreground) {
    startSession()
    if (options) recordRoute(options.router.currentRoute.value)
  } else {
    endSession()
    void flushProductAnalytics()
  }
}

export function flushProductAnalytics() {
  if (flushPromise || !options) return flushPromise || Promise.resolve()
  const accountId = options.getAccountId()
  const token = options.getAuthToken()
  if (!accountId || !token || !options.getEnabled()) return Promise.resolve()
  const queuedBeforePurge = queue.length
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (eventExpired(queue[index]!.occurredAt)) queue.splice(index, 1)
  }
  if (queue.length !== queuedBeforePurge) persistQueue()
  const pending = queue.filter(event => event.accountId === accountId).slice(0, MAX_BATCH_SIZE)
  if (!pending.length) return Promise.resolve()
  const payloadEvents = pending.map(({ accountId: _accountId, ...event }) => event)
  flushPromise = window.fetch(analyticsUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      platform: options.platform || 'unknown',
      appVersion: packageMetadata.version,
      events: payloadEvents,
    }),
    keepalive: true,
  }).then(response => {
    if (!response.ok) return
    const sentIds = new Set(pending.map(event => event.id))
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (sentIds.has(queue[index]!.id)) queue.splice(index, 1)
    }
    persistQueue()
  }).catch(() => {
    // Keep analytics queued for the next network or lifecycle flush.
  }).finally(() => {
    flushPromise = null
  })
  return flushPromise
}

export function installProductAnalytics(configuration: ProductAnalyticsOptions) {
  if (installed) return
  installed = true
  options = configuration
  restoreQueue()
  configuration.router.afterEach(to => recordRoute(to))
  void configuration.router.isReady().then(() => {
    startSession()
    if (!initialNavigationRecorded) recordRoute(configuration.router.currentRoute.value)
  })
  document.addEventListener('visibilitychange', () => {
    setProductAnalyticsForeground(document.visibilityState !== 'hidden')
  })
  window.addEventListener('pagehide', () => {
    setProductAnalyticsForeground(false)
  })
  window.addEventListener('pageshow', () => setProductAnalyticsForeground(true))
  window.setInterval(() => void flushProductAnalytics(), FLUSH_INTERVAL_MS)
}
