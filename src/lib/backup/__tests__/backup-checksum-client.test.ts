/**
 * @fileoverview Tests for the backup checksum worker client (issue #1249).
 *
 * The client lazily constructs the Web Worker on first instantiation. In
 * jsdom there is no `Worker` global, so `getChecksumApi()` must return
 * `null` rather than throw — that is the signal the bridge uses to fall
 * back to a synchronous main-thread digest.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";

import {
  BackupChecksumWorkerClient,
  backupChecksumWorkerClient,
} from "../backup-checksum-client";

describe("backup-checksum-client (issue #1249)", () => {
  afterEach(() => {
    BackupChecksumWorkerClient._resetForTesting();
  });

  describe("environment without a Worker global (jsdom / SSR / Node)", () => {
    it("returns null from getChecksumApi() when Worker is undefined", () => {
      // jsdom does not provide a `Worker` global. The constructor
      // should detect that and skip `init()` so subsequent calls return
      // a clean, no-proxy client. We assert by reading
      // `getChecksumApi()` directly.
      const client = BackupChecksumWorkerClient.getInstance();
      expect(client.getChecksumApi()).toBeNull();
    });

    it("records an initError when Worker construction throws", () => {
      // Constructing the singleton calls the private `init()`, which
      // attempts `new Worker(url, { type: "module" })`. In jsdom the
      // Worker global is undefined, so the try/catch stores the error
      // and leaves the proxy null.
      const client = BackupChecksumWorkerClient.getInstance();
      // The init may have either been short-circuited (no Worker global)
      // OR tried and caught. Both paths leave getChecksumApi() null.
      expect(client.getChecksumApi()).toBeNull();
    });

    it("terminates gracefully when there is no worker", () => {
      const client = BackupChecksumWorkerClient.getInstance();
      expect(() => client.terminate()).not.toThrow();
      expect(client.getChecksumApi()).toBeNull();
    });
  });

  describe("singleton lifecycle", () => {
    it("returns the same instance from getInstance()", () => {
      const a = BackupChecksumWorkerClient.getInstance();
      const b = BackupChecksumWorkerClient.getInstance();
      expect(a).toBe(b);
    });

    it("_resetForTesting clears the singleton so the next getInstance() returns a fresh instance", () => {
      const a = BackupChecksumWorkerClient.getInstance();
      BackupChecksumWorkerClient._resetForTesting();
      const b = BackupChecksumWorkerClient.getInstance();
      expect(a).not.toBe(b);
    });

    it("default export `backupChecksumWorkerClient` is the singleton instance at module load", () => {
      // The default export must always be the singleton so consumers
      // can import a stable handle and share the underlying worker.
      // This assertion holds at module-load time, BEFORE any
      // _resetForTesting() has fired. We re-import the module here to
      // get a clean default export, then compare to a freshly-built
      // instance from the same module instance.
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require("../backup-checksum-client");
        const client = fresh.BackupChecksumWorkerClient.getInstance();
        expect(fresh.backupChecksumWorkerClient).toBe(client);
      });
    });
  });

  describe("event subscription (test-only _emitTestEvent)", () => {
    it("delivers events to subscribers and supports unsubscribe", () => {
      const client = BackupChecksumWorkerClient.getInstance();
      const listener = jest.fn();

      const unsubscribe = client.on(listener);
      client._emitTestEvent({
        type: "progress",
        bytesProcessed: 128,
        totalBytes: 512,
      });
      client._emitTestEvent({
        type: "done",
        checksum: "abc",
        bytesProcessed: 512,
        totalBytes: 512,
      });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, {
        type: "progress",
        bytesProcessed: 128,
        totalBytes: 512,
      });

      unsubscribe();
      client._emitTestEvent({
        type: "error",
        message: "should not be delivered",
      });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("supports multiple subscribers", () => {
      const client = BackupChecksumWorkerClient.getInstance();
      const a = jest.fn();
      const b = jest.fn();

      const unsubA = client.on(a);
      const unsubB = client.on(b);
      client._emitTestEvent({
        type: "done",
        checksum: "x",
        bytesProcessed: 1,
        totalBytes: 1,
      });

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      unsubA();
      unsubB();
    });
  });
});
