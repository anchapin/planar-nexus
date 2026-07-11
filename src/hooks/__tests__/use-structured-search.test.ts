/**
 * @fileoverview Tests for the structured-search hook (issue #1440).
 *
 * The hook is a thin wrapper around `useSearchWorker` + the parser, so
 * the test surface covers:
 *   - call-through to the worker when `run` is invoked
 *   - propagation of parse errors into `errors`
 *   - "skip empty" behaviour for an empty / whitespace-only query
 *   - `useStructuredSearchImmediate` skips the debounce window.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the worker client so getSearchApi returns null (jsdom path).
// We intercept at the cardSearchIndex layer so we can verify the
// `where:`/term shape directly.
//
// The current pinned Jest typings don't accept `jest.Mock<...>` generic
// arguments, so we declare the mock as a permissive `any`-typed
// callable that gives the test full access to mockReset /
// mockResolvedValue[Once] without the use of `@ts-expect-error`.
const searchMock: any = jest.fn();
jest.mock("@/lib/search/card-search-index", () => ({
  cardSearchIndex: {
    search: (term: string, options?: unknown) =>
      searchMock(term, options),
  },
}));
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

import {
  useStructuredSearch,
  useStructuredSearchImmediate,
} from "../use-structured-search";

describe("useStructuredSearch (issue #1440)", () => {
  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  it("starts with empty results and no errors", () => {
    const { result } = renderHook(() => useStructuredSearch());
    expect(result.current.results).toEqual([]);
    expect(result.current.errors).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it("propagates parse errors into the result", async () => {
    const { result } = renderHook(() =>
      useStructuredSearch({ debounceMs: 5 }),
    );

    act(() => {
      void result.current.run('c:red t:"unclosed');
    });

    // The hook debounces the call; waitFor lets us assert after the
    // inner run completes without hard-coding a sleep.
    await waitFor(() => {
      expect(result.current.errors.length).toBeGreaterThan(0);
    });
    expect(result.current.errors.some((e) => /Unbalanced quote/.test(e.message))).toBe(true);
    // The underlying search *does* fire with an empty where/term so the
    // UI can still render a placeholder grid; the parse error is shown
    // via the inline error chip rather than blocking the search.
    expect(searchMock).toHaveBeenCalled();
  });

  it("passes the parsed `where:` clause and the leftover term to the index", async () => {
    const expectedHits = [
      { id: "1", name: "Lightning Bolt" },
      { id: "2", name: "Lightning Strike" },
    ];
    searchMock.mockResolvedValueOnce(expectedHits);

    // A tiny debounce makes the test deterministic without sleeping.
    const { result } = renderHook(() =>
      useStructuredSearch({ limit: 7, debounceMs: 5 }),
    );

    act(() => {
      void result.current.run("c:red t:instant cmc<=3 lightning");
    });

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalled();
    });

    expect(searchMock).toHaveBeenCalledWith(
      "lightning",
      expect.objectContaining({
        where: expect.objectContaining({
          colors: expect.anything(),
          type_line: { contains: "instant" },
          cmc: { lte: 3 },
        }),
        limit: 7,
      }),
    );

    await waitFor(() => {
      expect(result.current.results).toEqual(expectedHits);
    });
  });

  it("treats an empty query as 'no search'", async () => {
    const { result } = renderHook(() =>
      useStructuredSearch({ skipEmpty: true, debounceMs: 5 }),
    );

    act(() => {
      void result.current.run("   ");
    });

    await waitFor(() => {
      expect(searchMock).not.toHaveBeenCalled();
    });
    expect(result.current.results).toEqual([]);
    expect(result.current.parsed.where).toEqual({});
    expect(result.current.parsed.term).toBe("");
    expect(result.current.errors).toEqual([]);
  });
});

describe("useStructuredSearchImmediate (issue #1440)", () => {
  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  it("skips the debounce window", async () => {
    const expectedHits = [{ id: "1", name: "Sol Ring" }];
    searchMock.mockResolvedValueOnce(expectedHits);

    const { result } = renderHook(() =>
      useStructuredSearchImmediate({ limit: 5 }),
    );

    await act(async () => {
      await result.current.runNow("c:wubrg t:artifact,equipment");
    });

    // Single search call immediately, no waiting for the debounce.
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        where: expect.objectContaining({
          colors: { contains: ["W", "U", "B", "R", "G"] },
          or: expect.arrayContaining([
            { type_line: { contains: "artifact" } },
            { type_line: { contains: "equipment" } },
          ]),
        }),
        limit: 5,
      }),
    );

    expect(result.current.results).toEqual(expectedHits);
  });

  it("surfaces parse errors from a broken query", async () => {
    const { result } = renderHook(() => useStructuredSearchImmediate());

    await act(async () => {
      await result.current.runNow("c:zzz t:instant");
    });

    // `c:zzz` produces an "Unknown color spec" error; the rest still
    // produces a usable `where` for the type filter.
    expect(result.current.errors.length).toBeGreaterThan(0);
    expect(result.current.errors.some((e) => /Unknown color spec/.test(e.message))).toBe(true);
  });
});
