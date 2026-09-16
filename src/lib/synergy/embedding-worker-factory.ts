import type { EmbeddingWorkerLike } from "./embedding-manager";

/**
 * @fileoverview Browser-only factory for the synergy embedding Web Worker
 * (issue #1813).
 *
 * This module is deliberately separate from `embedding-manager.ts` because it
 * contains `import.meta`, which cannot be parsed under ts-jest / Node
 * CommonJS (`SyntaxError: Cannot use 'import.meta' outside a module`) — the
 * same constraint that keeps `ai-worker-client.ts` behind a dynamic
 * `import()` in `synergy-worker-bridge.ts`. The manager reaches this module
 * through a dynamic `import()` wrapped in try/catch, so Jest, SSR, and any
 * non-browser environment never parse or execute it.
 */

/**
 * Constructs the embedding worker. Returns `null` in environments without
 * the `Worker` global (SSR, Jest/jsdom) or if construction fails, so callers
 * can degrade gracefully instead of crashing.
 */
export function createEmbeddingWorker(): EmbeddingWorkerLike | null {
  if (typeof Worker === "undefined") return null;

  try {
    // Use dynamic URL resolution to avoid SSR/bundling issues. The literal
    // `new Worker(new URL(..., import.meta.url))` shape is what webpack /
    // Turbopack statically analyze to emit the worker as its own chunk.
    const workerPath =
      typeof import.meta !== "undefined" && import.meta.url
        ? new URL("../ai/embedding-worker.ts", import.meta.url).href
        : "/_next/static/chunks/embedding-worker.ts"; // Fallback path

    return new Worker(workerPath);
  } catch (error) {
    console.error("Failed to create synergy embedding worker:", error);
    return null;
  }
}
