<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, apiAssetUrl } from '@/lib/api'
import type { CuratedReviewSetSummary } from '@/types/domain'

const items = ref<CuratedReviewSetSummary[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const category = ref('')
const reducedMotion = ref(false)
let motionQuery: MediaQueryList | undefined
const categories = computed(() => [...new Set(items.value.map(item => item.category))].sort())
const filteredItems = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return items.value.filter(item => (!category.value || item.category === category.value) && (
    !query || [item.name, item.description, item.category, ...item.keywords]
      .join(' ').toLocaleLowerCase().includes(query)
  ))
})

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener('change', updateMotionPreference)
  void load()
})
onBeforeUnmount(() => motionQuery?.removeEventListener('change', updateMotionPreference))
function updateMotionPreference(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await api.getCuratedReviewSets()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load curated Review sets.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="app-page curated-page">
    <section class="curated-hero">
      <div>
        <h1>Curated Review sets</h1>
        <p>Choose a ready-made collection, select the languages and fields you want, then add it to your library for free.</p>
      </div>
      <v-icon icon="mdi-storefront-outline" size="56" color="secondary" aria-hidden="true" />
    </section>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append><v-btn variant="text" size="small" @click="load">Retry</v-btn></template>
    </v-alert>

    <div class="curated-filters mb-5">
      <v-text-field v-model="search" label="Search curated sets" prepend-inner-icon="mdi-magnify" clearable hide-details />
      <v-select v-model="category" :items="categories" label="Category" clearable hide-details />
    </div>

    <div v-if="loading" class="d-flex justify-center align-center ga-3 py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="muted">Loading curated sets…</span>
    </div>
    <div v-else-if="filteredItems.length" class="curated-grid">
      <v-card
        v-for="item in filteredItems"
        :key="item.slug"
        class="surface-card curated-tile"
        :to="{ name: 'flashcard-curated-detail', params: { slug: item.slug } }"
      >
        <v-carousel
          v-if="item.previews.length"
          :cycle="item.previews.length > 1 && !reducedMotion"
          :show-arrows="false"
          hide-delimiters
          height="13rem"
          interval="4000"
          class="curated-slideshow"
        >
          <v-carousel-item v-for="(preview, index) in item.previews" :key="`${preview.image}-${index}`">
            <v-img :src="apiAssetUrl(preview.image)" :alt="preview.front" height="13rem" cover>
              <div class="curated-slideshow__overlay"><strong>{{ preview.front }}</strong></div>
            </v-img>
          </v-carousel-item>
        </v-carousel>
        <div v-else class="curated-placeholder">
          <v-icon icon="mdi-cards-outline" size="48" color="secondary" />
          <span>Ready to review</span>
        </div>
        <v-card-text class="pa-4">
          <div class="d-flex align-center justify-space-between ga-3 mb-2">
            <v-chip color="secondary" size="small" variant="tonal">{{ item.category }}</v-chip>
            <span class="text-caption muted">{{ item.cardCount }} cards</span>
          </div>
          <h2>{{ item.name }}</h2>
          <p class="text-body-2 muted mt-2">{{ item.description }}</p>
        </v-card-text>
      </v-card>
    </div>
    <v-card v-else class="surface-card pa-8 text-center">
      <v-icon icon="mdi-store-search-outline" size="44" color="secondary" />
      <h2 class="text-h6 font-weight-black mt-3">No curated sets found</h2>
      <p class="muted mt-2">Try another search or category.</p>
    </v-card>
  </main>
</template>

<style scoped>
.curated-hero { display: flex; padding: 1.5rem; margin-bottom: 1.5rem; border: .0625rem solid rgba(var(--v-theme-secondary), .22); border-radius: 1.25rem; align-items: center; justify-content: space-between; gap: 2rem; background: linear-gradient(135deg, rgba(var(--v-theme-secondary), .14), rgba(var(--v-theme-surface), .96)); }
.curated-hero h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); font-weight: 950; letter-spacing: -.03em; }
.curated-hero p:last-child { max-width: 43rem; margin-top: .5rem; color: rgba(var(--v-theme-on-surface), .68); }
.curated-filters { display: grid; grid-template-columns: minmax(0, 2fr) minmax(12rem, 1fr); gap: .75rem; }
.curated-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.curated-tile { overflow: hidden; }
.curated-tile h2 { font-size: 1.05rem; font-weight: 900; line-height: 1.25; }
.curated-slideshow__overlay { display: flex; position: absolute; inset: 0; padding: 1rem; align-items: flex-end; background: linear-gradient(transparent 35%, rgba(0, 0, 0, .82)); }
.curated-slideshow__overlay strong { color: white; font-size: .92rem; line-height: 1.3; text-shadow: 0 .125rem .5rem black; }
.curated-placeholder { display: grid; height: 13rem; color: rgba(var(--v-theme-on-surface), .62); place-items: center; align-content: center; gap: .75rem; background: radial-gradient(circle at top, rgba(var(--v-theme-secondary), .18), transparent 60%); }
@media (max-width: 62rem) { .curated-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 40rem) { .curated-grid, .curated-filters { grid-template-columns: 1fr; } .curated-hero { align-items: flex-start; } .curated-hero > :deep(.v-icon) { display: none; } }
@media (prefers-reduced-motion: reduce) { .curated-slideshow :deep(*) { transition: none !important; animation: none !important; } }
</style>
