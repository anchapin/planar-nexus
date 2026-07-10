/**
 * @fileoverview Tests for the Orama card-search worker client (issue #1389).
 *
 * The client lazily constructs the Web Worker on first instantiation. In
 * jsdom there is no `Worker` global, so `getSearchApi()` must return
 * `null` and `getStatus()` must report `"fallback"` rather than throw —
 * that is the signal `searchCardsOffline` uses to fall back to the
 * main-thread `cardSearchIndex.search()`.
 *
 * Mirrors `backup-checksum-client.test.ts` (issue #1249).
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";

import {
  SearchWorkerClient,
  searchWorkerClient,
} from "../search-worker-client";

describe("search-worker-client (issue #1389)", () => {
  afterEach(() => {
    SearchWorkerClient._resetForTesting();
  });

  describe("environment without a Worker global (jsdom / SSR / Node)", () => {
    it("returns null from getSearchApi() when Worker is undefined", () => {
      // jsdom does not provide a `Worker` global. The constructor
      // detects that and skips `init()` so subsequent calls return a
      // clean, no-proxy client.
      const client = SearchWorkerClient.getInstance();
      expect(client.getSearchApi()).toBeNull();
    });

    it("reports 'fallback' status when Worker is undefined", () => {
      const client = SearchWorkerClient.getInstance();
      expect(client.getStatus()).toBe("fallback");
    });

    it("returns null init error when Worker was never attempted", () => {
      const client = SearchWorkerClient.getInstance();
      expect(client.getInitError()).toBeNull();
    });

    it("terminates gracefully when there is no worker", () => {
      const client = SearchWorkerClient.getInstance();
      expect(() => client.terminate()).not.toThrow();
      expect(client.getSearchApi()).toBeNull();
      expect(client.getStatus()).toBe("fallback");
    });
  });

  describe("singleton lifecycle", () => {
    it("returns the same instance from getInstance()", () => {
      const a = SearchWorkerClient.getInstance();
      const b = SearchWorkerClient.getInstance();
      expect(a).toBe(b);
    });

    it("_resetForTesting clears the singleton so the next getInstance() returns a fresh instance", () => {
      const a = SearchWorkerClient.getInstance();
      SearchWorkerClient._resetForTesting();
      const b = SearchWorkerClient.getInstance();
      expect(a).not.toBe(b);
    });

    it("default export searchWorkerClient is the singleton instance at module load", () => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require("../search-worker-client");
        const client = fresh.SearchWorkerClient.getInstance();
        expect(fresh.searchWorkerClient).toBe(client);
      });
    });
  });

  describe("status after terminate", () => {
    it("reports 'fallback' after terminate()", () => {
      const client = SearchWorkerClient.getInstance();
      client.terminate();
      expect(client.getStatus()).toBe("fallback");
      expect(client.getSearchApi()).toBeNull();
    });
  });
});
