<script setup lang="ts">
import { computed } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import { flashcardReviewSessionMenuItems } from '@/services/flashcards'
import type { FlashcardContextAction } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: boolean
  busy?: boolean
  canManageCard?: boolean
  canAddCard?: boolean
  canEjectCard?: boolean
  showUndoEject?: boolean
  canUndoEject?: boolean
  canToggleTts?: boolean
  ttsPaused?: boolean
  canToggleAudioFocus?: boolean
  audioFocusEnabled?: boolean
}>(), {
  busy: false,
  canManageCard: true,
  canAddCard: true,
  canEjectCard: true,
  showUndoEject: false,
  canUndoEject: false,
  canToggleTts: false,
  ttsPaused: false,
  canToggleAudioFocus: false,
  audioFocusEnabled: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  action: [action: FlashcardContextAction]
}>()

function select(action: FlashcardContextAction) {
  emit('update:modelValue', false)
  emit('action', action)
}

const items = computed(() => flashcardReviewSessionMenuItems({
  showUndoEject: props.showUndoEject,
  showTtsToggle: props.canToggleTts,
  ttsPaused: props.ttsPaused,
  showAudioFocus: props.canToggleAudioFocus,
  audioFocusEnabled: props.audioFocusEnabled,
}))

function itemDisabled(permission?: 'add' | 'manage' | 'eject' | 'undo_eject') {
  if (props.busy) return true
  if (permission === 'add') return !props.canAddCard
  if (permission === 'manage') return !props.canManageCard
  if (permission === 'eject') return !props.canEjectCard
  if (permission === 'undo_eject') return !props.canUndoEject
  return false
}
</script>

<template>
  <ActionBottomSheet
    :model-value="props.modelValue"
    title="Current context"
    aria-label="Current flashcard actions"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-for="item in items" :key="item.action">
      <v-divider v-if="'divider' in item && item.divider" class="my-1" />
      <v-list-item
        :title="item.title"
        :subtitle="'subtitle' in item ? item.subtitle : undefined"
        :prepend-icon="item.icon"
        :base-color="'color' in item ? item.color : undefined"
        :active="'active' in item ? item.active : false"
        :active-color="'active' in item && item.active ? 'secondary' : undefined"
        :disabled="itemDisabled('permission' in item ? item.permission : undefined)"
        :aria-pressed="'toggle' in item && item.toggle ? item.active : undefined"
        @click="select(item.action)"
      >
        <template v-if="'toggle' in item && item.toggle" #append>
          <v-icon
            :icon="item.active ? 'mdi-check-circle' : 'mdi-circle-outline'"
            :color="item.active ? 'secondary' : undefined"
            size="20"
          />
        </template>
      </v-list-item>
    </template>
  </ActionBottomSheet>
</template>
