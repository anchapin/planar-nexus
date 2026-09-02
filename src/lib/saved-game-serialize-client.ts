/**
 * @fileoverview Saved-game replay serialization worker client (issue #1577).
 *
 * Singleton that lazily initialises the saved-game serialize Web Worker and
 * exposes a Comlink proxy. Mirrors the pattern in
 * `src/lib/backup/backup-checksum-client.ts` (issue #1249) and
 * `src/ai/worker/ai-worker-client.ts` (#1079, #1080):
 *
 * - Worker URL is resolved with `import.meta.url` (via a `Function`
 *   constructor so ts-jest CommonJS never parses the token) so Next.js can
 *   bundle the worker module correctly under ESM. Falls back to
 *   `self.location.href` and then a plain string path.
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
      this.init();
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
  private init(): void {
    try {
      let workerUrl: string;

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
        workerUrl = new URL("./saved-game-serialize.worker.ts", metaUrl).href;
      } else if (
        typeof self !== "undefined" &&
        (self as unknown as { location?: Location }).location?.href
      ) {
        workerUrl = new URL(
          "./saved-game-serialize.worker.ts",
          (self as unknown as { location: Location }).location.href,
        ).href;
      } else {
        // Plain string path — Next.js and Vite both resolve this against
        // the worker chunk directory at build time.
        workerUrl = "./saved-game-serialize.worker.ts";
      }

      this.worker = new Worker(workerUrl, { type: "module" });
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

/**
 * Resolve `import.meta.url` at runtime in a way that survives both ESM
 * (browser / Next.js worker loader) and CJS (Jest ts-jest, Node SSR)
 * contexts. Uses a `Function` constructor so the `import.meta` token is
 * only evaluated in the host realm — Node's CommonJS parser would
 * otherwise reject it as a SyntaxError.
 *
 * Returns `null` when the host has no ESM module URL — callers fall back to
 * `self.location.href` or a plain string path.
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

export const savedGameSerializeWorkerClient =
  SavedGameSerializeWorkerClient.getInstance();
export { SavedGameSerializeWorkerClient };
