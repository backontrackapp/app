<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import AssistantPlanTable from '@/components/AssistantPlanTable.vue'
import {
  assistantChoice,
  assistantReadToolResult,
  assistantWritePlan,
  cancelledAssistantToolOutput,
  executeAssistantWritePlan,
  requestAssistantResponse,
  selectedAssistantChoice,
} from '@/services/assistant'
import {
  cancelPhoneSpeechRecognition,
  phoneSpeechRecognitionIsNative,
  phoneSpeechRecognitionStatus,
  requestPhoneSpeechRecognitionPermission,
  startPhoneSpeechRecognition,
  stopPhoneSpeechRecognition,
} from '@/services/phoneSpeechRecognition'
import {
  defaultFlashcardSpeechLanguage,
  loadFlashcardSpeechSupport,
  speakFlashcardText,
  stopFlashcardSpeech,
} from '@/services/flashcardSpeech'
import { useOverlayStack } from '@/services/overlayStack'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  AssistantChoice,
  AssistantConversationItem,
  AssistantMessageItem,
  AssistantPlanEntry,
  AssistantToolCallItem,
  AssistantWritePlan,
  PhoneSpeechStatus,
} from '@/types/domain'

const model = defineModel<boolean>({ default: false })
const { smAndDown, width: viewportWidth } = useDisplay()
const flashcards = useFlashcardStore()
const zIndex = useOverlayStack(model, () => { model.value = false })
const items = ref<AssistantConversationItem[]>([])
const composer = ref('')
const liveTranscript = ref('')
const busy = ref(false)
const receivingReply = ref(false)
const activity = ref('')
const recording = ref(false)
const error = ref('')
const pendingPlan = ref<AssistantWritePlan>()
const pendingChoice = ref<AssistantChoice>()
const planEntries = reactive(new Map<string, AssistantPlanEntry>())
const messagesElement = ref<HTMLElement>()
const speechStatus = ref<PhoneSpeechStatus>({ available: false, permission: 'prompt' })
const spokenReplies = ref(true)
const replySpeechLanguage = ref('')
let requestRevision = 0
let activeRequestController: AbortController | undefined
const AUTO_SCROLL_BOTTOM_TOLERANCE = 16

const messages = computed(() => items.value.filter(
  (item): item is AssistantMessageItem => item.type === 'message',
))
const visibleItems = computed(() => items.value.filter(item => (
  item.type === 'message' || (item.type === 'function_call' && (
    item.name === 'present_choices' || planEntries.has(item.callId)
  ))
)))
const voiceAvailable = computed(() => phoneSpeechRecognitionIsNative() && speechStatus.value.available)

const suggestions = [
  'Create a Review set with 50 English words translated to Arabic.',
  'Create a Review set from my top 20 errors.',
  'Add 10 beginner Spanish travel phrases to one of my Review sets.',
]

async function scrollMessagesToEnd() {
  await nextTick()
  const element = messagesElement.value
  if (element) element.scrollTop = element.scrollHeight
}

function messagesAreAtEnd() {
  const element = messagesElement.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_TOLERANCE
}

function requiredPlanEntry(callId: string) {
  const entry = planEntries.get(callId)
  if (!entry) throw new Error('The assistant proposal is unavailable.')
  return entry
}

async function speakReply(content: string) {
  if (!spokenReplies.value || !replySpeechLanguage.value || !content.trim()) return
  await speakFlashcardText(content, replySpeechLanguage.value).catch(() => undefined)
}

async function runAssistant() {
  if (busy.value || pendingPlan.value || pendingChoice.value) return
  const revision = ++requestRevision
  const controller = new AbortController()
  activeRequestController = controller
  let streamedMessage: AssistantMessageItem | undefined
  busy.value = true
  error.value = ''
  activity.value = 'Reviewing your flashcard request…'
  try {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      streamedMessage = undefined
      let receivingActivitySummary = false
      const response = await requestAssistantResponse(items.value, delta => {
        if (revision !== requestRevision || !model.value) return
        const shouldAutoScroll = messagesAreAtEnd()
        if (!streamedMessage) {
          streamedMessage = reactive({ type: 'message', role: 'assistant', content: '' })
          items.value.push(streamedMessage)
          receivingReply.value = true
        }
        streamedMessage.content += delta
        if (shouldAutoScroll) void scrollMessagesToEnd()
      }, event => {
        if (revision !== requestRevision || !model.value) return
        if (event.type === 'activity') {
          activity.value = event.label
          receivingActivitySummary = false
        } else {
          activity.value = `${receivingActivitySummary ? activity.value : ''}${event.delta}`.slice(-4000)
          receivingActivitySummary = true
        }
        if (messagesAreAtEnd()) void scrollMessagesToEnd()
      }, controller.signal)
      if (revision !== requestRevision || !model.value) return
      if (streamedMessage) {
        const streamedIndex = items.value.indexOf(streamedMessage)
        if (streamedIndex >= 0) items.value.splice(streamedIndex, 1)
        streamedMessage = undefined
      }
      receivingReply.value = false
      const responseItems = response.items
      responseItems.forEach(item => {
        if (item.type === 'function_call' && item.name === 'present_choices') assistantChoice(item)
      })
      items.value.push(...responseItems)
      await scrollMessagesToEnd()
      let continued = false
      for (const item of responseItems) {
        if (item.type === 'message' && item.role === 'assistant') void speakReply(item.content)
        if (item.type !== 'function_call') continue
        const choice = assistantChoice(item)
        if (choice) {
          pendingChoice.value = choice
          void speakReply(choice.prompt)
          await scrollMessagesToEnd()
          return
        }
        const readResult = assistantReadToolResult(item, flashcards)
        if (readResult) {
          activity.value = 'Checking your flashcard data…'
          items.value.push(readResult)
          continued = true
          continue
        }
        const plan = assistantWritePlan(item, flashcards)
        if (!plan) throw new Error('The assistant requested an unsupported action.')
        pendingPlan.value = plan
        planEntries.set(plan.call.callId, { plan, status: 'pending' })
        await scrollMessagesToEnd()
        return
      }
      if (!continued) return
    }
    throw new Error('The assistant used too many steps. Try a more specific request.')
  } catch (cause) {
    if (streamedMessage) {
      const streamedIndex = items.value.indexOf(streamedMessage)
      if (streamedIndex >= 0) items.value.splice(streamedIndex, 1)
    }
    receivingReply.value = false
    if (cause instanceof Error && cause.name === 'AbortError') return
    error.value = cause instanceof Error ? cause.message : 'The assistant could not respond.'
  } finally {
    if (activeRequestController === controller) activeRequestController = undefined
    if (revision === requestRevision) {
      receivingReply.value = false
      busy.value = false
      activity.value = ''
    }
  }
}

async function submit(message = composer.value) {
  const content = message.trim()
  if (!content || busy.value) return
  await stopFlashcardSpeech()
  composer.value = ''
  if (pendingPlan.value) {
    items.value.push(cancelledAssistantToolOutput(pendingPlan.value.call.callId))
    const entry = planEntries.get(pendingPlan.value.call.callId)
    if (entry) planEntries.set(pendingPlan.value.call.callId, { ...entry, status: 'cancelled' })
    pendingPlan.value = undefined
  }
  if (pendingChoice.value) {
    items.value.push(cancelledAssistantToolOutput(pendingChoice.value.call.callId))
    pendingChoice.value = undefined
  }
  items.value.push({ type: 'message', role: 'user', content })
  await scrollMessagesToEnd()
  await runAssistant()
}

function choiceSelection(callId: string) {
  const result = items.value.find(item => (
    item.type === 'function_call_output' && item.callId === callId
  ))
  return result?.type === 'function_call_output' && typeof result.output.selected_choice === 'string'
    ? result.output.selected_choice
    : ''
}

async function chooseAnswer(choice: AssistantChoice, answer: string) {
  if (busy.value || pendingPlan.value || pendingChoice.value?.call.callId !== choice.call.callId) return
  await stopFlashcardSpeech()
  items.value.push(selectedAssistantChoice(choice.call.callId, answer))
  pendingChoice.value = undefined
  await scrollMessagesToEnd()
  await runAssistant()
}

async function confirmPlan() {
  const plan = pendingPlan.value
  if (!plan || busy.value) return
  busy.value = true
  error.value = ''
  try {
    items.value.push(await executeAssistantWritePlan(plan, flashcards))
    const entry = planEntries.get(plan.call.callId)
    if (entry) planEntries.set(plan.call.callId, { ...entry, status: 'applied' })
    pendingPlan.value = undefined
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The flashcard action could not be completed.'
    return
  } finally {
    busy.value = false
  }
  await runAssistant()
}

function cancelPlan() {
  const plan = pendingPlan.value
  if (!plan || busy.value) return
  items.value.push(cancelledAssistantToolOutput(plan.call.callId))
  const entry = planEntries.get(plan.call.callId)
  if (entry) planEntries.set(plan.call.callId, { ...entry, status: 'cancelled' })
  pendingPlan.value = undefined
}

async function beginListening() {
  if (
    busy.value
    || recording.value
    || !phoneSpeechRecognitionIsNative()
  ) return
  await stopFlashcardSpeech()
  error.value = ''
  liveTranscript.value = ''
  try {
    let status = await phoneSpeechRecognitionStatus()
    if (status.permission === 'prompt') status = await requestPhoneSpeechRecognitionPermission()
    speechStatus.value = status
    if (status.permission !== 'granted') {
      throw new Error('Allow microphone and speech recognition access to use voice input.')
    }
    if (!status.available) throw new Error('Phone speech recognition is unavailable right now.')
    recording.value = true
    const result = await startPhoneSpeechRecognition(
      navigator.language || 'en-US',
      transcript => { liveTranscript.value = transcript },
    )
    composer.value = result.transcript.trim()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Voice recognition could not start.'
    if (!/cancel/i.test(message)) error.value = message
  } finally {
    recording.value = false
    liveTranscript.value = ''
  }
}

async function stopListening() {
  if (!recording.value) return
  await stopPhoneSpeechRecognition().catch(() => undefined)
}

async function resetPanel() {
  requestRevision += 1
  activeRequestController?.abort()
  activeRequestController = undefined
  await Promise.all([
    cancelPhoneSpeechRecognition().catch(() => undefined),
    stopFlashcardSpeech().catch(() => undefined),
  ])
  items.value = []
  composer.value = ''
  liveTranscript.value = ''
  recording.value = false
  receivingReply.value = false
  busy.value = false
  error.value = ''
  pendingPlan.value = undefined
  pendingChoice.value = undefined
  planEntries.clear()
}

watch(model, async (open) => {
  if (!open) {
    await resetPanel()
    return
  }
  if (!flashcards.loaded && !flashcards.loading) await flashcards.load().catch(() => undefined)
  speechStatus.value = await phoneSpeechRecognitionStatus().catch(() => ({
    available: false,
    permission: 'denied' as const,
  }))
  const support = await loadFlashcardSpeechSupport()
  replySpeechLanguage.value = defaultFlashcardSpeechLanguage(support.languages)
})

watch(
  [model, smAndDown],
  ([open, mobile]) => {
    document.documentElement.classList.toggle('assistant-mobile-open', open && mobile)
  },
  { immediate: true },
)

watch(spokenReplies, enabled => {
  if (!enabled) void stopFlashcardSpeech()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('assistant-mobile-open')
  void resetPanel()
})
</script>

<template>
  <Teleport to="body">
    <v-navigation-drawer
      v-model="model"
      temporary
      location="right"
      touchless
      :width="smAndDown ? viewportWidth : 480"
      :scrim="!smAndDown"
      class="assistant-panel"
      :class="{ 'assistant-panel--mobile': smAndDown }"
      :style="{ '--assistant-z-index': zIndex }"
      aria-label="AI flashcard assistant"
    >
      <div class="assistant-panel__layout">
        <header class="assistant-panel__header px-4">
          <div class="d-flex align-center ga-3 min-width-0">
            <v-avatar color="secondary" variant="tonal" size="36">
              <v-icon icon="mdi-creation-outline" />
            </v-avatar>
            <div class="min-width-0">
              <strong class="d-block text-truncate">AI assistant</strong>
              <span class="text-caption text-medium-emphasis">Flashcards only</span>
            </div>
          </div>
          <div class="d-flex align-center ga-1">
            <v-btn
              :icon="spokenReplies ? 'mdi-volume-high' : 'mdi-volume-off'"
              variant="text"
              :aria-label="spokenReplies ? 'Mute assistant replies' : 'Speak assistant replies'"
              @click="spokenReplies = !spokenReplies"
            />
            <v-btn icon="mdi-close" variant="text" aria-label="Close AI assistant" @click="model = false" />
          </div>
        </header>

        <div
          ref="messagesElement"
          class="assistant-panel__messages px-4 py-4"
          aria-live="polite"
          aria-label="AI assistant conversation"
          tabindex="0"
        >
          <div v-if="!messages.length" class="assistant-panel__welcome">
            <v-icon icon="mdi-microphone-message" color="secondary" size="42" />
            <h2 class="text-h6">What should I build?</h2>
            <p class="text-body-2 text-medium-emphasis mb-0">
              Ask for a flashcard or Review set task. You will review every change before it is saved.
            </p>
            <div class="d-flex flex-column align-stretch mt-4">
              <v-btn
                v-for="suggestion in suggestions"
                :key="suggestion"
                variant="text"
                color="secondary"
                class="assistant-panel__suggestion"
                @click="submit(suggestion)"
              >
                <span aria-hidden="true">&bull;</span>
                <span>{{ suggestion }}</span>
              </v-btn>
            </div>
          </div>

          <template v-for="(item, index) in visibleItems" :key="`${item.type}-${index}`">
            <div v-if="item.type === 'message'" class="assistant-message" :class="`assistant-message--${item.role}`">
              {{ item.content }}
              <v-btn
                v-if="item.role === 'assistant' && replySpeechLanguage"
                icon="mdi-volume-high"
                size="x-small"
                variant="text"
                aria-label="Replay assistant reply"
                @click="speakReply(item.content)"
              />
            </div>
            <div v-else-if="assistantChoice(item)" class="assistant-choice">
              <div class="assistant-message assistant-message--assistant">
                {{ assistantChoice(item)?.prompt }}
              </div>
              <div class="assistant-choice__actions" role="group" :aria-label="assistantChoice(item)?.prompt">
                <v-btn
                  v-for="choice in assistantChoice(item)?.choices"
                  :key="choice"
                  :color="choiceSelection(item.callId) === choice ? 'secondary' : undefined"
                  :variant="choiceSelection(item.callId) === choice ? 'flat' : 'outlined'"
                  :disabled="Boolean(choiceSelection(item.callId)) || busy || pendingChoice?.call.callId !== item.callId"
                  class="assistant-choice__button"
                  :class="{ 'assistant-choice__button--selected': choiceSelection(item.callId) === choice }"
                  :aria-pressed="choiceSelection(item.callId) === choice"
                  @click="chooseAnswer(assistantChoice(item)!, choice)"
                >
                  {{ choice }}
                </v-btn>
              </div>
            </div>
            <AssistantPlanTable
              v-else-if="item.type === 'function_call' && planEntries.has(item.callId)"
              :entry="requiredPlanEntry(item.callId)"
              :busy="busy && pendingPlan?.call.callId === item.callId"
              @cancel="cancelPlan"
              @confirm="confirmPlan"
            />
          </template>

          <div v-if="busy && !pendingPlan && !receivingReply" class="assistant-panel__activity text-body-2 text-medium-emphasis" role="status">
            <v-progress-circular indeterminate color="secondary" size="20" width="2" />
            <span>{{ activity }}</span>
          </div>
          <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
        </div>

        <footer class="assistant-panel__composer pa-4">
          <p v-if="recording" class="assistant-panel__listening mb-2">
            <v-icon icon="mdi-microphone" color="error" size="18" />
            <span>{{ liveTranscript || 'Listening…' }}</span>
          </p>
          <v-textarea
            v-model="composer"
            label="Ask about your flashcards"
            rows="1"
            auto-grow
            max-rows="4"
            hide-details="auto"
            :disabled="busy || recording"
            @keydown.enter.exact.prevent="submit()"
          >
            <template #append-inner>
              <div class="d-flex align-center ga-1">
                <v-btn
                  v-if="phoneSpeechRecognitionIsNative()"
                  :icon="recording ? 'mdi-stop-circle' : 'mdi-microphone-outline'"
                  :color="recording ? 'error' : voiceAvailable ? 'secondary' : undefined"
                  variant="text"
                  :aria-label="recording ? 'Stop listening' : 'Start voice request'"
                  :disabled="busy"
                  @click="recording ? stopListening() : beginListening()"
                />
                <v-btn
                  icon="mdi-send"
                  color="secondary"
                  variant="text"
                  aria-label="Send request"
                  :disabled="busy"
                  @click="submit()"
                />
              </div>
            </template>
          </v-textarea>
        </footer>
      </div>
    </v-navigation-drawer>
  </Teleport>
</template>

<style scoped>
.assistant-panel {
  z-index: var(--assistant-z-index) !important;
  border-left: .0625rem solid rgb(var(--v-theme-on-surface) / .1) !important;
  background: rgb(var(--v-theme-background)) !important;
}

.assistant-panel--mobile {
  top: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  max-width: 100vw !important;
  height: var(--app-viewport-height, 100dvh) !important;
  border-left: 0 !important;
}

:global(html.assistant-mobile-open),
:global(html.assistant-mobile-open body) { overflow: hidden !important; }

.assistant-panel :deep(.v-navigation-drawer__content) {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.assistant-panel__layout {
  display: grid;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.assistant-panel__header { display: flex; min-height: 4.25rem; align-items: center; justify-content: space-between; border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .08); padding-top: max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)); }
.assistant-panel__messages {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  flex-direction: column;
  gap: 1rem;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
.assistant-panel__messages > * { flex: 0 0 auto; }
.assistant-panel__welcome { margin: auto 0; text-align: center; }
.assistant-panel__suggestion {
  width: 100%;
  height: auto !important;
  min-height: 2.75rem;
  justify-content: flex-start;
  padding: .625rem .5rem;
  letter-spacing: normal;
  text-align: left;
}
.assistant-panel__suggestion :deep(.v-btn__content) {
  display: flex;
  align-items: baseline;
  gap: .5rem;
  overflow-wrap: anywhere;
  text-align: left;
  white-space: normal;
}
.assistant-message { width: fit-content; max-width: 88%; padding: .75rem 1rem; border-radius: 1rem; font-size: .875rem; line-height: 1.45; white-space: pre-wrap; }
.assistant-message--user { align-self: flex-end; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.assistant-message--assistant { align-self: flex-start; border: .0625rem solid rgb(var(--v-theme-on-surface) / .08); background: rgb(var(--v-theme-surface)); }
.assistant-message--assistant .v-btn { margin: -.4rem -.6rem -.4rem .25rem; }
.assistant-choice { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; }
.assistant-choice__actions { display: flex; width: 100%; flex-wrap: wrap; gap: .5rem; }
.assistant-choice__button {
  height: auto !important;
  min-height: 2.75rem;
  max-width: 100%;
  padding: .625rem 1rem;
  letter-spacing: normal;
}
.assistant-choice__button :deep(.v-btn__content) {
  overflow-wrap: anywhere;
  text-align: left;
  white-space: normal;
}
.assistant-choice__button--selected:disabled { opacity: 1; }
.assistant-panel__activity,
.assistant-panel__listening { display: flex; align-items: center; gap: .5rem; }
.assistant-panel__activity { min-height: 2.75rem; padding: .625rem .75rem; border: .0625rem solid rgba(var(--v-theme-secondary), .24); border-radius: .75rem; background: rgba(var(--v-theme-secondary), .08); line-height: 1.4; white-space: pre-wrap; }
.assistant-panel__composer { padding-bottom: calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem))) !important; border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08); background: rgb(var(--v-theme-surface)); }
.assistant-panel__listening { color: rgb(var(--v-theme-on-surface) / .72); font-size: .78rem; }

@media (prefers-reduced-motion: reduce) {
  .assistant-panel { transition: none !important; }
}
</style>
