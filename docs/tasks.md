# Tasks

Opening the Tasks view selects the current day. Choosing another date remains in effect while working in that view, but returning to Tasks starts from today again.

Swiping left across the Tasks view advances to the next date, while swiping right returns to the previous date. Date-dependent content moves in from the navigation direction with a quick horizontal transition, a centered card briefly confirms the newly selected date before fading away, and the Quick log row resets to its left edge. The week selector and horizontally scrollable Quick log row keep their own swipe behavior.

The task editor's archive action offers a choice between archiving and permanent deletion. Archiving removes a task from its schedule and reminders while preserving its settings, entries, and history. Archived tasks appear in the collapsible Archive section below Not scheduled, where selecting one opens the editor so it can be restored. Permanent deletion removes the task, its program steps, occurrences, entries, and image logs; saved interval and Review sessions remain in history without task attribution.

The task action menu includes **Duplicate**, which opens a new task prefilled with the original task's settings. The copy receives an independent name, ordering, and program steps, and is not created until the editor is saved.

Program steps can be duplicated from their expanded editor. The copy is inserted on the following program day with independent completion requirements and opens immediately for editing. Check-off, Interval, and Review set requirements can also have an optional label that identifies the requirement on its task card.

On mobile, the next incomplete task banner appears only when no incomplete task card is visible between the app bar and bottom navigation. It links to the nearest incomplete task farther down the page.

When a Daily Total log exactly fills the positive amount remaining to its target, the Tasks view asks whether to lock in the total. Locking finishes the task and prevents more changes for that day; skipping leaves it unlocked so more values can still be logged.

Logged amounts update task progress immediately. Background persistence and synchronization refreshes preserve that optimistic value so totals do not temporarily revert while the save is in flight.

Single tasks with **Quick log** enabled appear in a horizontally scrollable shortcut row at the top of the Tasks view whenever they are scheduled for the selected date, replacing their full card in the timed or all-day task schedule. Program and Tracking tasks do not offer Quick log. Each shortcut uses the task color and opens the same action sheet as the full task card. Numeric and duration-goal tasks show their current progress bar; simple action tasks do not add an empty progress treatment. Holding and dragging a shortcut reorders quick logs independently from the full task schedule, updates the local order immediately, and scrolls the shortcut row near its horizontal edges.

Completed interval and flashcard sessions reconcile their attributed program-step requirement only when its effective completion state changes. Repeated local refreshes preserve the original completion instead of creating another occurrence update.

Task occurrence updates remain optimistic while progress reloads are running. A completed program-step requirement that is marked incomplete stays incomplete after persistence finishes: older progress responses cannot replace it, and historical session reconciliation respects its recorded incomplete state.

Opening a completed program-step requirement shows a **Mark incomplete** action instead of changing it immediately. The action resets only the selected check, interval, or flashcard requirement while preserving its session history. Opening the completed step card outside its requirements offers the same action for all manually completed requirements. Quantity requirements continue to derive completion from their logged amounts, which can be adjusted from log history.

Programs with **Review if unfinished** enabled expose every unresolved step from earlier days in the retained task history under **Resolve open work**, including steps before a repeating-program cycle boundary. Strict programs provide the same backlog even when **Review if unfinished** is disabled. Each item shows its scheduled date and can be marked missed, carried forward, or used to shift the program. Shifting preserves the program's schedule through the unresolved step and delays only the days that follow it. Empty pending occurrences displaced by that shift do not create duplicate program-step cards; carried or logged work remains visible. Resolving one item removes only that dated occurrence from the open-work list; the remaining backlog stays available.

Open-work review is unavailable while viewing a future date. Future selections never expose review actions for tasks scheduled on or before that selected date.

When **Resolve open work** contains more than three items, it also offers confirmed bulk actions to mark the full backlog missed, carry the full backlog forward, or shift every affected program once for each of its unresolved steps. Each bulk action updates offline state and queues one command in a single local transaction; the server applies the complete command atomically so it cannot persist only part of the selection.

Task cards for missed, skipped, and shifted occurrences remain available in their dated history but use the same muted grayscale treatment as other inactive work. The **Missed** and **Shifted** labels retain their semantic colors so the resolution remains clear. Opening a missed or shifted task offers an undo action. Undoing a missed task returns it to pending; undoing a shifted program step also restores the following program schedule by one day. For dates earlier than yesterday, the task action sheet offers separate choices to undo only that day or also reset all later missed and shifted states for that task while preserving completed work and logs. Either undo choice updates its occurrences and program start date optimistically and queues one atomic transaction command.

Resolved or partially logged program occurrences anchor their historical date. If later program shifts would recalculate a different virtual step onto that same date, the Tasks view keeps the stored historical step instead of showing both cards. Empty carried work can still appear beside the day's scheduled step.

Pending and missed program-step requirements remain actionable on previous dates. Check and quantity requirements update that historical occurrence directly, while interval and Review set requirements start a session attributed to the selected program step and date. Future requirements remain unavailable.

## Health Connect

Step Counter tasks can load daily step totals from Android Health Connect after the user connects it in Settings. Health Connect does not expose screen-time or app-usage records, so Screen time is not offered as an automatically populated Duration-task unit. Supporting device screen time would require a separate Android `UsageStatsManager` integration and usage-access permission.
