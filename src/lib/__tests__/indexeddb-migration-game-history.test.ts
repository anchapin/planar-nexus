/**
 * @fileOverview Game History IndexedDB Migration Tests
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
  IndexedDBStorage,
  migrateGameHistoryToIndexedDB,
} from "../indexeddb-storage";
import * as IndexedDBModule from "../indexeddb-storage";

describe("Game History IndexedDB Migration", () => {
  let storage: IndexedDBStorage;
  const dbName = "TestMigrationStorage";

  beforeEach(async () => {
    // Mock window if not available
    if (typeof window === "undefined") {
      (global as any).window = {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        indexedDB: require("fake-indexeddb"),
        localStorage: {
          getItem: jest.fn(),
          setItem: jest.fn(),
          removeItem: jest.fn(),
        },
      };
      (global as any).indexedDB = (global as any).window.indexedDB;
      (global as any).localStorage = (global as any).window.localStorage;
    }

    storage = new IndexedDBStorage({
      dbName,
      version: 2,
      stores: ["game-history"],
    });
    await storage.initialize();

    // Mock getStorage to return our test storage
    jest.spyOn(IndexedDBModule, "getStorage").mockResolvedValue(storage);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await storage.clearAll();
    await storage.close();
    // Reset fake-indexeddb
    if ((global as any).indexedDB && (global as any).indexedDB.deleteDatabase) {
      await new Promise((resolve) => {
        const req = (global as any).indexedDB.deleteDatabase(dbName);
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    }
  });

  it("should migrate game history from localStorage to IndexedDB", async () => {
    const mockGameHistory = [
      {
        id: "game-1",
        date: Date.now(),
        mode: "vs_ai",
        result: "win",
        playerDeck: "Mono Red",
        turns: 5,
        playerLifeAtEnd: 20,
      },
      {
        id: "game-2",
        date: Date.now() - 1000,
        mode: "vs_ai",
        result: "loss",
        playerDeck: "Control",
        turns: 12,
        playerLifeAtEnd: 0,
      },
    ];

    // Set localStorage data
    localStorage.setItem(
      "planar-nexus-game-history",
      JSON.stringify(mockGameHistory),
    );

    // Run migration
    await migrateGameHistoryToIndexedDB(storage);

    // Verify data in IndexedDB
    // We need to use the default storage instance because migrateGameHistoryToIndexedDB uses getStorage()
    // but in tests we want to be careful.
    // Actually, getStorage() returns the singleton indexedDBStorage.
    // Let's check the data in our test storage if it happened to use the same DB or just use getAll on the store.

    const allRecords = await storage.getAll("game-history");
    expect(allRecords).toHaveLength(2);
    expect(allRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "game-1" }),
        expect.objectContaining({ id: "game-2" }),
      ]),
    );
  });

  it("should handle empty localStorage game history", async () => {
    localStorage.removeItem("planar-nexus-game-history");

    await migrateGameHistoryToIndexedDB();

    const allRecords = await storage.getAll("game-history");
    expect(allRecords).toHaveLength(0);
  });

  it("should handle corrupted localStorage game history", async () => {
    localStorage.setItem("planar-nexus-game-history", "invalid-json");
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Should not throw
    await expect(migrateGameHistoryToIndexedDB()).resolves.not.toThrow();

    const allRecords = await storage.getAll("game-history");
    expect(allRecords).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
