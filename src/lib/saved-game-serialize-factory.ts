/**
 * @fileoverview Browser-only factory for the saved-game serialization Web Worker
 * (issue #1912).
 *
 * This module is deliberately separate from `saved-game-serialize-client.ts` because it
 * captures `import.meta.url` at module top-level, which cannot be parsed
 * under ts-jest / Node CommonJS (`SyntaxError: Cannot use 'import.meta'
 * outside a module'). The client reaches this module through a dynamic
 * `import()` wrapped in try/catch, so Jest, SSR, and any non-browser
 * environment never parse or execute it.
 *
 * Issue #1894 follow-up: the previous version used a `Function` constructor
 * that evaluated `import.meta.url` in the host realm — which silently 404s
 * with the Next.js dev-server HTML page that Firefox/WebKit refuse under
 * `X-Content-Type-Options: nosniff`. Top-level `new URL(import.meta.url)`
 * is the canonical pattern that webpack / Turbopack statically analyse to
 * emit the worker as its own chunk. The literal `import.meta` token is
 * read in the actual module realm (not a `new Function`-created global
 * realm), so it survives both dev and production builds.
 */

/**
 * Module URL captured at evaluation time. Reading it here is what makes
 * the worker chunk statically analysable by webpack/Turbopack — they
 * see the literal `new URL(..., MODULE_URL)` shape and emit the worker
 * as its own chunk instead of trying to serve the raw `.ts` path.
 */
const MODULE_URL = new URL(import.meta.url);

/**
 * Constructs the saved-game serialization worker. Returns `null` in environments
 * without the `Worker` global (SSR, Jest/jsdom) or if construction
 * fails, so callers can degrade gracefully instead of crashing.
 */
export function createSavedGameSerializeWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;

  try {
    const workerUrl = new URL("./saved-game-serialize.worker.ts", MODULE_URL)
      .href;
    return new Worker(workerUrl, { type: "module" });
  } catch (error) {
    console.error("Failed to create saved-game serialize worker:", error);
    return null;
  }
}
