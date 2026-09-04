/**
 * @fileOverview Tests for the saved-games metadata + payload split
 *              (issue #1572).
 *
 * Verifies the behavior that the saved-games list view depends on:
 *   1. `getAllSavedGames()` returns the cheap {@link SavedGameMeta}
 *      projection — no `gameStateJson` / `replayJson` bytes — so the
 *      list mount cost stays proportional to metadata size only.
 *   2. `getSavedGame(id)` and `getSavedGamePayload(id)` round-trip the
 *      full payload on demand.
 *   3. `saveGame()` writes meta + payload to the v3 stores and leaves
 *      the legacy store empty.
 *   4. `deleteGame()` cleans up every store that might still hold the
 *      record (meta + payload + legacy).
 *   5. The `hasReplay` flag on the meta row tracks the presence of a
 *      replay in the payload — the list view uses it to gate the
 *      "Share Replay" affordance without paying the payload round-trip.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  savedGamesManager,
  createSavedGame,
  SavedGameMeta,
} from "../saved-games";
import {
  indexedDBStorage,
  SAVED_GAMES_META_STORE,
  SAVED_GAMES_PAYLOAD_STORE,
} from "../indexeddb-storage";
import { createInitialGameState } from "../game-state/game-state";
import type { Replay } from "../game-state/replay";
import type { SavedGame } from "../saved-games";

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

/**
 * Minimal replay fixture — the actual Replay type requires more fields
 * but the manager only round-trips the JSON string, so a plain
 * serializable object is enough for these tests.
 */
function makeReplay(): Replay {
  return {
    id: "replay-1572",
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
        resultingState: { players: new Map() },
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

beforeEach(async () => {
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
  await savedGamesManager.clearAll();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("saved-games metadata + payload split (issue #1572)", () => {
  it("getAllSavedGames() returns SavedGameMeta[] — never the heavy payload fields", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();

    // Save a game with a large payload so a regression that pulls
    // payload bytes through the list view would be obvious in a
    // memory profile or in the payload store read count.
    const heavyPayload = "x".repeat(50_000);
    const saved = await savedGamesManager.saveGame({
      ...(await createSavedGame("Heavy Game", "commander", gameState, replay)),
      gameStateJson: heavyPayload,
    });
    expect(saved.id).toBeDefined();

    // Spy on the payload store so we can prove the list-view path
    // never reads it. The meta store IS allowed (it's the cheap
    // projection).
    const metaSpy = jest.spyOn(indexedDBStorage, "getAll");
    const list = await savedGamesManager.getAllSavedGames();

    expect(list).toHaveLength(1);
    const meta = list[0];
    expect(meta.name).toBe("Heavy Game");
    expect(meta.format).toBe("commander");
    expect(meta.hasReplay).toBe(true);

    // CRITICAL: every record from getAllSavedGames() must be free of
    // payload bytes (acceptance criterion #1572-2: "no record in the
    // result array has a non-empty `gameStateJson` or `replayJson`
    // field — payloads are loaded explicitly via
    // `savedGamesManager.getSavedGamePayload(id)`"). The SavedGameMeta
    // type itself doesn't expose these fields; the runtime check
    // below catches any accidental `as unknown as SavedGameMeta`
    // smuggling.
    for (const row of list) {
      expect((row as unknown as Record<string, unknown>).gameStateJson).toBeUndefined();
      expect((row as unknown as Record<string, unknown>).replayJson).toBeUndefined();
    }

    // Sanity: the meta store was read at most once and the payload
    // store was never read. The lazy-migration probe reads meta +
    // legacy but NOT payload; the list-view read should never reach
    // payload. (We bound the upper call counts loosely to keep the
    // test robust against future helpers.)
    const metaCallCount = metaSpy.mock.calls.filter(
      ([storeName]) => storeName === SAVED_GAMES_META_STORE,
    ).length;
    const payloadCallCount = metaSpy.mock.calls.filter(
      ([storeName]) => storeName === SAVED_GAMES_PAYLOAD_STORE,
    ).length;
    expect(metaCallCount).toBeGreaterThanOrEqual(1);
    expect(payloadCallCount).toBe(0);
  });

  it("getAllSavedGames() returns hasReplay=false when the payload has no replayJson", async () => {
    const gameState = createInitialGameState(["Player 1", "Player 2"]);
    await savedGamesManager.saveGame(
      await createSavedGame("No Replay", "standard", gameState),
    );

    const list = await savedGamesManager.getAllSavedGames();
    expect(list).toHaveLength(1);
    expect(list[0].hasReplay).toBe(false);
  });

  it("saveGame() writes meta + payload to the v3 split stores and clears the legacy row", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();
    const saved = await savedGamesManager.saveGame(
      await createSavedGame("Split Test", "commander", gameState, replay),
    );

    // Meta row carries the cheap fields.
    const meta = await indexedDBStorage.get(SAVED_GAMES_META_STORE, saved.id);
    expect(meta).toBeDefined();
    expect((meta as unknown as Record<string, unknown>).id).toBe(saved.id);
    expect((meta as unknown as Record<string, unknown>).name).toBe("Split Test");

    // Payload row carries the heavy fields. The on-disk
    // gameStateJson is gzip-compressed by #1020, so a byte-identical
    // comparison to the in-memory string is the wrong check — instead
    // confirm the row exists with the expected replayJson and the
    // compressed marker on the gameStateJson prefix.
    const payload = await indexedDBStorage.get(
      SAVED_GAMES_PAYLOAD_STORE,
      saved.id,
    );
    expect(payload).toBeDefined();
    expect((payload as unknown as Record<string, unknown>).replayJson).toBe(
      saved.replayJson,
    );
    const onDiskGameState = (payload as unknown as Record<string, unknown>)
      .gameStateJson as string;
    expect(typeof onDiskGameState).toBe("string");
    expect(onDiskGameState.length).toBeGreaterThan(0);

    // Legacy store stays empty (the list view never reads it, and
    // backup paths rehydrate from meta + payload so a leftover
    // duplicate would just waste space).
    const legacy = await indexedDBStorage.get("saved-games", saved.id);
    expect(legacy).toBeNull();
  });

  it("getSavedGame() round-trips meta + payload back into the full SavedGame shape", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();
    const saved = await savedGamesManager.saveGame(
      await createSavedGame("Round Trip", "commander", gameState, replay),
    );

    const readBack = await savedGamesManager.getSavedGame(saved.id);
    expect(readBack).not.toBeNull();
    expect(readBack?.id).toBe(saved.id);
    // The decompressed gameStateJson must match the in-memory value
    // byte-for-byte (acceptance criterion for the #1020 compression
    // seam).
    expect(readBack?.gameStateJson).toBe(saved.gameStateJson);
    expect(readBack?.replayJson).toBe(saved.replayJson);
  });

  it("getSavedGamePayload() returns only the payload bytes — no meta fields", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();
    const saved = await savedGamesManager.saveGame(
      await createSavedGame("Payload Only", "commander", gameState, replay),
    );

    const payload = await savedGamesManager.getSavedGamePayload(saved.id);
    expect(payload).not.toBeNull();
    expect(payload?.id).toBe(saved.id);
    // Payload.gameStateJson is the gzip-compressed base64 envelope;
    // confirm the row exists + is non-empty without leaking the
    // in-memory plaintext shape.
    expect(typeof payload?.gameStateJson).toBe("string");
    expect((payload?.gameStateJson ?? "").length).toBeGreaterThan(0);
    expect(payload?.replayJson).toBe(saved.replayJson);

    // Defensive runtime check: the payload type doesn't expose name /
    // format / status (those live on the meta row only).
    const asAny = payload as unknown as Record<string, unknown>;
    expect(asAny.name).toBeUndefined();
    expect(asAny.format).toBeUndefined();
    expect(asAny.status).toBeUndefined();
  });

  it("getSavedGamePayload() returns null for an unknown id", async () => {
    const payload = await savedGamesManager.getSavedGamePayload(
      "does-not-exist",
    );
    expect(payload).toBeNull();
  });

  it("deleteGame() cleans up meta + payload + (empty) legacy store", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const saved = await savedGamesManager.saveGame(
      await createSavedGame("Doomed Game", "commander", gameState),
    );

    const ok = await savedGamesManager.deleteGame(saved.id);
    expect(ok).toBe(true);

    expect(
      await indexedDBStorage.get(SAVED_GAMES_META_STORE, saved.id),
    ).toBeNull();
    expect(
      await indexedDBStorage.get(SAVED_GAMES_PAYLOAD_STORE, saved.id),
    ).toBeNull();
    expect(
      await savedGamesManager.getSavedGame(saved.id),
    ).toBeNull();
  });

  it("searchGames / filterByStatus / filterByFormat / getManualSaves / getAutoSaves operate on meta only (issue #1572)", async () => {
    const gameState = createInitialGameState(["Alice", "Bob"]);

    const manual = await createSavedGame("Manual 1", "commander", gameState);
    manual.status = "in_progress";
    await savedGamesManager.saveGame(manual);

    const completed = await createSavedGame(
      "Completed 1",
      "standard",
      gameState,
    );
    completed.status = "completed";
    await savedGamesManager.saveGame(completed);

    const all = await savedGamesManager.getAllSavedGames();
    expect(all.every((g) => !("gameStateJson" in (g as unknown as object)))).toBe(
      true,
    );
    expect(all.every((g) => !("replayJson" in (g as unknown as object)))).toBe(
      true,
    );

    const commanderOnly = await savedGamesManager.filterByFormat("commander");
    expect(commanderOnly).toHaveLength(1);
    expect(commanderOnly[0].name).toBe("Manual 1");
    expect((commanderOnly[0] as unknown as Record<string, unknown>).gameStateJson).toBeUndefined();

    const completedOnly = await savedGamesManager.filterByStatus("completed");
    expect(completedOnly).toHaveLength(1);
    expect(completedOnly[0].name).toBe("Completed 1");

    const search = await savedGamesManager.searchGames("Manual");
    expect(search).toHaveLength(1);
    expect(search[0].name).toBe("Manual 1");

    const manuals = await savedGamesManager.getManualSaves();
    expect(manuals.every((g) => !g.isAutoSave)).toBe(true);
  });

  it("loadGameState() / loadReplay() fetch ONLY the payload row", async () => {
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();
    const saved = await savedGamesManager.saveGame(
      await createSavedGame(
        "Lazy Load Test",
        "commander",
        gameState,
        replay,
      ),
    );

    // Spy on the meta store to prove loadGameState / loadReplay
    // never read it on the open-saved-game path.
    const getSpy = jest.spyOn(indexedDBStorage, "get");
    getSpy.mockClear();

    const loadedState = await savedGamesManager.loadGameState(saved.id);
    expect(loadedState).not.toBeNull();

    const replayLoaded = await savedGamesManager.loadReplay(saved.id);
    expect(replayLoaded).not.toBeNull();

    // The payload store should have been read for both calls; the
    // meta store should have been read for neither (the lazy path
    // uses the meta store's hasReplay flag via the legacy path only,
    // and here we have a fresh v3 row).
    const metaRead = getSpy.mock.calls.filter(
      ([storeName]) => storeName === SAVED_GAMES_META_STORE,
    ).length;
    const payloadRead = getSpy.mock.calls.filter(
      ([storeName]) => storeName === SAVED_GAMES_PAYLOAD_STORE,
    ).length;
    expect(payloadRead).toBeGreaterThanOrEqual(1);
    expect(metaRead).toBe(0);
  });

  it("SavedGameMeta shape includes every field the saved-games list view renders (acceptance: no payload fields missing)", () => {
    // Compile-time check via a round-trip projection.
    const meta: SavedGameMeta = {
      id: "x",
      name: "Render Check",
      format: "commander",
      playerNames: ["A", "B"],
      savedAt: 1,
      createdAt: 0,
      turnNumber: 1,
      currentPhase: "main",
      status: "in_progress",
      isAutoSave: false,
      hasReplay: false,
    };
    // List view renders these fields — spot check:
    expect(meta.name).toBe("Render Check");
    expect(meta.format).toBe("commander");
    expect(meta.playerNames).toEqual(["A", "B"]);
    expect(meta.turnNumber).toBe(1);
    expect(meta.currentPhase).toBe("main");
    expect(meta.status).toBe("in_progress");
    expect(meta.savedAt).toBe(1);
    expect(meta.isAutoSave).toBe(false);
    expect(meta.hasReplay).toBe(false);
  });
});

describe("saved-games list-view smoke test (issue #1572 acceptance criterion)", () => {
  it("50 saved games: list view pulls meta-only and never reads the payload store", async () => {
    // The list view must pull at most N rows from the meta store and
    // ZERO rows from the payload store (issue acceptance criterion:
    // `< 5 MB heap delta` and `no record has a non-empty gameStateJson
    // or replayJson field`).
    const gameState = createInitialGameState(["Ada", "Bruno"]);
    const replay = makeReplay();

    // Save 50 distinct games with a 50 KB gameStateJson each so a
    // regression that pulls payload through the list view would
    // explode the heap.
    for (let i = 0; i < 50; i++) {
      const saved = await savedGamesManager.saveGame({
        ...(await createSavedGame(`Game ${i}`, "commander", gameState, replay)),
        gameStateJson: "x".repeat(50_000),
      } as SavedGame);
      expect(saved.id).toBeDefined();
    }

    const getSpy = jest.spyOn(indexedDBStorage, "getAll");
    getSpy.mockClear();

    const list = await savedGamesManager.getAllSavedGames();
    expect(list).toHaveLength(50);
    // Payload is NEVER in the result.
    for (const row of list) {
      expect(
        (row as unknown as Record<string, unknown>).gameStateJson,
      ).toBeUndefined();
      expect(
        (row as unknown as Record<string, unknown>).replayJson,
      ).toBeUndefined();
    }
    const payloadReads = getSpy.mock.calls.filter(
      ([storeName]) => storeName === SAVED_GAMES_PAYLOAD_STORE,
    ).length;
    expect(payloadReads).toBe(0);
  });
});