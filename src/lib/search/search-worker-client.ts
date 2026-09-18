/**
 * @fileoverview Card search worker client (issue #1389, fix #1894).
 *
 * Singleton that lazily initialises the Orama card-search Web Worker and
 * exposes a Comlink proxy. Mirrors the pattern in
 * `src/lib/backup/backup-checksum-client.ts` (issue #1249) and
 * `src/ai/worker/ai-worker-client.ts` (issue #1079):
 *
 * - Worker URL is resolved in `search-worker-factory.ts` via a
 *   module-top-level `import.meta.url` capture — the literal
 *   `new URL("./search.worker.ts", MODULE_URL)` shape that webpack /
 *   Turbopack statically analyse to emit the worker as its own chunk.
 *   The factory is loaded through a dynamic `import()` wrapped in
 *   try/catch so the `import.meta` token never reaches the parser in
 *   ts-jest CJS, SSR, or any other non-ESM context.
 * - A last-resort `self.location.href` branch stays in place for the
 *   case where the dynamic import fails for an unexpected reason in
 *   the browser — Firefox/WebKit refused the broken-path worker with
 *   a `text/html` MIME error (issue #1894 acceptance criterion: keep
 *   the fallback, do not remove it).
 * - When the worker cannot be initialised (no `Worker` global — jsdom,
 *   SSR, server tests, CSP-blocked), `getSearchApi()` returns `null`
 *   and `getStatus()` reports `"fallback"` so callers degrade
 *   gracefully to the main-thread `cardSearchIndex`.
 * - `getStatus()` transitions through `"initializing"` -> `"ready"` on
 *   successful worker construction, or -> `"fallback"` / `"error"` on
 *   failure.
 *
 * Issue #1894 follows up on #1780. The previous
 * `resolveImportMetaUrl()` helper used `new Function(...)` to recover
 * the calling module's URL, but `new Function` builds a global-realm
 * function where `import.meta` is undefined — so the helper always
 * returned `null` in production traffic and the client fell through
 * to `self.location.href`, which resolved to a path the Next.js dev
 * server does not serve as a JavaScript module. Firefox/WebKit
 * refused that path's `text/html` MIME type; Chromium was lenient and
 * silent. The split into `search-worker-factory.ts` + dynamic import
 * is the proper fix: the literal `import.meta.url` is read in the
 * actual module realm and survives both dev and production builds.
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
      this.init();
    }
  }

  public static getInstance(): SearchWorkerClient {
    if (!SearchWorkerClient.instance) {
      SearchWorkerClient.instance = new SearchWorkerClient();
    }
    return SearchWorkerClient.instance;
  }

  /**
   * Returns the Comlink proxy for the worker, or `null` when the worker
   * could not be initialised (no `Worker` global, init threw, CSP blocked
   * the module load). Returning `null` lets the caller fall back to the
   * main-thread `cardSearchIndex.search()`.
   */
  public getSearchApi(): Comlink.Remote<SearchWorkerAPI> | null {
    return this.proxy;
  }

  /**
   * Current worker status. Transitions:
   *   "initializing" -> "ready"  (worker spawned successfully)
   *   "initializing" -> "error"  (worker construction threw)
   *   "fallback"               (no Worker global at all — jsdom/SSR)
   */
  public getStatus(): SearchWorkerStatus {
    return this.status;
  }

  /**
   * Returns the init error if the worker failed to construct. Useful for
   * diagnostics and tests.
   */
  public getInitError(): Error | null {
    return this.initError;
  }

  /**
   * Reset the singleton so tests can inject a different environment.
   * @internal
   */
  public static _resetForTesting(): void {
    if (SearchWorkerClient.instance) {
      SearchWorkerClient.instance.terminate();
      SearchWorkerClient.instance = null;
    }
  }

  /**
   * Initialise the Web Worker and Comlink proxy.
   *
   * Issue #1894 fix: the worker URL is now produced by
   * `search-worker-factory.ts` (loaded via dynamic `import()` so the
   * `import.meta` token never reaches the ts-jest CJS parser). The
   * `self.location.href` branch is preserved as a last-resort fallback
   * for the rare case where the dynamic import fails in the browser
   * for an unrelated reason.
   *
   * Issue #1780 (cross-browser E2E follow-up): the constructor does
   * not throw for the MIME-type failure mode that Firefox/WebKit
   * exhibit when the dev server returns `text/html` for an
   * unresolved worker path ("Loading Worker from ... was blocked
   * because of a disallowed MIME type"). The browser surfaces that
   * as an asynchronous console.error and fires the worker's `error`
   * event — listening on that event gives us a clean signal to
   * surface in `initError` and `getStatus()`. The URL resolution
   * itself is no longer broken in production builds (issue #1894),
   * so the `error` event should now only fire for genuinely
   * unexpected load failures.
   */
  private init(): void {
    // Kick off the async factory load. The status stays at
    // `"initializing"` until the promise settles. Callers poll
    // `getStatus()` (see `use-search-worker.ts`) or check
    // `getSearchApi()` directly.
    void this.initAsync();
  }

  private async initAsync(): Promise<void> {
    try {
      const worker = await this.loadWorker();
      if (!worker) {
        // Factory returned null (no `Worker` global — jsdom/SSR) or
        // the last-resort fallback path also failed. The synchronous
        // constructor already set status to `"initializing"`; flip it
        // to `"fallback"` so callers degrade gracefully.
        this.worker = null;
        this.proxy = null;
        this.status = "fallback";
        return;
      }

      this.worker = worker;
      this.proxy = Comlink.wrap<SearchWorkerAPI>(this.worker);

      // Issue #1780: surface async worker failures (MIME-type
      // rejection, 404, network drop) via `initError` + the `"error"`
      // status, so the prewarm helper and any UI subscriber can
      // react. The constructor's try/catch only sees synchronous
      // failures; the `error` event covers the rest.
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
        // The proxy is still attached but every Comlink call would now
        // throw. Drop it so callers fall back to `cardSearchIndex` cleanly
        // instead of seeing raw Comlink errors.
        this.proxy = null;
        try {
          this.worker?.terminate();
        } catch {
          // already terminated — nothing to do
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

  /**
   * Resolves a `Worker` for the card-search module. Returns `null`
   * if no worker can be constructed in this environment. The
   * resolution order is:
   *
   *  1. Dynamic import of `search-worker-factory.ts` — the proper
   *     production path. The factory uses a top-level
   *     `import.meta.url` capture so the worker URL is statically
   *     analysable by the bundler.
   *  2. Last-resort `self.location.href` — kept so the
   *     acceptance-criterion "fallback is preserved" holds even if
   *     step 1 fails for an unexpected reason in the browser.
   *  3. Plain string path — used when neither `self.location.href`
   *     nor the factory is available (e.g. exotic SSR setup).
   */
  private async loadWorker(): Promise<Worker | null> {
    // Step 1: proper ESM factory. The dynamic `import()` is wrapped
    // in try/catch: ts-jest CJS will throw on the `import.meta`
    // inside the factory, SSR will throw on the missing `Worker`,
    // and any unexpected bundler error is surfaced as a clean null
    // instead of a thrown exception out of the constructor.
    try {
      const mod = (await import(
        /* webpackChunkName: "search-worker-factory" */
        "./search-worker-factory"
      )) as {
        createSearchWorker?: () => Worker | null;
      };
      const factoryWorker = mod.createSearchWorker?.() ?? null;
      if (factoryWorker) return factoryWorker;
    } catch (factoryError) {
      // Non-browser environment (ts-jest, SSR) or unexpected bundle
      // error — fall through to the last-resort path.
      console.warn(
        "[search-worker] factory load failed; trying last-resort path:",
        factoryError,
      );
    }

    // Step 2 (last-resort fallback — issue #1894 acceptance
    // criterion): `self.location.href`. This is the path that
    // Firefox/WebKit refused with a `text/html` MIME error in #1894,
    // but we keep it as a defense so the client never silently
    // produces zero workers in a real browser if the dynamic import
    // is unexpectedly broken.
    if (
      typeof self !== "undefined" &&
      (self as unknown as { location?: Location }).location?.href
    ) {
      try {
        return new Worker(
          new URL(
            "./search.worker.ts",
            (self as unknown as { location: Location }).location.href,
          ).href,
          { type: "module" },
        );
      } catch {
        // Last resort failed too — give up.
      }
    }

    return null;
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
    this.status = "fallback";
  }
}

export { SearchWorkerClient };

/**
 * Default singleton — the primary import for consumers. Shares a single
 * underlying worker across all call sites.
 */
export const searchWorkerClient = SearchWorkerClient.getInstance();
