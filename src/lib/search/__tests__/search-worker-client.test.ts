/**
 * @fileoverview Tests for the Orama card-search worker client (issue #1389,
 * fix #1894).
 *
 * The client lazily constructs the Web Worker on first instantiation. In
 * jsdom there is no `Worker` global, so `getSearchApi()` must return
 * `null` and `getStatus()` must report `"fallback"` rather than throw —
 * that is the signal `searchCardsOffline` uses to fall back to the
 * main-thread `cardSearchIndex.search()`.
 *
 * Issue #1894 acceptance criterion: source-level guards pin the broken
 * `new Function('... import.meta.url ...')` pattern out of the file and
 * confirm the proper module-top-level `import.meta.url` capture lives
 * in the dedicated `search-worker-factory.ts` module loaded via
 * dynamic import. See `search-worker-factory.test.ts` for the matching
 * factory-side guards.
 *
 * Mirrors `backup-checksum-client.test.ts` (issue #1249).
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  describe("prewarm integration (issue #1576)", () => {
    it("keeps status 'fallback' when the prewarm helper probes it under jsdom", () => {
      // Acceptance criterion 3 from issue #1576: when the worker fails to
      // initialise (jsdom, CSP-blocked), the prewarm helper must not raise
      // an error to the user. The prewarm module reads getStatus() to
      // decide between the "fallback" branch (this test) and the "ready"
      // branch (covered in prewarm-search-worker.test.ts).
      const client = SearchWorkerClient.getInstance();
      expect(client.getStatus()).toBe("fallback");
      // Probing never throws and never mutates the status.
      expect(() => client.getStatus()).not.toThrow();
      expect(client.getStatus()).toBe("fallback");
      expect(client.getSearchApi()).toBeNull();
    });

    it("does not throw and reports 'fallback' when getStatus is called after terminate under jsdom", () => {
      // The prewarm helper short-circuits to the "fallback" branch when
      // getStatus() returns "fallback". Ensure this stays stable across a
      // terminate-and-re-instantiate cycle (avoids a regression where the
      // status flips to a stale value mid-flight).
      const client = SearchWorkerClient.getInstance();
      client.terminate();
      client.terminate(); // double-terminate is a no-op
      expect(client.getStatus()).toBe("fallback");
      expect(client.getSearchApi()).toBeNull();
    });
  });

  describe("issue #1894 — worker URL resolution regression guards", () => {
    it("client source no longer uses the broken `new Function('... import.meta.url ...')` pattern", () => {
      // Issue #1894 root cause: the prior
      // `resolveImportMetaUrl()` helper used
      // `new Function('try { return ... import.meta.url ... }')()` —
      // `new Function` builds a global-realm function where
      // `import.meta` is undefined, so the helper ALWAYS returned
      // null in production traffic and the client fell through to
      // `self.location.href`, which Firefox/WebKit refused with a
      // `text/html` MIME error.
      //
      // The fix moved URL resolution into
      // `search-worker-factory.ts` (loaded via dynamic `import()`).
      // A regression that re-introduces the `new Function`-realm
      // trick here would re-introduce the cross-browser failure.
      const source = readFileSync(
        join(__dirname, "..", "search-worker-client.ts"),
        "utf8",
      );
      // Strip comments so the prose docstring that explains the bug
      // does not trip the regex (it still references `new Function`
      // and `import.meta.url` while describing what is no longer in
      // the code).
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code).not.toMatch(/new\s+Function\s*\(/);
    });

    it("client source delegates URL resolution to the dedicated factory module via dynamic import", () => {
      // The fix relies on a dynamic `import()` of
      // `./search-worker-factory`, with the production-catch
      // surrounding it so a CJS-environment load failure (the
      // `import.meta` parse error) is handled silently and the
      // last-resort `self.location.href` branch takes over.
      const source = readFileSync(
        join(__dirname, "..", "search-worker-client.ts"),
        "utf8",
      );
      expect(source).toMatch(
        /import\s*\(\s*\/\*[^]*?\*\/\s*['"]\.\/search-worker-factory['"]\s*\)/,
      );
    });

    it("client source keeps the last-resort self.location.href fallback (acceptance criterion)", () => {
      // Acceptance criterion: "The fallback to `self.location.href`
      // is preserved as a last-resort defense (not removed)". The
      // factory dynamic import is the primary path; the
      // `self.location.href` branch must remain in the client so a
      // future bundle regression that breaks the dynamic import
      // does not silently produce zero workers.
      const source = readFileSync(
        join(__dirname, "..", "search-worker-client.ts"),
        "utf8",
      );
      expect(source).toMatch(/self\.location\.href/);
    });
  });
});
