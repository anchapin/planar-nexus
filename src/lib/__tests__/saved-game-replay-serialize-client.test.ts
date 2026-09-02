/**
 * @fileoverview Tests for the saved-game serialize worker client
 * (issue #1577).
 *
 * Mirrors `backup-checksum-client.test.ts` (#1249). The client lazily
 * constructs the Web Worker on first instantiation. In jsdom there is no
 * `Worker` global, so `getSerializeApi()` must return `null` rather than
 * throw — that is the signal the bridge uses to fall back to the
 * synchronous main-thread serialization.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";

import {
  SavedGameSerializeWorkerClient,
  savedGameSerializeWorkerClient,
} from "../saved-game-serialize-client";

describe("saved-game-serialize-client (issue #1577)", () => {
  afterEach(() => {
    SavedGameSerializeWorkerClient._resetForTesting();
  });

  describe("environment without a Worker global (jsdom / SSR / Node)", () => {
    it("returns null from getSerializeApi() when Worker is undefined", () => {
      // jsdom does not provide a `Worker` global. The constructor should
      // detect that and skip `init()` so subsequent calls return a clean,
      // no-proxy client.
      const client = SavedGameSerializeWorkerClient.getInstance();
      expect(client.getSerializeApi()).toBeNull();
    });

    it("records no init error when the Worker global is simply missing", () => {
      const client = SavedGameSerializeWorkerClient.getInstance();
      // Init was short-circuited (no Worker global) — no construction was
      // attempted, so no error should be recorded either.
      expect(client.getInitError()).toBeNull();
      expect(client.getSerializeApi()).toBeNull();
    });

    it("terminates gracefully when there is no worker", () => {
      const client = SavedGameSerializeWorkerClient.getInstance();
      expect(() => client.terminate()).not.toThrow();
      expect(client.getSerializeApi()).toBeNull();
    });
  });

  describe("singleton lifecycle", () => {
    it("returns the same instance from getInstance()", () => {
      const a = SavedGameSerializeWorkerClient.getInstance();
      const b = SavedGameSerializeWorkerClient.getInstance();
      expect(a).toBe(b);
    });

    it("_resetForTesting() produces a fresh instance", () => {
      const a = SavedGameSerializeWorkerClient.getInstance();
      SavedGameSerializeWorkerClient._resetForTesting();
      const b = SavedGameSerializeWorkerClient.getInstance();
      expect(a).not.toBe(b);
    });

    it("default export `savedGameSerializeWorkerClient` is the singleton instance at module load", () => {
      // The default export must always be the singleton so consumers can
      // import a stable handle and share the underlying worker. Verified
      // inside an isolated module instance so the outer suite's
      // `_resetForTesting()` (which nulls the static singleton) cannot
      // break the identity relationship.
      jest.isolateModules(() => {
        const mod = jest.requireActual("../saved-game-serialize-client") as {
          savedGameSerializeWorkerClient: unknown;
          SavedGameSerializeWorkerClient: {
            getInstance: () => unknown;
          };
        };
        expect(mod.savedGameSerializeWorkerClient).toBeDefined();
        expect(mod.savedGameSerializeWorkerClient).toBe(
          mod.SavedGameSerializeWorkerClient.getInstance(),
        );
      });
    });

    it("class and named exports are exposed for typing and teardown", () => {
      expect(typeof SavedGameSerializeWorkerClient).toBe("function");
      expect(typeof SavedGameSerializeWorkerClient._resetForTesting).toBe(
        "function",
      );
      // The module-level export handle is a constructed client (null proxy
      // in jsdom, but never null itself).
      expect(savedGameSerializeWorkerClient).toBeDefined();
      expect(savedGameSerializeWorkerClient.getSerializeApi()).toBeNull();
    });
  });
});
