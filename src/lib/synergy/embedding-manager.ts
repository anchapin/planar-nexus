/**
 * @fileoverview Synergy embedding worker manager — module-level singleton.
 *
 * Issue #1813: the deck-builder previously spawned a fresh embedding
 * Worker on every SynergyProvider mount and posted LOAD_MODEL
 * unconditionally, paying the multi-MB model download + onnxruntime WASM
 * init on every page visit even when the user never opened the synergy
 * panel. This module owns the Worker + model lifecycle at the module
 * level so:
 *
 *   1. The Worker (and the loaded model) survives route transitions
 *      and provider remounts.
 *   2. `ensureStarted()` is the single idempotent entry point — re-arms
 *      after errors but otherwise posts LOAD_MODEL exactly once.
 *   3. Subscribers receive raw worker responses (re-broadcast), letting
 *      callers derive their own model state and dispatch embeddings.
 *
 * The Worker factory is injected via `_setEmbeddingWorkerFactoryLoader`
 * so tests can substitute a fake without touching `globalThis.Worker`
 * (jsdom has no real Web Worker and importing the production worker
 * file would pull in the heavy transformers/onnxruntime stack).
 */

import type { WorkerMessage, WorkerResponse } from "@/lib/ai/embedding-worker";

/** Lifecycle of the worker + model. */
export type EmbeddingWorkerLoadState =
  "not-started" | "loading" | "ready" | "error";

/**
 * Structural type for an embedding Worker. Mirrors the subset of the
 * Web Worker API the manager uses; tests supply a fake with the same
 * shape. The `type` parameter is a union (rather than two overloads) so
 * class-based test fakes that declare addEventListener as overloaded
 * methods are structurally assignable across ts-jest configurations.
 */
export interface EmbeddingWorkerLike {
  postMessage(message: WorkerMessage): void;
  addEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<WorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void;
  removeEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<WorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void;
  terminate?(): void;
}

type WorkerFactoryLoader = () => Promise<
  (() => EmbeddingWorkerLike | null) | null
>;

export class EmbeddingWorkerManager {
  private worker: EmbeddingWorkerLike | null = null;
  private loadState: EmbeddingWorkerLoadState = "not-started";
  private factoryLoader: WorkerFactoryLoader | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadResolve: (() => void) | null = null;
  private loadReject: ((err: Error) => void) | null = null;
  private listeners = new Set<(response: WorkerResponse) => void>();
  private pendingResolve:
    ((results: Array<{ id: string; embedding: number[] }>) => void) | null =
    null;
  private pendingReject: ((err: Error) => void) | null = null;

  getLoadState(): EmbeddingWorkerLoadState {
    return this.loadState;
  }

  /**
   * Subscribe to raw worker responses. The manager re-broadcasts every
   * WorkerResponse it receives to all current subscribers; callers
   * dispatch on `response.type` (MODEL_LOADED, EMBEDDINGS_GENERATED,
   * ERROR). No synthetic state events are emitted.
   */
  subscribe(listener: (response: WorkerResponse) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Idempotent. Returns a promise that resolves when the worker reaches
   * `ready` (MODEL_LOADED) or — if the factory can't produce a worker
   * (jsdom / SSR / loader throws) — resolves immediately and stays
   * `not-started`. Never rejects on factory failure: the manager must
   * remain inert and queryable so the provider can render a graceful
   * empty state.
   *
   * Production path: when no factory has been registered (e.g. by a
   * test), dynamically import `embedding-worker-factory` — the
   * browser-only module that constructs the real Worker (it uses
   * `import.meta`, which is unparseable under ts-jest, so the dynamic
   * import is wrapped in try/catch to keep non-browser environments
   * inert).
   */
  ensureStarted(): Promise<void> {
    if (this.loadState === "ready") return Promise.resolve();
    if (this.loadState === "loading" && this.loadPromise)
      return this.loadPromise;

    // From here we're starting (or retrying after an error). Reset the
    // load bookkeeping, then ensure a worker and post LOAD_MODEL —
    // reusing the existing worker instance on retry.
    this.loadState = "loading";
    this.loadPromise = new Promise<void>((resolve) => {
      this.loadResolve = resolve;
      this.loadReject = null;
      const settleInert = () => {
        this.loadState = "not-started";
        this.loadPromise = null;
        const r = this.loadResolve;
        this.loadResolve = null;
        this.loadReject = null;
        r?.();
      };
      (async () => {
        try {
          if (!this.worker) {
            let factory: (() => EmbeddingWorkerLike | null) | null = null;
            if (this.factoryLoader) {
              factory = await this.factoryLoader();
            } else {
              // Production fallback: dynamic import the browser-only
              // factory module. The module is unparseable under ts-jest
              // (import.meta), so the import throws there — caught by
              // the surrounding try/catch and settleInert.
              try {
                const mod = (await import(
                  /* webpackChunkName: "synergy-worker" */
                  "./embedding-worker-factory"
                )) as {
                  createEmbeddingWorker?: () => EmbeddingWorkerLike | null;
                };
                factory = mod.createEmbeddingWorker ?? null;
              } catch {
                factory = null;
              }
            }
            if (!factory) {
              settleInert();
              return;
            }
            const w = factory();
            if (!w) {
              settleInert();
              return;
            }
            this.worker = w;
            this.attachListeners(w);
          }
          // Worker is ready (new or reused). Post LOAD_MODEL; resolve
          // eagerly — the load is "started" once the request is on the
          // wire. The MODEL_LOADED round-trip flips state to "ready" via
          // the attached message listener (see attachListeners), which
          // callers observe through subscribe(getLoadState()).
          this.worker!.postMessage({ type: "LOAD_MODEL" } as WorkerMessage);
          const r = this.loadResolve;
          this.loadResolve = null;
          this.loadReject = null;
          r?.();
        } catch {
          settleInert();
        }
      })();
    });
    return this.loadPromise;
  }

  /**
   * Request embeddings for the given cards. Resolves with the worker's
   * EMBEDDINGS_GENERATED results, or — if no worker is available —
   * resolves with an empty array (no-op) so callers don't need to
   * guard. Rejects only on worker-level errors (ERROR response).
   */
  async requestEmbeddings(
    cards: Extract<WorkerMessage, { type: "GENERATE_EMBEDDINGS" }>["cards"],
  ): Promise<Array<{ id: string; embedding: number[] }>> {
    if (!this.worker) {
      // No-op: caller must check `getLoadState()` for graceful UI.
      return [];
    }
    await this.ensureStarted();
    if (!this.worker) return [];
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.worker!.postMessage({
        type: "GENERATE_EMBEDDINGS",
        cards,
      } as WorkerMessage);
    });
  }

  /** Tear down (test-only). */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate?.();
      this.worker = null;
    }
    this.loadState = "not-started";
    this.loadPromise = null;
    this.loadResolve = null;
    this.loadReject = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private attachListeners(worker: EmbeddingWorkerLike): void {
    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        // Re-broadcast to subscribers first — tests assert on the
        // collected sequence.
        for (const l of this.listeners) {
          l(response);
        }
        if (response.type === "MODEL_LOADED") {
          this.loadState = "ready";
          const r = this.loadResolve;
          this.loadResolve = null;
          this.loadReject = null;
          r?.();
          return;
        }
        if (response.type === "EMBEDDINGS_GENERATED") {
          const results = (
            response as unknown as {
              results: Array<{ id: string; embedding: number[] }>;
            }
          ).results;
          const r = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingReject = null;
          r?.(results);
          return;
        }
        if (response.type === "ERROR") {
          const err = new Error(
            (response as { error?: string }).error ?? "worker error",
          );
          this.loadState = "error";
          const pr = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          pr?.(err);
          const lr = this.loadResolve;
          if (lr) {
            this.loadResolve = null;
            this.loadReject = null;
            this.loadPromise = null;
            // Don't reject the outer ensureStarted promise on worker
            // errors — the manager stays queryable. Call the captured
            // resolve via loadResolve? We resolve (settle) the load promise
            // so the caller doesn't hang.
            lr();
          }
          return;
        }
        // PROGRESS: ignored.
      },
    );

    worker.addEventListener("error", (event: ErrorEvent) => {
      const err = new Error(event.message || "worker load error");
      this.loadState = "error";
      const pr = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      pr?.(err);
      const lr = this.loadResolve;
      if (lr) {
        this.loadResolve = null;
        this.loadReject = null;
        this.loadPromise = null;
        lr();
      }
      for (const l of this.listeners) {
        l({ type: "ERROR", error: err.message });
      }
    });
  }
}

// --- Module-level singleton + test seams ------------------------------------

export const embeddingWorkerManager = new EmbeddingWorkerManager();

/**
 * Register a factory loader. The loader returns a factory that
 * produces a fresh `EmbeddingWorkerLike` per call (so tests get a new
 * fake each time and production can `new Worker(url)`). Pass `null`
 * to clear.
 */
export function _setEmbeddingWorkerFactoryLoader(
  loader: WorkerFactoryLoader | null,
): WorkerFactoryLoader | null {
  const prev = embeddingWorkerManager[
    "factoryLoader" as keyof EmbeddingWorkerManager
  ] as WorkerFactoryLoader | null;
  (
    embeddingWorkerManager as unknown as {
      factoryLoader: WorkerFactoryLoader | null;
    }
  ).factoryLoader = loader;
  return prev;
}

/**
 * Test-only: tear down the singleton (worker, listeners, state).
 * Called from `beforeEach` to isolate tests.
 */
export function _resetEmbeddingWorkerManager(): void {
  embeddingWorkerManager.destroy();
}
