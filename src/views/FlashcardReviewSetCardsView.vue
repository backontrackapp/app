<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const loading = ref(true)
const error = ref('')
const filteredCardCount = ref(0)
const archivedFilteredCardCount = ref(0)
const archiveExpanded = ref(false)
const reviewSetId = computed(() => String(route.params.id || ''))
const reviewSet = computed(() => store.reviewSets.find(item => item.id === reviewSetId.value))
const allCards = computed(() => store.reviewSetCards[reviewSetId.value] || [])
const cards = computed(() => allCards.value.filter(card => card.archived !== true))
const archivedCards = computed(() => allCards.value.filter(card => card.archived === true))
const canEdit = computed(() => (
  reviewSet.value?.accessRole === 'owner' || reviewSet.value?.accessRole === 'editor'
))
const tags = computed(() => {
  const tagMap = new Map<string, { id: string; name: string }>()
  cards.value.flatMap(card => card.tagDetails || []).forEach(tag => tagMap.set(tag.id, tag))
  return [...tagMap.values()]
})

onMounted(async () => {
  try {
    if (!store.loaded) await store.load()
    if (!reviewSet.value) throw new Error('That Review set could not be found.')
    await store.loadReviewSetCards(reviewSetId.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load these cards.'
  } finally {
    loading.value = false
  }
})

function openCard(card: Flashcard, cardList: Flashcard[]) {
  if (!canEdit.value) return
  void router.push({
    name: 'flashcard-review-set-card-edit',
    params: { reviewSetId: reviewSetId.value, id: card.id },
    state: { flashcardNavigationIds: cardList.map(item => item.id) },
  })
}

function openNewCard() {
  if (!canEdit.value) return
  void router.push({
    name: 'flashcard-review-set-card-new',
    params: { reviewSetId: reviewSetId.value },
  })
}

function bulkUpdateCards(action: Parameters<typeof store.bulkUpdateReviewSetCards>[1], cardIds: string[]) {
  return store.bulkUpdateReviewSetCards(reviewSetId.value, action, cardIds)
}

</script>

<template>
  <main class="app-page review-set-cards-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loading" class="cards-loading py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading shared cards…</span>
    </div>

    <template v-else-if="reviewSet">
      <v-card class="surface-card pa-5 mb-4">
        <div class="cards-heading">
          <div class="min-width-0">
            <h1 class="text-h6 font-weight-black text-truncate">{{ reviewSet.name }}</h1>
            <p class="text-body-2 muted mt-1">
              <template v-if="reviewSet.accessRole === 'owner'">Your assigned cards</template>
              <template v-else>Shared by {{ reviewSet.ownerName || 'another account' }}</template>
            </p>
          </div>
          <v-chip
            v-if="reviewSet.accessRole !== 'owner'"
            size="small"
            :color="reviewSet.accessRole === 'editor' ? 'secondary' : undefined"
          >
            {{ reviewSet.accessRole === 'editor' ? 'Editor' : 'Read only' }}
          </v-chip>
        </div>
      </v-card>

      <div class="section-heading mt-0">
        <h2>Cards</h2>
        <span class="text-caption muted">
          {{ filteredCardCount === cards.length ? cards.length : `${filteredCardCount} of ${cards.length}` }}
        </span>
      </div>

      <FlashcardCardsManager
        :cards="cards"
        :tags="tags"
        :selectable="canEdit"
        :interactive="canEdit"
        :can-add="canEdit"
        :show-import="canEdit"
        :import-review-set-id="reviewSetId"
        :source-review-set-id="reviewSetId"
        :bulk-actions="reviewSet.accessRole === 'owner'
          ? ['inject_into_review_set', 'delete']
          : canEdit ? ['delete'] : []"
        :bulk-action-handler="bulkUpdateCards"
        add-aria-label="Add a card to this Review set"
        empty-title="No assigned cards"
        :empty-description="canEdit ? 'Add a card to assign it to this Review set.' : 'The owner has not assigned a card yet.'"
        first-card-label="Add the first card"
        @update:filtered-count="filteredCardCount = $event"
        @add-card="openNewCard"
        @open-card="openCard"
      />

      <section v-if="canEdit && archivedCards.length" class="mt-4">
        <v-btn
          block
          variant="text"
          class="archive-heading"
          :aria-expanded="archiveExpanded"
          aria-controls="archived-review-set-cards"
          @click="archiveExpanded = !archiveExpanded"
        >
          <v-icon icon="mdi-archive-outline" size="small" />
          <span>Archive</span>
          <span class="archive-heading__count">{{ archivedCards.length }}</span>
          <v-icon :icon="archiveExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="small" />
        </v-btn>
        <v-expand-transition>
          <div v-show="archiveExpanded" id="archived-review-set-cards">
            <div class="mt-2">
              <FlashcardCardsManager
                :cards="archivedCards"
                :tags="tags"
                :interactive="false"
                :can-add="false"
                empty-title="No archived cards"
                empty-description="Archived cards will appear here."
                @update:filtered-count="archivedFilteredCardCount = $event"
                @open-card="openCard"
              >
                <template #action-column-heading><span class="d-sr-only">Restore</span></template>
                <template #action-column="{ card, cards: visibleCards }">
                  <v-btn
                    icon="mdi-archive-arrow-up-outline"
                    variant="text"
                    size="small"
                    color="secondary"
                    :aria-label="`Open archived card: ${card.front}`"
                    @click.stop="openCard(card, visibleCards)"
                  />
                </template>
              </FlashcardCardsManager>
              <p class="text-caption muted mt-2 text-right">
                {{ archivedFilteredCardCount }} of {{ archivedCards.length }} archived
              </p>
            </div>
          </div>
        </v-expand-transition>
      </section>
    </template>
  </main>
</template>

<style scoped>
.cards-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.cards-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; }
.archive-heading { min-height: 2.75rem; }
.archive-heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.archive-heading__count { margin-left: auto; color: rgb(var(--v-theme-on-surface) / .54); font-size: .7rem; }
</style>
