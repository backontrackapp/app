# Journal

The reflection editor uses one archive/restore action in place of direct deletion. For a current reflection, the action asks whether to archive it or delete it permanently. Archiving removes the reflection from the main timeline while preserving its content, image, and task or tracker context. Archived reflections appear in the collapsible Archive section and can be opened to restore or permanently delete. Restoring returns a reflection to its original timeline date; permanent deletion cannot be undone.

Archived tasks and trackers are not offered in the optional **Connect this reflection** selectors. Existing connections remain identified when an older reflection is edited and can be removed without silently changing the rest of its context.

Journal reflections are created and edited in the standard authenticated app shell. On native Android and iOS, focusing the Reflection field immediately hides the app chrome and expands the field across the full usable viewport. The textarea scrolls independently for long entries and respects native safe areas. On Android, it also reserves space for the form action panel above the software keyboard so Create or Save, Cancel, and edit actions remain visible without covering the reflection.

The fullscreen editor collapses when the field blurs or when the native keyboard is dismissed. Its focus and blur transitions use the app's standard quick motion curve and are disabled when the operating system requests reduced motion. Other journal fields and desktop or web layouts retain the regular card-based editor.
