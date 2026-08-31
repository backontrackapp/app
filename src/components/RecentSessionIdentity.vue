<script setup lang="ts">
import { computed } from 'vue'
import ContentIcon from '@/components/ContentIcon.vue'
import { exercisePresentationById } from '@/services/exercisePresentations'
import type { SessionPresentation } from '@/types/domain'

const props = withDefaults(defineProps<{
  presentation?: SessionPresentation
  fallbackIcon: string
  fallbackColor: string
}>(), {
  presentation: undefined,
})

const exercise = computed(() => exercisePresentationById(props.presentation?.exercise))
const icon = computed(() => props.presentation?.icon || props.fallbackIcon)
const color = computed(() => props.presentation?.color || props.fallbackColor)
</script>

<template>
  <v-avatar size="2.5rem" :color="color" variant="tonal" class="recent-session-identity">
    <v-img
      v-if="exercise?.imageUrl"
      :src="exercise.imageUrl"
      :alt="exercise.name"
      cover
    />
    <ContentIcon v-else :icon="icon" size="1.25rem" />
  </v-avatar>
</template>

<style scoped>
.recent-session-identity { overflow: hidden; }
</style>
