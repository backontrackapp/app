<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard } from '@/types/domain'

const router = useRouter()
const store = useFlashcardStore()
const filteredCardCount = ref(0)
const archivedFilteredCardCount = ref(0)
const archiveExpanded = ref(false)
const activeCards = computed(() => store.cards.filter(card => card.archived !== true))
const archivedCards = computed(() => store.cards.filter(card => card.archived === true))
onMounted(() => {
  if (!store.loaded) store.load().catch(() => undefined)
})

function openNewCard() {
  void router.push({ name: 'flashcard-new' })
}

function openCard(card: Flashcard, cards: Flashcard[]) {
  void router.push({
    name: 'flashcard-edit',
    params: { id: card.id },
    state: { flashcardNavigationIds: cards.map(item => item.id) },
  })
}

</script>

<template>
  <main class="app-page flashcard-cards-page">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">
      {{ store.error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>

    <div v-if="store.loading && !store.loaded" class="d-flex justify-center py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="ml-3 muted">Loading cards…</span>
    </div>

    <template v-else>
      <section>
        <div class="section-heading mt-0">
          <h2>Your cards</h2>
          <span class="text-caption muted">{{ filteredCardCount }} of {{ activeCards.length }}</span>
        </div>
        <FlashcardCardsManager
          :cards="activeCards"
          :tags="store.tags"
          library-actions
          selectable
          show-unassigned-filter
          :interactive="false"
          @update:filtered-count="filteredCardCount = $event"
          @add-card="openNewCard"
          @open-card="openCard"
        >
          <template #action-column-heading><span class="d-sr-only">Edit</span></template>
          <template #action-column="{ card, cards }">
            <div
              class="flashcard-card-edit"
              @pointerdown.stop
              @touchstart.stop
              @click.stop
              @keydown.stop
            >
              <v-btn
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                :aria-label="`Edit card: ${card.front}`"
                @click.stop="openCard(card, cards)"
              />
            </div>
          </template>
        </FlashcardCardsManager>

        <section v-if="archivedCards.length" class="mt-4">
          <v-btn
            block
            variant="text"
            class="archive-heading"
            :aria-expanded="archiveExpanded"
            aria-controls="archived-flashcards"
            @click="archiveExpanded = !archiveExpanded"
          >
            <v-icon icon="mdi-archive-outline" size="small" />
            <span>Archive</span>
            <span class="archive-heading__count">{{ archivedCards.length }}</span>
            <v-icon :icon="archiveExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="small" />
          </v-btn>
          <v-expand-transition>
            <div v-show="archiveExpanded" id="archived-flashcards">
              <div class="mt-2">
                <div class="section-heading mt-0">
                  <h3 class="text-body-1 font-weight-black">Archived cards</h3>
                  <span class="text-caption muted">
                    {{ archivedFilteredCardCount }} of {{ archivedCards.length }}
                  </span>
                </div>
                <FlashcardCardsManager
                  :cards="archivedCards"
                  :tags="store.tags"
                  :interactive="false"
                  :can-add="false"
                  empty-title="No archived cards"
                  empty-description="Archived cards will appear here."
                  @update:filtered-count="archivedFilteredCardCount = $event"
                  @open-card="openCard"
                >
                  <template #action-column-heading><span class="d-sr-only">Restore</span></template>
                  <template #action-column="{ card, cards }">
                    <div class="flashcard-card-edit" @pointerdown.stop @touchstart.stop @click.stop @keydown.stop>
                      <v-btn
                        icon="mdi-archive-arrow-up-outline"
                        variant="text"
                        size="small"
                        color="secondary"
                        :aria-label="`Open archived card: ${card.front}`"
                        @click.stop="openCard(card, cards)"
                      />
                    </div>
                  </template>
                </FlashcardCardsManager>
              </div>
            </div>
          </v-expand-transition>
        </section>
      </section>
    </template>
  </main>
</template>

<style scoped>
.flashcard-card-edit { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; }
.archive-heading { min-height: 2.75rem; }
.archive-heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.archive-heading__count { margin-left: auto; color: rgb(var(--v-theme-on-surface) / .54); font-size: .7rem; }
</style>
