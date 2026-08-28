<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import ContentIcon from '@/components/ContentIcon.vue'
import { filterEmojiOptions, loadEmojiOptions } from '@/services/emojis'
import type { EmojiOption } from '@/types/emoji'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  dialogTitle?: string
  clearable?: boolean
  disabled?: boolean
}>(), {
  modelValue: '',
  label: 'Icon',
  placeholder: 'Choose an emoji',
  dialogTitle: 'Choose an emoji',
  clearable: true,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectorId = useId()
const activatorId = `emoji-selector-activator-${selectorId}`
const dialogTitleId = `emoji-selector-title-${selectorId}`
const dialogOpen = ref(false)
const loading = ref(false)
const loadError = ref('')
const query = ref('')
const emojiOptions = shallowRef<EmojiOption[]>([])
const searchField = ref<{ focus: () => void }>()
const virtualList = ref<{ scrollToIndex: (index: number) => void }>()
const filteredOptions = computed(() => filterEmojiOptions(emojiOptions.value, query.value || ''))
const selectedOption = computed(() => emojiOptions.value.find(option => option.value === props.modelValue))
const activatorLabel = computed(() => {
  if (selectedOption.value) return selectedOption.value.label
  if (props.modelValue.startsWith('mdi-')) {
    return props.modelValue
      .slice(4)
      .split('-')
      .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ')
  }
  if (props.modelValue && loading.value) return 'Loading icon name…'
  if (props.modelValue) return 'Selected emoji'
  return props.placeholder
})
const resultLabel = computed(() => {
  const count = filteredOptions.value.length
  if (loading.value) return 'Loading emoji…'
  if (loadError.value) return loadError.value
  if (query.value?.trim()) return `${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`
  return `${count.toLocaleString()} emoji`
})

async function ensureEmojiOptions() {
  if (emojiOptions.value.length || loading.value) return

  loading.value = true
  loadError.value = ''
  try {
    emojiOptions.value = await loadEmojiOptions()
  } catch {
    loadError.value = 'Emoji could not be loaded.'
  } finally {
    loading.value = false
  }
}

async function openSelector() {
  if (props.disabled) return
  query.value = ''
  dialogOpen.value = true
  await ensureEmojiOptions()
  await nextTick()
  const selectedIndex = filteredOptions.value.findIndex(option => option.value === props.modelValue)
  if (selectedIndex >= 0) virtualList.value?.scrollToIndex(selectedIndex)
}

function selectEmoji(option: EmojiOption) {
  emit('update:modelValue', option.value)
  dialogOpen.value = false
}

function clearSelection() {
  emit('update:modelValue', '')
  dialogOpen.value = false
}

function focusSearch() {
  searchField.value?.focus()
}

watch(query, async () => {
  await nextTick()
  virtualList.value?.scrollToIndex(0)
})

watch(() => props.modelValue, (value) => {
  if (value && !emojiOptions.value.length) void ensureEmojiOptions()
}, { immediate: true })
</script>

<template>
  <div class="emoji-selector">
    <label :for="activatorId" class="emoji-selector__label">{{ label }}</label>
    <v-btn
      :id="activatorId"
      v-bind="$attrs"
      class="emoji-selector__activator"
      variant="outlined"
      size="large"
      block
      type="button"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="dialogOpen"
      @click="openSelector"
    >
      <span v-if="modelValue" class="emoji-selector__activator-glyph" aria-hidden="true">
        <ContentIcon :icon="modelValue" size="1.375rem" />
      </span>
      <span v-else class="emoji-selector__activator-glyph emoji-selector__activator-glyph--empty" aria-hidden="true">
        <v-icon icon="mdi-emoticon-outline" />
      </span>
      <span
        class="emoji-selector__activator-name"
        :class="{ 'emoji-selector__activator-name--placeholder': !modelValue }"
      >
        {{ activatorLabel }}
      </span>
      <v-icon class="emoji-selector__activator-chevron" icon="mdi-chevron-down" />
    </v-btn>
  </div>

  <AppDialog
    v-model="dialogOpen"
    max-width="42rem"
    :aria-labelledby="dialogTitleId"
    @after-enter="focusSearch"
  >
    <v-card class="emoji-selector__dialog surface-card" rounded="xl">
      <v-card-title class="emoji-selector__header">
        <span :id="dialogTitleId">{{ dialogTitle }}</span>
        <div class="emoji-selector__header-actions">
          <v-btn
            v-if="clearable && modelValue"
            icon="mdi-delete-outline"
            variant="text"
            size="small"
            aria-label="Remove selected emoji"
            @click="clearSelection"
          />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="Close emoji selector"
            @click="dialogOpen = false"
          />
        </div>
      </v-card-title>

      <div class="px-5 pb-4">
        <v-text-field
          ref="searchField"
          :model-value="query"
          label="Search emoji"
          prepend-inner-icon="mdi-magnify"
          clearable
          :disabled="Boolean(loadError)"
          @update:model-value="query = $event || ''"
        />
        <p class="emoji-selector__result-count mt-2" aria-live="polite">{{ resultLabel }}</p>
      </div>

      <div v-if="loading" class="emoji-selector__state" aria-live="polite">
        <v-progress-circular indeterminate color="secondary" size="2rem" />
        <p>Loading emoji…</p>
      </div>

      <div v-else-if="loadError" class="emoji-selector__state" role="alert">
        <v-icon icon="mdi-alert-circle-outline" color="error" size="2rem" />
        <p>{{ loadError }}</p>
        <v-btn color="secondary" variant="tonal" @click="ensureEmojiOptions">Try again</v-btn>
      </div>

      <div v-else-if="!filteredOptions.length" class="emoji-selector__state" aria-live="polite">
        <v-icon icon="mdi-emoticon-sad-outline" size="2rem" />
        <div>
          <p class="font-weight-bold">No emoji found</p>
          <p class="text-body-2 muted mt-1">Try another name or keyword.</p>
        </div>
      </div>

      <v-virtual-scroll
        v-else
        ref="virtualList"
        class="emoji-selector__list"
        :items="filteredOptions"
        item-key="hexcode"
        item-height="64"
        height="min(28rem, 54dvh)"
        role="listbox"
        aria-label="Emoji"
      >
        <template #default="{ item }">
          <v-list-item
            class="emoji-selector__option"
            :active="item.value === modelValue"
            active-color="secondary"
            :aria-selected="item.value === modelValue"
            link
            role="option"
            @click="selectEmoji(item)"
          >
            <template #prepend>
              <span class="emoji-selector__option-glyph" aria-hidden="true">{{ item.value }}</span>
            </template>
            <v-list-item-title>{{ item.label }}</v-list-item-title>
            <template #append>
              <v-icon v-if="item.value === modelValue" icon="mdi-check" color="secondary" />
            </template>
          </v-list-item>
        </template>
      </v-virtual-scroll>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.emoji-selector__label {
  display: block;
  margin-bottom: .5rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .75rem;
  font-weight: 750;
}

.emoji-selector__activator {
  min-height: 3.5rem;
  padding: .5rem .75rem;
  border-color: rgb(var(--v-theme-on-surface) / .38);
}

.emoji-selector__activator :deep(.v-btn__content) {
  width: 100%;
  min-width: 0;
  justify-content: flex-start;
  gap: .75rem;
}

.emoji-selector__activator-glyph {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: .6875rem;
  background: rgb(var(--v-theme-surface-variant) / .52);
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 1.375rem;
  line-height: 1;
}

.emoji-selector__activator-glyph--empty {
  color: rgb(var(--v-theme-on-surface) / .68);
}

.emoji-selector__activator-name {
  min-width: 0;
  overflow: hidden;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.emoji-selector__activator-name--placeholder {
  color: rgb(var(--v-theme-on-surface) / .56);
}

.emoji-selector__activator-chevron {
  margin-left: auto;
  color: rgb(var(--v-theme-on-surface) / .68);
}

.emoji-selector__dialog {
  max-height: calc(100dvh - 2rem);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.emoji-selector__header {
  display: flex;
  min-height: 4rem;
  align-items: center;
  justify-content: space-between;
  padding: .75rem 1rem .75rem 1.25rem;
  font-weight: 900;
}

.emoji-selector__header-actions {
  display: flex;
  align-items: center;
}

.emoji-selector__result-count {
  min-height: 1.25rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .75rem;
}

.emoji-selector__list {
  border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-surface));
}

.emoji-selector__option {
  min-height: 4rem;
  border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .06);
}

.emoji-selector__option:focus-visible {
  outline: .125rem solid rgb(var(--v-theme-secondary));
  outline-offset: -.1875rem;
}

.emoji-selector__option-glyph {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: .875rem;
  background: rgb(var(--v-theme-surface-variant) / .52);
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 1.75rem;
  line-height: 1;
}

.emoji-selector__state {
  display: flex;
  min-height: min(28rem, 54dvh);
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  text-align: center;
}

@media (max-width: 37.5rem) {
  .emoji-selector__header {
    min-height: 3.5rem;
  }

  .emoji-selector__list,
  .emoji-selector__state {
    height: 58dvh !important;
    min-height: 58dvh;
  }
}
</style>
