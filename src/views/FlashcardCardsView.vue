<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, FlashcardReviewSet } from '@/types/domain'

const router = useRouter()
const store = useFlashcardStore()
const filteredCardCount = ref(0)
const archivedFilteredCardCount = ref(0)
const archiveExpanded = ref(false)
const activeCards = computed(() => store.cards.filter(card => card.archived !== true))
const archivedCards = computed(() => store.cards.filter(card => card.archived === true))
const reviewSetsByCardId = computed(() => {
  const assignments = new Map<string, FlashcardReviewSet[]>()

  store.reviewSets.forEach((reviewSet) => {
    (reviewSet.assignedCards || []).forEach((cardId) => {
      const cardReviewSets = assignments.get(cardId) || []
      cardReviewSets.push(reviewSet)
      assignments.set(cardId, cardReviewSets)
    })
  })

  return assignments
})

function cardReviewSets(card: Flashcard) {
  return reviewSetsByCardId.value.get(card.id) || []
}

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
          <template #last-column-heading>Review sets</template>
          <template #last-column="{ card }">
            <div
              v-if="cardReviewSets(card).length"
              class="flashcard-review-set-chips"
              role="list"
              :aria-label="`Review sets containing ${card.front}`"
            >
              <v-chip
                v-for="reviewSet in cardReviewSets(card)"
                :key="reviewSet.id"
                size="x-small"
                variant="outlined"
                class="flashcard-review-set-chip"
                :style="{ borderColor: reviewSet.color, color: reviewSet.color }"
                role="listitem"
              >
                <template #prepend>
                  <span class="flashcard-review-set-chip__icon" aria-hidden="true">
                    <span v-if="reviewSet.icon">{{ reviewSet.icon }}</span>
                    <v-icon v-else icon="mdi-cards-outline" size="x-small" />
                  </span>
                </template>
                {{ reviewSet.name }}{{ reviewSet.archived ? ' (archived)' : '' }}
              </v-chip>
            </div>
            <span v-else class="flashcard-review-set-empty">No review sets</span>
          </template>
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
.flashcard-review-set-chips { display: flex; flex-wrap: wrap; gap: .25rem; }
.flashcard-review-set-chip { max-width: 100%; }
.flashcard-review-set-chip__icon { display: inline-flex; margin-right: .25rem; }
.flashcard-review-set-chip :deep(.v-chip__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flashcard-review-set-empty { color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; }
.archive-heading { min-height: 2.75rem; }
.archive-heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.archive-heading__count { margin-left: auto; color: rgb(var(--v-theme-on-surface) / .54); font-size: .7rem; }
</style>
