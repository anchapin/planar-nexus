/**
 * @fileOverview Bounded undo/redo history for the deck-builder's
 * `deck` + `sideboard` state (issue #1546).
 *
 * Design:
 * - The hook tracks two bounded stacks (`past`, `future`). Each entry holds a
 *   snapshot of the deck and sideboard that the next mutation will replace.
 * - `recordEdit(description, prevDeck, prevSideboard)` is called by the
 *   page **before** mutating `setDeck` / `setSideboard`. It pushes the
 *   pre-mutation snapshot onto `past` and clears `future` (a new edit
 *   invalidates the redo stack — standard undo semantics).
 * - `undo(currentDeck, currentSideboard)` pops `past`, pushes the supplied
 *   `currentDeck` / `currentSideboard` onto `future`, and returns the popped
 *   snapshot so the caller can `setDeck` / `setSideboard` to it.
 * - `redo(currentDeck, currentSideboard)` is the mirror.
 * - `MAX_HISTORY_SIZE` bounds the stack. The oldest snapshot is evicted when
 *   the 51st edit is recorded (issue acceptance criterion #5).
 *
 * The hook does **not** own `deck` / `sideboard` state — the page does. We
 * only snapshot what the caller tells us to snapshot. This keeps the
 * existing useState-based deck/sideboard wiring untouched and avoids
 * duplicating every legality / max-copies check.
 *
 * Per issue #1546 the history is **per-session, in-memory only** — no
 * IndexedDB persistence is wired (acceptance criterion #6). The hook's state
 * dies with the page unmount.
 */

import { useCallback, useReducer } from "react";
import type { DeckCard } from "@/lib/card-database";

/** Maximum number of undo snapshots retained. Issue #1546 acceptance #5. */
export const MAX_HISTORY_SIZE = 50;

export interface HistoryEntry {
  /** Snapshot of `deck` BEFORE the recorded edit was applied. */
  deck: DeckCard[];
  /** Snapshot of `sideboard` BEFORE the recorded edit was applied. */
  sideboard: DeckCard[];
  /**
   * Human-readable description of the action (e.g. "Add Lightning Bolt",
   * "Clear deck"). Surfaces in the ARIA live region for non-visual users
   * and in any future UI affordance that lists undo/redo history.
   */
  description: string;
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Latest announcement for the ARIA live region. */
  announcement: string;
}

type HistoryAction =
  | { type: "record"; entry: HistoryEntry }
  | {
      type: "undo";
      currentDeck: DeckCard[];
      currentSideboard: DeckCard[];
    }
  | {
      type: "redo";
      currentDeck: DeckCard[];
      currentSideboard: DeckCard[];
    }
  | { type: "reset" };

function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "record": {
      const next = [...state.past, action.entry];
      // Bound the stack: drop the oldest entry when we exceed the limit.
      const trimmed =
        next.length > MAX_HISTORY_SIZE ? next.slice(-MAX_HISTORY_SIZE) : next;
      return {
        past: trimmed,
        // A fresh edit invalidates the redo stack (standard editor semantics).
        future: [],
        // Keep any in-flight announcement so the live region doesn't flicker.
        announcement: state.announcement,
      };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const last = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        future: [
          {
            deck: action.currentDeck,
            sideboard: action.currentSideboard,
            description: last.description,
          },
          ...state.future,
        ],
        announcement: `Undo: ${last.description}`,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [
          ...state.past,
          {
            deck: action.currentDeck,
            sideboard: action.currentSideboard,
            description: next.description,
          },
        ],
        future: state.future.slice(1),
        announcement: `Redo: ${next.description}`,
      };
    }
    case "reset":
      return { past: [], future: [], announcement: "" };
  }
}

const INITIAL_HISTORY_STATE: HistoryState = {
  past: [],
  future: [],
  announcement: "",
};

export interface UseDeckHistoryResult {
  /** Snapshots available for undo, oldest first. */
  past: HistoryEntry[];
  /** Snapshots available for redo, newest first. */
  future: HistoryEntry[];
  /**
   * Most recent announcement ("Undo: …" / "Redo: …") — wire this to an
   * aria-live region so screen readers narrate each revert (issue #1546
   * acceptance criterion #8).
   */
  announcement: string;
  /**
   * Snapshot the *current* deck/sideboard on the undo stack before the
   * caller mutates them. Clears the redo stack (a fresh edit invalidates it).
   */
  recordEdit: (
    description: string,
    prevDeck: DeckCard[],
    prevSideboard: DeckCard[],
  ) => void;
  /**
   * Pop the most recent past entry, push the supplied current state onto
   * `future`, and return the popped snapshot so the caller can apply it via
   * `setDeck` / `setSideboard`. Returns `null` when there is nothing to undo.
   */
  undo: (
    currentDeck: DeckCard[],
    currentSideboard: DeckCard[],
  ) => HistoryEntry | null;
  /**
   * Mirror of `undo`. Returns `null` when there is nothing to redo.
   */
  redo: (
    currentDeck: DeckCard[],
    currentSideboard: DeckCard[],
  ) => HistoryEntry | null;
  /** Drop all history. Called on unmount / hard state resets. */
  reset: () => void;
}

export function useDeckHistory(): UseDeckHistoryResult {
  const [state, dispatch] = useReducer(historyReducer, INITIAL_HISTORY_STATE);

  const recordEdit = useCallback(
    (description: string, prevDeck: DeckCard[], prevSideboard: DeckCard[]) => {
      dispatch({
        type: "record",
        entry: {
          deck: prevDeck,
          sideboard: prevSideboard,
          description,
        },
      });
    },
    [],
  );

  const undo = useCallback(
    (
      currentDeck: DeckCard[],
      currentSideboard: DeckCard[],
    ): HistoryEntry | null => {
      if (state.past.length === 0) return null;
      // Snapshot the entry now — `state.past` may shift under us if a
      // staggered dispatch lands before React commits this callback's return.
      const entry = state.past[state.past.length - 1];
      dispatch({ type: "undo", currentDeck, currentSideboard });
      return entry;
    },
    [state.past],
  );

  const redo = useCallback(
    (
      currentDeck: DeckCard[],
      currentSideboard: DeckCard[],
    ): HistoryEntry | null => {
      if (state.future.length === 0) return null;
      const entry = state.future[0];
      dispatch({ type: "redo", currentDeck, currentSideboard });
      return entry;
    },
    [state.future],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return {
    past: state.past,
    future: state.future,
    announcement: state.announcement,
    recordEdit,
    undo,
    redo,
    reset,
  };
}
