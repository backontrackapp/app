<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { INTERVAL_TEMPLATE_ACTIONS, type IntervalTemplateAction } from '@/services/intervalTemplateActions'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()
const pendingDelete = ref<IntervalTemplate>()
const selectedTemplate = ref<IntervalTemplate>()
const templateActionsOpen = ref(false)
const deleting = ref(false)
const reordering = ref(false)

onMounted(() => {
  if (!store.templates.length) store.load().catch(() => undefined)
})

async function removeTemplate() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await store.deleteTemplate(pendingDelete.value.id)
    pendingDelete.value = undefined
  } catch {
    pendingDelete.value = undefined
  } finally {
    deleting.value = false
  }
}

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
    store.templates.map((template) => [template.id, template]),
  )
  const ordered = result.orderedIds
    .map((id) => templatesById.get(id))
    .filter((template): template is IntervalTemplate => Boolean(template))
  if (ordered.length !== store.templates.length) return
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

function requestDelete(template: IntervalTemplate) {
  templateActionsOpen.value = false
  pendingDelete.value = template
}

function runTemplateAction(action: IntervalTemplateAction, template: IntervalTemplate) {
  if (action === 'play') return startTemplate(template)
  if (action === 'edit') return editTemplate(template)
  if (action === 'duplicate') return duplicateTemplate(template)
  requestDelete(template)
}
</script>

<template>
  <div v-if="store.templates.length" class="interval-plan-list">
    <v-card
      v-for="template in store.templates"
      :key="template.id"
      v-long-press-drag="{
        id: template.id,
        group: 'interval-templates',
        disabled: store.templates.length < 2 || reordering,
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
          <v-icon icon="mdi-timer-outline" size="21" />
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

  <v-card v-else-if="store.loaded" class="surface-card pa-8 text-center">
    <v-icon icon="mdi-timer-plus-outline" size="42" class="mb-3" />
    <h2 class="text-h6 font-weight-black">Build your first interval</h2>
    <p class="text-body-2 muted mt-2 mb-5">Combine timed steps and repeat groups for any kind of session.</p>
    <v-btn color="secondary" to="/intervals/new">Create interval</v-btn>
  </v-card>

  <ActionBottomSheet
    v-model="templateActionsOpen"
    :title="selectedTemplate?.name || 'Interval actions'"
    hide-title
    :aria-label="selectedTemplate ? `${selectedTemplate.name} actions` : 'Interval actions'"
  >
    <template v-if="selectedTemplate">
      <v-list-item
        v-for="item in INTERVAL_TEMPLATE_ACTIONS"
        :key="item.action"
        :prepend-icon="item.icon"
        :title="item.title"
        :base-color="item.color"
        :class="{ 'font-weight-bold': item.action === 'play' }"
        rounded="lg"
        @click="runTemplateAction(item.action, selectedTemplate)"
      />
    </template>
  </ActionBottomSheet>

  <ConfirmDialog
    :model-value="Boolean(pendingDelete)"
    title="Delete this interval?"
    message="The reusable interval will be removed. Existing session history will remain."
    confirm-text="Delete interval"
    icon="mdi-delete-outline"
    :loading="deleting"
    @update:model-value="!$event && (pendingDelete = undefined)"
    @confirm="removeTemplate"
  />
</template>

<style scoped>
.interval-plan-list { display: grid; gap: .75rem; }
.interval-plan-card { overflow: hidden; cursor: pointer; }
.interval-plan-card:focus-visible { outline: .1875rem solid rgb(var(--v-theme-primary) / .55); outline-offset: .1875rem; }
.interval-plan-card__row { width: 100%; min-width: 0; }
.interval-plan-details { overflow: hidden; min-width: 0; flex: 1 1 0; }
.interval-template-icon { display: grid; width: 2.625rem; height: 2.625rem; flex: 0 0 auto; place-items: center; border-radius: .875rem; color: rgb(var(--v-theme-on-secondary)); }
@media (min-width: 43.75rem) { .interval-plan-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
