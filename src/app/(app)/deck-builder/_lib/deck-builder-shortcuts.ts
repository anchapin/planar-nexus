import type { ScryfallCard } from "@/lib/card-database";

/**
 * Resolved deck-builder shortcut action.
 *
 * Issue #1546 extended the action union with `undo` and `redo`. The
 * corresponding `Ctrl+Z` / `Cmd+Z` (undo) and `Ctrl+Shift+Z` / `Cmd+Shift+Z`
 * / `Ctrl+Y` / `Cmd+Y` (redo) bindings live in this file so the existing
 * `isEditableTarget` guard keeps text-input undo under the browser's control
 * (acceptance criterion #7).
 */
export type DeckBuilderShortcutAction =
  | { type: "addCard"; card: ScryfallCard; max: boolean }
  | { type: "removeCard"; card: ScryfallCard; all: boolean }
  | { type: "newDeck" }
  | { type: "drawSample" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "none" };

export interface DeckBuilderShortcutContext {
  /** The card currently focused/selected in the search results, if any. */
  selectedCard: ScryfallCard | null;
}

/** Element tags where keyboard input should not trigger shortcuts. */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

/** True when a key event originated from a form field / editable region. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return target.getAttribute("contenteditable") === "true";
}

/**
 * Resolve a keyboard event into a deck-builder shortcut action.
 *
 * Documented shortcuts (docs/USER_GUIDE.md §8 "Keyboard Shortcuts"):
 *   +                Add Card to Deck
 *   -                Remove Card from Deck
 *   Shift++          Add Maximum Copies
 *   Shift+-          Remove All Copies
 *   Enter            Confirm / add the focused card
 *   Ctrl/Cmd+N       New Deck
 *   Ctrl/Cmd+Z       Undo Last Edit        (issue #1546)
 *   Ctrl/Cmd+Shift+Z Redo                   (issue #1546)
 *   Ctrl/Cmd+Y       Redo                   (issue #1546)
 *   H                Draw another opening hand (Hand Test)
 *
 * On a US keyboard the unshifted "+/=" key reports "=". Shift+"=" reports "+",
 * and Shift+"-" reports "_". We therefore treat "=" as "add one" and "+" as
 * "add max" (and "-" / "_" the same way for removal) — this matches the
 * documented "+" (add) / "Shift++" (add max) pair while staying usable on the
 * physical keys people actually press.
 */
export function resolveDeckBuilderShortcut(
  event: KeyboardEvent,
  ctx: DeckBuilderShortcutContext,
): DeckBuilderShortcutAction {
  // Never fire shortcuts while the user is typing in a form field. This is
  // what stops Ctrl+Z in the deck-name input from clobbering the deck —
  // the browser's native input undo fires instead (issue #1546 acceptance
  // criterion #7).
  if (isEditableTarget(event.target)) {
    return { type: "none" };
  }

  const key = event.key;
  const modifier = event.ctrlKey || event.metaKey;

  // Ctrl/Cmd+N — New Deck (documented global shortcut).
  if (modifier && (key === "n" || key === "N")) {
    return { type: "newDeck" };
  }

  // Ctrl/Cmd+Z — Undo last deck / sideboard edit. We deliberately do NOT
  // handle Ctrl+Z when the event originated from an editable target — the
  // guard above already returned `none` in that case.
  if (modifier && !event.shiftKey && (key === "z" || key === "Z")) {
    return { type: "undo" };
  }

  // Ctrl/Cmd+Shift+Z — Redo (the platform-standard binding).
  if (modifier && event.shiftKey && (key === "z" || key === "Z")) {
    return { type: "redo" };
  }

  // Ctrl/Cmd+Y — Redo (Windows convention; many desktop apps expose both
  // Shift+Z and Y so muscle memory from either ecosystem works).
  if (modifier && !event.shiftKey && (key === "y" || key === "Y")) {
    return { type: "redo" };
  }

  // Let other modifier combos (Ctrl+S, Ctrl+F, ...) be handled by their own
  // listeners so we never double-trigger documented global shortcuts.
  if (modifier) {
    return { type: "none" };
  }

  const { selectedCard } = ctx;

  // "+" (Shift held on US layout) -> add maximum; "=" (unshifted) -> add one.
  if (key === "+" || key === "=") {
    if (!selectedCard) return { type: "none" };
    return { type: "addCard", card: selectedCard, max: key === "+" };
  }

  // "_" (Shift held) -> remove all; "-" (unshifted) -> remove one.
  if (key === "-" || key === "_") {
    if (!selectedCard) return { type: "none" };
    return { type: "removeCard", card: selectedCard, all: key === "_" };
  }

  // Enter — confirm / add the focused card (mirrors the in-search Enter which
  // adds the highlighted result).
  if (key === "Enter") {
    if (!selectedCard) return { type: "none" };
    return { type: "addCard", card: selectedCard, max: false };
  }

  // H — draw another opening hand in the Hand Test goldfish simulator
  // (issue #1439). No card selection required.
  if (key === "h" || key === "H") {
    return { type: "drawSample" };
  }

  return { type: "none" };
}
