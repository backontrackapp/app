<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import {
  assistantReadToolResult,
  assistantWritePlan,
  cancelledAssistantToolOutput,
  executeAssistantWritePlan,
  requestAssistantResponse,
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
  AssistantConversationItem,
  AssistantMessageItem,
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
const recording = ref(false)
const error = ref('')
const pendingPlan = ref<AssistantWritePlan>()
const messagesElement = ref<HTMLElement>()
const speechStatus = ref<PhoneSpeechStatus>({ available: false, permission: 'prompt' })
const spokenReplies = ref(true)
const replySpeechLanguage = ref('')
let requestRevision = 0

const messages = computed(() => items.value.filter(
  (item): item is AssistantMessageItem => item.type === 'message',
))
const canSend = computed(() => Boolean(composer.value.trim()) && !busy.value && !pendingPlan.value)
const voiceAvailable = computed(() => phoneSpeechRecognitionIsNative() && speechStatus.value.available)

const suggestions = [
  'Create a Review set with 50 English words translated to Arabic.',
  'Create a Review set from my top 20 errors.',
]

async function scrollMessagesToEnd() {
  await nextTick()
  const element = messagesElement.value
  if (element) element.scrollTop = element.scrollHeight
}

async function speakReply(content: string) {
  if (!spokenReplies.value || !replySpeechLanguage.value || !content.trim()) return
  await speakFlashcardText(content, replySpeechLanguage.value).catch(() => undefined)
}

async function runAssistant() {
  if (busy.value || pendingPlan.value) return
  const revision = ++requestRevision
  busy.value = true
  error.value = ''
  try {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const response = await requestAssistantResponse(items.value)
      if (revision !== requestRevision || !model.value) return
      const responseItems = response.items
      items.value.push(...responseItems)
      await scrollMessagesToEnd()
      let continued = false
      for (const item of responseItems) {
        if (item.type === 'message' && item.role === 'assistant') void speakReply(item.content)
        if (item.type !== 'function_call') continue
        const readResult = assistantReadToolResult(item, flashcards)
        if (readResult) {
          items.value.push(readResult)
          continued = true
          continue
        }
        pendingPlan.value = assistantWritePlan(item, flashcards)
        if (!pendingPlan.value) throw new Error('The assistant requested an unsupported action.')
        await scrollMessagesToEnd()
        return
      }
      if (!continued) return
    }
    throw new Error('The assistant used too many steps. Try a more specific request.')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The assistant could not respond.'
  } finally {
    if (revision === requestRevision) busy.value = false
  }
}

async function submit(message = composer.value) {
  const content = message.trim()
  if (!content || busy.value || pendingPlan.value) return
  await stopFlashcardSpeech()
  composer.value = ''
  items.value.push({ type: 'message', role: 'user', content })
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
    pendingPlan.value = undefined
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The flashcard action could not be completed.'
    return
  } finally {
    busy.value = false
  }
  await runAssistant()
}

async function cancelPlan() {
  const plan = pendingPlan.value
  if (!plan || busy.value) return
  items.value.push(cancelledAssistantToolOutput(plan.call.callId))
  pendingPlan.value = undefined
  await runAssistant()
}

async function beginListening() {
  if (busy.value || recording.value || pendingPlan.value || !phoneSpeechRecognitionIsNative()) return
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
  await Promise.all([
    cancelPhoneSpeechRecognition().catch(() => undefined),
    stopFlashcardSpeech().catch(() => undefined),
  ])
  items.value = []
  composer.value = ''
  liveTranscript.value = ''
  recording.value = false
  busy.value = false
  error.value = ''
  pendingPlan.value = undefined
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

        <div ref="messagesElement" class="assistant-panel__messages px-4 py-4" aria-live="polite">
          <div v-if="!messages.length" class="assistant-panel__welcome">
            <v-icon icon="mdi-microphone-message" color="secondary" size="42" />
            <h2 class="text-h6">What should I build?</h2>
            <p class="text-body-2 text-medium-emphasis mb-0">
              Speak or type a request. You will review every change before it is saved.
            </p>
            <div class="d-flex flex-column align-stretch ga-1 mt-4">
              <v-btn
                v-for="suggestion in suggestions"
                :key="suggestion"
                variant="text"
                color="secondary"
                append-icon="mdi-arrow-right"
                class="assistant-panel__suggestion"
                @click="submit(suggestion)"
              >
                {{ suggestion }}
              </v-btn>
            </div>
          </div>

          <template v-for="(message, index) in messages" :key="`${message.role}-${index}`">
            <div class="assistant-message" :class="`assistant-message--${message.role}`">
              {{ message.content }}
              <v-btn
                v-if="message.role === 'assistant' && replySpeechLanguage"
                icon="mdi-volume-high"
                size="x-small"
                variant="text"
                aria-label="Replay assistant reply"
                @click="speakReply(message.content)"
              />
            </div>
          </template>

          <v-card v-if="pendingPlan" class="surface-card assistant-plan pa-4" rounded="xl">
            <div class="d-flex align-start ga-3">
              <v-avatar color="secondary" variant="tonal" size="36">
                <v-icon icon="mdi-card-multiple-outline" />
              </v-avatar>
              <div class="min-width-0">
                <strong>{{ pendingPlan.title }}</strong>
                <p class="text-body-2 text-medium-emphasis mt-1 mb-0">{{ pendingPlan.description }}</p>
              </div>
            </div>
            <v-alert
              v-if="pendingPlan.convertsTagSelection"
              type="warning"
              variant="tonal"
              density="compact"
              class="mt-3"
            >
              This tag-based set will become a fixed card list while keeping its current cards.
            </v-alert>
            <v-list v-if="pendingPlan.newCards.length" bg-color="transparent" density="compact" class="mt-2 pa-0">
              <v-list-item
                v-for="card in pendingPlan.newCards.slice(0, 5)"
                :key="`${card.front}-${card.back}`"
                :title="card.front"
                :subtitle="card.back"
              />
            </v-list>
            <p v-if="pendingPlan.newCards.length > 5" class="text-caption text-medium-emphasis mb-0">
              And {{ pendingPlan.newCards.length - 5 }} more new cards.
            </p>
            <div class="d-flex justify-end ga-2 mt-4">
              <v-btn variant="text" :disabled="busy" @click="cancelPlan">Cancel</v-btn>
              <v-btn color="secondary" :loading="busy" @click="confirmPlan">Confirm</v-btn>
            </div>
          </v-card>

          <div v-if="busy && !pendingPlan" class="assistant-panel__thinking text-body-2 text-medium-emphasis">
            <v-progress-circular indeterminate color="secondary" size="20" width="2" />
            <span>Thinking…</span>
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
            label="Ask the AI"
            rows="1"
            auto-grow
            max-rows="4"
            hide-details="auto"
            :disabled="busy || recording || Boolean(pendingPlan)"
            @keydown.enter.exact.prevent="submit()"
          >
            <template #append-inner>
              <v-btn
                v-if="phoneSpeechRecognitionIsNative()"
                :icon="recording ? 'mdi-stop-circle' : 'mdi-microphone-outline'"
                :color="recording ? 'error' : voiceAvailable ? 'secondary' : undefined"
                variant="text"
                :aria-label="recording ? 'Stop listening' : 'Start voice request'"
                :disabled="busy || Boolean(pendingPlan)"
                @click="recording ? stopListening() : beginListening()"
              />
            </template>
          </v-textarea>
          <div class="d-flex align-center justify-space-between ga-3 mt-3">
            <span class="text-caption text-medium-emphasis">
              {{ phoneSpeechRecognitionIsNative() ? 'Phone speech recognition' : 'Voice input is available in the mobile app' }}
            </span>
            <v-btn
              color="secondary"
              prepend-icon="mdi-send"
              :disabled="!canSend"
              :loading="busy"
              @click="submit()"
            >
              Send
            </v-btn>
          </div>
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

.assistant-panel :deep(.v-navigation-drawer__content) { overflow: hidden; }
.assistant-panel__layout { display: grid; height: 100%; grid-template-rows: auto minmax(0, 1fr) auto; }
.assistant-panel__header { display: flex; min-height: 4.25rem; align-items: center; justify-content: space-between; border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .08); padding-top: max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)); }
.assistant-panel__messages { display: flex; min-height: 0; overflow-y: auto; flex-direction: column; gap: 1rem; }
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
  display: block;
  overflow-wrap: anywhere;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: .2rem;
  white-space: normal;
}
.assistant-message { width: fit-content; max-width: 88%; padding: .75rem 1rem; border-radius: 1rem; font-size: .875rem; line-height: 1.45; white-space: pre-wrap; }
.assistant-message--user { align-self: flex-end; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.assistant-message--assistant { align-self: flex-start; border: .0625rem solid rgb(var(--v-theme-on-surface) / .08); background: rgb(var(--v-theme-surface)); }
.assistant-message--assistant .v-btn { margin: -.4rem -.6rem -.4rem .25rem; }
.assistant-plan { background: rgb(var(--v-theme-surface)); }
.assistant-panel__thinking,
.assistant-panel__listening { display: flex; align-items: center; gap: .5rem; }
.assistant-panel__composer { padding-bottom: calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem))) !important; border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08); background: rgb(var(--v-theme-surface)); }
.assistant-panel__listening { color: rgb(var(--v-theme-on-surface) / .72); font-size: .78rem; }

@media (prefers-reduced-motion: reduce) {
  .assistant-panel { transition: none !important; }
}
</style>
