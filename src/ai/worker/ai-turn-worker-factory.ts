/**
 * @fileoverview Browser-only factory for the AI-opponent Web Worker
 * (planar-nexus issue #2417, slice 2).
 *
 * This module is deliberately separate from `ai-turn-worker-client.ts`
 * because it captures `import.meta.url` at module top-level — the
 * syntactic `import.meta` token is unparseable under ts-jest CommonJS
 * (`SyntaxError: Cannot use 'import.meta' outside a module`). The client
 * reaches this module through a dynamic `import()` wrapped in try/catch, so
 * Jest, SSR, and any non-browser environment never parse or execute it.
 *
 * The shape mirrors slice 1's `src/lib/game-state/engine-worker-factory.ts`
 * (and the repo's other worker factories):
 *
 *   - `const MODULE_URL = new URL(import.meta.url)` at module top level is
 *     the literal shape webpack / Turbopack statically analyse to emit the
 *     worker as its own chunk,
 *   - `new URL("./ai-turn-worker.ts", MODULE_URL)` resolves the worker
 *     relative to this module (both live in `src/ai/worker/`),
 *   - the factory returns `null` instead of throwing when no `Worker`
 *     global exists or when construction fails, so the client can degrade
 *     to the in-process handler.
 */

/**
 * Module URL captured at evaluation time. In the browser this is the
 * fully-qualified URL of this file as served by the bundler. Reading it
 * here, at module top-level, is what makes the worker chunk statically
 * analysable by webpack/Turbopack.
 */
const MODULE_URL = new URL(import.meta.url);

/**
 * The "not a bundled asset" fallback is static for the life of the page (the
 * worker URL never changes), so it is logged once per page context.
 */
let hasWarnedNotBundled = false;

/**
 * Constructs the AI-opponent worker. Returns `null` in environments
 * without the `Worker` global (SSR, Jest/jsdom), in dev builds where the
 * worker URL cannot be served as a module worker, or if construction
 * throws — callers then fall back to the in-process handler.
 */
export function createAITurnWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;

  try {
    const workerUrl = new URL("./ai-turn-worker.ts", MODULE_URL);

    // Same constraint as the search worker (issue #1937) and slice 1's
    // engine worker: only a bundled asset URL can load as a module worker.
    // Next.js DEV builds resolve `import.meta.url` to shapes the dev server
    // cannot serve as a worker module, so degrade to the in-process handler
    // instead of spawning a worker that can never load.
    if (!workerUrl.href.includes("/_next/")) {
      if (!hasWarnedNotBundled) {
        hasWarnedNotBundled = true;
        console.warn(
          "[ai-turn-worker-factory] worker URL is not a bundled asset (dev build?) — falling back to the in-process AI turn (logged once per page):",
          workerUrl.href,
        );
      }
      return null;
    }

    return new Worker(workerUrl.href, { type: "module" });
  } catch (error) {
    console.warn(
      "[ai-turn-worker-factory] failed to construct worker:",
      error,
    );
    return null;
  }
}
