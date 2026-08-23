# Tasks

Opening the Tasks view selects the current day. Choosing another date remains in effect while working in that view, but returning to Tasks starts from today again.

Saved tasks are archived instead of deleted from the task editor. Archiving removes a task from its schedule and reminders while preserving its settings, entries, and history. Archived tasks appear in the collapsible Archive section below Not scheduled, where selecting one opens the editor so it can be restored.

On mobile, the next incomplete task banner appears only when no incomplete task card is visible between the app bar and bottom navigation. It links to the nearest incomplete task farther down the page.

When a Daily Total log exactly fills the positive amount remaining to its target, the Tasks view asks whether to lock in the total. Locking finishes the task and prevents more changes for that day; skipping leaves it unlocked so more values can still be logged.

Logged amounts update task progress immediately. Background persistence and synchronization refreshes preserve that optimistic value so totals do not temporarily revert while the save is in flight.

Tasks with **Quick log** enabled appear in a horizontally scrollable shortcut row at the top of the Tasks view whenever they are scheduled for the selected date. Each shortcut uses the task color and opens the same action sheet as its full task card. Numeric, tracking, duration-goal, and multi-requirement tasks show their current progress bar; simple action tasks do not add an empty progress treatment. Holding and dragging a shortcut reorders quick logs independently from the full task schedule, updates the local order immediately, and scrolls the shortcut row near its horizontal edges.

Completed interval and flashcard sessions reconcile their attributed program-step requirement only when its effective completion state changes. Repeated local refreshes preserve the original completion instead of creating another occurrence update.

Task occurrence updates remain optimistic while progress reloads are running. A completed program-step requirement that is marked incomplete stays incomplete after persistence finishes: older progress responses cannot replace it, and historical session reconciliation respects its recorded incomplete state.

Opening a completed program-step requirement shows a **Mark incomplete** action instead of changing it immediately. The action resets only the selected check, interval, or flashcard requirement while preserving its session history. Opening the completed step card outside its requirements offers the same action for all manually completed requirements. Quantity requirements continue to derive completion from their logged amounts, which can be adjusted from log history.

Programs with **Review if unfinished** enabled expose every unresolved step from earlier days in the retained task history under **Resolve open work**, including steps before a repeating-program cycle boundary. Strict programs provide the same backlog even when **Review if unfinished** is disabled. Each item shows its scheduled date and can be marked missed, carried forward, or used to shift the program. Resolving one item removes only that dated occurrence from the open-work list; the remaining backlog stays available.

When **Resolve open work** contains more than three items, it also offers confirmed bulk actions to mark the full backlog missed, carry the full backlog forward, or shift every affected program once for each of its unresolved steps. Each bulk action updates offline state and queues one command in a single local transaction; the server applies the complete command atomically so it cannot persist only part of the selection.

Task cards for missed, skipped, and shifted occurrences remain available in their dated history but use the same muted grayscale treatment as other inactive work. Shifted occurrences also show an explicit **Shifted** status.

## Health Connect

Step Counter tasks can load daily step totals from Android Health Connect after the user connects it in Settings. Health Connect does not expose screen-time or app-usage records, so Screen time is not offered as an automatically populated Duration-task unit. Supporting device screen time would require a separate Android `UsageStatsManager` integration and usage-access permission.
