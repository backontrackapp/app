# Flashcards

## Curated Review sets

The lime **+ Curated** button opens a searchable catalog of Review sets prepared by the BackOnTrack team. The catalog uses a three-column desktop grid (two columns on tablets and one on phones); available card images cycle in each tile with the front text overlaid. Opening a set shows its cards in the shared flashcard table.

Before cloning, users choose the front and back languages. `front`, `back`, `transliteration`, and `notes` may each have BCP 47 language suffixes such as `front_en-US` or `notes_fr-FR`. Transliteration and notes follow the selected back language and fall back to their unsuffixed columns. Images are retained as references when cards are cloned. A full clone creates an owned selected-card Review set with the curated defaults and opens its editor; selected cards can instead be sent through the table's bulk menu to a new or existing owned custom set.

Curated source files are not database records. The API reads them from the private data directory at request time, while cloned cards and Review sets use the normal offline-first synchronization path.

## Card images

Cards accept an optional HTTPS image URL or a cropped 256 × 256 JPEG upload. Uploaded files are stored under the private data directory and served through immutable card-image URLs. Review screens render the image as a dimmed full-card background; Interval reviews use it behind the progress rings. Shared Review set editors can update images through the same set-scoped permissions as other card fields.

## AI assistant

The sparkle button between synchronization and the account menu is enabled on Flashcards and its nested card and Review set screens. It opens the flashcard assistant as a right-side panel on larger screens and a full-screen drawer on phones. The conversation lasts only for the open panel session. Its empty state offers three bullet-style example requests, and the composer keeps its microphone and send actions together inside the input.

Android and iOS users can dictate a request with the phone's speech recognizer. The operating system converts speech to text; BackOnTrack does not send raw microphone audio to its server or to OpenAI. The transcript stays in the composer so it can be reviewed or edited before sending. Typed requests remain available everywhere.

The POC declares exactly four assistant tools: list the current user's owned Review sets, read matching cards and current-user review statistics from one owned set, propose a new selected-card Review set, and propose adding cards to an owned set. The model cannot invoke undeclared CRUD operations. Read tools run automatically against the local account data. Every create or add proposal shows a preview and requires confirmation; cancellation is returned to the model as a cancelled tool result.

When a user asks the assistant to create a Review set in two languages, generated cards include a transliteration of the back-language phrase or word and a short explanation in the note field by default. An explicit request to omit or use different content for either field takes precedence.

Confirmed writes use one `flashcards.assistant_apply` offline-sync command. New cards and the selected-card Review set relationship are changed together in the local database and replayed together in one server transaction. Adding cards to a tag-based set converts it to a fixed card selection while preserving all cards that matched before the change.

The PHP server owns the OpenAI credential and calls the Responses API with response storage disabled, parallel tool calls disabled, a pseudonymous safety identifier, and strict schemas for the four declared tools. Tool results are scoped to the authenticated account before they enter the conversation. Assistant requests and confirmed writes are rate limited per account.

## Review set card actions

Selecting an owned or shared Review set card opens its action menu. **Review** is the first action, followed by the management actions available for that set's access level.

## Recent session history

Recent reviews are grouped by day, with every group collapsed by default.

Selecting a recent Review opens its action menu. **See details** reopens the saved completion summary; **Delete** asks for confirmation and removes the history item immediately. Reviews recorded inside an Interval open that Interval's details, and deleting one removes the shared Interval run from both histories. Deleting session history does not reverse task progress already recorded by the completed session.

## CSV import

Cards include an optional transliteration alongside the front, back, note, and tags. The transliteration is editable on card forms, searchable, and shown as its own column in the card manager and Review set card table.

The card importer shows an example with the `front,back,transliteration,note,tags` header and sample rows. Copy example places the displayed CSV directly on the clipboard so it can be used as a starting template. Front and back are required, while transliteration, notes, and tags are optional; imported Review set cards inherit the destination set's tags.

## Bulk column swaps

The card manager and owned Review set card table expose one **Swap column content** bulk action. Its modal can swap any two of Front, Back, Transliteration, and Note across the selected cards. Apply stays disabled when the result would leave a required face empty or move content beyond the destination column's length limit. Repeating the same swap restores the original content.

## Custom selected-card Review sets

The card manager and owned Review set card tables expose **Create Review set** in their bulk menu. The dialog can create a named Review set from the selected cards or add the selection to an existing owned custom set. When no custom set is available, the dialog keeps the new-set option selected.

Selected-card Review sets persist explicit card membership instead of deriving membership from tags. They are created from a card list's bulk menu. After creation, their editor replaces the Review set tag field with an information area explaining the custom selection; more cards can be added from the same bulk workflow.

Creating a custom Review set from the bulk dialog redirects directly to its editor. Review sets already present in the local store initialize that editor immediately, without a page-level loading state.

## Runner settings

Active Interval settings include the same Review cards section as the Interval form, so a Review set can be attached, replaced, or removed during a run. The Apply to menu in active Interval and Review set settings offers Current session, the saved Interval or Review set, and Both. Choosing Both updates the saved source and the active session snapshot so the current run reflects the new settings immediately.

## Standalone review time limits

Passive Review sets finish after a configured amount of active review time. The limit is enabled at one hour by default when Passive mode is selected and can be disabled. The Review set and active-session settings use an hours-and-minutes wheel, with limits from one minute through 23 hours 59 minutes. Paused time does not count. Reaching the limit completes the session even when cards remain, including looping reviews, and Android background playback stops at the same limit. Manual Review sets do not use a time limit. Mini Review sets inside Interval sessions continue to follow the Interval step duration instead.

## Review card ejection

Each Review set has two independent eject-button settings. With both settings cleared, eject permanently removes the current card from the active list and completes a standalone review after its last active card is ejected.

The **Load the next card** behavior is enabled by default for new Review sets. It keeps the active list filled up to the configured maximum by injecting the next ordered, matching card whenever one is ejected. For example, a 50-card Review set with a 10-card session limit keeps 10 cards active while reserve cards remain, then drains the final 10 and completes after all 50 cards have been ejected. The ordered reserve is snapshotted when standalone and mini interval sessions start, so the behavior remains deterministic and available offline.

The optional **Exclude card** behavior also adds the ejected card to the Review set's excluded cards, preventing it from appearing in future sessions. Undoing the last eject in a standalone review restores the card to the active queue and removes that exclusion.

Both settings can be enabled together so the ejected card is excluded while the active list is replenished from the ordered reserve.

Ejecting the current card advances both standalone and mini interval Review set sessions to the next available card. An injected replacement always starts at the beginning of its first configured face instead of inheriting the ejected card's face or playback progress.

Opening a Review set and starting its session use the same forward horizontal navigation as interval runners. The welcome screen remains intact while the running session enters, preventing an intermediate session-layout flash during startup; reduced-motion preferences continue to disable directional movement.

The standalone review header reports the current card's position within the live queue. Its position follows previous and next swipes, while its queue size immediately follows session-setting changes, grading, ejection, undo, card additions, and card removal.

## Standalone review motion

Automatic and manual standalone Review set changes use the same directional model: previous and next cards move down and up, while front and back faces move right and left. Motion is limited to the card value, answer, and note; the face label, replay or reveal hint, card surface, and passive progress remain stationary. Reduced-motion preferences replace the content without directional movement.

Standalone Review set sessions show the current card position centered above the card, between the review mode and elapsed time. Finite sessions advance from 1 through the session total, while indefinite sessions wrap the position at the start of each loop.

Mini Review set cards in an active Interval append the current card position to the Review set title as `(X of Y)`.

In mobile landscape, an active Interval with a Review set uses a two-pane runner. The session title and `Interval X of Y` are centered in the header between Leave and session options. The current step, its group iteration chips, the enlarged timer, and interval navigation stay centered in the left pane, while the Review set card fills the right pane. Landscape intervals without a Review set keep the standard timer-focused layout.

The full Review-set pane in a landscape Interval supports the same directional swipe navigation as the mini card in portrait and the standalone reviewer. Gesture capture belongs to the complete card surface, while eject and tag controls remain independent tap targets.
