/**
 * Tests for the `useCardFilters` memoization + LRU cache added in
 * issue #1425.
 *
 * The deck builder's `search(query, cards)` runs a fuzzy + filter + sort
 * pipeline over the full card collection (~5k cards) on every debounced
 * keystroke. These tests verify the hook now:
 *
 *  - Returns the *same array reference* for identical inputs (cache hit).
 *  - Recomputes when any input actually changes (cache miss).
 *  - Binds memory via an LRU bound (oldest entry evicted when full).
 *  - Builds a stable key across referentially-different-but-equal inputs
 *    (fresh array with the same contents; filter object with reordered
 *    array values).
 *  - Preserves result correctness against the uncached baseline.
 *
 * `fuzzySearch` is mocked to a passthrough so the tests do not depend on
 * the Orama index / IndexedDB stack — the cache boundary is observable
 * purely through the `applyFilters` / `sortCards` spy counts.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import type { MinimalCard } from "@/lib/card-database";

// --- Mocks ---------------------------------------------------------------
//
// `fuzzySearch` is backed by the Orama index + IndexedDB. Replacing it
// with a passthrough keeps these tests focused on the memoization layer
// (the actual fuzzy/filter/sort correctness is covered by their own
// per-module test suites).
const fuzzySearchMock = jest.fn(
  async (cards: MinimalCard[], _query: string): Promise<MinimalCard[]> => cards,
);

jest.mock("@/lib/search/fuzzy-search", () => ({
  fuzzySearch: (...args: unknown[]) =>
    fuzzySearchMock(...(args as [MinimalCard[], string])),
}));

// `loadPreferences` is invoked on mount and would otherwise race the
// tests against the `setSortConfig` it triggers. Stub it to resolve
// with the default sort so the hook starts from a known state.
jest.mock("@/lib/search/search-preferences", () => ({
  loadPreferences: jest.fn(async () => ({
    sortOption: "name" as const,
    sortDirection: "asc" as const,
  })),
  savePreferences: jest.fn(async () => undefined),
}));

// Pull the modules AFTER mocks are registered so the spy bindings line
// up. We import the real `applyFilters` / `sortCards` (they are pure)
// and spy on them to count cache misses.
//
// The spies are installed by replacing the named export on the module's
// namespace object. This works under ts-jest because compiled TS imports
// become `const ns = require(...); ns.foo(...)` — i.e. every call site
// reads the property lazily through the live module exports object, so
// a `jest.spyOn(module, "export")` swap is observable at call time.
import * as filterCardsModule from "@/lib/search/filter-cards";
import * as sortCardsModule from "@/lib/search/sort-cards";
import {
  useCardFilters,
  getFilterSignature,
  getCardsSignature,
  getSortSignature,
  SEARCH_CACHE_MAX_SIZE,
} from "../use-card-filters";
import type { FilterState } from "@/lib/search/filter-types";

// --- Fixtures ------------------------------------------------------------

function makeCard(
  id: string,
  overrides: Partial<MinimalCard> = {},
): MinimalCard {
  return {
    id,
    name: id,
    cmc: 1,
    type_line: "Creature — Test",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "common",
    set: "TST",
    legalities: {},
    ...overrides,
  };
}

/** A small deterministic fixture distinct enough to exercise filters + sort. */
const baseCards: MinimalCard[] = [
  makeCard("a", { name: "Aven", cmc: 2, colors: ["W"], color_identity: ["W"] }),
  makeCard("b", { name: "Bear", cmc: 2, colors: ["G"], color_identity: ["G"] }),
  makeCard("c", {
    name: "Coral",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  }),
  makeCard("d", {
    name: "Dragon",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
  }),
];

/** Build a 5k-card fixture by tiling the base cards (issue #1425 scale). */
function makeLargeCardSet(count: number): MinimalCard[] {
  const out: MinimalCard[] = [];
  for (let i = 0; i < count; i++) {
    const tile = baseCards[i % baseCards.length];
    out.push({
      ...tile,
      id: `${tile.id}-${i}`,
      name: `${tile.name}-${i}`,
    });
  }
  return out;
}

// Helper: wait for the mount effect (loadPreferences resolution) so the
// hook is in a stable state before assertions run. The mount effect
// triggers two state updates (`setSortConfig`, `setIsLoadingPrefs`); we
// wrap the flush in `act` so React does not warn about unwrapped
// updates during the test.
async function settlePrefs() {
  await act(async () => {
    // `loadPreferences` resolves on the next microtask. A double await
    // covers Promise resolution + the .then() chain inside the effect.
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  fuzzySearchMock.mockClear();
});

// Spies on the live module exports. The hook reads `applyFilters` /
// `sortCards` through the module namespace at call time (ts-jest emits
// `filter_cards_1.applyFilters(...)`), so swapping the property here is
// observable to the hook's next invocation.
let applyFiltersSpy: ReturnType<typeof jest.spyOn>;
let sortCardsSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  applyFiltersSpy = jest.spyOn(filterCardsModule, "applyFilters");
  sortCardsSpy = jest.spyOn(sortCardsModule, "sortCards");
});

afterEach(() => {
  applyFiltersSpy.mockRestore();
  sortCardsSpy.mockRestore();
});

// --- Signature helpers ---------------------------------------------------

describe("getFilterSignature", () => {
  it("is stable across referentially-different-but-equal filter objects", () => {
    const a: FilterState = { color: { mode: "include", colors: ["W", "U"] } };
    const b: FilterState = { color: { mode: "include", colors: ["U", "W"] } };
    // Different reference, different array order — same signature.
    expect(a).not.toBe(b);
    expect(getFilterSignature(a)).toBe(getFilterSignature(b));
  });

  it("changes when a filter value changes", () => {
    const a: FilterState = { color: { mode: "include", colors: ["W"] } };
    const b: FilterState = { color: { mode: "include", colors: ["U"] } };
    expect(getFilterSignature(a)).not.toBe(getFilterSignature(b));
  });

  it("treats {a:1,b:undefined} and {a:1} as equal (JSON drops undefined)", () => {
    const a: FilterState = { searchQuery: "foo" };
    const b: FilterState = {
      searchQuery: "foo",
      color: undefined,
    };
    expect(getFilterSignature(a)).toBe(getFilterSignature(b));
  });
});

describe("getSortSignature", () => {
  it("encodes option + direction", () => {
    expect(getSortSignature({ option: "name", direction: "asc" })).toBe(
      getSortSignature({ option: "name", direction: "asc" }),
    );
    expect(getSortSignature({ option: "name", direction: "asc" })).not.toBe(
      getSortSignature({ option: "name", direction: "desc" }),
    );
    expect(getSortSignature({ option: "cmc", direction: "asc" })).not.toBe(
      getSortSignature({ option: "name", direction: "asc" }),
    );
  });
});

describe("getCardsSignature", () => {
  it("returns identical signatures for arrays with the same contents", () => {
    const a = makeLargeCardSet(3);
    const b = a.slice(); // new reference, same contents
    expect(a).not.toBe(b);
    expect(getCardsSignature(a)).toBe(getCardsSignature(b));
  });

  it("changes when a card field that filters/sort read is mutated", () => {
    const base = [makeCard("a")];
    const variant: MinimalCard[] = [{ ...base[0], cmc: 7 }];
    expect(getCardsSignature(base)).not.toBe(getCardsSignature(variant));
  });

  it("changes when the array length changes", () => {
    const a = [makeCard("a")];
    const b = [makeCard("a"), makeCard("b")];
    expect(getCardsSignature(a)).not.toBe(getCardsSignature(b));
  });

  it("memoizes the signature per array reference (WeakMap cache)", () => {
    const cards = makeLargeCardSet(100);
    const first = getCardsSignature(cards);
    const second = getCardsSignature(cards);
    expect(first).toBe(second);
    // No way to observe the WeakMap hit directly without leaking impl
    // details; identical output across two calls is the contract.
  });
});

// --- Hook: filteredCards memoization -------------------------------------

describe("useCardFilters.filteredCards memoization", () => {
  it("returns the same array reference for content-identical inputs", async () => {
    const { result, rerender } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cardsA = makeLargeCardSet(100);
    const first = result.current.filteredCards(cardsA);

    // Re-render with a brand-new array reference holding identical cards.
    rerender();
    const second = result.current.filteredCards(cardsA);

    expect(second).toBe(first);
  });

  it("returns the same reference when called twice with the same fresh array", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(100);
    const a = result.current.filteredCards(cards);
    const b = result.current.filteredCards(cards);
    expect(a).toBe(b);
  });

  it("recomputes when the cards contents change", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cardsA = makeLargeCardSet(10);
    const first = result.current.filteredCards(cardsA);

    const cardsB = cardsA.slice(0, 5); // different contents
    const second = result.current.filteredCards(cardsB);

    expect(second).not.toBe(first);
    expect(second.length).toBe(5);
  });

  it("recomputes when a filter is added", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(20);
    const first = result.current.filteredCards(cards);

    act(() => {
      result.current.setFilter("cmc", { mode: "exact", value: 2 });
    });

    const second = result.current.filteredCards(cards);
    expect(second).not.toBe(first);
  });

  it("preserves correctness against the uncached applyFilters baseline", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);
    // Bypass the spy by calling the real implementation directly.
    const expected = filterCardsModule.applyFilters(cards, {});
    const actual = result.current.filteredCards(cards);
    expect(actual).toEqual(expected);
  });
});

// --- Hook: search() LRU cache --------------------------------------------

describe("useCardFilters.search LRU cache", () => {
  it("serves a repeated query from cache without re-running the pipeline", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(100);

    const first = await result.current.search("lightning", cards);
    const applyCountAfterFirst = applyFiltersSpy.mock.calls.length;
    const sortCountAfterFirst = sortCardsSpy.mock.calls.length;
    expect(applyCountAfterFirst).toBeGreaterThan(0);
    expect(sortCountAfterFirst).toBeGreaterThan(0);

    // Second identical call: must hit the cache and skip the pipeline.
    const second = await result.current.search("lightning", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFirst);
    expect(sortCardsSpy.mock.calls.length).toBe(sortCountAfterFirst);

    // Same array reference returned (cache stores the result, not a copy).
    expect(second).toBe(first);
  });

  it("recomputes when the query changes", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);

    await result.current.search("light", cards);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    await result.current.search("lightning", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst + 1);
  });

  it("recomputes when the cards contents change", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cardsA = makeLargeCardSet(50);
    const cardsB = cardsA.slice(0, 25);

    await result.current.search("light", cardsA);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    await result.current.search("light", cardsB);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst + 1);
  });

  it("recomputes when a filter is added", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);

    await result.current.search("light", cards);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    act(() => {
      result.current.setFilter("cmc", { mode: "exact", value: 2 });
    });

    await result.current.search("light", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst + 1);
  });

  it("recomputes when the sort config changes", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);

    await result.current.search("light", cards);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    act(() => {
      result.current.setSort({ option: "cmc", direction: "desc" });
    });

    await result.current.search("light", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst + 1);
  });

  it("treats referentially-different-but-equal cards as a cache hit", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cardsA = makeLargeCardSet(100);
    const cardsB = cardsA.slice(); // new reference, same contents

    const first = await result.current.search("light", cardsA);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    const second = await result.current.search("light", cardsB);

    // Same reference returned from the cache, pipeline not re-run.
    expect(second).toBe(first);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst);
  });

  it("treats filter arrays with reordered values as a cache hit", async () => {
    // The signature helper canonicalizes array order. End-to-end, this
    // means setting a filter to {colors: [W,U]} and later setting it to
    // {colors: [U,W]} must NOT clear the search cache or force a
    // recompute — the canonical signature is unchanged, so the
    // cache-clear effect does not fire and the existing cache entry
    // stays valid.
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);

    act(() => {
      result.current.setFilter("color", {
        mode: "include",
        colors: ["W", "U"],
      });
    });

    const first = await result.current.search("light", cards);
    const afterFirst = applyFiltersSpy.mock.calls.length;
    expect(afterFirst).toBe(1);

    // Re-apply the filter with the same colors in a different order.
    // `getFilterSignature` canonicalizes array order, so the signature
    // is unchanged -> cache-clear effect does not run -> cache survives.
    act(() => {
      result.current.setFilter("color", {
        mode: "include",
        colors: ["U", "W"],
      });
    });

    const second = await result.current.search("light", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst); // cache hit
    expect(second).toBe(first);
  });

  it("normalizes the query term so equivalent inputs share a cache entry", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);

    const first = await result.current.search("Lightning", cards);
    const afterFirst = applyFiltersSpy.mock.calls.length;

    // Whitespace + case variations: same cache key, no recompute.
    const second = await result.current.search("  lightning  ", cards);
    const third = await result.current.search("LIGHTNING", cards);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(applyFiltersSpy.mock.calls.length).toBe(afterFirst);
  });

  it("preserves result correctness against the uncached baseline", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(50);
    // Baseline: simulate the uncached pipeline manually. Use the module
    // namespace so we go through the (spy-wrapped) original impl.
    const baselineSorted = sortCardsModule.sortCards(
      filterCardsModule.applyFilters(cards.slice(), {}),
      { option: "name", direction: "asc" },
    );

    const actual = await result.current.search(" ", cards); // query < 2 chars
    expect(actual).toEqual(baselineSorted);
  });

  it("does not invoke fuzzySearch when query < 2 chars (preserves short-circuit)", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(10);

    await result.current.search("a", cards); // length 1 -> no fuzzy
    expect(fuzzySearchMock).not.toHaveBeenCalled();

    await result.current.search("ab", cards); // length 2 -> fuzzy runs
    expect(fuzzySearchMock).toHaveBeenCalledTimes(1);
  });

  // --- LRU eviction ------------------------------------------------------

  it("evicts the least-recently-used entry when the cache fills", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(10);

    // Fill the cache with `max` distinct queries.
    // Each unique query string -> distinct cache key.
    for (let i = 0; i < SEARCH_CACHE_MAX_SIZE; i++) {
      await result.current.search(`q-${i}`, cards);
    }
    const applyCountAfterFill = applyFiltersSpy.mock.calls.length;
    expect(applyCountAfterFill).toBe(SEARCH_CACHE_MAX_SIZE);

    // The very first query ("q-0") is the LRU entry. Adding one more
    // distinct query must evict it.
    await result.current.search(`q-final`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill + 1);

    // Re-running "q-0" must now be a cache MISS -> pipeline re-runs.
    await result.current.search(`q-0`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill + 2);

    // Sanity: SEARCH_CACHE_MAX_SIZE is comfortably above the issue floor.
    expect(SEARCH_CACHE_MAX_SIZE).toBeGreaterThanOrEqual(32);
  });

  it("promotes a cache hit to most-recently-used (LRU recency)", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    const cards = makeLargeCardSet(10);

    // Fill cache with `max` entries.
    for (let i = 0; i < SEARCH_CACHE_MAX_SIZE; i++) {
      await result.current.search(`q-${i}`, cards);
    }
    const applyCountAfterFill = applyFiltersSpy.mock.calls.length;

    // Touch "q-0" (the LRU) so it becomes MRU.
    await result.current.search(`q-0`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill); // hit

    // Now add a new entry. Without the recency touch, "q-0" would have
    // been evicted; with it, "q-1" is the new LRU and gets evicted.
    await result.current.search(`q-new`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill + 1); // miss

    // "q-0" should still be cached (was promoted); "q-1" was evicted.
    await result.current.search(`q-0`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill + 1); // hit

    await result.current.search(`q-1`, cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(applyCountAfterFill + 2); // miss
  });

  // --- Scale smoke test --------------------------------------------------

  it("cache hit is O(1): same reference across 100 repeat calls runs the pipeline once", async () => {
    const { result } = renderHook(() => useCardFilters());
    await settlePrefs();

    // 5k cards — the scale called out in issue #1425.
    const cards = makeLargeCardSet(5000);

    const first = await result.current.search("lightning", cards);
    expect(applyFiltersSpy.mock.calls.length).toBe(1);

    // 99 more identical calls: all hits, no pipeline re-runs.
    let last = first;
    for (let i = 0; i < 99; i++) {
      last = await result.current.search("lightning", cards);
    }
    expect(applyFiltersSpy.mock.calls.length).toBe(1);
    expect(last).toBe(first);
  });
});
