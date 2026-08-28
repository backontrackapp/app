# Forms

Create and edit forms use the shared action panel for destructive, cancel, and primary actions. On Android, the panel remains visible and docks above the software keyboard while a field is focused; other sticky page actions continue to hide so they do not obstruct the focused field.

Cancel exits immediately when a form is unchanged. After any field differs from its initialized or saved value, Cancel asks the user to confirm that they want to discard their unsaved changes.

After a form save succeeds, the shared bottom snackbar identifies both the saved record type and its name, for example `Task “Morning walk” saved.` Names are collapsed to one line and shortened when necessary. Untitled reflections use the beginning of their body, and form-like log actions use the tracker or image-log label. This confirmation survives route navigation and is shown for create and edit flows, reusable dialogs, and in-session settings forms.

Emoji fields use the shared `EmojiSelector` component. Its outlined button shows the selected emoji and human-readable icon name, then opens a searchable, vertically scrollable dialog containing every standard Unicode emoji and skin-tone variant. The search field receives focus when the dialog opens. Results use human-readable labels and a virtual list so only the visible options are mounted. The emoji dataset is loaded the first time a selector without a saved value opens, and saved values preload it so their names can be shown; loaded data is reused by every selector instance.
