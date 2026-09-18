/**
 * @fileoverview Card search worker client (issue #1389).
 *
 * Singleton that lazily initialises the Orama card-search Web Worker and
 * exposes a Comlink proxy. Mirrors the pattern in
 * `src/lib/backup/backup-checksum-client.ts` (issue #1249) and
 * `src/ai/worker/ai-worker-client.ts` (issue #1079):
 *
 * - Worker URL is resolved with `import.meta.url` so Next.js / Vite can
 *   bundle the worker module correctly under ESM. We fall back to a plain
 *   string path if `import.meta` is unavailable (Jest CJS, older runtimes).
 * - When the worker cannot be initialised (no `Worker` global — jsdom, SSR,
 *   server tests, CSP-blocked), `getSearchApi()` returns `null` and
 *   `getStatus()` reports `"fallback"` so callers degrade gracefully to the
 *   main-thread `cardSearchIndex`.
 * - `getStatus()` transitions through `"initializing"` -> `"ready"` on
 *   successful worker construction, or -> `"fallback"` / `"error"` on
 *   failure.
 *
 * Issue #1780: the `import.meta.url` resolution is intentionally
 * double-guarded — see the long-form note on `resolveImportMetaUrl()` at
 * the bottom of the file for the Firefox/WebKit MIME-type trap that the
 * `worker-src` CSP and the dev server's 404 page conspire to produce.
 * The fix scope for #1780 is the card-database side (waiting for
 * `initializeCardDatabase()` before the prewarm reads); the Worker URL
 * resolution is documented for a follow-up.
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
   * Issue #1780 (cross-browser E2E follow-up): the constructor does not
   * throw for the MIME-type failure mode that Firefox/WebKit exhibit when
   * the dev server returns `text/html` for an unresolved worker path
   * ("Loading Worker from ... was blocked because of a disallowed MIME
   * type"). The browser surfaces that as an asynchronous console.error
   * and fires the worker's `error` event — listening on that event gives
   * us a clean signal to surface in `initError` and `getStatus()`. The
   * underlying URL resolution is still broken in dev (see
   * `resolveImportMetaUrl()` docstring); the event-listener wiring here
   * is the diagnostic complement, not a fix for the URL resolution.
   */
  private init(): void {
    try {
      let workerUrl: string | URL;

      const metaUrl = resolveImportMetaUrl();
      if (metaUrl) {
        workerUrl = new URL("./search.worker.ts", metaUrl).href;
      } else if (
        typeof self !== "undefined" &&
        (self as unknown as { location?: Location }).location?.href
      ) {
        workerUrl = new URL(
          "./search.worker.ts",
          (self as unknown as { location: Location }).location.href,
        ).href;
      } else {
        workerUrl = "./search.worker.ts";
      }

      this.worker = new Worker(workerUrl, { type: "module" });
      this.proxy = Comlink.wrap<SearchWorkerAPI>(this.worker);

      // Issue #1780: surface async worker failures (MIME-type rejection,
      // 404, network drop) via `initError` + the `"error"` status, so the
      // prewarm helper and any UI subscriber can react. The constructor's
      // try/catch only sees synchronous failures; the `error` event covers
      // the rest.
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

/**
 * Resolve `import.meta.url` at runtime in a way that survives both ESM
 * (browser / Next.js worker loader) and CJS (Jest ts-jest, Node SSR)
 * contexts. Uses a `Function` constructor so the `import.meta` token is
 * only evaluated in the host realm — Node's CommonJS parser would
 * otherwise reject it as a SyntaxError.
 *
 * Returns `null` when the host has no ESM module URL — callers fall back
 * to `self.location.href` or a plain string path.
 *
 * Issue #1780 note: in the browser the `new Function(...)` body runs in
 * the global-scope realm where `import.meta` is undefined (it is a
 * module-scoped concept). So this helper returns `null` in the browser,
 * which means production traffic always falls through to the
 * `self.location.href` branch. That branch resolves to a path the Next.js
 * dev server does not serve as a JavaScript module (the `.ts` extension
 * is not in any recognized route), so Firefox/WebKit refuse the Worker
 * construct with the "disallowed MIME type" error — Chromium is lenient
 * and accepts `text/html` for the same URL. The proper fix is to follow
 * the `src/lib/synergy/embedding-worker-factory.ts` pattern: extract the
 * `new URL("./search.worker.ts", import.meta.url)` line into a separate
 * factory module loaded via dynamic `import()`, so webpack's worker
 * loader can statically analyse it and emit the worker as its own chunk.
 * That refactor is intentionally deferred from #1780 — the card-database
 * side of the fix (waiting for `initializeCardDatabase()` before reading)
 * is the user-visible behaviour change; the Worker URL resolution is a
 * longer-term follow-up that affects every worker in the app.
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

export { SearchWorkerClient };

/**
 * Default singleton — the primary import for consumers. Shares a single
 * underlying worker across all call sites.
 */
export const searchWorkerClient = SearchWorkerClient.getInstance();
