import type { Task, TrackingTracker } from '@/types/domain'
import { trackingGoalForDate } from '@/services/tracking'

export function taskAttachedTrackers(task: Task, trackers: TrackingTracker[]) {
  const trackerById = new Map(trackers.map(tracker => [tracker.id, tracker]))
  return [...new Set(task.trackingTrackers || [])]
    .map(id => trackerById.get(id))
    .filter((tracker): tracker is TrackingTracker => Boolean(tracker))
}

/**
 * A scheduled task with one number or duration tracker keeps the legacy
 * quantitative task presentation, but its target and values live on the tracker.
 */
export function taskGoalTracker(task: Task, trackers: TrackingTracker[], date?: string) {
  const attached = taskAttachedTrackers(task, trackers)
  const [tracker] = attached
  const goal = tracker && date ? trackingGoalForDate(tracker, date) : tracker
  if (
    task.type !== 'tracking'
    || attached.length !== 1
    || !tracker
    || !['number', 'duration'].includes(tracker.kind)
    || !goal
    || goal.targetValue <= 0
  ) return undefined
  if (!date) return tracker
  return {
    ...tracker,
    targetValue: goal.targetValue,
    targetOperator: goal.targetOperator,
    trackingWindow: goal.trackingWindow,
  }
}
