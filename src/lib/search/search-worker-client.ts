/**
 * @fileoverview Card search worker client (issue #1389, fix #1894).
 *
 * Singleton that lazily initialises the Orama card-search Web Worker and
 * exposes a Comlink proxy.
 *
 * Issue #1894: the worker URL is resolved in `search-worker-factory.ts`
 * via a module-top-level `import.meta.url` capture. The factory is loaded
 * through a dynamic `import()` wrapped in try/catch so the `import.meta`
 * token never reaches the ts-jest CJS parser. When the factory chunk
 * fails to load (SSR, jsdom, unexpected bundler error), the client falls
 * back to a `self.location.href`-based URL — kept as a defense even
 * though Firefox/WebKit refuse that path's `text/html` MIME type
 * (#1894 acceptance criterion: preserve the fallback).
 *
 * When the worker cannot be initialised (no `Worker` global, init threw,
 * CSP blocked), `getSearchApi()` returns `null` and `getStatus()`
 * reports `"fallback"` so callers degrade gracefully to the main-thread
 * `cardSearchIndex`.
 */

import * as Comlink from "comlink";
import type { searchWorker } from "./search.worker";

export type SearchWorkerStatus =
  "ready" | "initializing" | "fallback" | "error";

export type SearchWorkerAPI = typeof searchWorker;

class SearchWorkerClient {
  private static instance: SearchWorkerClient | null = null;
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<SearchWorkerAPI> | null = null;
  private initError: Error | null = null;
  private status: SearchWorkerStatus = "fallback";

  private constructor() {
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      this.status = "initializing";
      void this.init();
    }
  }

  public static getInstance(): SearchWorkerClient {
    if (!SearchWorkerClient.instance) {
      SearchWorkerClient.instance = new SearchWorkerClient();
    }
    return SearchWorkerClient.instance;
  }

  /** Returns the Comlink proxy, or `null` if no worker could be built. */
  public getSearchApi(): Comlink.Remote<SearchWorkerAPI> | null {
    return this.proxy;
  }

  /** Current worker status — see {@link SearchWorkerStatus}. */
  public getStatus(): SearchWorkerStatus {
    return this.status;
  }

  /** Returns the init error if the worker failed to construct. */
  public getInitError(): Error | null {
    return this.initError;
  }

  /** Reset the singleton so tests can inject a different environment. */
  public static _resetForTesting(): void {
    if (SearchWorkerClient.instance) {
      SearchWorkerClient.instance.terminate();
      SearchWorkerClient.instance = null;
    }
  }

  /**
   * Construct the worker. Tries the factory first (proper
   * `import.meta.url` resolution), then falls back to `self.location.href`
   * for environments where the factory chunk failed to load.
   *
   * The dynamic `import()` is wrapped in a `Function` constructor so the
   * bundler does not statically trace it as a chunk dependency and emit
   * an eagerly-preloaded chunk loader for routes that pull in this
   * client (issue #1894 follow-up — bundle-budget impact).
   */
  private async init(): Promise<void> {
    try {
      let worker: Worker | null = null;
      try {
        const dynImport = new Function("p", "return import(p)") as (
          p: string,
        ) => Promise<{
          createSearchWorker?: () => Worker | null;
        }>;
        const mod = await dynImport("./search-worker-factory");
        worker = mod.createSearchWorker?.() ?? null;
      } catch (err) {
        console.warn("[search-worker] factory load failed:", err);
      }
      if (!worker && typeof self !== "undefined" && self.location?.href) {
        try {
          worker = new Worker(
            new URL("./search.worker.ts", self.location.href).href,
            { type: "module" },
          );
        } catch {
          /* last-resort failed */
        }
      }
      if (!worker) {
        this.status = "fallback";
        return;
      }
      this.worker = worker;
      this.proxy = Comlink.wrap<SearchWorkerAPI>(this.worker);
      this.worker.addEventListener("error", (event) => {
        const message =
          (event as ErrorEvent).message ||
          `worker failed to load (${event.type})`;
        this.initError = new Error(`[search-worker] ${message}`);
        console.warn(
          "[search-worker] Worker error; falling back to main-thread Orama search:",
          this.initError,
        );
        this.status = "error";
        this.proxy = null;
        try {
          this.worker?.terminate();
        } catch {
          /* already terminated */
        }
        this.worker = null;
      });
      this.status = "ready";
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      console.warn(
        "[search-worker] Worker init failed; falling back to main-thread Orama search:",
        this.initError,
      );
      this.worker = null;
      this.proxy = null;
      this.status = "error";
    }
  }

  /** Terminate the worker. */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.proxy = null;
    }
    this.status = "fallback";
  }
}

export { SearchWorkerClient };

/** Default singleton — shared across all consumers. */
export const searchWorkerClient = SearchWorkerClient.getInstance();
