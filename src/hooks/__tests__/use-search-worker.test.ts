/**
 * @fileoverview Tests for the useSearchWorker hook (issue #1389).
 *
 * Validates:
 *   (a) the hook falls back to cardSearchIndex.search when the worker
 *       proxy is null (jsdom environment — no Worker global).
 *   (b) `isReady` is false and `error` is null in the fallback path.
 *   (c) `search` returns {id, name}[] hits from the main-thread index.
 *   (d) `status` reports "fallback" in jsdom.
 */
import { describe, it, expect } from "@jest/globals";

// Mock cardSearchIndex.search so we can assert the fallback path was hit
// without depending on IndexedDB / Orama persistence.
const searchMock = jest.fn();
jest.mock("@/lib/search/card-search-index", () => ({
  cardSearchIndex: {
    search: (...args: unknown[]) => searchMock(...args),
  },
}));

// Mock the worker client so getSearchApi() returns null (jsdom fallback).
jest.mock("@/lib/search/search-worker-client", () => {
  const instance = {
    getSearchApi: () => null,
    getStatus: () => "fallback" as const,
    getInitError: () => null,
    terminate: () => {},
  };
  return {
    searchWorkerClient: instance,
    SearchWorkerClient: {
      getInstance: () => instance,
      _resetForTesting: () => {},
    },
  };
});

import { renderHook } from "@testing-library/react";
import { useSearchWorker } from "../use-search-worker";

describe("useSearchWorker hook (issue #1389)", () => {
  describe("fallback path (worker unavailable — jsdom)", () => {
    it("reports status='fallback' and isReady=false", () => {
      const { result } = renderHook(() => useSearchWorker());
      expect(result.current.status).toBe("fallback");
      expect(result.current.isReady).toBe(false);
    });

    it("reports error=null when the worker was never attempted", () => {
      const { result } = renderHook(() => useSearchWorker());
      expect(result.current.error).toBeNull();
    });

    it("falls back to cardSearchIndex.search and returns its hits", async () => {
      const expected = [
        { id: "1", name: "Lightning Bolt" },
        { id: "2", name: "Lightning Strike" },
      ];
      searchMock.mockResolvedValueOnce(expected);

      const { result } = renderHook(() => useSearchWorker());
      const hits = await result.current.search("lightning", { limit: 10 });

      expect(hits).toEqual(expected);
      expect(searchMock).toHaveBeenCalledWith("lightning", { limit: 10 });
    });

    it("passes options through to cardSearchIndex.search", async () => {
      searchMock.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSearchWorker());
      await result.current.search("sol", { limit: 5, offset: 10 });

      expect(searchMock).toHaveBeenCalledWith("sol", { limit: 5, offset: 10 });
    });

    it("returns empty array for a query with no matches", async () => {
      searchMock.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSearchWorker());
      const hits = await result.current.search("nonexistent");

      expect(hits).toEqual([]);
    });
  });
});
