<script setup lang="ts">
import ContentIcon from '@/components/ContentIcon.vue'
import type { ProgramStepRequirementListItem } from '@/types/domain'

const props = defineProps<{
  items: ProgramStepRequirementListItem[]
  color: string
  busy?: boolean
  ariaLabel: string
}>()

const emit = defineEmits<{
  select: [id: string]
}>()
</script>

<template>
  <v-list
    v-if="props.items.length"
    class="program-requirement-list pa-0"
    bg-color="transparent"
    :aria-label="props.ariaLabel"
    @touchstart.stop
    @click.stop
  >
    <v-list-item
      v-for="requirement in props.items"
      :key="requirement.id"
      class="program-requirement-list__item"
      :class="{ 'program-requirement-list__item--done': requirement.complete }"
      :title="requirement.title"
      :subtitle="requirement.subtitle"
      :disabled="props.busy || (!requirement.complete && requirement.disabled)"
      rounded="lg"
      @click="emit('select', requirement.id)"
    >
      <template #prepend>
        <span
          class="program-requirement-list__icon"
          :class="{ 'program-requirement-list__icon--image': requirement.image }"
          :style="{ background: requirement.color || props.color }"
        >
          <v-img
            v-if="requirement.image"
            class="program-requirement-list__image"
            :src="requirement.image"
            :alt="requirement.imageAlt || requirement.title"
            cover
            eager
          >
            <template #error><ContentIcon icon="mdi-dumbbell" size="1.125rem" /></template>
          </v-img>
          <ContentIcon
            v-else
            :icon="requirement.complete ? 'mdi-check-bold' : requirement.icon"
            size="1.125rem"
          />
          <span v-if="requirement.image && requirement.complete" class="program-requirement-list__complete-badge">
            <ContentIcon icon="mdi-check-bold" size=".625rem" />
          </span>
        </span>
      </template>
    </v-list-item>
  </v-list>
</template>

<style scoped>
.program-requirement-list { display: grid; gap: .4rem; }
.program-requirement-list__item { min-height: 2.75rem; background: rgba(var(--v-theme-on-surface), .04); transition: background-color .18s ease, opacity .18s ease; }
.program-requirement-list__item--done { background: rgba(var(--v-theme-on-surface), .02); filter: grayscale(1); opacity: .5; }
.program-requirement-list__icon { position: relative; display: grid; width: 2rem; height: 2rem; margin-inline-end: .7rem; place-items: center; border-radius: .65rem; color: rgb(var(--v-theme-on-secondary)); }
.program-requirement-list__icon--image { overflow: hidden; background: rgb(var(--v-theme-surface-variant)) !important; border: .0625rem solid rgb(var(--v-theme-on-surface) / .12); }
.program-requirement-list__image { width: 100% !important; height: 100% !important; }
.program-requirement-list__image :deep(.v-img__img) { object-fit: cover; }
.program-requirement-list__complete-badge { position: absolute; right: .1rem; bottom: .1rem; display: grid; width: .9rem; height: .9rem; place-items: center; border: .0625rem solid rgb(var(--v-theme-surface)); border-radius: 999rem; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
</style>
