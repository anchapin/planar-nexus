/**
 * @fileoverview Saved-game replay serialization bridge (issue #1577).
 *
 * Single seam between the main thread and the saved-game serialize Web
 * Worker. Mirrors `src/lib/backup/backup-checksum-bridge.ts` (#1249) and
 * `src/ai/worker/synergy-worker-bridge.ts` (#1079) /
 * `src/ai/worker/trigger-chain-worker-bridge.ts` (#1080) — the established
 * pattern for offloading CPU-heavy work to a worker with a transparent
 * main-thread fallback:
 *
 * - Resolves the worker client lazily through an injectable resolver so the
 *   worker path and the fallback path can be unit-tested without a real
 *   `Worker` global (jsdom does not provide one).
 * - The default resolver dynamic-imports the real client so this module is
 *   Jest-safe (`import.meta.url` cannot be statically required under
 *   ts-jest CommonJS).
 * - Any resolver or worker error is swallowed and routed to the main-thread
 *   fallback. A one-shot `console.warn` keeps the noise down on tight loops.
 * - The returned `replayJson` string is byte-identical between the worker
 *   path and the fallback path: both run the same pure helpers from
 *   `saved-game-serialize-core.ts` (`JSON.stringify(replay, mapReplacer)`),
 *   so saves written before #1577 are indistinguishable from saves written
 *   after it.
 *
 * Composition with related issues (deliberately NOT implemented here):
 * - #1572–#1574 restructure the saved-games/ReplaySystem store; this bridge
 *   sits at the serialization boundary and composes with whatever store
 *   shape lands there.
 * - wave-3-perf-2 compresses the at-rest `replayJson` bytes; compression
 *   composes after this seam (serialize first, then compress) and is
 *   untouched by this module.
 */

import type { Replay } from "./game-state/replay";
import {
  serializeReplayOnMainThread,
  replayJsonFromBytes,
} from "./saved-game-serialize-core";

// Note: the real client is loaded via dynamic import inside the default
// resolver (see below) — the same Jest-safe pattern used by
// `src/lib/backup/backup-checksum-bridge.ts` (#1249).

/**
 * Minimal shape of the serialize client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests
 * can inject a plain stub without pulling the import.meta-based client
 * module into the Jest module graph.
 */
export interface SavedGameSerializeApi {
  /**
   * Object mode: hand the replay object graph to the worker (Comlink
   * structured-clones it across) and run the `JSON.stringify` with the
   * `mapReplacer` callback inside the worker.
   */
  serializeReplay(payload: unknown): Promise<string>;

  /**
   * Bytes mode: pre-encoded replay JSON bytes cross zero-copy on the
   * Comlink transfer list (`transferList`, length 1 for a single
   * `ArrayBuffer` input — issue #1577 transfer-list acceptance criterion).
   * Comlink strips the transfer list before the worker implementation runs.
   */
  serializeReplayBytes(
    payload: ArrayBuffer | [ArrayBuffer, number, number],
    transferList?: ArrayBuffer[],
  ): Promise<string>;
}

export interface SavedGameSerializeClient {
  getSerializeApi(): SavedGameSerializeApi | null;
}

export type SavedGameSerializeClientResolver =
  () => Promise<SavedGameSerializeClient | null>;

/**
 * Default resolver: dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview. In ts-jest
 * CommonJS mode a static `import` of the client would attempt to evaluate
 * `new URL(..., import.meta.url)` at parse time and crash; a dynamic
 * `import()` is only resolved when the resolver runs at runtime, so test
 * environments that never call it (and that inject their own resolver)
 * never trip on `import.meta`.
 */
const defaultResolver: SavedGameSerializeClientResolver = async () => {
  try {
    const mod = await import("./saved-game-serialize-client");
    return mod.savedGameSerializeWorkerClient as unknown as SavedGameSerializeClient;
  } catch {
    return null;
  }
};

let clientResolver: SavedGameSerializeClientResolver = defaultResolver;
let fallbackWarningLogged = false;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a
 * stub worker client and exercise both the worker path and the fallback
 * path without a real Worker global.
 */
export function _setSavedGameSerializeClientResolver(
  resolver: SavedGameSerializeClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetSavedGameSerializeClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/** Emit a fallback `console.warn` at most once across the page lifetime. */
function warnFallback(reason: string, error?: unknown): void {
  if (fallbackWarningLogged) return;
  fallbackWarningLogged = true;
  console.warn(
    `[saved-game-serialize] ${reason}; falling back to main-thread JSON.stringify.`,
    error ?? "",
  );
}

/** Resolve the worker client, swallowing resolver failures as `null`. */
async function resolveClient(): Promise<SavedGameSerializeClient | null> {
  try {
    return await clientResolver();
  } catch {
    return null;
  }
}

/**
 * Serialize a replay into the canonical `replayJson` string, off the main
 * thread when the worker is available; otherwise on the main thread with
 * byte-identical results.
 *
 * This is the seam `savedGamesManager.saveToAutoSave` / `createSavedGame`
 * are wired through (issue #1577): a 50–200 MB
 * `JSON.stringify(replay, mapReplacer)` used to run synchronously inside the
 * auto-save path right after a user game action, blocking the next frame for
 * 200–500 ms. With a worker available, the stringify (including the
 * `mapReplacer` JS-callback walk) runs on the worker thread.
 *
 * Guarantees:
 * - Byte-identical output to the pre-#1577 synchronous
 *   `JSON.stringify(replay, mapReplacer)` call on both paths.
 * - `undefined` in, `undefined` out — callers pass the optional replay
 *   straight through (`replayJson?: string` stays unset for `null` replays).
 * - Never throws due to worker unavailability. Any resolver/client error is
 *   swallowed and routed to the main-thread fallback.
 */
export async function serializeReplayJson(
  replay: Replay | null | undefined,
): Promise<string | undefined> {
  if (replay === null || replay === undefined) {
    return undefined;
  }

  const client = await resolveClient();
  if (client) {
    const api = client.getSerializeApi();
    if (api) {
      try {
        return await api.serializeReplay(replay);
      } catch (error) {
        warnFallback("Worker serialization failed", error);
        // Fall through to main-thread fallback.
      }
    } else {
      warnFallback("Worker client has no serialize API");
    }
  }

  return serializeReplayOnMainThread(replay);
}

/**
 * Serialize pre-encoded replay JSON bytes into the canonical `replayJson`
 * string, off the main thread when the worker is available.
 *
 * Byte-level counterpart of {@link serializeReplayJson} for callers that
 * already hold serialized replay bytes (the composition point for
 * #1572–#1574 restructuring and the replay-compression issue): the
 * `ArrayBuffer` is handed to the worker on the Comlink transfer list
 * (`[buffer]`, a single transferable — zero-copy) instead of paying a
 * structured-clone copy of the payload.
 */
export async function serializeReplayJsonFromBytes(
  buffer: ArrayBuffer,
): Promise<string> {
  const client = await resolveClient();
  if (client) {
    const api = client.getSerializeApi();
    if (api) {
      try {
        return await api.serializeReplayBytes(buffer, [buffer]);
      } catch (error) {
        warnFallback("Worker bytes serialization failed", error);
        // Fall through to main-thread fallback.
      }
    } else {
      warnFallback("Worker client has no serialize API");
    }
  }

  return replayJsonFromBytes(buffer);
}

// Re-exported for parity tests: the oracle both paths must match.
export { serializeReplayOnMainThread };
