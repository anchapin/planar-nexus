/**
 * @fileoverview Tests for game-state JSON compression
 *
 * Issue #1020: saved-game gameStateJson is gzip-compressed (base64-enveloped)
 * at the IndexedDB storage boundary. These tests cover the round-trip, the
 * size reduction, and backward compatibility with legacy uncompressed saves.
 *
 * Issue #1423: the compress/decompress entry points are now `async` (they
 * drive the native `CompressionStream` / `DecompressionStream` APIs).
 */

import { describe, it, expect } from "@jest/globals";
import {
  compressGameStateJson,
  decompressGameStateJson,
  isCompressedGameState,
  COMPRESSED_MARKER,
} from "../game-state-compression";

/** Build a realistically-sized, highly-repetitive serialized game state. */
function makeGameStateJson(): string {
  const players = Array.from({ length: 4 }, (_, i) => ({
    id: `player-${i}`,
    name: `Player ${i}`,
    life: 40,
    commanderDamage: Array.from({ length: 60 }, (_, c) => ({
      sourceId: `commander-${c}`,
      amount: c % 5,
    })),
    hand: Array.from({ length: 7 }, (_, c) => ({
      id: `card-${i}-${c}`,
      name: `Island ${c % 3}`,
    })),
  }));

  return JSON.stringify({
    gameId: "game-1020",
    status: "in_progress",
    turn: {
      turnNumber: 12,
      currentPhase: "PRECOMBAT_MAIN",
      priorityPlayer: "player-0",
    },
    players,
    zones: Array.from({ length: 8 }, (_, z) => ({
      id: `zone-${z}`,
      cardIds: Array.from({ length: 30 }, (_, c) => `card-${z}-${c}`),
    })),
    cards: Array.from({ length: 200 }, (_, c) => ({
      id: `card-${c}`,
      ownerId: `player-${c % 4}`,
      cardData: { id: `oracle-${c % 10}`, name: `Repeated Card Name ${c % 5}` },
    })),
  });
}

describe("game-state-compression (issue #1020)", () => {
  describe("isCompressedGameState", () => {
    it("detects the marker prefix", async () => {
      expect(isCompressedGameState(await compressGameStateJson("{}"))).toBe(
        true,
      );
    });

    it("returns false for legacy JSON (compact or pretty)", () => {
      expect(isCompressedGameState('{"gameId":"legacy"}')).toBe(false);
      expect(isCompressedGameState('{\n  "gameId": "legacy"\n}')).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(isCompressedGameState("")).toBe(false);
    });
  });

  describe("compressGameStateJson / decompressGameStateJson", () => {
    it("marks the payload with the compression marker", async () => {
      const compressed = await compressGameStateJson('{"gameId":"x"}');
      expect(compressed.startsWith(COMPRESSED_MARKER)).toBe(true);
    });

    it("round-trips a realistic game-state payload", async () => {
      const json = makeGameStateJson();
      const restored = await decompressGameStateJson(
        await compressGameStateJson(json),
      );
      expect(restored).toBe(json);
      expect(JSON.parse(restored)).toEqual(JSON.parse(json));
    });

    it("compresses repetitive game-state JSON by more than 50%", async () => {
      const json = makeGameStateJson();
      const compressed = await compressGameStateJson(json);
      // Even after base64 (4/3) expansion, gzip on highly-repetitive JSON
      // yields a large net reduction.
      expect(compressed.length).toBeLessThan(json.length * 0.5);
    });

    it("decompresses legacy uncompressed JSON unchanged (backward compat)", async () => {
      const legacyPretty = JSON.stringify({ gameId: "legacy" }, null, 2);
      const legacyCompact = JSON.stringify({ gameId: "legacy" });

      expect(await decompressGameStateJson(legacyPretty)).toBe(legacyPretty);
      expect(await decompressGameStateJson(legacyCompact)).toBe(legacyCompact);
    });

    it("preserves Map-encoded structures through a round-trip", async () => {
      // Mirror the mapReplacer output shape used by serializeGameState.
      const json = JSON.stringify({
        gameId: "g1",
        players: { dataType: "Map", value: [["p1", { life: 40 }]] },
      });
      const restored = await decompressGameStateJson(
        await compressGameStateJson(json),
      );
      expect(JSON.parse(restored)).toEqual(JSON.parse(json));
    });
  });
});
