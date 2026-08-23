<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SquareImageUpload from '@/components/SquareImageUpload.vue'
import { squareImageSourceIsValid } from '@/services/avatarImage'
import type { SquareImageSource, SquareImageSourceValue } from '@/types/domain'

const props = defineProps<{ modelValue: SquareImageSourceValue; loading?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: SquareImageSourceValue]
  error: [message: string]
}>()
const imageUpload = ref<InstanceType<typeof SquareImageUpload>>()
const uploadPreviewUrl = ref('')
const previewFailed = ref(false)
const previewUrl = computed(() => props.modelValue.source === 'url'
  ? props.modelValue.url.trim()
  : props.modelValue.source === 'upload'
    ? uploadPreviewUrl.value || (props.modelValue.existingSource === 'upload' ? props.modelValue.existingUrl : '')
    : '')
const urlIsValid = computed(() => props.modelValue.source !== 'url' || squareImageSourceIsValid(props.modelValue))

watch(() => props.modelValue.upload, (upload) => {
  releasePreview()
  if (upload) uploadPreviewUrl.value = URL.createObjectURL(upload)
  previewFailed.value = false
}, { immediate: true })
watch(() => [props.modelValue.source, props.modelValue.url], () => { previewFailed.value = false })
onBeforeUnmount(releasePreview)

function updateSource(source: SquareImageSource) {
  emit('update:modelValue', { ...props.modelValue, source })
}
function useUpload(upload: Blob) {
  emit('update:modelValue', { ...props.modelValue, source: 'upload', upload })
}
function releasePreview() {
  if (uploadPreviewUrl.value) URL.revokeObjectURL(uploadPreviewUrl.value)
  uploadPreviewUrl.value = ''
}
</script>

<template>
  <section class="flashcard-image-field">
    <SquareImageUpload
      ref="imageUpload"
      subject="flashcard"
      title="Adjust card image"
      description="Move and resize the image. It will be saved as a 256 × 256 square."
      save-label="Use image"
      :loading="loading"
      @upload="useUpload"
      @error="emit('error', $event)"
    />
    <div>
      <strong>Card image</strong>
      <p class="muted text-caption mt-1">Optional · uploads are cropped to 256 × 256</p>
    </div>
    <v-btn-toggle
      :model-value="modelValue.source"
      mandatory
      color="secondary"
      variant="tonal"
      class="flashcard-image-field__sources mt-3"
      @update:model-value="updateSource"
    >
      <v-btn value="none" prepend-icon="mdi-image-off-outline">None</v-btn>
      <v-btn value="upload" prepend-icon="mdi-image-plus-outline">Upload</v-btn>
      <v-btn value="url" prepend-icon="mdi-link-variant">URL</v-btn>
    </v-btn-toggle>
    <v-text-field
      v-if="modelValue.source === 'url'"
      :model-value="modelValue.url"
      label="Image URL"
      placeholder="https://example.com/image.jpg"
      autocomplete="off"
      class="mt-4"
      :rules="[() => urlIsValid || 'Enter a complete HTTP or HTTPS URL']"
      @update:model-value="emit('update:modelValue', { ...modelValue, url: $event, upload: undefined })"
    />
    <div v-if="modelValue.source === 'upload'" class="d-flex align-center ga-3 mt-4">
      <v-btn variant="tonal" color="secondary" prepend-icon="mdi-image-plus-outline" :disabled="loading" @click="imageUpload?.choose()">
        {{ previewUrl ? 'Replace upload' : 'Choose image' }}
      </v-btn>
    </div>
    <v-img
      v-if="previewUrl && !previewFailed"
      :src="previewUrl"
      alt="Card image preview"
      width="256"
      max-width="100%"
      aspect-ratio="1"
      cover
      class="flashcard-image-field__preview mt-4"
      @error="previewFailed = true"
    />
    <v-alert v-if="previewFailed" type="warning" variant="tonal" density="compact" class="mt-4">
      This image could not be previewed. Check the URL or choose another upload.
    </v-alert>
  </section>
</template>

<style scoped>
.flashcard-image-field__sources { display: grid; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
.flashcard-image-field__sources :deep(.v-btn) { width: 100%; min-width: 0; }
.flashcard-image-field__preview { overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1rem; }
</style>
