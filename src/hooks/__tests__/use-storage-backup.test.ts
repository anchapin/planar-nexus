/**
 * @fileOverview Tests for useStorageBackup hook
 *
 * Issue #927: Incremental backup exists in the storage lib but is unreachable
 * from the UI.
 *
 * Tests the hook's wiring of:
 * - Backup mode toggle (full / incremental)
 * - exportData routes to incremental path when mode is set
 * - exportIncrementalData wraps indexedDBStorage.exportIncrementalBackup
 * - importData handles incremental backup imports
 * - lastIncrementalResult surfaced after incremental export
 * - hasIncrementalBaseline / lastBackupAt computed from manifest
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useStorageBackup } from "../use-storage-backup";
import { indexedDBStorage } from "@/lib/indexeddb-storage";
import { compressData, decompressData } from "@/lib/backup-compression";

// ---------------------------------------------------------------------------
// Mocks — jest.mock is hoisted above the imports by babel-jest, so the named
// imports above resolve to the mocked implementations. We access the mock
// fns via typed cast accessors below (the repo convention, see
// use-ai-worker.test.ts) instead of `require()`.
// ---------------------------------------------------------------------------

jest.mock("@/lib/indexeddb-storage", () => ({
  indexedDBStorage: {
    initialize: jest.fn(),
    getStorageQuota: jest.fn(),
    getBackupManifest: jest.fn(),
    exportBackup: jest.fn(),
    exportIncrementalBackup: jest.fn(),
    importBackup: jest.fn(),
    importIncrementalBackup: jest.fn(),
    clearAll: jest.fn(),
  },
  formatBytes: (n: number) => `${n} B`,
}));

jest.mock("@/lib/backup-compression", () => ({
  compressData: jest.fn().mockReturnValue(new Uint8Array([0x1f, 0x8b])),
  decompressData: jest.fn(),
  BACKUP_COMPRESSED_MIME: "application/gzip",
  BACKUP_COMPRESSED_EXTENSION: ".json.gz",
}));

// Typed accessors for the mocked fns.
const mocked = {
  initialize: indexedDBStorage.initialize as unknown as jest.Mock,
  getStorageQuota: indexedDBStorage.getStorageQuota as unknown as jest.Mock,
  getBackupManifest: indexedDBStorage.getBackupManifest as unknown as jest.Mock,
  exportBackup: indexedDBStorage.exportBackup as unknown as jest.Mock,
  exportIncrementalBackup:
    indexedDBStorage.exportIncrementalBackup as unknown as jest.Mock,
  importBackup: indexedDBStorage.importBackup as unknown as jest.Mock,
  importIncrementalBackup:
    indexedDBStorage.importIncrementalBackup as unknown as jest.Mock,
  clearAll: indexedDBStorage.clearAll as unknown as jest.Mock,
  compressData: compressData as unknown as jest.Mock,
  decompressData: decompressData as unknown as jest.Mock,
};

// ---------------------------------------------------------------------------
// Browser API stubs (JSDOM does not implement URL.createObjectURL / FileReader)
// ---------------------------------------------------------------------------

const mockRevokeObjectURL = jest.fn();
global.URL.createObjectURL = jest.fn(() => "blob:test-blob-id");
global.URL.revokeObjectURL = mockRevokeObjectURL;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Prevent initialize from running its effect (which calls getBackupManifest
  // internally), so the test fully controls when getBackupManifest is called.
  mocked.initialize.mockResolvedValue(undefined);
  mocked.getStorageQuota.mockResolvedValue({
    quota: 10 * 1024 * 1024,
    usage: 2 * 1024 * 1024,
    percentage: 20,
    approachingLimit: false,
  });
  mocked.getBackupManifest.mockResolvedValue(null); // default; override per-test
  mocked.exportBackup.mockResolvedValue({
    type: "full",
    version: "1.0.0",
    exportedAt: "2026-01-01T00:00:00.000Z",
    decks: [],
    savedGames: [],
    preferences: {},
    usageTracking: [],
    achievements: [],
    checksum: "abc123",
  });
  mocked.exportIncrementalBackup.mockResolvedValue({
    type: "incremental",
    version: "1.0.0",
    since: "2026-01-01T00:00:00.000Z",
    exportedAt: "2026-06-01T00:00:00.000Z",
    decks: [{ id: "deck-1", name: "Deck 1" }] as any,
    savedGames: [{ id: "game-1", name: "Game 1" }] as any,
    deletedRecords: [],
    checksum: "delta-checksum",
  });
  mocked.importBackup.mockResolvedValue(undefined);
  mocked.importIncrementalBackup.mockResolvedValue(undefined);
  mocked.clearAll.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useStorageBackup hook", () => {
  describe("initialization", () => {
    it("initializes storage and loads quota on mount", async () => {
      const { result } = renderHook(() => useStorageBackup());

      await waitFor(() => {
        expect(result.current.isInitialized).toBe(true);
      });

      expect(mocked.initialize).toHaveBeenCalledTimes(1);
      expect(mocked.getStorageQuota).toHaveBeenCalled();
      expect(mocked.getBackupManifest).toHaveBeenCalled();
    });

    it("exposes correct default values", async () => {
      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      expect(result.current.backupMode).toBe("full");
      expect(result.current.status).toBe("idle");
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBe(null);
      expect(result.current.lastIncrementalResult).toBe(null);
      expect(result.current.hasIncrementalBaseline).toBe(false);
      expect(result.current.lastBackupAt).toBe(null);
    });
  });

  describe("backup mode toggle", () => {
    it("defaults to full mode", async () => {
      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.backupMode).toBe("full");
    });

    it("setBackupMode switches to incremental", async () => {
      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => {
        result.current.setBackupMode("incremental");
      });

      expect(result.current.backupMode).toBe("incremental");
    });

    it("setBackupMode switches back to full", async () => {
      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => {
        result.current.setBackupMode("incremental");
      });
      expect(result.current.backupMode).toBe("incremental");

      act(() => {
        result.current.setBackupMode("full");
      });
      expect(result.current.backupMode).toBe("full");
    });
  });

  describe("exportData — full mode", () => {
    it("calls indexedDBStorage.exportBackup in full mode", async () => {
      mocked.exportBackup.mockResolvedValueOnce({
        type: "full",
        version: "1.0.0",
        exportedAt: "2026-01-01T00:00:00.000Z",
        decks: [],
        savedGames: [],
        preferences: {},
        usageTracking: [],
        achievements: [],
        checksum: "full-checksum",
      } as any);

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => result.current.setBackupMode("full"));

      await act(async () => {
        await result.current.exportData();
      });

      expect(mocked.exportBackup).toHaveBeenCalledTimes(1);
      expect(mocked.exportIncrementalBackup).not.toHaveBeenCalled();
      expect(result.current.status).toBe("complete");
    });

    it("compresses the exported data", async () => {
      mocked.exportBackup.mockResolvedValueOnce({
        type: "full",
        version: "1.0.0",
        exportedAt: "2026-01-01T00:00:00.000Z",
        decks: [],
        savedGames: [],
        preferences: {},
        usageTracking: [],
        achievements: [],
        checksum: "c",
      } as any);

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.exportData();
      });

      expect(mocked.compressData).toHaveBeenCalled();
    });
  });

  describe("exportData — incremental mode", () => {
    it("routes to exportIncrementalBackup when mode is incremental", async () => {
      mocked.getBackupManifest.mockResolvedValue({
        id: "backup-manifest",
        lastFullBackupAt: "2026-01-01T00:00:00.000Z",
      });
      mocked.exportIncrementalBackup.mockResolvedValueOnce({
        type: "incremental",
        version: "1.0.0",
        since: "2026-01-01T00:00:00.000Z",
        exportedAt: "2026-06-01T00:00:00.000Z",
        decks: [{ id: "deck-1" }] as any,
        savedGames: [{ id: "game-1" }] as any,
        deletedRecords: [],
        checksum: "inc-checksum",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => {
        result.current.setBackupMode("incremental");
      });

      await act(async () => {
        await result.current.exportData();
      });

      expect(mocked.exportIncrementalBackup).toHaveBeenCalledTimes(1);
      expect(mocked.exportBackup).not.toHaveBeenCalled();
      expect(result.current.status).toBe("complete");
    });

    it("sets lastIncrementalResult after successful incremental export", async () => {
      mocked.getBackupManifest.mockResolvedValue({
        id: "backup-manifest",
        lastFullBackupAt: "2026-01-01T00:00:00.000Z",
      });
      mocked.exportIncrementalBackup.mockResolvedValueOnce({
        type: "incremental",
        version: "1.0.0",
        since: "2026-01-01T00:00:00.000Z",
        exportedAt: "2026-06-01T00:00:00.000Z",
        decks: [{ id: "deck-1" }, { id: "deck-2" }] as any,
        savedGames: [{ id: "game-1" }] as any,
        deletedRecords: [],
        checksum: "inc-cs",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => result.current.setBackupMode("incremental"));

      await act(async () => {
        await result.current.exportData();
      });

      expect(result.current.lastIncrementalResult).not.toBeNull();
      expect(result.current.lastIncrementalResult!.deckCount).toBe(2);
      expect(result.current.lastIncrementalResult!.savedGameCount).toBe(1);
      expect(result.current.lastIncrementalResult!.since).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    });

    it("derives since timestamp from manifest lastIncrementalBackupAt when available", async () => {
      // Persistent mock: getBackupManifest is called both on mount
      // (refreshBackupManifest) and again inside exportIncrementalData,
      // so both calls must observe the same manifest.
      mocked.getBackupManifest.mockResolvedValue({
        id: "backup-manifest",
        lastIncrementalBackupAt: "2026-04-01T00:00:00.000Z",
        lastFullBackupAt: "2026-01-01T00:00:00.000Z",
      });
      mocked.exportIncrementalBackup.mockResolvedValueOnce({
        type: "incremental",
        version: "1.0.0",
        since: "2026-04-01T00:00:00.000Z",
        exportedAt: "2026-06-01T00:00:00.000Z",
        decks: [],
        savedGames: [],
        deletedRecords: [],
        checksum: "cs",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => result.current.setBackupMode("incremental"));

      await act(async () => {
        await result.current.exportData();
      });

      const sinceArg = mocked.exportIncrementalBackup.mock.calls[0][0] as Date;
      expect(sinceArg.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    });

    it("falls back to epoch when no manifest exists", async () => {
      // Persistent null mock — see the note on the previous test.
      mocked.getBackupManifest.mockResolvedValue(null);
      mocked.exportIncrementalBackup.mockResolvedValueOnce({
        type: "incremental",
        version: "1.0.0",
        since: new Date(0).toISOString(),
        exportedAt: "2026-06-01T00:00:00.000Z",
        decks: [],
        savedGames: [],
        deletedRecords: [],
        checksum: "cs",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => result.current.setBackupMode("incremental"));

      await act(async () => {
        await result.current.exportData();
      });

      const sinceArg = mocked.exportIncrementalBackup.mock.calls[0][0] as Date;
      expect(sinceArg.getTime()).toBe(0);
    });
  });

  describe("importData — full vs incremental", () => {
    it("calls indexedDBStorage.importBackup for full backup", async () => {
      const fullPayload = {
        version: "1.0.0",
        exportedAt: "2026-01-01T00:00:00.000Z",
        checksum: "c",
      };
      mocked.decompressData.mockReturnValueOnce(fullPayload);

      const raw = JSON.stringify(fullPayload);
      const encoder = new TextEncoder();
      const encoded = encoder.encode(raw);
      const arrayBuffer = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      );

      // JSDOM File doesn't support arrayBuffer() — patch it.
      const blob = new Blob([encoded], { type: "application/json" });
      const file = new File([blob], "backup.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: () => Promise.resolve(arrayBuffer),
        writable: true,
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.importData(file);
      });

      expect(mocked.importBackup).toHaveBeenCalledTimes(1);
      expect(mocked.importIncrementalBackup).not.toHaveBeenCalled();
    });

    it("calls indexedDBStorage.importIncrementalBackup for incremental backup", async () => {
      const incrementalPayload = {
        type: "incremental",
        version: "1.0.0",
        since: "2026-01-01T00:00:00.000Z",
        exportedAt: "2026-06-01T00:00:00.000Z",
        decks: [{ id: "deck-1" }],
        savedGames: [],
        deletedRecords: [],
        checksum: "inc-cs",
      };
      mocked.decompressData.mockReturnValueOnce(incrementalPayload);

      const raw = JSON.stringify(incrementalPayload);
      const encoder = new TextEncoder();
      const encoded = encoder.encode(raw);
      const arrayBuffer = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      );

      const blob = new Blob([encoded], { type: "application/gzip" });
      const file = new File([blob], "inc.json.gz", {
        type: "application/gzip",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: () => Promise.resolve(arrayBuffer),
        writable: true,
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.importData(file);
      });

      expect(mocked.importIncrementalBackup).toHaveBeenCalledTimes(1);
      expect(mocked.importBackup).not.toHaveBeenCalled();
    });
  });

  describe("hasIncrementalBaseline / lastBackupAt", () => {
    it("is false when no manifest exists", async () => {
      mocked.getBackupManifest.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      expect(result.current.hasIncrementalBaseline).toBe(false);
      expect(result.current.lastBackupAt).toBe(null);
    });

    it("is true when lastFullBackupAt is present", async () => {
      mocked.getBackupManifest.mockResolvedValueOnce({
        id: "backup-manifest",
        lastFullBackupAt: "2026-01-01T00:00:00.000Z",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      expect(result.current.hasIncrementalBaseline).toBe(true);
      expect(result.current.lastBackupAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("prefers lastIncrementalBackupAt over lastFullBackupAt for lastBackupAt", async () => {
      mocked.getBackupManifest.mockResolvedValueOnce({
        id: "backup-manifest",
        lastFullBackupAt: "2026-01-01T00:00:00.000Z",
        lastIncrementalBackupAt: "2026-04-01T00:00:00.000Z",
      });

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      expect(result.current.hasIncrementalBaseline).toBe(true);
      expect(result.current.lastBackupAt).toBe("2026-04-01T00:00:00.000Z");
    });
  });

  describe("reset", () => {
    it("resets status, progress, and error", async () => {
      mocked.exportBackup.mockRejectedValueOnce(new Error("export failed"));

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.exportData().catch(() => {});
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBe(null);
    });
  });

  describe("clearAllData", () => {
    it("calls indexedDBStorage.clearAll", async () => {
      mocked.clearAll.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useStorageBackup());
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.clearAllData();
      });

      expect(mocked.clearAll).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("complete");
    });
  });
});
