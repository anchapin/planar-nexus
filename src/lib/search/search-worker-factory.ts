/**
 * @fileoverview Browser-only factory for the Orama card-search Web Worker
 * (issue #1894).
 *
 * This module is deliberately separate from `search-worker-client.ts`
 * because it captures `import.meta.url` at module top-level — the
 * syntactic `import.meta` token is unparseable under ts-jest CommonJS
 * (`SyntaxError: Cannot use 'import.meta' outside a module`). The
 * client reaches this module through a dynamic `import()` wrapped in
 * try/catch, so Jest, SSR, and any non-browser environment never parse
 * or execute it.
 *
 * Why a separate factory (issue #1780 follow-up): the prior client
 * tried to recover the calling module's URL via a
 * `new Function('try { return ... import.meta.url ... }')()` helper.
 * `new Function` builds a global-realm function; `import.meta` is a
 * module-scoped construct and is undefined there, so the helper
 * **always** returned `null` in production traffic. The client then
 * fell through to `self.location.href`, which resolved to
 * `…/single-player/search.worker.ts` — a path the Next.js dev server
 * does not serve as a JavaScript module. The 404 page's `text/html`
 * MIME type was rejected by Firefox/WebKit's worker-loader
 * (`X-Content-Type-Options: nosniff` makes Chromium lenient and
 * silent). The fix here uses the top-level module-realm
 * `import.meta.url`, which IS defined in every ESM environment.
 *
 * Mirrors `src/lib/synergy/embedding-worker-factory.ts` (issue #1813).
 */

/**
 * Module URL captured at evaluation time. In the browser this is the
 * fully-qualified URL of this file as served by the bundler
 * (e.g. `https://app/_next/static/chunks/search-worker-factory.js` in
 * production, a webpack-dev-server URL in dev). Reading it here, at
 * module top-level, is what makes the worker chunk statically
 * analysable by webpack/Turbopack — they see the literal
 * `new URL(..., MODULE_URL)` shape and emit the worker as its own
 * chunk instead of trying to serve the raw `.ts` path.
 */
const MODULE_URL = new URL(import.meta.url);

/**
 * Constructs the Orama card-search worker. Returns `null` in
 * environments without the `Worker` global (SSR, Jest/jsdom) or if
 * construction throws, so callers can degrade gracefully instead of
 * crashing.
 */
export function createSearchWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;

  try {
    const workerUrl = new URL("./search.worker.ts", MODULE_URL).href;
    return new Worker(workerUrl, { type: "module" });
  } catch (error) {
    console.warn(
      "[search-worker-factory] failed to construct worker:",
      error,
    );
    return null;
  }
}
