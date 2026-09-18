/**
 * @fileoverview Card search worker client (issue #1389, fix #1894).
 *
 * Worker URL resolution: production traffic uses the dedicated
 * `search-worker-factory.ts` module loaded via dynamic `import()` —
 * the factory captures `import.meta.url` at module top-level (the
 * `new URL("./search.worker.ts", MODULE_URL)` shape that webpack /
 * Turbopack statically analyse to emit the worker as its own chunk).
 * The dynamic import keeps the `import.meta` token out of ts-jest's
 * CJS parser.
 *
 * Acceptance criterion (issue #1894): Firefox/WebKit must load the
 * production worker — the prior `self.location.href` fallback
 * resolved to an HTML page that the dev server returns for any
 * unrecognised path, which those browsers refuse with a `text/html`
 * MIME error.
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

  private async init(): Promise<void> {
    try {
      let w: Worker | null = null;
      try {
        const mod = (await import("./search-worker-factory")) as {
          createSearchWorker?: () => Worker | null;
        };
        w = mod.createSearchWorker?.() ?? null;
      } catch {
        /* factory chunk failed to load — fall through to last-resort */
      }
      if (!w && typeof self !== "undefined" && self.location?.href) {
        try {
          w = new Worker(
            new URL("./search.worker.ts", self.location.href).href,
            { type: "module" },
          );
        } catch {
          /* last-resort failed too */
        }
      }
      if (!w) {
        this.status = "fallback";
        return;
      }
      this.worker = w;
      this.proxy = Comlink.wrap<SearchWorkerAPI>(this.worker);
      this.worker.addEventListener("error", (event) => {
        const message =
          (event as ErrorEvent).message ||
          `worker failed to load (${event.type})`;
        this.initError = new Error(`[search-worker] ${message}`);
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
