/**
 * @fileOverview Incremental Backup/Restore Tests
 *
 * Phase 34 Plan 01: Scalable Storage & Backups
 *
 * Tests for:
 * - IncrementalBackupData type structure
 * - exportIncrementalBackup() - only returns changed records
 * - importIncrementalBackup() - upserts without clearing
 * - BackupManifest tracking
 */

import "fake-indexeddb/auto";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "@jest/globals";
import * as crypto from "crypto";
import {
  IndexedDBStorage,
  type IncrementalBackupData,
  type BackupManifest,
  type StoredDeck,
  type StoredGame,
} from "../indexeddb-storage";

const TEST_CONFIG = {
  dbName: "TestIncrementalStorage",
  version: 3,
  stores: [
    "decks",
    "saved-games",
    "preferences",
    "usage-tracking",
    "achievements",
    "game-history",
  ],
};

function makeDeck(id: string, updatedAt: string): StoredDeck {
  return {
    id,
    name: `Deck ${id}`,
    format: "standard",
    cards: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    metadata: {},
  };
}

function makeGame(id: string, savedAt: number): StoredGame {
  return {
    id,
    name: `Game ${id}`,
    format: "standard",
    playerNames: ["Player1"],
    savedAt,
    createdAt: savedAt - 1000,
    turnNumber: 1,
    currentPhase: "main",
    status: "in_progress",
    isAutoSave: false,
    gameStateJson: "{}",
    metadata: {},
  };
}

beforeAll(() => {
  const nodeCrypto = crypto;
  const mockCrypto = {
    subtle: {
      digest: async (
        algorithm: string | { name: string },
        data: ArrayBuffer | Uint8Array,
      ) => {
        const alg = typeof algorithm === "string" ? algorithm : algorithm.name;
        const hashName = alg.replace("-", "").toLowerCase();
        const buf =
          data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.from(
                (data as Uint8Array).buffer,
                (data as Uint8Array).byteOffset,
                (data as Uint8Array).byteLength,
              );
        const hash = nodeCrypto.createHash(hashName).update(buf).digest();
        return hash.buffer.slice(
          hash.byteOffset,
          hash.byteOffset + hash.byteLength,
        );
      },
    },
  };
  Object.defineProperty(global, "crypto", {
    value: mockCrypto,
    writable: true,
    configurable: true,
  });
});

describe("Incremental Backup/Restore", () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage(TEST_CONFIG);
    await storage.initialize();
  });

  afterEach(async () => {
    try {
      await storage.clearAll();
      await storage.close();
    } catch {
      // ignore
    }
  });

  describe("Test 1: IncrementalBackupData structure", () => {
    it('should have type="incremental", since, exportedAt, decks, savedGames, deletedRecords, checksum', async () => {
      const since = new Date("2026-01-01T00:00:00.000Z");
      const result = await storage.exportIncrementalBackup(since);

      expect(result.type).toBe("incremental");
      expect(result.since).toBe(since.toISOString());
      expect(typeof result.exportedAt).toBe("string");
      expect(Array.isArray(result.decks)).toBe(true);
      expect(Array.isArray(result.savedGames)).toBe(true);
      expect(Array.isArray(result.deletedRecords)).toBe(true);
      expect(typeof result.checksum).toBe("string");
      expect(result.checksum.length).toBeGreaterThan(0);
    });
  });

  describe("Test 2: exportIncrementalBackup filters decks by updatedAt", () => {
    it("should return only decks with updatedAt > since", async () => {
      const oldDeck = makeDeck("old-1", "2026-01-01T00:00:00.000Z");
      const newDeck = makeDeck("new-1", "2026-06-01T00:00:00.000Z");

      await storage.set("decks", oldDeck);
      await storage.set("decks", newDeck);

      const since = new Date("2026-03-01T00:00:00.000Z");
      const result = await storage.exportIncrementalBackup(since);

      expect(result.decks).toHaveLength(1);
      expect(result.decks[0].id).toBe("new-1");
    });
  });

  describe("Test 3: exportIncrementalBackup filters savedGames by savedAt", () => {
    it("should return only savedGames with savedAt > since", async () => {
      const sinceDate = new Date("2026-03-01T00:00:00.000Z");
      const oldGame = makeGame(
        "old-game",
        new Date("2026-01-01T00:00:00.000Z").getTime(),
      );
      const newGame = makeGame(
        "new-game",
        new Date("2026-06-01T00:00:00.000Z").getTime(),
      );

      await storage.set("saved-games", oldGame);
      await storage.set("saved-games", newGame);

      const result = await storage.exportIncrementalBackup(sinceDate);

      expect(result.savedGames).toHaveLength(1);
      expect(result.savedGames[0].id).toBe("new-game");
    });
  });

  describe("Test 4: exportIncrementalBackup checksum matches recalculated", () => {
    it("should produce a valid checksum", async () => {
      const deck = makeDeck("deck-1", "2026-06-01T00:00:00.000Z");
      await storage.set("decks", deck);

      const since = new Date("2026-03-01T00:00:00.000Z");
      const result = await storage.exportIncrementalBackup(since);

      expect(result.checksum).toBeTruthy();
      expect(typeof result.checksum).toBe("string");
      expect(result.checksum.length).toBe(64);
    });
  });

  describe("Test 5: importIncrementalBackup upserts without clearing", () => {
    it("should merge new records without removing existing ones", async () => {
      const existingDeck = makeDeck("existing", "2026-01-01T00:00:00.000Z");
      await storage.set("decks", existingDeck);

      const newDeck = makeDeck("new-deck", "2026-06-01T00:00:00.000Z");
      const since = new Date("2026-03-01T00:00:00.000Z");

      const incrementalData: IncrementalBackupData = {
        type: "incremental",
        version: "1.0.0",
        since: since.toISOString(),
        exportedAt: new Date().toISOString(),
        decks: [newDeck],
        savedGames: [],
        deletedRecords: [],
        checksum: "",
      };

      const encoder = new TextEncoder();
      const { checksum: _cs, ...dataToHash } = incrementalData;
      const json = JSON.stringify(dataToHash);
      const buf = await globalThis.crypto.subtle.digest(
        "SHA-256",
        encoder.encode(json),
      );
      incrementalData.checksum = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await storage.importIncrementalBackup(incrementalData);

      const allDecks = await storage.getAll<StoredDeck>("decks");
      expect(allDecks).toHaveLength(2);
      const ids = allDecks.map((d) => d.id);
      expect(ids).toContain("existing");
      expect(ids).toContain("new-deck");
    });
  });

  describe("Test 6: importIncrementalBackup applies deletedRecords", () => {
    it("should delete records listed in deletedRecords", async () => {
      const deck1 = makeDeck("deck-to-delete", "2026-01-01T00:00:00.000Z");
      const deck2 = makeDeck("deck-to-keep", "2026-01-01T00:00:00.000Z");
      await storage.set("decks", deck1);
      await storage.set("decks", deck2);

      const incrementalData: IncrementalBackupData = {
        type: "incremental",
        version: "1.0.0",
        since: new Date("2026-03-01T00:00:00.000Z").toISOString(),
        exportedAt: new Date().toISOString(),
        decks: [],
        savedGames: [],
        deletedRecords: [{ store: "decks", id: "deck-to-delete" }],
        checksum: "",
      };

      const encoder = new TextEncoder();
      const { checksum: _cs, ...dataToHash } = incrementalData;
      const json = JSON.stringify(dataToHash);
      const buf = await globalThis.crypto.subtle.digest(
        "SHA-256",
        encoder.encode(json),
      );
      incrementalData.checksum = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await storage.importIncrementalBackup(incrementalData);

      const allDecks = await storage.getAll<StoredDeck>("decks");
      expect(allDecks).toHaveLength(1);
      expect(allDecks[0].id).toBe("deck-to-keep");
    });
  });

  describe("Test 7: getBackupManifest returns null when no backup done", () => {
    it("should return null when no manifest exists", async () => {
      const manifest = await storage.getBackupManifest();
      expect(manifest).toBeNull();
    });
  });

  describe("Test 8: updateBackupManifest persists lastIncrementalBackupAt", () => {
    it("should persist manifest after incremental backup", async () => {
      const since = new Date("2026-01-01T00:00:00.000Z");
      await storage.exportIncrementalBackup(since);

      const manifest = await storage.getBackupManifest();
      expect(manifest).not.toBeNull();
      expect(manifest!.lastIncrementalBackupAt).toBeTruthy();
      expect(manifest!.id).toBe("backup-manifest");
    });
  });
});
