/**
 * @fileoverview Saved-game replay serialization Web Worker (issue #1577).
 *
 * Runs the 50–200 MB `JSON.stringify(replay, mapReplacer)` call — previously
 * synchronous on the main thread inside `savedGamesManager.saveToAutoSave` /
 * `createSavedGame` — off the main thread so auto-save stops blocking the
 * next rendered frame after a game action.
 *
 * Mirrors `src/lib/backup/backup-checksum.worker.ts` (#1249), the established
 * Comlink worker pattern:
 *
 * - The Comlink-exposed surface is a plain async object (`savedGameSerializeWorker`).
 * - All serialization logic lives in the pure `saved-game-serialize-core.ts`
 *   module shared with the main-thread fallback, so both paths produce
 *   byte-identical `replayJson` output.
 * - The `Comlink.expose` registration is guarded so requiring this module in
 *   Node/Jest (no worker realm) is a no-op and the functions can be exercised
 *   directly by unit tests.
 */

import {
  serializeReplayOnMainThread,
  replayJsonFromBytes,
} from "./saved-game-serialize-core";

/**
 * Comlink-exposed worker API. Same surface the client
 * (`saved-game-serialize-client.ts`) proxies.
 *
 * Note on `serializeReplayBytes`: the *client-side* proxy type declares an
 * additional trailing `transferList?: ArrayBuffer[]` parameter — Comlink's
 * convention for the postMessage transfer list. Comlink strips that argument
 * before invoking the exposed implementation, so the worker-side signature
 * only sees `payload`. The bridge passes `[buffer]` so the payload crosses
 * the boundary zero-copy (issue #1577 transfer-list acceptance criterion).
 */
export const savedGameSerializeWorker = {
  /**
   * Serialize a replay object graph into the canonical `replayJson` string.
   *
   * The `Replay` payload (with its nested `Map` objects — structured-clone
   * safe) is handed to the worker by Comlink; the expensive stringify with
   * the `mapReplacer` JS callback runs here, off the main thread.
   */
  async serializeReplay(payload: unknown): Promise<string> {
    return serializeReplayOnMainThread(payload);
  },

  /**
   * Serialize pre-encoded replay JSON bytes back to the canonical
   * `replayJson` string. Accepts a whole `ArrayBuffer` or a
   * `[buffer, byteOffset, byteLength]` sub-region (transfer-list entry) so a
   * slice of a larger buffer can be processed without copying — the same
   * shape `backup-checksum.worker.ts` accepts.
   */
  async serializeReplayBytes(
    payload: ArrayBuffer | [ArrayBuffer, number, number],
  ): Promise<string> {
    return replayJsonFromBytes(payload);
  },
};

export type SavedGameSerializeWorkerAPI = typeof savedGameSerializeWorker;

// Worker entrypoint. When this module is loaded as a Web Worker
// (`new Worker(url, { type: "module" })`), `Comlink.expose` registers
// `savedGameSerializeWorker` as the worker RPC surface. In Node/test contexts
// this is a no-op (the `self`/`Worker` global is missing or we are inside the
// same realm as the test runner), and the `serializeReplay` /
// `serializeReplayBytes` functions are exercised directly.
declare const self: {
  postMessage: (message: unknown) => void;
  onmessage?: (event: { data: unknown }) => void | Promise<void>;
  addEventListener?: (
    type: string,
    listener: (event: { data: unknown }) => void,
  ) => void;
};

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  // Defer Comlink import to avoid pulling it into the synchronous Jest module
  // graph when this module is required by tests.
  void import("comlink").then((Comlink) => {
    Comlink.expose(savedGameSerializeWorker);
  });
}
