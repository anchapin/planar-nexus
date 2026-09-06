# Frontend result — Issue #1546 (deck-builder undo/redo)

## Status

- ✅ COMPLETE — typecheck green, lint clean (0 errors, no new warnings), 9,924/9,935 jest tests pass (11 pre-existing skipped; 1 pre-existing `coach-conversation-storage` failure from #1634 tolerated per task instructions).
- Branch: `fix/issue-1546-meta-coverage`
- Commit SHA: (filled in after commit)
- Files changed:
  - **NEW** `src/app/(app)/deck-builder/_lib/use-deck-history.ts` — `useReducer`-based history hook with bounded past/future stacks.
  - **NEW** `src/app/(app)/deck-builder/_lib/__tests__/use-deck-history.test.tsx` — 17 unit tests covering record/undo/redo, bounded stack (50), session isolation, reset, announcement strings.
  - **MODIFIED** `src/app/(app)/deck-builder/_lib/deck-builder-shortcuts.ts` — added `{ type: "undo" }` and `{ type: "redo" }` to `DeckBuilderShortcutAction`; resolve Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z → redo, Ctrl/Cmd+Y → redo. `isEditableTarget` guard already prevents text-input undo collisions (acceptance #7).
  - **MODIFIED** `src/app/(app)/deck-builder/_lib/use-deck-builder-shortcuts.ts` — added optional `undo?: () => void` and `redo?: () => void` handler slots wired through the keydown listener.
  - **MODIFIED** `src/app/(app)/deck-builder/_lib/__tests__/deck-builder-shortcuts.test.ts` — added 12 tests covering undo/redo keybinding + editable-target guard.
  - **MODIFIED** `src/app/(app)/deck-builder/page.tsx` — wired `useDeckHistory`, `handleUndo` / `handleRedo` callbacks, recorded history at every mutation site (addCardToDeck, removeCardFromDeck, clearDeck, handleShortcutRemove, addCardToSideboard, removeCardFromSideboard, importDeck, loadDeck), added a separate `role="status"` / `aria-live="polite"` live region for undo/redo announcements.
  - **MODIFIED** `src/app/(app)/deck-builder/_components/import-export-controls.tsx` — replaced "This cannot be undone" copy with "You can restore the previous deck with Ctrl+Z (⌘+Z on macOS) immediately after."
  - **MODIFIED** `docs/USER_GUIDE.md` — added `Ctrl+Z / ⌘+Z` (undo), `Ctrl+Shift+Z / ⌘+Shift+Z` (redo), `Ctrl+Y / ⌘+Y` (redo) rows to the Deck Builder Shortcuts table.

## History design

- **Bounded stack**: `MAX_HISTORY_SIZE = 50`. The 51st `recordEdit` evicts the oldest snapshot from `past` via `slice(-MAX_HISTORY_SIZE)`. (Issue acceptance #5.)
- **Per-session**: hook state lives in component memory only; no IndexedDB persistence. A fresh mount (page reload, navigation) starts with empty `past` / `future`. (Issue acceptance #6.)
- **Per-edit semantics**: `recordEdit(description, prevDeck, prevSideboard)` snapshots the state being replaced; new edits clear the redo stack (standard editor behavior).
- **Snapshot shape**: `{ deck: DeckCard[]; sideboard: DeckCard[]; description: string }`. The `description` surfaces in the ARIA live region.
- **Reducer pattern**: `useReducer(historyReducer, initialState)`. The reducer is pure and synchronous, so two rapid `Ctrl+Z` presses are processed in order without race conditions.

## Keyboard binding

| Binding                                                                         | Action                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Ctrl+Z` / `⌘+Z`                                                                | Undo last deck / sideboard edit                         |
| `Ctrl+Shift+Z` / `⌘+Shift+Z`                                                    | Redo (platform standard)                                |
| `Ctrl+Y` / `⌘+Y`                                                                | Redo (Windows convention)                               |
| Any of the above while focus is in `<input>` / `<textarea>` / `contenteditable` | Native browser input undo fires (no deck history touch) |

All bindings go through `resolveDeckBuilderShortcut`, which already had the `isEditableTarget` guard from the existing deck-builder-shortcuts module — that guard delegates input-undo to the browser (issue acceptance #7).

## ARIA live region

A separate `role="status" aria-live="polite" aria-atomic="true" className="sr-only"` div (`id="deck-builder-history-announcement"`) renders the hook's `announcement` string. The string is `"Undo: <description>"` or `"Redo: <description>"`, e.g. `"Undo: Clear deck"`. Kept distinct from the drag-and-drop live region (issue #1545) so the two streams don't overwrite each other.

## Test status

- `npm run typecheck` — ✅ 0 errors
- `npm run lint` — ✅ 0 errors, no new warnings on changed files
- `npx jest --testPathPatterns="deck-builder|use-deck-history"` — ✅ 16 suites / 192 tests pass (includes 17 new history tests + 12 new shortcut tests = 29 new tests)
- Full `jest` (excluding tolerated `coach-conversation-storage`) — ✅ 481 suites / 9,924 tests pass / 11 skipped
- Pre-existing tolerated failures (left as-is per task spec):
  - `coach-conversation-storage` "auto-resumes the most recent conversation" — known from #1634.

## Acceptance criteria checklist

- [x] AC #1: undo restores previous deck after an add.
- [x] AC #2: redo restores after undo (`Ctrl+Shift+Z` and `Ctrl+Y` both wired).
- [x] AC #3: undoing a "Clear" restores the 60-card deck (we now record the pre-clear snapshot in `clearDeck`).
- [x] AC #4: undoing an import restores the pre-import deck (`importDeck` now records the snapshot).
- [x] AC #5: bounded at 50 entries (`MAX_HISTORY_SIZE = 50`, evicts oldest on overflow).
- [x] AC #6: history is per-session, no IndexedDB persistence.
- [x] AC #7: `isEditableTarget` guard delegates to native browser input undo.
- [x] AC #8: ARIA live region announces `"Undo: <description>"` / `"Redo: <description>"`.

## Blockers

- None.

## Out-of-scope dependencies / notes for other agents

- The `coach-conversation-storage` test failure (#1634) remains tolerated; not touched here.
- `BACKEND_ONLY_PLUGINS` already includes `"window-state"` (verified `tests/capability-audit.test.ts:127`); no edit needed.
- The drag-and-drop hook (`use-deck-builder-drag-drop.ts`) calls `addCardToDeck` / `addCardToSideboard`, which now record history automatically — drag-and-drop drops are undoable through Ctrl+Z with no further wiring needed.
