/**
 * @fileOverview Unit tests for `useDeckHistory` (issue #1546).
 *
 * Coverage targets:
 *   - `recordEdit` pushes onto `past`; new edits clear `future`.
 *   - `undo` returns the most recent `past` entry and pushes current state
 *     onto `future`; no-op when `past` is empty.
 *   - `redo` mirrors `undo`.
 *   - The stack is bounded at MAX_HISTORY_SIZE=50 — the 51st edit evicts
 *     the oldest snapshot (acceptance criterion #5).
 *   - The announcement string surfaces for the ARIA live region (acceptance
 *     criterion #8).
 *   - Reset wipes both stacks.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { MAX_HISTORY_SIZE, useDeckHistory } from "../use-deck-history";
import type { DeckCard } from "@/lib/card-database";

const bolt = (count = 1): DeckCard =>
  ({
    id: "bolt-1",
    name: "Lightning Bolt",
    set: "m21",
    collector_number: "162",
    cmc: 1,
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "common",
    legalities: { modern: "legal", standard: "legal" },
    count,
  }) as unknown as DeckCard;

const island = (count = 1): DeckCard =>
  ({
    id: "island-1",
    name: "Island",
    set: "m21",
    collector_number: "311",
    cmc: 0,
    type_line: "Basic Land — Island",
    oracle_text: "{T}: Add {U}.",
    colors: [],
    color_identity: ["U"],
    rarity: "common",
    legalities: { modern: "legal", standard: "legal" },
    count,
  }) as unknown as DeckCard;

describe("useDeckHistory (#1546)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  describe("initial state", () => {
    it("starts with empty past and future", () => {
      const { result } = renderHook(() => useDeckHistory());
      expect(result.current.past).toEqual([]);
      expect(result.current.future).toEqual([]);
    });

    it("starts with an empty announcement", () => {
      const { result } = renderHook(() => useDeckHistory());
      expect(result.current.announcement).toBe("");
    });
  });

  describe("recordEdit", () => {
    it("pushes the supplied snapshot onto past with the description", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Lightning Bolt", [], []);
      });
      expect(result.current.past).toHaveLength(1);
      expect(result.current.past[0]).toEqual({
        deck: [],
        sideboard: [],
        description: "Add Lightning Bolt",
      });
    });

    it("accumulates multiple edits in chronological order", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Bolt", [], []);
      });
      act(() => {
        result.current.recordEdit("Add Island", [bolt()], []);
      });
      act(() => {
        result.current.recordEdit(
          "Add Island to sideboard",
          [bolt(), island()],
          [],
        );
      });
      expect(result.current.past.map((e) => e.description)).toEqual([
        "Add Bolt",
        "Add Island",
        "Add Island to sideboard",
      ]);
      expect(result.current.past[2].deck).toEqual([bolt(), island()]);
      expect(result.current.past[2].sideboard).toEqual([]);
    });

    it("clears the future stack when a new edit is recorded", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("first", [], []);
      });
      act(() => {
        result.current.undo([], []);
      });
      // After undo, future has one entry.
      expect(result.current.future).toHaveLength(1);
      act(() => {
        result.current.recordEdit("branch", [], []);
      });
      // New edit invalidates redo.
      expect(result.current.future).toEqual([]);
    });
  });

  describe("undo", () => {
    it("returns null when there is nothing to undo", () => {
      const { result } = renderHook(() => useDeckHistory());
      let returned: unknown = "sentinel";
      act(() => {
        returned = result.current.undo([bolt()], []);
      });
      expect(returned).toBeNull();
      expect(result.current.past).toEqual([]);
    });

    it("returns the most recent past entry and pushes current state onto future", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Bolt", [], []);
      });
      act(() => {
        result.current.recordEdit("Add Island", [bolt()], []);
      });
      act(() => {
        result.current.undo([bolt(), island()], []);
      });
      // Caller is expected to setDeck/setSideboard to the returned entry.
      const lastEntry = result.current.past[result.current.past.length - 1];
      // After undo, future has one entry (the state that was current when undo fired).
      expect(result.current.future).toHaveLength(1);
      expect(result.current.future[0]).toEqual({
        deck: [bolt(), island()],
        sideboard: [],
        description: "Add Island",
      });
      // past has been shortened by one.
      expect(result.current.past).toHaveLength(1);
      expect(lastEntry.description).toBe("Add Bolt");
    });

    it("announces the reverted action for the ARIA live region", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Lightning Bolt", [], []);
      });
      expect(result.current.announcement).toBe("");
      act(() => {
        result.current.undo([bolt()], []);
      });
      expect(result.current.announcement).toBe("Undo: Add Lightning Bolt");
    });

    it("returns null (no-op) once everything has been undone", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("only edit", [], []);
      });
      act(() => {
        result.current.undo([bolt()], []);
      });
      let returned: unknown = "sentinel";
      act(() => {
        returned = result.current.undo([], []);
      });
      expect(returned).toBeNull();
      expect(result.current.past).toEqual([]);
    });
  });

  describe("redo", () => {
    it("returns null when there is nothing to redo", () => {
      const { result } = renderHook(() => useDeckHistory());
      let returned: unknown = "sentinel";
      act(() => {
        returned = result.current.redo([], []);
      });
      expect(returned).toBeNull();
      expect(result.current.future).toEqual([]);
    });

    it("returns the next future entry and pushes current state onto past", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Bolt", [], []);
      });
      act(() => {
        result.current.recordEdit("Add Island", [bolt()], []);
      });
      // Undo back to "Add Bolt" applied → past = [Add Bolt], future = [Add Island state].
      act(() => {
        result.current.undo([bolt(), island()], []);
      });
      // Now redo.
      act(() => {
        result.current.redo([bolt()], []);
      });
      expect(result.current.past).toHaveLength(2);
      expect(result.current.future).toEqual([]);
    });

    it("announces the re-applied action for the ARIA live region", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Lightning Bolt", [], []);
      });
      act(() => {
        result.current.recordEdit("Add Island", [bolt()], []);
      });
      act(() => {
        result.current.undo([bolt(), island()], []);
      });
      expect(result.current.announcement).toBe("Undo: Add Island");
      act(() => {
        result.current.redo([bolt()], []);
      });
      expect(result.current.announcement).toBe("Redo: Add Island");
    });
  });

  describe("bounded stack (acceptance criterion #5)", () => {
    it(`evicts the oldest snapshot when the stack exceeds ${MAX_HISTORY_SIZE}`, () => {
      const { result } = renderHook(() => useDeckHistory());
      // Push MAX_HISTORY_SIZE + 5 edits.
      const total = MAX_HISTORY_SIZE + 5;
      for (let i = 0; i < total; i += 1) {
        act(() => {
          result.current.recordEdit(`edit-${i}`, [], []);
        });
      }
      expect(result.current.past).toHaveLength(MAX_HISTORY_SIZE);
      // The oldest entries (edit-0 .. edit-4) should have been evicted; the
      // survivors start at edit-5.
      expect(result.current.past[0].description).toBe(`edit-5`);
      expect(
        result.current.past[result.current.past.length - 1].description,
      ).toBe(`edit-${total - 1}`);
    });

    it("caps the stack at MAX_HISTORY_SIZE when undoing past the start", () => {
      const { result } = renderHook(() => useDeckHistory());
      for (let i = 0; i < MAX_HISTORY_SIZE + 3; i += 1) {
        act(() => {
          result.current.recordEdit(`edit-${i}`, [], []);
        });
      }
      // Undo all of them — none should throw.
      for (let i = 0; i < MAX_HISTORY_SIZE; i += 1) {
        act(() => {
          result.current.undo([], []);
        });
      }
      expect(result.current.past).toEqual([]);
    });
  });

  describe("session isolation (acceptance criterion #6)", () => {
    it("starts with empty history when the hook re-mounts", () => {
      const { result, unmount } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("ephemeral", [], []);
      });
      expect(result.current.past).toHaveLength(1);
      unmount();
      const { result: result2 } = renderHook(() => useDeckHistory());
      expect(result2.current.past).toEqual([]);
      expect(result2.current.future).toEqual([]);
    });
  });

  describe("reset", () => {
    it("clears both past and future stacks", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("a", [], []);
      });
      act(() => {
        result.current.recordEdit("b", [], []);
      });
      act(() => {
        result.current.undo([bolt()], []);
      });
      expect(result.current.past.length).toBeGreaterThan(0);
      expect(result.current.future.length).toBeGreaterThan(0);
      act(() => {
        result.current.reset();
      });
      expect(result.current.past).toEqual([]);
      expect(result.current.future).toEqual([]);
    });
  });

  describe("description round-trip", () => {
    it("preserves descriptions exactly across undo/redo cycles", () => {
      const { result } = renderHook(() => useDeckHistory());
      act(() => {
        result.current.recordEdit("Add Lightning Bolt", [], []);
      });
      act(() => {
        result.current.recordEdit("Add Island to sideboard", [], []);
      });
      act(() => {
        result.current.undo([bolt()], []);
      });
      expect(result.current.past[0].description).toBe("Add Lightning Bolt");
      expect(result.current.future[0].description).toBe(
        "Add Island to sideboard",
      );
      act(() => {
        result.current.redo([], []);
      });
      expect(result.current.announcement).toBe("Redo: Add Island to sideboard");
    });
  });
});
