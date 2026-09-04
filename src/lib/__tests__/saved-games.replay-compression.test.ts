/**
 * @fileOverview Tests for at-rest gzip compression of `replayJson`
 *              (issue #1573).
 *
 * Acceptance criteria covered:
 *   1. A save containing a large `replayJson` persists a `gzn:`-enveloped
 *      base64/gzip payload whose on-disk size is a multiple smaller than
 *      the plaintext (≥5× on realistic replay JSON).
 *   2. `loadReplay(id)` inflates the envelope and returns the identical
 *      replay object graph (round-trip fidelity).
 *   3. A legacy record whose `replayJson` was written UNCOMPRESSED (pre
 *      #1573, e.g. restored from an old backup export) is detected via the
 *      envelope-marker check and read back unmodified — no migration step.
 *   4. The compression helper is idempotent, so a record round-tripped
 *      through backup import is never double-wrapped.
 *   5. `getSavedGame()` / `exportGame()` still hand callers plaintext
 *      `replayJson`, keeping the export file shape byte-compatible with
 *      pre-#1573 importers.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import { savedGamesManager, createSavedGame } from "../saved-games";
import {
  indexedDBStorage,
  SAVED_GAMES_META_STORE,
  SAVED_GAMES_PAYLOAD_STORE,
  StoredGamePayload,
  StoredGameMeta,
} from "../indexeddb-storage";
import { createInitialGameState } from "../game-state/game-state";
import {
  compressReplayJson,
  decompressReplayJson,
  isCompressedReplayJson,
} from "../game-state/replay-compression";
import type { Replay } from "../game-state/replay";

const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
};

/**
 * Build a replay with `actionCount` actions. The action payloads mimic the
 * real shape (repetitive keys, ids, phase names) so the measured
 * compression ratio is representative rather than an artifact of a single
 * repeated character.
 */
function makeLargeReplay(actionCount: number): Replay {
  const phases = ["upkeep", "draw", "main1", "combat", "main2", "end"];
  return {
    id: "replay-1573",
    metadata: {
      format: "commander",
      playerNames: ["Ada", "Bruno", "Cleo", "Dara"],
      startingLife: 40,
      isCommander: true,
      gameStartDate: 1_700_000_000_000,
    },
    actions: Array.from({ length: actionCount }, (_, i) => ({
      sequenceNumber: i + 1,
      action: {
        type: i % 3 === 0 ? "cast_spell" : "pass_priority",
        playerId: `player-${i % 4}`,
        cardId: `card-${i % 60}-0000-4000-8000-000000000000`,
        targets: [`permanent-${i % 30}`],
      },
      stateDelta: {
        turn: {
          turnNumber: Math.floor(i / 6) + 1,
          currentPhase: phases[i % 6],
        },
        life: { "player-0": 40 - (i % 12), "player-1": 40 - (i % 9) },
        zones: {
          battlefield: [`permanent-${i % 30}`, `permanent-${(i + 7) % 30}`],
          graveyard: [`card-${i % 60}-0000-4000-8000-000000000000`],
        },
      },
      description: `Player ${i % 4} takes action ${i + 1} during ${phases[i % 6]}`,
      recordedAt: 1_700_000_000_000 + i * 1_500,
    })),
    currentPosition: actionCount,
    totalActions: actionCount,
    createdAt: 1_700_000_000_000,
    lastModifiedAt: 1_700_000_000_000 + actionCount * 1_500,
  } as unknown as Replay;
}

beforeEach(async () => {
  const mockLocalStorage = createMockLocalStorage();
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(global, "localStorage", {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
  await savedGamesManager.clearAll();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("replayJson at-rest compression (issue #1573)", () => {
  it("persists replayJson as a gzn: envelope that is materially smaller than the plaintext", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeLargeReplay(400);

    const game = await createSavedGame(
      "Big Commander Game",
      "commander",
      gameState,
      replay,
    );
    const plaintext = game.replayJson as string;
    // Sanity: the fixture is genuinely large enough for the ratio to
    // mean something.
    expect(plaintext.length).toBeGreaterThan(100_000);

    await savedGamesManager.saveGame(game);

    const payload = await indexedDBStorage.get<StoredGamePayload>(
      SAVED_GAMES_PAYLOAD_STORE,
      game.id,
    );
    const onDisk = payload?.replayJson as string;

    // Unambiguously identifiable wire format.
    expect(isCompressedReplayJson(onDisk)).toBe(true);

    // ≥5× reduction on a realistic replay (base64 costs 33%, gzip on
    // this shape wins ~20-40×, so 5× is a conservative floor).
    const ratio = plaintext.length / onDisk.length;
    expect(ratio).toBeGreaterThanOrEqual(5);
  });

  it("round-trips the replay object graph through loadReplay()", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeLargeReplay(50);
    const game = await createSavedGame(
      "Round Trip",
      "commander",
      gameState,
      replay,
    );
    await savedGamesManager.saveGame(game);

    const loaded = await savedGamesManager.loadReplay(game.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.totalActions).toBe(50);
    expect(loaded?.actions).toHaveLength(50);
    expect(loaded?.actions[0].description).toBe(
      "Player 0 takes action 1 during upkeep",
    );
    expect(loaded?.actions[49].sequenceNumber).toBe(50);
    expect(loaded?.metadata.playerNames).toEqual([
      "Ada",
      "Bruno",
      "Cleo",
      "Dara",
    ]);
  });

  it("getSavedGame() hands back plaintext replayJson (export shape unchanged)", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const game = await createSavedGame(
      "Export Shape",
      "commander",
      gameState,
      makeLargeReplay(20),
    );
    await savedGamesManager.saveGame(game);

    const readBack = await savedGamesManager.getSavedGame(game.id);
    expect(readBack?.replayJson).toBe(game.replayJson);
    expect(isCompressedReplayJson(readBack?.replayJson)).toBe(false);
  });

  describe("backward compatibility with legacy uncompressed rows", () => {
    /**
     * Write a v3 meta + payload pair whose `replayJson` is raw,
     * uncompressed JSON — exactly what pre-#1573 builds persisted (and
     * what the #1084 backup fixtures restore).
     */
    async function seedLegacyRow(id: string, replayJson: string) {
      await indexedDBStorage.initialize();
      const meta: StoredGameMeta = {
        id,
        name: "Legacy Save",
        format: "commander",
        playerNames: ["Ada", "Bruno"],
        savedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
        turnNumber: 4,
        currentPhase: "main1",
        status: "in_progress",
        isAutoSave: false,
        hasReplay: true,
      };
      const payload: StoredGamePayload = {
        id,
        // Legacy rows also had UNCOMPRESSED gameStateJson; the #1020
        // marker check already handles that and is exercised here too.
        gameStateJson: JSON.stringify({ legacy: true }),
        replayJson,
      };
      await indexedDBStorage.set(SAVED_GAMES_META_STORE, meta);
      await indexedDBStorage.set(SAVED_GAMES_PAYLOAD_STORE, payload);
    }

    it("loadReplay() reads a legacy uncompressed replayJson without modification", async () => {
      const legacyJson = JSON.stringify(makeLargeReplay(10));
      await seedLegacyRow("legacy-1573", legacyJson);

      const loaded = await savedGamesManager.loadReplay("legacy-1573");
      expect(loaded).not.toBeNull();
      expect(loaded?.totalActions).toBe(10);
      expect(loaded?.actions).toHaveLength(10);
    });

    it("getSavedGame() returns a legacy uncompressed replayJson byte-for-byte", async () => {
      const legacyJson = JSON.stringify(makeLargeReplay(5));
      await seedLegacyRow("legacy-1573-b", legacyJson);

      const readBack = await savedGamesManager.getSavedGame("legacy-1573-b");
      expect(readBack?.replayJson).toBe(legacyJson);
    });
  });

  describe("compressReplayJson / decompressReplayJson helpers", () => {
    it("round-trips an arbitrary JSON string", async () => {
      const json = JSON.stringify({ a: 1, b: "two", c: [3, 4, 5] });
      const packed = (await compressReplayJson(json)) as string;
      expect(isCompressedReplayJson(packed)).toBe(true);
      expect(await decompressReplayJson(packed)).toBe(json);
    });

    it("passes undefined through unchanged (no replay attached)", async () => {
      expect(await compressReplayJson(undefined)).toBeUndefined();
      expect(await decompressReplayJson(undefined)).toBeUndefined();
    });

    it("passes an empty string through unchanged", async () => {
      expect(await compressReplayJson("")).toBe("");
    });

    it("is idempotent — never double-wraps an already-compressed payload", async () => {
      const json = JSON.stringify(makeLargeReplay(5));
      const once = (await compressReplayJson(json)) as string;
      const twice = (await compressReplayJson(once)) as string;
      expect(twice).toBe(once);
      expect(await decompressReplayJson(twice)).toBe(json);
    });

    it("returns legacy raw JSON unchanged on decompress (marker miss)", async () => {
      const raw = '{"id":"legacy","actions":[]}';
      expect(isCompressedReplayJson(raw)).toBe(false);
      expect(await decompressReplayJson(raw)).toBe(raw);
    });
  });
});
