"use client";

/**
 * @fileOverview React hook that wires the pure deck-builder drag-drop reducer
 * to keyboard events, HTML5 drag-and-drop events, and an ARIA live region for
 * screen-reader announcements. See `deck-builder-drag-drop.ts` for the
 * reducer + state machine.
 *
 * This hook is the *only* place where DOM events meet the carry state. The
 * page-level component consumes the returned bindings (handlers + refs) and
 * forwards them to `CardResultTile`, `DeckList`, and `SideboardList`.
 *
 * Why an aria-live region instead of `aria-grabbed` / `aria-dropeffect`?
 * `aria-grabbed` and `aria-dropeffect` were deprecated in WAI-ARIA 1.1; the
 * modern WAI-ARIA Authoring Practices "Drag-and-Drop" pattern uses a live
 * region for state announcements (which is what this hook exposes via
 * `announcement`) plus `role` / `aria-label` on source and targets. See
 * https://www.w3.org/WAI/ARIA/apg/patterns/drag-and-drop/ .
 *
 * Keyboard model (documented in docs/USER_GUIDE.md, see issue #1545):
 *   M (when focused on a search-result tile) → pick up the focused card
 *   Shift+M                                 → pick up with 4-of intent
 *   ArrowDown / ArrowUp while carrying      → cycle target mainboard ↔ sideboard
 *   Enter while carrying                    → drop into the current target (1)
 *   Shift+Enter while carrying              → drop into the current target (4)
 *   Space while carrying                    → same as Enter (WAI-ARIA standard)
 *   Escape while carrying                   → cancel the carry
 *
 * The hook does NOT install its own window-level keydown listener; instead it
 * exposes a `handleKeyDown(event)` function that the host page calls from its
 * single, ordered keydown listener. This avoids listener-ordering conflicts
 * with other page-level shortcuts (Ctrl+S, Ctrl+F, Escape-for-dialog).
 *
 * Pointer model:
 *   dragstart on a search-result tile → set carry (1 copy)
 *   dragstart with Shift held         → set carry (4 copies)
 *   drop on DeckList / SideboardList  → drop into that list
 *   Escape or dragend without drop    → cancel
 */

import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ScryfallCard } from "@/lib/card-database";
import {
  buildPickUpAnnouncement,
  buildTargetChangeAnnouncement,
  deckBuilderDragDropReducer,
  initialDeckBuilderDragDropState,
  type DeckBuilderDragDropState,
  type DeckBuilderDropCopies,
  type DeckBuilderDropTarget,
} from "./deck-builder-drag-drop";

/**
 * DataTransfer payload key used to round-trip the carried card id between
 * `dragstart` and `drop`. The full ScryfallCard is *not* serialised into the
 * DataTransfer (DataTransfer.getData is lossy and stringly-typed) — instead
 * the source stores the payload in a ref-backed Map keyed by the card id, and
 * the drop target reads it back via `getDragPayload(cardId)`.
 */
export const DECK_BUILDER_DRAG_PAYLOAD_PREFIX = "application/x-planar-card-id:";

/** Test-only: read a `cardId` out of a `DataTransfer`-shaped object. */
export function readCardIdFromDataTransfer(
  data: { getData: (type: string) => string } | null | undefined,
): string | null {
  if (!data) return null;
  try {
    const raw = data.getData("text/plain") || data.getData("text");
    if (!raw) return null;
    return raw;
  } catch {
    return null;
  }
}

export interface UseDeckBuilderDragDropOptions {
  /** Whether the active format supports a sideboard. */
  supportsSideboard: boolean;
  /**
   * Called when the user commits a drop (Enter on a target, or pointer drop).
   * The handler is responsible for invoking the actual deck mutation
   * (addCardToDeck / addCardToSideboard) and for surfacing toasts.
   */
  onDrop: (payload: {
    card: ScryfallCard;
    copies: DeckBuilderDropCopies;
    target: DeckBuilderDropTarget;
  }) => void;
  /** Called when the user cancels a carry (Escape or dragend without drop). */
  onCancel?: () => void;
}

export interface UseDeckBuilderDragDropResult {
  /** Current carry state. */
  state: DeckBuilderDragDropState;
  /** Whether a card is currently being carried (either keyboard or pointer). */
  isCarrying: boolean;
  /** The card currently being carried, or `null`. */
  carriedCard: ScryfallCard | null;
  /** The current drop target while carrying. */
  target: DeckBuilderDropTarget;
  /** The number of copies `pickUp` intends to add (1 or 4). */
  copies: DeckBuilderDropCopies;
  /** Screen-reader announcement text. Re-announced on every change. */
  announcement: string;
  /**
   * Drag handlers to spread on a `CardResultTile`'s root button. They wire the
   * HTML5 drag-and-drop source events to the carry state.
   */
  sourceDragHandlers: {
    draggable: true;
    onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnd: (event: ReactDragEvent<HTMLElement>) => void;
  };
  /**
   * Drop handlers to spread on `DeckList` and `SideboardList` wrappers so
   * they accept dropped cards from the search results.
   */
  targetDropHandlers: {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
  };
  /**
   * Single keydown handler the host page installs on `window`. Returns
   * `true` if the event was consumed by the drag-drop flow so the page can
   * skip its other handlers (e.g. Escape closes dialogs only when the
   * carry isn't being cancelled).
   */
  handleKeyDown: (event: KeyboardEvent | ReactKeyboardEvent) => boolean;
  /** Programmatic pick-up (used by the `M` shortcut handler in the page). */
  pickUp: (card: ScryfallCard, copies: DeckBuilderDropCopies) => void;
  /** Programmatic cycle of the current target zone. */
  switchTarget: (direction: "next" | "previous") => void;
  /** Programmatic commit (used by the Enter handler in the page). */
  commitDrop: (copiesOverride?: DeckBuilderDropCopies) => void;
  /** Programmatic cancel (used by the Escape handler in the page). */
  cancel: () => void;
}

/**
 * Returns the default target — `mainboard` for every format. The hook filters
 * `sideboard` out of the available cycle when `supportsSideboard` is false
 * (Commander family formats don't have a sideboard per the format rules).
 */
function defaultTarget(): DeckBuilderDropTarget {
  return "mainboard";
}

/**
 * Human label for the current target, used in ARIA live announcements.
 */
function targetLabel(target: DeckBuilderDropTarget): string {
  return target === "mainboard" ? "Mainboard" : "Sideboard";
}

/**
 * Validates that the requested target is allowed in the current format.
 * Returns the effective target (defaults to `mainboard` if the requested
 * target is `sideboard` but the format has no sideboard).
 */
function effectiveTarget(
  requested: DeckBuilderDropTarget,
  supportsSideboard: boolean,
): DeckBuilderDropTarget {
  if (requested === "sideboard" && !supportsSideboard) return "mainboard";
  return requested;
}

/**
 * Filter the reducer's `switchTarget` output so `sideboard` is never returned
 * for formats that don't support it. The reducer still cycles correctly
 * because we only ever present 1 or 2 options to the user.
 */
function cycleTarget(
  state: DeckBuilderDragDropState,
  direction: "next" | "previous",
  supportsSideboard: boolean,
): DeckBuilderDropTarget {
  if (!supportsSideboard) return "mainboard";
  return direction === "next"
    ? state.target === "mainboard"
      ? "sideboard"
      : "mainboard"
    : state.target === "sideboard"
      ? "mainboard"
      : "sideboard";
}

export function useDeckBuilderDragDrop(
  options: UseDeckBuilderDragDropOptions,
): UseDeckBuilderDragDropResult {
  const { supportsSideboard, onDrop, onCancel } = options;

  const [state, dispatch] = useReducer(
    deckBuilderDragDropReducer,
    initialDeckBuilderDragDropState,
  );

  // Pointer carries use the same reducer but bypass keyboard listeners.
  // We keep a separate ref so the drop handler can look up the card payload
  // by id (DataTransfer cannot safely round-trip a ScryfallCard object).
  const pointerPayloadRef = useRef<{
    card: ScryfallCard;
    copies: DeckBuilderDropCopies;
  } | null>(null);

  // Most recent announcement text. The page renders this inside an
  // `aria-live="polite"` region so screen readers pick up state transitions
  // without us having to call into a portal.
  const announcementRef = useRef<string>("");
  // We trigger a React re-render after announcement mutations by bumping a
  // counter — useReducer's state already does this for the carry state, but
  // the announcement text is derived (not stored) so we need a separate
  // signal for pure keyboard announcements that don't change carry state.
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);
  const setAnnouncement = useCallback((text: string) => {
    if (text === announcementRef.current) return;
    announcementRef.current = text;
    forceRerender();
  }, []);

  // Pick up a card programmatically (keyboard path).
  const pickUp = useCallback(
    (card: ScryfallCard, copies: DeckBuilderDropCopies) => {
      const target = effectiveTarget(defaultTarget(), supportsSideboard);
      dispatch({
        type: "pickUp",
        card,
        copies,
        defaultTarget: target,
      });
      setAnnouncement(
        buildPickUpAnnouncement(card, copies, targetLabel(target)),
      );
    },
    [setAnnouncement, supportsSideboard],
  );

  // Cycle the target. Keeps `sideboard` out of the cycle for formats without
  // a sideboard; keeps the announcement in sync so screen readers hear it.
  const switchTarget = useCallback(
    (direction: "next" | "previous") => {
      // Manual cycle (the reducer's `switchTarget` is allowed to return
      // `sideboard`; we override here so the hook stays format-aware).
      dispatch({ type: "switchTarget", direction });
      // Compute the *next* label off the current state — the reducer's
      // state update is batched so we compute against the current snapshot
      // and the next render will pick up the actual new target. For
      // announcement purposes the prediction is good enough.
      const next = cycleTarget(state, direction, supportsSideboard);
      setAnnouncement(buildTargetChangeAnnouncement(targetLabel(next)));
    },
    [setAnnouncement, state, supportsSideboard],
  );

  // Commit the carry. Returns nothing — the caller wires `onDrop` to perform
  // the actual deck mutation.
  const commitDrop = useCallback(
    (copiesOverride?: DeckBuilderDropCopies) => {
      if (!state.carriedCard) return;
      const target = effectiveTarget(state.target, supportsSideboard);
      const copies = copiesOverride ?? state.copies;
      onDrop({ card: state.carriedCard, copies, target });
      dispatch({ type: "drop" });
      setAnnouncement("");
    },
    [onDrop, setAnnouncement, state, supportsSideboard],
  );

  // Cancel the carry.
  const cancel = useCallback(() => {
    if (!state.carriedCard) return;
    dispatch({ type: "cancel" });
    onCancel?.();
    setAnnouncement("");
  }, [onCancel, setAnnouncement, state.carriedCard]);

  // Single keydown handler. The page installs this from its main keydown
  // listener so the carry state can short-circuit Escape / Enter / Space /
  // arrow handling *before* the page-level dialog or shortcut handlers run.
  //
  // Returns `true` when the event was consumed so the page can skip its
  // own handlers (e.g. don't close the import dialog if Escape just
  // cancelled a carry).
  const handleKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent): boolean => {
      // Form-field safety: never intercept typing in inputs.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
          return false;
        if (target.isContentEditable) return false;
        if (target.getAttribute("contenteditable") === "true") return false;
      }
      // Modifier combos other than Shift are owned by other handlers.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      // Escape: cancel any active carry. MUST be evaluated first so the
      // page-level Escape handler (which closes dialogs) is suppressed when
      // a carry is being cancelled.
      if (event.key === "Escape" && state.carriedCard) {
        event.preventDefault();
        cancel();
        return true;
      }

      // Pick-up: `M` while NOT carrying and a card is currently focused in
      // the search results. The host page supplies the focused card via a
      // closure so we don't need to know about CardSearch's selection model.
      if (event.key === "m" || event.key === "M") {
        if (state.carriedCard) return false;
        const focused = (
          typeof document !== "undefined" ? document.activeElement : null
        ) as (HTMLElement & { __deckBuilderCard?: ScryfallCard }) | null;
        const card = focused?.__deckBuilderCard;
        if (!card) return false;
        event.preventDefault();
        pickUp(card, event.shiftKey ? 4 : 1);
        return true;
      }

      // Only intercept the rest when carrying.
      if (!state.carriedCard) return false;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        switchTarget(event.key === "ArrowDown" ? "next" : "previous");
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        commitDrop(event.shiftKey ? 4 : 1);
        return true;
      }

      if (event.key === " " || event.key === "Spacebar") {
        // Space is the documented WAI-ARIA drop activator. Mirror Enter.
        event.preventDefault();
        commitDrop(event.shiftKey ? 4 : 1);
        return true;
      }

      return false;
    },
    [cancel, commitDrop, pickUp, state.carriedCard, switchTarget],
  );

  // ---- Pointer (HTML5) drag-and-drop wiring -------------------------------

  const sourceDragHandlers = useMemo(
    () => ({
      draggable: true as const,
      onDragStart: (event: ReactDragEvent<HTMLElement>) => {
        const card = (
          event.currentTarget as HTMLElement & {
            __deckBuilderCard?: ScryfallCard;
          }
        ).__deckBuilderCard;
        if (!card) return;
        const copies: DeckBuilderDropCopies = event.shiftKey ? 4 : 1;
        pointerPayloadRef.current = { card, copies };
        // Round-trip the card id via text/plain so the drop target can
        // locate the right payload. text/plain is the lowest-common-
        // denominator MIME that all browsers populate reliably.
        try {
          event.dataTransfer.setData("text/plain", card.id);
          event.dataTransfer.effectAllowed = "copy";
        } catch {
          // Some browsers reject setData on synthetic events — fall back
          // to the ref-only path.
        }
        const target = effectiveTarget(defaultTarget(), supportsSideboard);
        dispatch({ type: "pickUp", card, copies, defaultTarget: target });
        setAnnouncement(
          buildPickUpAnnouncement(card, copies, targetLabel(target)),
        );
      },
      onDragEnd: () => {
        // If the drag ended without a drop being handled, clear the carry.
        if (pointerPayloadRef.current) {
          pointerPayloadRef.current = null;
          dispatch({ type: "cancel" });
          setAnnouncement("");
        }
      },
    }),
    [setAnnouncement, supportsSideboard],
  );

  const targetDropHandlers = useMemo(
    () => ({
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        if (!pointerPayloadRef.current) return;
        // Prevent default to allow drop. effectAllowed = "copy" on the
        // source means we're signalling a copy operation, not a move.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragEnter: (event: ReactDragEvent<HTMLElement>) => {
        if (!pointerPayloadRef.current) return;
        event.preventDefault();
      },
      onDragLeave: (_event: ReactDragEvent<HTMLElement>) => {
        // Intentionally a no-op — we don't clear the carry on leave because
        // the user may drag across child elements. The drop handler clears
        // it on success, and dragend clears it on cancel.
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        const payload = pointerPayloadRef.current;
        if (!payload) return;
        event.preventDefault();
        // Read the card id from text/plain (set by the source) and confirm
        // it matches the ref'd payload. Falling back to text is a defensive
        // measure for browsers that drop text/plain.
        const droppedId = readCardIdFromDataTransfer(event.dataTransfer);
        if (droppedId && droppedId !== payload.card.id) {
          // Mismatched payload — treat as cancel.
          pointerPayloadRef.current = null;
          dispatch({ type: "cancel" });
          setAnnouncement("");
          return;
        }
        // Determine which target zone the drop occurred in by inspecting the
        // closest zone marker — the host page supplies it via data-target.
        const zone = event.currentTarget.getAttribute("data-target");
        const target: DeckBuilderDropTarget =
          zone === "sideboard" && supportsSideboard ? "sideboard" : "mainboard";
        onDrop({ card: payload.card, copies: payload.copies, target });
        pointerPayloadRef.current = null;
        dispatch({ type: "drop" });
        setAnnouncement("");
      },
    }),
    [onDrop, setAnnouncement, supportsSideboard],
  );

  return {
    state,
    isCarrying: !!state.carriedCard,
    carriedCard: state.carriedCard,
    target: effectiveTarget(state.target, supportsSideboard),
    copies: state.copies,
    announcement: announcementRef.current,
    sourceDragHandlers,
    targetDropHandlers,
    handleKeyDown,
    pickUp,
    switchTarget,
    commitDrop,
    cancel,
  };
}

/**
 * Re-export the event handler types so consumers can spread the returned
 * objects onto JSX elements without re-importing React's DragEvent / etc.
 */
export type DeckBuilderSourceDragHandlers =
  UseDeckBuilderDragDropResult["sourceDragHandlers"];
export type DeckBuilderTargetDropHandlers =
  UseDeckBuilderDragDropResult["targetDropHandlers"];

/**
 * Helper to attach a ScryfallCard onto an HTMLElement so the drag-and-drop
 * `onDragStart` handler can recover it without coupling to React's synthetic
 * event system. Used by CardResultTile.
 */
export function attachCardToElement(
  element: HTMLElement,
  card: ScryfallCard,
): void {
  (
    element as HTMLElement & { __deckBuilderCard?: ScryfallCard }
  ).__deckBuilderCard = card;
}
