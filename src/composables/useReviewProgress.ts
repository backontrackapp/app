import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createReviewProgressTimeline } from '@/services/reviewProgress'
import type { ReviewProgressPhase } from '@/types/domain'

export function useReviewProgress(source: () => ReviewProgressPhase) {
  const timeline = createReviewProgressTimeline()
  const progress = ref(0)
  let frame = 0

  function update() {
    const phase = source()
    progress.value = timeline.update({
      ...phase,
      running: phase.running && document.visibilityState === 'visible',
    }, performance.now())
  }

  function animate() {
    update()
    frame = requestAnimationFrame(animate)
  }

  function beginSpeech(estimatedMs: number) {
    update()
    const playback = timeline.beginSpeech(source(), performance.now(), estimatedMs)
    return {
      duration(durationMs: number) {
        update()
        playback.duration(durationMs)
      },
      finish() {
        update()
        playback.finish()
      },
    }
  }

  watch(source, update, { flush: 'post' })
  onMounted(animate)
  onBeforeUnmount(() => cancelAnimationFrame(frame))
  return { progress, beginSpeech }
}
