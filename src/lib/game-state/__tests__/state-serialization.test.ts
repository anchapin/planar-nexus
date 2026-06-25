/**
 * @fileOverview Tests for compact GameState serialization
 *
 * Issue #1020: serializeGameState must emit compact (non-pretty) JSON so that
 * WebRTC sync messages and saved-game payloads avoid the ~30% whitespace
 * overhead, while a dedicated pretty-print helper remains available for
 * debugging.
 */

import { describe, it, expect } from "@jest/globals";
import {
  serializeGameState,
  deserializeGameState,
  prettyPrintGameState,
  cloneGameState,
} from "../state-serialization";
import { createInitialGameState } from "../game-state";
import { Phase } from "../types";

describe("state-serialization (issue #1020)", () => {
  describe("serializeGameState", () => {
    it("emits compact JSON with no indentation", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const json = serializeGameState(state);

      expect(json).not.toContain("\n");
      // Compact JSON separates keys and values with ":" (no space); the
      // players Map is serialized via mapReplacer.
      expect(json).toContain('"dataType":"Map"');
    });

    it("does not retain the legacy pretty-print separator", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const json = serializeGameState(state);
      expect(json).not.toContain('"dataType": "Map"');
    });

    it("is smaller than the pretty-printed representation", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const compact = serializeGameState(state);
      const pretty = prettyPrintGameState(state);
      expect(compact.length).toBeLessThan(pretty.length);
    });

    it("round-trips through deserializeGameState preserving Maps", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.turnNumber = 4;

      const restored = deserializeGameState(serializeGameState(state));

      expect(restored.gameId).toBe(state.gameId);
      expect(restored.players).toBeInstanceOf(Map);
      expect(restored.players.size).toBe(2);
      expect(restored.turn.currentPhase).toBe(Phase.PRECOMBAT_MAIN);
      expect(restored.turn.turnNumber).toBe(4);
    });
  });

  describe("prettyPrintGameState", () => {
    it("emits indented, human-readable JSON for debugging", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const pretty = prettyPrintGameState(state);

      expect(pretty).toContain("\n");
      expect(pretty).toContain('  ');

      // Pretty and compact must decode to the same structure.
      const compact = serializeGameState(state);
      expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    });
  });

  describe("cloneGameState", () => {
    it("produces an equal but structurally independent copy", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const clone = cloneGameState(state);

      expect(clone.gameId).toBe(state.gameId);
      expect(clone.players).not.toBe(state.players);
      expect(clone.players.size).toBe(state.players.size);
    });
  });
});
