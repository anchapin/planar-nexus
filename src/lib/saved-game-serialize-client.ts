/**
 * @fileoverview Saved-game replay serialization worker client (issue #1577,
 * fix #1912).
 *
 * Singleton that lazily initialises the saved-game serialize Web Worker and
 * exposes a Comlink proxy. Mirrors the pattern in
 * `src/lib/search/search-worker-client.ts` (issue #1389, fix #1894):
 *
 * - Worker URL is resolved via the dedicated `saved-game-serialize-factory.ts`
 *   module, loaded through dynamic `import()` wrapped in try/catch — the factory
 *   captures `import.meta.url` at module top-level so webpack/Turbopack can
 *   statically analyse the `new URL(..., MODULE_URL)` shape and emit the worker
 *   as its own chunk. The dynamic import keeps the `import.meta` token out of
 *   ts-jest's CJS parser.
 * - The client returns `null` from `getSerializeApi()` when the worker cannot
 *   be initialised (no `Worker` global — jsdom, SSR, server tests) so the
 *   bridge layer falls back to the synchronous main-thread serialization.
 * - `terminate()` is exposed for cleanup during test teardown.
 */

import * as Comlink from "comlink";
import type { savedGameSerializeWorker } from "./saved-game-serialize.worker";

/**
 * Worker-side API surface (what `Comlink.expose` registers).
 */
export type SavedGameSerializeWorkerAPI = typeof savedGameSerializeWorker;

/**
 * Client-side remote API view. Differs from the worker-side type in that the
 * bytes entry point declares Comlink's trailing transfer-list argument:
 * `proxy.serializeReplayBytes(buffer, [buffer])` transfers the buffer
 * zero-copy instead of structured-cloning it (issue #1577 transfer-list
 * acceptance criterion). Comlink strips the transfer list before dispatch,
 * so the worker implementation signature is unchanged.
 */
export type SavedGameSerializeRemoteApi = {
  serializeReplay(payload: unknown): Promise<string>;
  serializeReplayBytes(
    payload: ArrayBuffer | [ArrayBuffer, number, number],
    transferList?: ArrayBuffer[],
  ): Promise<string>;
};

class SavedGameSerializeWorkerClient {
  private static instance: SavedGameSerializeWorkerClient | null = null;
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<SavedGameSerializeRemoteApi> | null = null;
  private initError: Error | null = null;

  private constructor() {
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      void this.init();
    }
  }

  public static getInstance(): SavedGameSerializeWorkerClient {
    if (!SavedGameSerializeWorkerClient.instance) {
      SavedGameSerializeWorkerClient.instance =
        new SavedGameSerializeWorkerClient();
    }
    return SavedGameSerializeWorkerClient.instance;
  }

  /**
   * Returns the Comlink proxy for the worker, or `null` when the worker
   * could not be initialised (no `Worker` global, init threw, etc).
   *
   * Returning `null` rather than throwing lets the bridge degrade gracefully
   * to the synchronous main-thread serialization — the same contract as
   * `BackupChecksumWorkerClient.getChecksumApi()` (#1249).
   */
  public getSerializeApi(): Comlink.Remote<SavedGameSerializeRemoteApi> | null {
    return this.proxy;
  }

  /**
   * Construct the worker and wrap it with Comlink. Any failure is swallowed:
   * `initError` is recorded and both handles are left `null` so callers see
   * a clean fallback signal rather than an exception.
   */
  private async init(): Promise<void> {
    try {
      let w: Worker | null = null;

      // Load the factory via dynamic import so the `import.meta.url`
      // token in the factory never reaches ts-jest's CJS parser.
      try {
        const mod =
          (await import("./saved-game-serialize-factory")) as unknown as {
            createSavedGameSerializeWorker?: () => Worker | null;
          };
        w = mod.createSavedGameSerializeWorker?.() ?? null;
      } catch {
        /* factory chunk failed to load — fall through to last-resort */
      }

      if (!w && typeof self !== "undefined" && self.location?.href) {
        try {
          w = new Worker(
            new URL("./saved-game-serialize.worker.ts", self.location.href)
              .href,
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
      this.proxy = Comlink.wrap<SavedGameSerializeRemoteApi>(this.worker);
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      console.warn(
        "[saved-game-serialize] Worker init failed; falling back to main-thread JSON.stringify:",
        this.initError,
      );
      this.worker = null;
      this.proxy = null;
    }
  }

  /**
   * Terminate the worker. Called from `_resetForTesting` and from any
   * long-lived consumer that wants to free the worker thread.
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.proxy = null;
    }
  }

  /**
   * Returns the init error if the worker failed to construct. Useful for
   * diagnostics / tests.
   */
  public getInitError(): Error | null {
    return this.initError;
  }

  /**
   * Reset the singleton. @internal — test-only; mirrors
   * `BackupChecksumWorkerClient._resetForTesting()`.
   */
  public static _resetForTesting(): void {
    if (SavedGameSerializeWorkerClient.instance) {
      SavedGameSerializeWorkerClient.instance.terminate();
    }
    SavedGameSerializeWorkerClient.instance = null;
  }
}

export const savedGameSerializeWorkerClient =
  SavedGameSerializeWorkerClient.getInstance();
export { SavedGameSerializeWorkerClient };
