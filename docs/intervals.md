# Intervals

Saved intervals support an optional emoji and selectable color as visual anchors. The editor places the shared emoji selector button directly above the color picker. Active interval cards show the selected emoji against that color and fall back to the timer icon when no emoji is selected; archived cards retain their archive status icon. Duplicating an interval preserves both its emoji and color.

The interval editor does not expose the former optional template description field. Existing stored descriptions remain intact when another interval setting is edited.

Interval steps use their selected preset type as the step name. The editable **Interval name** field is shown only for the **Custom** type; selecting any preset replaces the stored name with that preset's label.

The interval editor uses one archive/restore action in place of direct deletion. For an active interval, the action asks whether to archive it or delete it permanently. Archiving removes the template from interval plans and new attachment choices while preserving its definition and completed run history. Archived intervals appear in the collapsible Archive section and can be opened to restore or permanently delete. Permanent deletion removes the reusable template while completed runs keep their snapshots.

## Interval card actions

Selecting an interval card opens its action menu. **Play** is the first action, followed by Edit and Duplicate. Archiving or permanently deleting an interval remains available from its editor.

Starting a saved or Quick interval while another interval is active opens a warning instead of resuming the existing run. Confirming ends the active run and continues with the selected interval; cancelling leaves the active run unchanged.

When an interval is opened from a task, its start panel shows the task name beneath the interval summary. Standalone interval launches omit this task context.

The start panel remains mounted until the running route has committed. Start, active, and completion screens follow one forward horizontal transition: the next screen enters from the right while the previous screen exits left. The panels remain pinned to the same layout area instead of rendering an empty intermediate frame or shifting the page. Reduced-motion preferences keep the crossfade without directional movement.

## Interval sounds

Settings provides a sound choice for each interval type. In addition to packaged cues and a silent option, **Speak Step Name** uses text-to-speech to announce the interval step's title when that step begins. Its preview announces the interval type name. The first step is cued when a saved, quick, or repeated interval starts, and each later step is cued when the run advances; navigating backward remains silent. Spoken step names also work while an interval runs in the background on Android.

## Recent run history

Recent runs are grouped by day, with every group collapsed by default.

Runs created from an interval that has since been archived remain in recent history without an archive tag.

Selecting a recent run opens its action menu. **See details** reopens the saved completion summary; **Delete** asks for confirmation and removes the run from history immediately. Deleting a run also removes any Review history derived from that Interval, but does not reverse task progress already recorded by the completed session.

When a completed or ended interval is not attributed to an exercise, the interval name remains the standalone completion title in both portrait and landscape. Exercise-attributed runs use the exercise identity as the title and keep the interval name as supporting source context.
