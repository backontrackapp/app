<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import EmptyStateCard from '@/components/EmptyStateCard.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { INTERVAL_TEMPLATE_ACTIONS, type IntervalTemplateAction } from '@/services/intervalTemplateActions'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()
const selectedTemplate = ref<IntervalTemplate>()
const templateActionsOpen = ref(false)
const reordering = ref(false)
const archiveExpanded = ref(false)
const activeTemplates = computed(() => store.templates.filter(template => !template.archived))
const archivedTemplates = computed(() => store.templates.filter(template => template.archived))

onMounted(() => {
  if (!store.templates.length) store.load().catch(() => undefined)
})

async function saveTemplateOrder(ordered: IntervalTemplate[]) {
  reordering.value = true
  try {
    await store.reorderTemplates(ordered)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reordering.value = false
  }
}

async function reorderByDrag(result: LongPressDragResult) {
  const templatesById = new Map(
    activeTemplates.value.map((template) => [template.id, template]),
  )
  const ordered = result.orderedIds
    .map((id) => templatesById.get(id))
    .filter((template): template is IntervalTemplate => Boolean(template))
  if (ordered.length !== activeTemplates.value.length) return
  await saveTemplateOrder(ordered)
}

function startTemplate(template: IntervalTemplate) {
  templateActionsOpen.value = false
  return router.push(`/intervals/run/template/${template.id}`)
}

function editTemplate(template: IntervalTemplate) {
  templateActionsOpen.value = false
  return router.push(`/intervals/${template.id}/edit`)
}

function openTemplateActions(template: IntervalTemplate) {
  selectedTemplate.value = template
  templateActionsOpen.value = true
}

function duplicateTemplate(template: IntervalTemplate) {
  templateActionsOpen.value = false
  return router.push({
    name: 'interval-new',
    query: { duplicate: template.id },
  })
}

function runTemplateAction(action: IntervalTemplateAction, template: IntervalTemplate) {
  if (action === 'play') return startTemplate(template)
  if (action === 'edit') return editTemplate(template)
  return duplicateTemplate(template)
}
</script>

<template>
  <div v-if="activeTemplates.length" class="interval-plan-list">
    <v-card
      v-for="template in activeTemplates"
      :key="template.id"
      v-long-press-drag="{
        id: template.id,
        group: 'interval-templates',
        disabled: activeTemplates.length < 2 || reordering,
        onDrop: reorderByDrag,
      }"
      class="surface-card pa-4 interval-plan-card"
      role="button"
      tabindex="0"
      :aria-label="`Actions for ${template.name}`"
      @click="openTemplateActions(template)"
      @keydown.enter="openTemplateActions(template)"
      @keydown.space.prevent="openTemplateActions(template)"
    >
      <div class="interval-plan-card__row d-flex align-start ga-3">
        <div class="interval-template-icon" :style="{ background: template.color }">
          <span v-if="template.icon" class="interval-template-emoji" aria-hidden="true">{{ template.icon }}</span>
          <v-icon v-else icon="mdi-timer-outline" size="21" />
        </div>
        <div class="interval-plan-details">
          <h2 class="text-body-1 font-weight-black text-truncate">{{ template.name }}</h2>
          <p class="text-caption muted mt-1">
            {{ formatIntervalDuration(intervalDuration(template.definition)) }} ·
            {{ intervalStepCount(template.definition) }} intervals
          </p>
          <p v-if="template.description" class="text-caption muted mt-3 text-truncate">{{ template.description }}</p>
        </div>
      </div>
    </v-card>
  </div>

  <EmptyStateCard
    v-else-if="store.loaded && !archivedTemplates.length"
    icon="mdi-timer-plus-outline"
    title="Build your first interval"
    subtitle="Combine timed steps and repeat groups for any kind of session."
  >
    <template #button>
      <v-btn color="secondary" to="/intervals/new">Create an interval</v-btn>
    </template>
  </EmptyStateCard>

  <section v-if="archivedTemplates.length" class="mt-4">
    <v-btn block variant="text" class="archive-heading" :aria-expanded="archiveExpanded" aria-controls="archived-intervals" @click="archiveExpanded = !archiveExpanded">
      <v-icon icon="mdi-archive-outline" size="small" />
      <span>Archive</span>
      <span class="archive-heading__count">{{ archivedTemplates.length }}</span>
      <v-icon :icon="archiveExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="small" />
    </v-btn>
    <v-expand-transition>
      <div v-show="archiveExpanded" id="archived-intervals">
        <div class="interval-plan-list mt-2">
          <v-card v-for="template in archivedTemplates" :key="template.id" class="surface-card pa-4 interval-plan-card" role="link" tabindex="0" :aria-label="`Edit archived interval ${template.name}`" @click="editTemplate(template)" @keydown.enter="editTemplate(template)" @keydown.space.prevent="editTemplate(template)">
            <div class="interval-plan-card__row d-flex align-start ga-3">
              <div class="interval-template-icon" :style="{ background: template.color }"><v-icon icon="mdi-archive-outline" size="21" /></div>
              <div class="interval-plan-details"><h2 class="text-body-1 font-weight-black text-truncate">{{ template.name }}</h2><p class="text-caption muted mt-1">Archived · Open to restore</p></div>
            </div>
          </v-card>
        </div>
      </div>
    </v-expand-transition>
  </section>

  <ActionBottomSheet
    v-model="templateActionsOpen"
    :title="selectedTemplate?.name || 'Interval actions'"
    hide-title
    :aria-label="selectedTemplate ? `${selectedTemplate.name} actions` : 'Interval actions'"
  >
    <template v-if="selectedTemplate">
      <template v-for="item in INTERVAL_TEMPLATE_ACTIONS" :key="item.action">
        <v-divider v-if="'divider' in item && item.divider" class="my-2" />
        <v-list-item
          :prepend-icon="item.icon"
          :title="item.title"
          :base-color="item.color"
          :class="{ 'font-weight-bold': item.action === 'play' }"
          rounded="lg"
          @click="runTemplateAction(item.action, selectedTemplate)"
        />
      </template>
    </template>
  </ActionBottomSheet>

</template>

<style scoped>
.interval-plan-list { display: grid; gap: .75rem; }
.interval-plan-card { overflow: hidden; cursor: pointer; }
.interval-plan-card:focus-visible { outline: .1875rem solid rgb(var(--v-theme-primary) / .55); outline-offset: .1875rem; }
.interval-plan-card__row { width: 100%; min-width: 0; }
.interval-plan-details { overflow: hidden; min-width: 0; flex: 1 1 0; }
.interval-template-icon { display: grid; width: 2.625rem; height: 2.625rem; flex: 0 0 auto; place-items: center; border-radius: .875rem; color: rgb(var(--v-theme-on-secondary)); }
.interval-template-emoji { font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; font-size: 1.375rem; line-height: 1; }
.archive-heading { min-height: 2.75rem; }
.archive-heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.archive-heading__count { margin-left: auto; color: rgb(var(--v-theme-on-surface) / .54); font-size: .7rem; }
@media (min-width: 43.75rem) { .interval-plan-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
