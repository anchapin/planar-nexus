/**
 * @fileoverview Backup checksum worker client (issue #1249, fix #1912).
 *
 * Singleton that lazily initialises the backup SHA-256 Web Worker and exposes
 * a Comlink proxy. Mirrors the pattern in `src/lib/search/search-worker-client.ts`
 * (issue #1389, fix #1894):
 *
 * - Worker URL is resolved via the dedicated `backup-checksum-factory.ts` module,
 *   loaded through dynamic `import()` wrapped in try/catch — the factory captures
 *   `import.meta.url` at module top-level so webpack/Turbopack can statically
 *   analyse the `new URL(..., MODULE_URL)` shape and emit the worker as its own
 *   chunk. The dynamic import keeps the `import.meta` token out of ts-jest's
 *   CJS parser.
 * - The client returns `null` from `getChecksumApi()` when the worker cannot
 *   be initialised (no `Worker` global — jsdom, SSR, server tests) so the
 *   bridge layer falls back to a synchronous main-thread compute.
 * - Calls to `terminate()` are exposed for cleanup during test teardown.
 */

import * as Comlink from "comlink";
import type { backupChecksumWorker } from "./backup-checksum.worker";

export interface ChecksumProgressEvent {
  type: "progress";
  bytesProcessed: number;
  totalBytes: number;
}

export interface ChecksumDoneEvent {
  type: "done";
  checksum: string;
  bytesProcessed: number;
  totalBytes: number;
}

export interface ChecksumErrorEvent {
  type: "error";
  message: string;
}

export type ChecksumWorkerEvent =
  ChecksumProgressEvent | ChecksumDoneEvent | ChecksumErrorEvent;

export type BackupChecksumWorkerAPI = typeof backupChecksumWorker;

class BackupChecksumWorkerClient {
  private static instance: BackupChecksumWorkerClient | null = null;
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<BackupChecksumWorkerAPI> | null = null;
  private initError: Error | null = null;
  private listeners: Array<(event: ChecksumWorkerEvent) => void> = [];

  private constructor() {
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      void this.init();
    }
  }

  public static getInstance(): BackupChecksumWorkerClient {
    if (!BackupChecksumWorkerClient.instance) {
      BackupChecksumWorkerClient.instance = new BackupChecksumWorkerClient();
    }
    return BackupChecksumWorkerClient.instance;
  }

  /**
   * Returns the Comlink proxy for the worker, or `null` when the worker
   * could not be initialised (no `Worker` global, init threw, etc).
   *
   * Returning `null` rather than throwing lets the bridge degrade gracefully
   * to a synchronous main-thread checksum (issue #1249 acceptance criterion:
   * "Worker init failure falls back to the synchronous path with a
   * `console.warn`").
   */
  public getChecksumApi(): Comlink.Remote<BackupChecksumWorkerAPI> | null {
    return this.proxy;
  }

  /**
   * Subscribe to raw worker events (progress / done / error). Used by the
   * bridge layer to forward progress callbacks to the UI without going
   * through Comlink (so the bridge stays a thin pass-through).
   */
  public on(listener: (event: ChecksumWorkerEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Test/cleanup helper: emit a synthetic worker event to all subscribers.
   * Used by the bridge in tests to simulate progress without a real worker.
   * Production code paths should not call this directly.
   */
  public _emitTestEvent(event: ChecksumWorkerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Reset the singleton so tests can inject a different resolver.
   * @internal
   */
  public static _resetForTesting(): void {
    if (BackupChecksumWorkerClient.instance) {
      BackupChecksumWorkerClient.instance.terminate();
      BackupChecksumWorkerClient.instance = null;
    }
  }

  /**
   * Initialise the Web Worker and Comlink proxy.
   */
  private async init(): Promise<void> {
    try {
      let w: Worker | null = null;

      // Load the factory via dynamic import so the `import.meta.url`
      // token in the factory never reaches ts-jest's CJS parser.
      try {
        const mod = (await import("./backup-checksum-factory")) as unknown as {
          createBackupChecksumWorker?: () => Worker | null;
        };
        w = mod.createBackupChecksumWorker?.() ?? null;
      } catch {
        /* factory chunk failed to load — fall through to last-resort */
      }

      if (!w && typeof self !== "undefined" && self.location?.href) {
        try {
          w = new Worker(
            new URL("./backup-checksum.worker.ts", self.location.href).href,
            { type: "module" },
          );
        } catch {
          /* last-resort failed */
        }
      }

      if (!w) {
        this.worker = null;
        this.proxy = null;
        return;
      }

      this.worker = w;
      this.proxy = Comlink.wrap<BackupChecksumWorkerAPI>(this.worker);

      this.worker.addEventListener(
        "message",
        (event: MessageEvent<ChecksumWorkerEvent>) => {
          for (const listener of this.listeners) {
            listener(event.data);
          }
        },
      );
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      console.warn(
        "[backup-checksum] Worker init failed; falling back to main-thread SHA-256:",
        this.initError,
      );
      this.worker = null;
      this.proxy = null;
    }
  }

  /**
   * Terminate the worker. Called from `_resetForTesting` and from any
   * long-lived consumer that wants to free the worker thread (the browser
   * will reclaim it on tab close, so production code rarely needs this).
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.proxy = null;
    }
    this.listeners = [];
  }

  /**
   * Returns the init error if the worker failed to construct. Useful for
   * diagnostics / tests.
   */
  public getInitError(): Error | null {
    return this.initError;
  }
}

export const backupChecksumWorkerClient =
  BackupChecksumWorkerClient.getInstance();
export { BackupChecksumWorkerClient };
