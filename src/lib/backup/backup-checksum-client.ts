/**
 * @fileoverview Backup checksum worker client (issue #1249).
 *
 * Singleton that lazily initialises the backup SHA-256 Web Worker and exposes
 * a Comlink proxy. Mirrors the pattern in `src/ai/worker/ai-worker-client.ts`
 * (issue #1079, #1080):
 *
 * - Worker URL is resolved with `import.meta.url` so Next.js / Vite can bundle
 *   the worker module correctly under ESM. We fall back to a plain string path
 *   if `import.meta` is unavailable (e.g. in older test runners).
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
      this.init();
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
  private init(): void {
    try {
      let workerUrl: string | URL;

      // Resolve the worker URL relative to the current module.
      //
      // We avoid the `import.meta.url` syntax here because it is invalid
      // in CommonJS (Jest's ts-jest default), even when wrapped in
      // `typeof import.meta !== "undefined"`. The `Function` constructor
      // evaluates the expression at runtime in the host realm so:
      //   - in browsers / Next.js ESM: `import.meta.url` resolves to the
      //     bundled module URL (used by the Webpack worker loader)
      //   - in jsdom / Node CJS: the check evaluates `false` and we fall
      //     through to a plain string path
      const metaUrl = resolveImportMetaUrl();
      if (metaUrl) {
        workerUrl = new URL("./backup-checksum.worker.ts", metaUrl).href;
      } else if (
        typeof self !== "undefined" &&
        (self as unknown as { location?: Location }).location?.href
      ) {
        workerUrl = new URL(
          "./backup-checksum.worker.ts",
          (self as unknown as { location: Location }).location.href,
        ).href;
      } else {
        // Plain string path — Next.js and Vite both resolve this against
        // the worker chunk directory at build time.
        workerUrl = "./backup-checksum.worker.ts";
      }

      this.worker = new Worker(workerUrl, { type: "module" });
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

/**
 * Resolve `import.meta.url` at runtime in a way that survives both ESM
 * (browser / Next.js worker loader) and CJS (Jest ts-jest, Node SSR)
 * contexts. Uses a `Function` constructor so the `import.meta` token is
 * only evaluated in the host realm — Node's CommonJS parser would
 * otherwise reject it as a SyntaxError.
 *
 * Returns `null` when the host has no ESM module URL — callers fall back
 * to `self.location.href` or a plain string path.
 */
function resolveImportMetaUrl(): string | null {
  try {
    return new Function(
      'try { return typeof import.meta !== "undefined" && import.meta && import.meta.url ? import.meta.url : null; } catch (_) { return null; }',
    )() as string | null;
  } catch {
    return null;
  }
}

export const backupChecksumWorkerClient =
  BackupChecksumWorkerClient.getInstance();
export { BackupChecksumWorkerClient };
