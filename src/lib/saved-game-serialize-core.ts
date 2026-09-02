/**
 * @fileoverview Shared pure helpers for saved-game replay serialization.
 *
 * Issue #1577: the replay `JSON.stringify(replay, mapReplacer)` call in the
 * auto-save path is a 50–200 MB synchronous main-thread stall. The fix moves
 * that serialization into a Web Worker (`saved-game-serialize.worker.ts`)
 * behind the bridge (`saved-game-serialize-bridge.ts`).
 *
 * This module holds the pure serialization primitives so the worker path and
 * the main-thread fallback path execute *the same code*, which guarantees the
 * persisted `replayJson` bytes are identical regardless of which path ran
 * (issue #1577 parity acceptance criterion).
 *
 * Mirrors the role of the digest helper inside `src/lib/backup/backup-checksum.worker.ts`
 * (#1249): the pure core is import-safe from both a worker realm and the
 * Jest/jsdom realm (no `import.meta`, no Worker global references).
 */

import { mapReplacer, mapReviver } from "./game-state/state-serialization";

/**
 * Serialize a replay payload with the Map-preserving replacer — the exact
 * pre-#1577 synchronous implementation. Byte-identical output is what the
 * fallback path (and the parity tests) rely on: saves written before #1577
 * must be indistinguishable from saves written after it.
 */
export function serializeReplayOnMainThread(replay: unknown): string {
  return JSON.stringify(replay, mapReplacer);
}

/**
 * Normalized view of a Comlink transfer-list payload.
 *
 * Mirrors `normalizeBuffer` in `src/lib/backup/backup-checksum.worker.ts`:
 * callers may hand off a whole `ArrayBuffer` or a `[buffer, byteOffset,
 * byteLength]` sub-region tuple so a slice of a larger buffer can be
 * transferred without copying.
 */
export interface NormalizedReplayBuffer {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
}

/**
 * Normalize either transfer form into `{buffer, byteOffset, byteLength}`.
 */
export function normalizeReplayBuffer(
  payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
): NormalizedReplayBuffer {
  if (Array.isArray(payload)) {
    const [buffer, byteOffset, byteLength] = payload;
    return { buffer, byteOffset, byteLength };
  }
  return {
    buffer: payload as ArrayBuffer,
    byteOffset: 0,
    byteLength: payload.byteLength,
  };
}

/**
 * Round-trip pre-encoded replay JSON bytes back to the canonical
 * `replayJson` string.
 *
 * Decode → `JSON.parse` with `mapReviver` (restores the `Map` objects the
 * replacer encodes as `{"dataType":"Map","value":[...]}` envelopes) →
 * re-serialize with `serializeReplayOnMainThread`. Because parse preserves
 * key order and the replacer re-emits the same envelope, the output is
 * byte-identical to the object-mode serialization of the same replay.
 *
 * This is the byte-level seam the saved-game pipeline composes on: when the
 * replay restructuring (#1572–#1574) and the replay compression issue
 * (wave-3-perf-2) land, holders of pre-encoded replay bytes can transfer
 * them to the worker zero-copy (Comlink transfer-list) instead of paying a
 * structured-clone copy of the object graph.
 */
export function replayJsonFromBytes(
  payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
): string {
  const { buffer, byteOffset, byteLength } = normalizeReplayBuffer(payload);
  const bytes = new Uint8Array(buffer, byteOffset, byteLength);
  const json = new TextDecoder().decode(bytes);
  const replay: unknown = JSON.parse(json, mapReviver);
  return serializeReplayOnMainThread(replay);
}
