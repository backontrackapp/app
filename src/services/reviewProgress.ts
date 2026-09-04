import type { ReviewProgressPhase } from '@/types/domain'

// The scheduling clock still waits for actual audio completion. This visual clock
// distributes a repetition's progress over audio plus its full post-audio delay.
export function createReviewProgressTimeline() {
  let key = ''
  let fraction = 0
  let lastAt = 0
  let running = false
  let previousRemainingMs = 0
  let speech: { elapsedMs: number; expectedMs: number } | undefined

  function update(phase: ReviewProgressPhase, now: number) {
    const delta = Math.max(0, now - lastAt)
    lastAt = now
    if (key !== phase.key || (!speech && previousRemainingMs <= 0 && phase.remainingMs > 0)) {
      key = phase.key
      fraction = Math.max(0, Math.min(1, 1 - phase.remainingMs / phase.delayMs))
      speech = undefined
    } else if (running && phase.running) {
      if (speech) speech.elapsedMs += delta
      // Browser speech has no advance duration metadata. If it exceeds the
      // estimate, keep moving without reaching the boundary before audio ends.
      const estimatedRemaining = speech ? speech.expectedMs - speech.elapsedMs : 0
      const speechRemaining = phase.speechRemainingMs
        ?? (speech ? (estimatedRemaining > 0 ? estimatedRemaining : 250) : 0)
      const remaining = Math.max(0, phase.remainingMs) + speechRemaining
      if (delta > 0) fraction += (1 - fraction) * delta / (remaining + delta)
    }
    running = phase.running
    previousRemainingMs = phase.remainingMs
    return (phase.repeatIndex + fraction) / Math.max(1, phase.repeatCount) * 100
  }

  function beginSpeech(phase: ReviewProgressPhase, now: number, estimatedMs: number) {
    update(phase, now)
    const playback = { elapsedMs: 0, expectedMs: Math.max(250, estimatedMs) }
    speech = playback
    return {
      duration(durationMs: number) {
        if (speech === playback && Number.isFinite(durationMs) && durationMs > 0) {
          playback.expectedMs = playback.elapsedMs + durationMs
        }
      },
      finish() {
        if (speech === playback) speech = undefined
      },
    }
  }

  return { update, beginSpeech }
}
