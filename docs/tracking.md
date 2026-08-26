# Tracking insights

The tracker editor uses one archive/restore action in place of direct deletion. For an active or paused tracker, the action asks whether to archive it or delete it permanently. Archiving removes the tracker from logging, charts, and new attachment choices while preserving its definition, active or paused state, and logs. Archived trackers appear in the collapsible Archive section and can be opened to restore or permanently delete. Permanent deletion removes the tracker and all of its logs.

The factor selector groups device-derived wellbeing data under **Health Connect**. Steps are read as daily aggregates from Health Connect. Screen time is measured from Android screen-interactive usage events and requires Usage Access because Health Connect does not define a screen-time record.

Both device factors are quantitative. Insights load one value per local calendar day in the selected range, use `steps` and `minutes` as their respective units, and refresh the current day's cached value after one minute. The current day's screen-time range ends at the current instant so an ongoing interactive session never counts future time through midnight.

When Android Usage Access is enabled, the main Tracking page also loads screen time for the visible week and shows it as a duration series in the weekly chart. Future dates are not requested. Like tracker series, screen time can be hidden or restored from the chart legend.

The main Tracking page lists the outcome group (**How you felt**) above the factor group (**Things you did**) and keeps tracker cards focused on starting a new log and managing the tracker. Cards with an entry on the selected date are greyed out, while remaining available for additional entries and tracker actions. Entries for the selected date appear together in a chronological **Log** section below both tracker groups. Selecting a log opens it for editing, and days without entries show an explicit empty state.

Archived trackers, tasks, intervals, and Review sets are excluded from the factor and outcome selectors. Their historical logs remain available elsewhere in the application.

Swiping left across **Things you did**, **How you felt**, or the **Log** section advances to the next date, while swiping right returns to the previous date. All three date-dependent sections move in together from the navigation direction with a quick horizontal transition, and a centered card briefly confirms the selected date before fading away.

Tracker cards can be reordered within their **Things you did** or **How you felt** group by pressing and holding, then dragging. Cards animate into their prospective grid positions while dragging, with row-aware targeting for stable vertical movement across the grid. The new order is applied immediately and saved through the offline-first data layer; if persistence fails, the previous order is restored and an error is shown.

The weekly chart uses the full SVG width without a horizontal plot inset. It keeps its grid, day labels, and chart-series multi-select visible while a week is loading instead of replacing the chart with a skeleton. When the selected week has no entries, its empty state appears above the series selector. The compact selector has no entrance transition, shows series colors in its dense list and x-small tonal selected chips, displays at most two selected series, and summarizes the remainder as an overflow count. When loading finishes, bars animate up from the baseline; devices that request reduced motion receive the final state immediately.
