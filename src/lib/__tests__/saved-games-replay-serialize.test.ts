/**
 * @fileoverview Wire-up tests for the off-main-thread replay serialization
 * in the saved-game auto-save path (issue #1577).
 *
 * Verifies the two serialization sites that used to run
 * `JSON.stringify(replay, mapReplacer)` synchronously —
 * `savedGamesManager.saveToAutoSave` and `createSavedGame` — now route
 * through the bridge seam:
 *
 * - Fallback path (jsdom default resolver, no Worker global): the persisted
 *   `replayJson` is byte-identical to the pre-#1577 synchronous output.
 * - Worker path (stubbed resolver): the replay object flows through the
 *   bridge's worker API (sentinel string lands in `replayJson`), proving
 *   the save path no longer stringifies on the main thread when a worker
 *   is available.
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
import { createInitialGameState } from "../game-state/game-state";
import {
  _setSavedGameSerializeClientResolver,
  _resetSavedGameSerializeClientResolver,
} from "../saved-game-serialize-bridge";
import { mapReplacer } from "../game-state/state-serialization";
import type { Replay } from "../game-state/replay";

// Mock localStorage — mirrors saved-games-auto-save.test.ts setup.
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
    get store() {
      return store;
    },
  };
};

let mockLocalStorage: ReturnType<typeof createMockLocalStorage>;

/** Synthetic replay fixture with a Map (exercises the mapReplacer envelope). */
function makeReplay(): Replay {
  return {
    id: "replay-wire-001",
    metadata: {
      format: "commander",
      playerNames: ["Ada", "Bruno"],
      startingLife: 40,
      isCommander: true,
      gameStartDate: 1_700_000_000_000,
    },
    actions: [
      {
        sequenceNumber: 1,
        action: { type: "pass_priority", playerId: "p1" },
        resultingState: {
          players: new Map([
            ["p1", { name: "Ada", life: 40 }],
            ["p2", { name: "Bruno", life: 39 }],
          ]),
        },
        description: "Ada passes priority",
        recordedAt: 1_700_000_000_001,
      },
    ],
    currentPosition: 1,
    totalActions: 1,
    createdAt: 1_700_000_000_000,
    lastModifiedAt: 1_700_000_000_001,
  } as unknown as Replay;
}

describe("saved-games replay serialization seam (issue #1577)", () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
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
    savedGamesManager.clearAll();
  });

  afterEach(() => {
    _resetSavedGameSerializeClientResolver();
  });

  describe("fallback path (jsdom — no Worker global)", () => {
    it("saveToAutoSave persists replayJson byte-identical to the pre-#1577 synchronous stringify", async () => {
      const gameState = createInitialGameState(["Ada", "Bruno"]);
      const replay = makeReplay();

      const saved = await savedGamesManager.saveToAutoSave(
        gameState,
        replay,
        0,
      );

      const oracle = JSON.stringify(replay, mapReplacer);
      expect(saved.replayJson).toBe(oracle);

      // And the persisted record round-trips with the same bytes.
      const readBack = await savedGamesManager.getSavedGame(saved.id);
      expect(readBack?.replayJson).toBe(oracle);
    });

    it("createSavedGame produces replayJson byte-identical to the pre-#1577 synchronous stringify", async () => {
      const gameState = createInitialGameState(["Ada", "Bruno"]);
      const replay = makeReplay();

      const saved = await createSavedGame(
        "Test Save",
        "commander",
        gameState,
        replay,
      );

      expect(saved.replayJson).toBe(JSON.stringify(replay, mapReplacer));
    });

    it("a null replay still saves with replayJson unset", async () => {
      const gameState = createInitialGameState(["Ada", "Bruno"]);

      const saved = await savedGamesManager.saveToAutoSave(gameState, null, 0);

      expect(saved.replayJson).toBeUndefined();
    });
  });

  describe("worker path (stubbed resolver)", () => {
    it("saveToAutoSave routes the replay through the bridge's worker API", async () => {
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockResolvedValue("sentinel-from-worker");
      _setSavedGameSerializeClientResolver(async () => ({
        getSerializeApi: () => ({
          serializeReplay: serializeMock as never,
          serializeReplayBytes: jest.fn() as never,
        }),
      }));

      const gameState = createInitialGameState(["Ada", "Bruno"]);
      const replay = makeReplay();

      const saved = await savedGamesManager.saveToAutoSave(
        gameState,
        replay,
        0,
      );

      // The worker sentinel — NOT the main-thread stringify — must land in
      // the saved record: the auto-save path no longer serializes replays
      // on the main thread when a worker is available.
      expect(saved.replayJson).toBe("sentinel-from-worker");
      expect(serializeMock).toHaveBeenCalledTimes(1);
      expect(serializeMock.mock.calls[0][0]).toBe(replay);
    });

    it("createSavedGame routes the replay through the bridge's worker API", async () => {
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockResolvedValue("sentinel-from-worker");
      _setSavedGameSerializeClientResolver(async () => ({
        getSerializeApi: () => ({
          serializeReplay: serializeMock as never,
          serializeReplayBytes: jest.fn() as never,
        }),
      }));

      const gameState = createInitialGameState(["Ada", "Bruno"]);
      const replay = makeReplay();

      const saved = await createSavedGame(
        "Worker Save",
        "commander",
        gameState,
        replay,
      );

      expect(saved.replayJson).toBe("sentinel-from-worker");
      expect(serializeMock).toHaveBeenCalledTimes(1);
      expect(serializeMock.mock.calls[0][0]).toBe(replay);
    });

    it("a null replay skips the worker entirely", async () => {
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      _setSavedGameSerializeClientResolver(async () => ({
        getSerializeApi: () => ({
          serializeReplay: serializeMock as never,
          serializeReplayBytes: jest.fn() as never,
        }),
      }));

      const gameState = createInitialGameState(["Ada", "Bruno"]);
      const saved = await savedGamesManager.saveToAutoSave(gameState, null, 0);

      expect(saved.replayJson).toBeUndefined();
      expect(serializeMock).not.toHaveBeenCalled();
    });
  });
});
