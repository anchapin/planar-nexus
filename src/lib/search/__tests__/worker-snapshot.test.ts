/**
 * @fileoverview Unit tests for the worker-snapshot persistence module
 * (issue #1792).
 *
 * Covers:
 *   (a) `cardCorpusFingerprint` — order-insensitive (sorts IDs), stable
 *       across V8 versions (uses `>>> 0`), distinct for distinct sets.
 *   (b) `loadWorkerSnapshot` — returns the snapshot string when the
 *       stored fingerprint matches the current corpus; returns `null`
 *       on missing row, fingerprint mismatch, or read failure.
 *   (c) `saveWorkerSnapshot` — persists the row with fingerprint
 *       fields and a fresh timestamp.
 *   (d) `clearWorkerSnapshot` — deletes the row.
 *
 * The Dexie layer is mocked — `worker-snapshot` only depends on
 * `db.orama_snapshots.{get,put,delete}`, so the mock is narrow.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("@/lib/db/local-intelligence-db", () => ({
  __esModule: true,
  db: {
    orama_snapshots: {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports --
 * Same jest.requireMock pattern as `tests/prewarm-search-worker.test.ts`:
 * the jest.mock factory hoists `jest.fn()` above the call site, so the
 * test body must reach back through `require` to grab the same handle.
 */
const { db } = require("@/lib/db/local-intelligence-db") as {
  db: {
    orama_snapshots: {
      get: jest.Mock<(id: string) => Promise<unknown>>;
      put: jest.Mock<(row: unknown) => Promise<unknown>>;
      delete: jest.Mock<(id: string) => Promise<unknown>>;
    };
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

import {
  WORKER_SNAPSHOT_ID,
  cardCorpusFingerprint,
  clearWorkerSnapshot,
  loadWorkerSnapshot,
  saveWorkerSnapshot,
} from "../worker-snapshot";

beforeEach(() => {
  db.orama_snapshots.get.mockReset();
  db.orama_snapshots.put.mockReset();
  db.orama_snapshots.delete.mockReset();
});

describe("cardCorpusFingerprint (issue #1792)", () => {
  it("is order-insensitive (sorts card IDs before hashing)", () => {
    const a = cardCorpusFingerprint([{ id: "1" }, { id: "2" }, { id: "3" }]);
    const b = cardCorpusFingerprint([{ id: "3" }, { id: "1" }, { id: "2" }]);
    expect(a.cardIdsHash).toBe(b.cardIdsHash);
    expect(a.cardCount).toBe(b.cardCount);
  });

  it("returns the same hash for the same set across multiple calls", () => {
    const cards = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const a = cardCorpusFingerprint(cards);
    const b = cardCorpusFingerprint(cards);
    expect(a).toEqual(b);
  });

  it("produces distinct hashes for distinct ID sets", () => {
    const a = cardCorpusFingerprint([{ id: "1" }, { id: "2" }]);
    const b = cardCorpusFingerprint([{ id: "1" }, { id: "3" }]);
    expect(a.cardIdsHash).not.toBe(b.cardIdsHash);
  });

  it("reflects count changes (separate from hash changes)", () => {
    const a = cardCorpusFingerprint([{ id: "1" }]);
    const b = cardCorpusFingerprint([{ id: "1" }, { id: "2" }]);
    expect(a.cardCount).toBe(1);
    expect(b.cardCount).toBe(2);
    expect(a.cardIdsHash).not.toBe(b.cardIdsHash);
  });

  it("returns a 8-character lowercase hex string for the hash", () => {
    const fp = cardCorpusFingerprint([{ id: "test-id" }]);
    expect(fp.cardIdsHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("loadWorkerSnapshot (issue #1792)", () => {
  it("returns null when no snapshot row exists", async () => {
    db.orama_snapshots.get.mockResolvedValue(undefined);
    const result = await loadWorkerSnapshot({
      cardCount: 5,
      cardIdsHash: "abc12345",
    });
    expect(result).toBeNull();
  });

  it("returns null when the stored cardCount does not match", async () => {
    db.orama_snapshots.get.mockResolvedValue({
      id: WORKER_SNAPSHOT_ID,
      data: "snapshot-data",
      cardCount: 5,
      cardIdsHash: "abc12345",
      timestamp: 12345,
    });
    const result = await loadWorkerSnapshot({
      cardCount: 10,
      cardIdsHash: "abc12345",
    });
    expect(result).toBeNull();
  });

  it("returns null when the stored cardIdsHash does not match", async () => {
    db.orama_snapshots.get.mockResolvedValue({
      id: WORKER_SNAPSHOT_ID,
      data: "snapshot-data",
      cardCount: 5,
      cardIdsHash: "abc12345",
      timestamp: 12345,
    });
    const result = await loadWorkerSnapshot({
      cardCount: 5,
      cardIdsHash: "ffffffff",
    });
    expect(result).toBeNull();
  });

  it("returns the snapshot string when the fingerprint matches", async () => {
    db.orama_snapshots.get.mockResolvedValue({
      id: WORKER_SNAPSHOT_ID,
      data: "snapshot-data-here",
      cardCount: 5,
      cardIdsHash: "abc12345",
      timestamp: 12345,
    });
    const result = await loadWorkerSnapshot({
      cardCount: 5,
      cardIdsHash: "abc12345",
    });
    expect(result).toBe("snapshot-data-here");
  });

  it("returns null when Dexie get throws (fail-soft contract)", async () => {
    db.orama_snapshots.get.mockRejectedValue(new Error("Dexie read failed"));
    const result = await loadWorkerSnapshot({
      cardCount: 5,
      cardIdsHash: "abc12345",
    });
    expect(result).toBeNull();
  });

  it("returns null when the stored data field is not a string", async () => {
    db.orama_snapshots.get.mockResolvedValue({
      id: WORKER_SNAPSHOT_ID,
      data: { malformed: true },
      cardCount: 5,
      cardIdsHash: "abc12345",
      timestamp: 12345,
    });
    const result = await loadWorkerSnapshot({
      cardCount: 5,
      cardIdsHash: "abc12345",
    });
    expect(result).toBeNull();
  });
});

describe("saveWorkerSnapshot (issue #1792)", () => {
  it("persists the envelope with fingerprint fields and a fresh timestamp", async () => {
    db.orama_snapshots.put.mockResolvedValue(undefined);
    const before = Date.now();
    await saveWorkerSnapshot("payload-data", {
      cardCount: 3,
      cardIdsHash: "deadbeef",
    });
    const after = Date.now();

    expect(db.orama_snapshots.put).toHaveBeenCalledTimes(1);
    const call = db.orama_snapshots.put.mock.calls[0]?.[0] as unknown as {
      id: string;
      data: string;
      cardCount: number;
      cardIdsHash: string;
      timestamp: number;
    };
    expect(call.id).toBe(WORKER_SNAPSHOT_ID);
    expect(call.data).toBe("payload-data");
    expect(call.cardCount).toBe(3);
    expect(call.cardIdsHash).toBe("deadbeef");
    expect(call.timestamp).toBeGreaterThanOrEqual(before);
    expect(call.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("clearWorkerSnapshot (issue #1792)", () => {
  it("deletes the worker snapshot row", async () => {
    db.orama_snapshots.delete.mockResolvedValue(undefined);
    await clearWorkerSnapshot();
    expect(db.orama_snapshots.delete).toHaveBeenCalledWith(WORKER_SNAPSHOT_ID);
  });
});
