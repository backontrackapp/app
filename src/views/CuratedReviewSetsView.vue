<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import { api, apiAssetUrl } from '@/lib/api'
import type { CuratedReviewSetSummary } from '@/types/domain'

const items = ref<CuratedReviewSetSummary[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const category = ref('')
const categoryFilterOpen = ref(false)
const categoryFilterTarget = ref<HTMLElement>()
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
function selectCategory(value: string) {
  category.value = value
  categoryFilterOpen.value = false
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
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append><v-btn variant="text" size="small" @click="load">Retry</v-btn></template>
    </v-alert>

    <div class="curated-filters mb-5">
      <v-text-field
        v-model="search"
        label="Search curated sets"
        prepend-inner-icon="mdi-magnify"
        autocomplete="off"
        clearable
        hide-details
      >
        <template #append-inner>
          <span ref="categoryFilterTarget">
            <v-badge
              :model-value="Boolean(category)"
              color="secondary"
              dot
              location="top end"
              offset-x="2"
              offset-y="2"
            >
              <v-btn
                icon="mdi-filter-variant"
                variant="text"
                :aria-label="category ? `Filter curated sets: ${category}` : 'Filter curated sets'"
                :aria-pressed="Boolean(category)"
                @pointerdown.stop
                @touchstart.stop
                @click.stop="categoryFilterOpen = true"
              />
            </v-badge>
          </span>
        </template>
      </v-text-field>
      <ActionBottomSheet
        v-model="categoryFilterOpen"
        title="Filters"
        aria-label="Curated Review set filters"
        :menu-target="categoryFilterTarget"
      >
        <v-list-item
          :prepend-icon="category === '' ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
          title="All categories"
          :active="category === ''"
          color="secondary"
          :aria-pressed="category === ''"
          @click="selectCategory('')"
        />
        <v-list-item
          v-for="itemCategory in categories"
          :key="itemCategory"
          :prepend-icon="category === itemCategory ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
          :title="itemCategory"
          :active="category === itemCategory"
          color="secondary"
          :aria-pressed="category === itemCategory"
          @click="selectCategory(itemCategory)"
        />
      </ActionBottomSheet>
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
        <v-img
          v-if="item.thumbnail"
          :src="apiAssetUrl(item.thumbnail)"
          :alt="`${item.name} thumbnail`"
          height="13rem"
          cover
        />
        <v-carousel
          v-else-if="item.previews.length"
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
.curated-filters { display: flex; flex-direction: column; gap: .75rem; }
.curated-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.curated-tile { overflow: hidden; border: 0; }
.curated-tile h2 { font-size: 1.05rem; font-weight: 900; line-height: 1.25; }
.curated-slideshow__overlay { display: flex; position: absolute; inset: 0; padding: 1rem; align-items: flex-end; background: linear-gradient(transparent 35%, rgba(0, 0, 0, .82)); }
.curated-slideshow__overlay strong { color: white; font-size: .92rem; line-height: 1.3; text-shadow: 0 .125rem .5rem black; }
.curated-placeholder { display: grid; height: 13rem; color: rgba(var(--v-theme-on-surface), .62); place-items: center; align-content: center; gap: .75rem; background: radial-gradient(circle at top, rgba(var(--v-theme-secondary), .18), transparent 60%); }
@media (max-width: 62rem) { .curated-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 40rem) { .curated-grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .curated-slideshow :deep(*) { transition: none !important; animation: none !important; } }
</style>
