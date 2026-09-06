/**
 * @fileoverview IndexedDB persistence tests for `recent-searches.ts` (issue #1544).
 *
 * Validates:
 *  - `saveRecentSearch` upserts by `query` key (no duplicate rows).
 *  - `loadRecentSearches` returns queries most-recently-used first.
 *  - `deleteRecentSearch` removes a single query.
 *  - `clearRecentSearches` wipes the store.
 *  - Empty / whitespace-only queries are ignored on save.
 *
 * fake-indexeddb is loaded globally by jest.setup.js. Each spec starts
 * from a cleared store rather than re-opening the database because
 * fake-indexeddb requires the DB handle to be closed before
 * `deleteDatabase` can resolve — clearing is the safe inter-test reset.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";

import {
  saveRecentSearch,
  loadRecentSearches,
  deleteRecentSearch,
  clearRecentSearches,
} from "../recent-searches";

describe("recent-searches storage (issue #1544)", () => {
  beforeEach(async () => {
    // Clear the store between specs. We can't use `deleteDatabase` because
    // the module-level `db` handle stays open across imports, and
    // fake-indexeddb's `deleteDatabase` will hang until that handle is
    // closed. Clearing is the safe equivalent.
    await clearRecentSearches();
  });

  it("returns an empty list when nothing has been recorded", async () => {
    const result = await loadRecentSearches();
    expect(result).toEqual([]);
  });

  it("saves a new query and reads it back", async () => {
    await saveRecentSearch("lightning");
    const result = await loadRecentSearches();
    expect(result).toEqual(["lightning"]);
  });

  it("orders queries most-recently-used first", async () => {
    await saveRecentSearch("ramp");
    // Manual delay so the second write's `lastUsedAt` is strictly later.
    await new Promise((r) => setTimeout(r, 5));
    await saveRecentSearch("counterspell");
    await new Promise((r) => setTimeout(r, 5));
    await saveRecentSearch("board wipe");

    const result = await loadRecentSearches();
    expect(result).toEqual(["board wipe", "counterspell", "ramp"]);
  });

  it("re-records an existing query without duplicating it", async () => {
    await saveRecentSearch("lightning");
    await saveRecentSearch("ramp");
    await new Promise((r) => setTimeout(r, 5));
    // Re-record the first query; should bump to MRU, not duplicate.
    await saveRecentSearch("lightning");

    const result = await loadRecentSearches();
    expect(result).toEqual(["lightning", "ramp"]);
    expect(result.length).toBe(2);
  });

  it("ignores empty and whitespace-only queries", async () => {
    await saveRecentSearch("");
    await saveRecentSearch("   ");
    await saveRecentSearch("lightning");

    const result = await loadRecentSearches();
    expect(result).toEqual(["lightning"]);
  });

  it("trims surrounding whitespace before saving", async () => {
    await saveRecentSearch("  lightning bolt  ");

    const result = await loadRecentSearches();
    expect(result).toEqual(["lightning bolt"]);
  });

  it("deletes a single query and leaves the rest intact", async () => {
    await saveRecentSearch("lightning");
    await saveRecentSearch("ramp");

    await deleteRecentSearch("lightning");

    const result = await loadRecentSearches();
    expect(result).toEqual(["ramp"]);
  });

  it("clearRecentSearches empties the store", async () => {
    await saveRecentSearch("lightning");
    await saveRecentSearch("ramp");

    await clearRecentSearches();

    const result = await loadRecentSearches();
    expect(result).toEqual([]);
  });
});
