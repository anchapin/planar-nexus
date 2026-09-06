/**
 * @fileOverview Pure reducer + helpers for the deck-builder keyboard /
 * pointer drag-and-drop flow (issue #1545).
 *
 * Why a separate module?
 * - The carry/drop state transitions are pure (no DOM, no React) and trivially
 *   unit-testable. Lifting the logic out of the React hook lets us assert the
 *   state machine exhaustively without rendering anything.
 * - The same state shape is used by both keyboard (M/Enter/Escape/arrows) and
 *   pointer (HTML5 drag-and-drop) paths, so the reducer is the single source
 *   of truth and the React hook is a thin event-binding shell.
 *
 * State machine (input → output):
 *   idle  --pickUp(card, copies)-->  carrying (target = defaultTarget)
 *   carrying  --switchTarget(dir)--> carrying (target cycles)
 *   carrying  --drop()-->  idle (caller applies the actual deck mutation)
 *   carrying  --cancel()--> idle
 *
 * The reducer never mutates the deck itself — it only tracks the carry / target
 * state. The caller (the page-level hook) is responsible for invoking the
 * `addCardToDeck` / `addCardToSideboard` mutation when `drop()` fires so the
 * reducer stays decoupled from format legality, copy caps and toasts.
 */

import type { ScryfallCard } from "@/lib/card-database";

/** Which list the carried card is currently aimed at. */
export type DeckBuilderDropTarget = "mainboard" | "sideboard";

/** How many copies `pickUp` intends to add (mirrors shift+click = 4-of). */
export type DeckBuilderDropCopies = 1 | 4;

/**
 * Snapshot of the carry state. `null` `carriedCard` means "not carrying".
 */
export interface DeckBuilderDragDropState {
  carriedCard: ScryfallCard | null;
  copies: DeckBuilderDropCopies;
  /**
   * The drop target the carried card is currently aimed at. Always defaults
   * to `mainboard` after pickUp; arrow keys cycle. When the active format has
   * no sideboard the hook filters `sideboard` out so the reducer still sees a
   * 2-cycle shape but the UI never offers that option.
   */
  target: DeckBuilderDropTarget;
}

/** All possible actions on the carry state. */
export type DeckBuilderDragDropAction =
  | {
      type: "pickUp";
      card: ScryfallCard;
      copies: DeckBuilderDropCopies;
      defaultTarget: DeckBuilderDropTarget;
    }
  | { type: "switchTarget"; direction: "next" | "previous" }
  | { type: "drop" }
  | { type: "cancel" };

/** Initial state: nothing carried. */
export const initialDeckBuilderDragDropState: DeckBuilderDragDropState = {
  carriedCard: null,
  copies: 1,
  target: "mainboard",
};

/**
 * Reduce a `DeckBuilderDragDropAction` to a new state. Pure — no side effects.
 *
 * `switchTarget` cycles through `mainboard` → `sideboard` → `mainboard` in the
 * "next" direction and the reverse for "previous". This is the WAI-ARIA
 * recommended pattern for keyboard-driven drag-and-drop: the source element
 * retains focus and arrow keys cycle through the available drop targets.
 *
 * `drop` and `cancel` always transition to the initial state; the caller is
 * responsible for the actual deck mutation when `drop` fires (it returns the
 * carried card + copies + target, then resets).
 */
export function deckBuilderDragDropReducer(
  state: DeckBuilderDragDropState,
  action: DeckBuilderDragDropAction,
): DeckBuilderDragDropState {
  switch (action.type) {
    case "pickUp":
      // Picking up a different card while already carrying replaces the carry.
      // Picking up the SAME card keeps the existing target (less surprising
      // than resetting focus) and accepts the new copy count.
      if (
        state.carriedCard &&
        state.carriedCard.id === action.card.id &&
        state.copies === action.copies
      ) {
        return state;
      }
      return {
        carriedCard: action.card,
        copies: action.copies,
        target: action.defaultTarget,
      };

    case "switchTarget": {
      if (!state.carriedCard) return state;
      const direction = action.direction === "next" ? 1 : -1;
      // 2-element cycle; mainboard <-> sideboard. The hook (which knows about
      // the active format) is responsible for never surfacing `sideboard` when
      // the format doesn't support one — the reducer still cycles correctly.
      const cycle: DeckBuilderDropTarget[] = ["mainboard", "sideboard"];
      const idx = cycle.indexOf(state.target);
      // idx should always be 0 or 1 — fall back to 0 defensively.
      const nextIdx =
        ((idx === -1 ? 0 : idx) + direction + cycle.length) % cycle.length;
      return { ...state, target: cycle[nextIdx] };
    }

    case "drop":
      // Reset to initial state. The caller already read `carriedCard`,
      // `copies` and `target` before dispatching `drop`, so resetting here
      // simply signals "carry is over".
      return initialDeckBuilderDragDropState;

    case "cancel":
      return initialDeckBuilderDragDropState;
  }
}

/**
 * Build the human-readable announcement for screen readers. Matches the
 * wording called out in issue #1545's acceptance criteria:
 *   "Holding <card name>. Press arrows to choose target, Enter to add,
 *    Escape to cancel."
 *
 * The target label is localised at the call site (the page knows the format's
 * naming for "Mainboard" vs "Sideboard"), so we accept it as a parameter.
 */
export function buildPickUpAnnouncement(
  card: ScryfallCard,
  copies: DeckBuilderDropCopies,
  targetLabel: string,
): string {
  const copySuffix = copies > 1 ? ` (${copies} copies)` : "";
  return `Holding ${card.name}${copySuffix}. Current target: ${targetLabel}. Press Arrow keys to choose target, Enter to add, Escape to cancel.`;
}

/**
 * Build the announcement when the drop target cycles, e.g.
 *   "Target: Sideboard."
 */
export function buildTargetChangeAnnouncement(targetLabel: string): string {
  return `Target: ${targetLabel}.`;
}
