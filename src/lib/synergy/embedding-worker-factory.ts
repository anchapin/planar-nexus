import type { EmbeddingWorkerLike } from "./embedding-manager";

/**
 * @fileoverview Browser-only factory for the synergy embedding Web Worker
 * (issues #1813, #1894).
 *
 * This module is deliberately separate from `embedding-manager.ts` because it
 * captures `import.meta.url` at module top-level, which cannot be parsed
 * under ts-jest / Node CommonJS (`SyntaxError: Cannot use 'import.meta'
 * outside a module`). The manager reaches this module through a dynamic
 * `import()` wrapped in try/catch, so Jest, SSR, and any non-browser
 * environment never parse or execute it.
 *
 * Issue #1894 follow-up: the previous version guarded the URL with
 * `typeof import.meta !== "undefined"` and fell through to a hard-coded
 * `/_next/static/chunks/...` path that the dev server does not serve.
 * Top-level `new URL(import.meta.url)` is the canonical pattern that
 * webpack / Turbopack statically analyse to emit the worker as its own
 * chunk. The literal `import.meta` token is read in the actual module
 * realm (not a `new Function`-created global realm like the prior
 * helper in `search-worker-client.ts`), so it survives both dev and
 * production builds.
 */

/**
 * Module URL captured at evaluation time. Reading it here is what makes
 * the worker chunk statically analysable by webpack/Turbopack — they
 * see the literal `new URL(..., MODULE_URL)` shape and emit the worker
 * as its own chunk instead of trying to serve the raw `.ts` path.
 */
const MODULE_URL = new URL(import.meta.url);

/**
 * Constructs the embedding worker. Returns `null` in environments
 * without the `Worker` global (SSR, Jest/jsdom) or if construction
 * fails, so callers can degrade gracefully instead of crashing.
 */
export function createEmbeddingWorker(): EmbeddingWorkerLike | null {
  if (typeof Worker === "undefined") return null;

  try {
    const workerUrl = new URL("../ai/embedding-worker.ts", MODULE_URL).href;
    return new Worker(workerUrl);
  } catch (error) {
    console.error("Failed to create synergy embedding worker:", error);
    return null;
  }
}
