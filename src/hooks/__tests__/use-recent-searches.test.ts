/**
 * @fileoverview Hook tests for `useRecentSearches` (issue #1544).
 *
 * Validates the LRU eviction + dedup contract that the chip row relies on:
 *  - Records a new query at the MRU position.
 *  - Re-recording an existing query moves it to MRU and keeps the
 *    row count flat (no duplicates).
 *  - Past `maxItems`, the oldest entry is evicted.
 *  - Dedup is case-insensitive but the most recent casing wins.
 *  - `removeRecent` removes a single query (case-insensitive match).
 *  - The pure `applyLruCap` helper handles edge cases (cap ≤ 0, empty
 *    input, length ≤ cap).
 *
 * The hook reads from the IndexedDB persistence layer; we mock that
 * layer so the tests are deterministic and don't have to wait for
 * fake-indexeddb round-trips.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const storageMock = {
  saveRecentSearch: jest.fn(async (_query: string) => undefined),
  loadRecentSearches: jest.fn(async (): Promise<string[]> => []),
  deleteRecentSearch: jest.fn(async (_query: string) => undefined),
  clearRecentSearches: jest.fn(async () => undefined),
};

jest.mock("@/lib/search/recent-searches", () => ({
  saveRecentSearch: (...args: unknown[]) =>
    storageMock.saveRecentSearch(...(args as [string])),
  loadRecentSearches: () => storageMock.loadRecentSearches(),
  deleteRecentSearch: (...args: unknown[]) =>
    storageMock.deleteRecentSearch(...(args as [string])),
  clearRecentSearches: () => storageMock.clearRecentSearches(),
}));

import {
  useRecentSearches,
  applyLruCap,
  MAX_RECENT_SEARCHES,
} from "../use-recent-searches";

describe("useRecentSearches — pure helpers (issue #1544)", () => {
  it("applyLruCap returns the input untouched when within the cap", () => {
    expect(applyLruCap(["a", "b"], 8)).toEqual(["a", "b"]);
  });

  it("applyLruCap trims from the tail when over the cap", () => {
    expect(applyLruCap(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });

  it("applyLruCap handles zero or negative caps by returning all items", () => {
    // Defensive: the hook uses this on every write, so a zero cap should
    // not accidentally truncate the persisted list to empty.
    expect(applyLruCap(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(applyLruCap(["a", "b", "c"], -1)).toEqual(["a", "b", "c"]);
  });
});

describe("useRecentSearches — hook behavior (issue #1544)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageMock.loadRecentSearches.mockResolvedValue([]);
    storageMock.saveRecentSearch.mockResolvedValue(undefined);
    storageMock.deleteRecentSearch.mockResolvedValue(undefined);
    storageMock.clearRecentSearches.mockResolvedValue(undefined);
  });

  it("loads the persisted list on mount", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["lightning", "ramp"]);

    const { result } = renderHook(() => useRecentSearches());
    // Wait for the initial effect to settle.
    await act(async () => {});

    expect(result.current.recent).toEqual(["lightning", "ramp"]);
    expect(result.current.isLoading).toBe(false);
    expect(storageMock.loadRecentSearches).toHaveBeenCalled();
  });

  it("records a new query at the MRU position", async () => {
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.recordSearch("lightning");
    });

    expect(result.current.recent).toEqual(["lightning"]);
    expect(storageMock.saveRecentSearch).toHaveBeenCalledWith("lightning");
  });

  it("moves an existing query to MRU without duplicating it", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["ramp", "lightning"]);
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    expect(result.current.recent).toEqual(["ramp", "lightning"]);

    await act(async () => {
      await result.current.recordSearch("lightning");
    });

    expect(result.current.recent).toEqual(["lightning", "ramp"]);
    // No duplicate rows.
    expect(result.current.recent.length).toBe(2);
  });

  it("dedupes case-insensitively, preserving the most recent casing", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["lightning"]);
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.recordSearch("Lightning");
    });

    expect(result.current.recent).toEqual(["Lightning"]);
    expect(result.current.recent.length).toBe(1);
  });

  it("evicts the oldest entry once `maxItems` is exceeded (LRU)", async () => {
    const { result } = renderHook(() => useRecentSearches(3));
    await act(async () => {});

    await act(async () => {
      await result.current.recordSearch("a");
    });
    await act(async () => {
      await result.current.recordSearch("b");
    });
    await act(async () => {
      await result.current.recordSearch("c");
    });
    expect(result.current.recent).toEqual(["c", "b", "a"]);

    await act(async () => {
      await result.current.recordSearch("d");
    });
    // `a` is the oldest; it should be evicted.
    expect(result.current.recent).toEqual(["d", "c", "b"]);
    expect(result.current.recent.length).toBe(3);
  });

  it("ignores empty and whitespace-only queries", async () => {
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.recordSearch("");
    });
    await act(async () => {
      await result.current.recordSearch("   ");
    });

    expect(result.current.recent).toEqual([]);
    expect(storageMock.saveRecentSearch).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace before storing", async () => {
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.recordSearch("  lightning bolt  ");
    });

    expect(result.current.recent).toEqual(["lightning bolt"]);
  });

  it("removeRecent deletes a single query (case-insensitive)", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["ramp", "lightning"]);
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.removeRecent("LIGHTNING");
    });

    expect(result.current.recent).toEqual(["ramp"]);
    expect(storageMock.deleteRecentSearch).toHaveBeenCalledWith("LIGHTNING");
  });

  it("clearAll wipes both the in-memory and persisted lists", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["lightning", "ramp"]);
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {});

    await act(async () => {
      await result.current.clearAll();
    });

    expect(result.current.recent).toEqual([]);
    expect(storageMock.clearRecentSearches).toHaveBeenCalled();
  });

  it("exports the documented 8-item cap", () => {
    expect(MAX_RECENT_SEARCHES).toBe(8);
  });
});
