<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  iconColor?: string
  title?: string
  subtitle?: string
  tile?: boolean
  flat?: boolean
}>(), {
  iconColor: 'secondary',
  tile: false,
  flat: false,
})
</script>

<template>
  <v-card
    class="empty-state-card pa-7 text-center"
    :class="{ 'surface-card': !flat }"
    :tile="tile"
    :flat="flat"
  >
    <v-icon v-if="icon" :icon="icon" :color="iconColor" size="42" class="mb-3" />
    <h2 v-if="title" class="text-h6 font-weight-black">{{ title }}</h2>
    <p v-if="subtitle" class="text-body-2 muted mt-2" :class="{ 'mb-5': $slots.button }">
      {{ subtitle }}
    </p>
    <slot name="button" />
  </v-card>
</template>
