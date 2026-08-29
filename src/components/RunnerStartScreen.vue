<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ContentIcon from '@/components/ContentIcon.vue'

const props = defineProps<{
  title: string
  summary: string
  taskName?: string
  icon: string
  image?: string
  imageAlt?: string
  color?: string
  primaryLabel: string
  cancelLabel: string
  busy?: boolean
}>()

defineEmits<{
  start: []
  cancel: []
}>()

const titleElement = ref<HTMLElement>()
const fittedTitleSize = ref('')
const titleWords = computed(() => props.title.trim().split(/\s+/).filter(Boolean))
let fitRevision = 0

async function fitTitleWords() {
  const revision = ++fitRevision
  fittedTitleSize.value = ''
  await nextTick()
  if (revision !== fitRevision) return
  const title = titleElement.value
  if (!title?.clientWidth) return

  const words = [...title.querySelectorAll<HTMLElement>('.runner-start-screen__word')]
  const widestWord = words.reduce((widest, word) => {
    const previousWhiteSpace = word.style.whiteSpace
    const previousMaxWidth = word.style.maxWidth
    word.style.whiteSpace = 'nowrap'
    word.style.maxWidth = 'none'
    const width = word.scrollWidth
    word.style.whiteSpace = previousWhiteSpace
    word.style.maxWidth = previousMaxWidth
    return Math.max(widest, width)
  }, 0)
  if (widestWord <= title.clientWidth) return

  const renderedFontPixels = Number.parseFloat(window.getComputedStyle(title).fontSize)
  const rootFontPixels = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
  if (!Number.isFinite(renderedFontPixels) || renderedFontPixels <= 0) return
  fittedTitleSize.value = `${renderedFontPixels * title.clientWidth / widestWord * .98 / rootFontPixels}rem`
}

watch(() => props.title, fitTitleWords)

onMounted(() => {
  void fitTitleWords()
  window.addEventListener('resize', fitTitleWords)
  void document.fonts?.ready.then(fitTitleWords)
})

onBeforeUnmount(() => {
  fitRevision += 1
  window.removeEventListener('resize', fitTitleWords)
})
</script>

<template>
  <section class="runner-start-screen">
    <div class="runner-start-screen__identity">
      <div
        class="runner-start-screen__icon"
        :class="{ 'runner-start-screen__icon--image': image }"
        :style="color ? { background: color } : undefined"
      >
        <v-img
          v-if="image"
          class="runner-start-screen__image"
          :src="image"
          :alt="imageAlt || title"
          cover
          eager
        >
          <template #error>
            <ContentIcon :icon="icon" size="2.25rem" />
          </template>
        </v-img>
        <ContentIcon v-else :icon="icon" size="2.25rem" />
      </div>
      <h1
        ref="titleElement"
        class="display-title runner-start-screen__title"
        :style="fittedTitleSize ? { fontSize: fittedTitleSize } : undefined"
      >
        <template v-for="(word, index) in titleWords" :key="`${word}-${index}`">
          {{ index ? ' ' : '' }}<span class="runner-start-screen__word">{{ word }}<span v-if="index === titleWords.length - 1" class="text-secondary">.</span></span>
        </template>
      </h1>
      <div class="runner-start-screen__details">
        <p v-if="taskName" class="runner-start-screen__task">
          <v-icon icon="mdi-clipboard-check-outline" size="small" />
          <span>{{ taskName }}</span>
        </p>
        <span v-if="taskName" class="runner-start-screen__separator" aria-hidden="true">·</span>
        <p class="runner-start-screen__summary">{{ summary }}</p>
      </div>
    </div>
    <div class="runner-start-screen__actions">
      <v-btn
        color="secondary"
        size="x-large"
        prepend-icon="mdi-play"
        :aria-label="primaryLabel"
        :loading="busy"
        @click="$emit('start')"
      >
        {{ primaryLabel }}
      </v-btn>
      <v-btn
        variant="text"
        size="large"
        :aria-label="cancelLabel"
        :disabled="busy"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.runner-start-screen {
  display: flex;
  width: min(100%, 44rem);
  min-height: 0;
  margin: 0 auto;
  padding-top: 1rem;
  flex: 1 1 auto;
  align-items: center;
  flex-direction: column;
  text-align: center;
}
.runner-start-screen__identity {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.runner-start-screen__icon {
  display: grid;
  width: 5rem;
  height: 5rem;
  margin-bottom: 1.5rem;
  place-items: center;
  border-radius: 1.5rem;
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}
.runner-start-screen__icon--image {
  overflow: hidden;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .12);
  background: rgb(var(--v-theme-surface-variant)) !important;
}
.runner-start-screen__image {
  width: 100% !important;
  height: 100% !important;
}
.runner-start-screen__image :deep(.v-img__img) { object-fit: cover; }
.runner-start-screen__title {
  width: 100%;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: clamp(2rem, 10vw, 6rem);
}
.runner-start-screen__word { max-width: 100%; }
.runner-start-screen__details {
  display: flex;
  width: 100%;
  min-width: 0;
  margin-top: 1rem;
  align-items: center;
  justify-content: center;
  gap: .75rem;
}
.runner-start-screen__summary {
  margin: 0;
  flex: 0 0 auto;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .875rem;
  font-weight: 800;
}
.runner-start-screen__separator {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-on-surface) / .4);
  font-weight: 900;
}
.runner-start-screen__task {
  display: flex;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  gap: .5rem;
  color: rgb(var(--v-theme-on-surface) / .76);
  font-size: .875rem;
  font-weight: 900;
}
.runner-start-screen__task span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.runner-start-screen__actions {
  display: flex;
  width: min(100%, 22rem);
  flex: 0 0 auto;
  align-items: stretch;
  flex-direction: column;
  gap: .75rem;
}
.runner-start-screen__actions :deep(.v-btn:first-child) {
  min-width: 0;
  min-height: 4rem;
  flex: 1 1 auto;
}
.runner-start-screen__actions :deep(.v-btn:last-child) {
  min-height: 4rem;
  flex: 0 0 auto;
}
@media (orientation: landscape) {
  .runner-start-screen {
    width: min(100%, 42rem);
    align-items: center;
    flex-direction: row;
    gap: 1rem;
    text-align: left;
  }
  .runner-start-screen__identity {
    display: grid;
    min-width: 0;
    grid-template-columns: 5rem minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 1.5rem;
  }
  .runner-start-screen__icon {
    margin-bottom: 0;
    grid-column: 1;
    grid-row: 1 / 3;
  }
  .runner-start-screen__title {
    grid-column: 2;
    grid-row: 1;
    align-self: end;
    font-size: clamp(2rem, 6vw, 4rem);
  }
  .runner-start-screen__details {
    margin-top: .5rem;
    grid-column: 2;
    grid-row: 2;
    align-self: start;
    justify-content: flex-start;
  }
  .runner-start-screen__actions {
    width: auto;
    justify-content: flex-end;
    flex-direction: column;
  }
}
</style>
