/**
 * @fileoverview Replay JSON Compression
 *
 * Issue #1573: `replayJson` is the single largest column in a saved-game
 * record — typically 10–100× larger than `gameStateJson` because each
 * {@link ReplayAction} embeds a state delta plus action metadata. A
 * 4-player Commander replay routinely reaches tens of MB of JSON, and it
 * was previously persisted **uncompressed** while `gameStateJson` next to
 * it was already gzip-enveloped (issue #1020 / #1423).
 *
 * This module closes that asymmetry by reusing the exact same
 * `gzn:`-prefixed base64/gzip envelope so both heavy columns share one
 * wire format.
 *
 * ## Wire format
 *
 * - **Compressed (new):** the literal `gzn:` marker followed by the base64
 *   encoding of an RFC 1952 gzip stream wrapping the replay JSON text.
 * - **Legacy (uncompressed):** raw UTF-8 JSON, which always begins with
 *   `{` (0x7b). Base64 output never starts with `gzn:`, and a JSON object
 *   never does either, so format detection is unambiguous and no migration
 *   pass is required — legacy rows are simply passed through on read.
 */

import {
  compressJsonEnvelope,
  decompressJsonEnvelope,
  isCompressedJsonEnvelope,
} from "./game-state-compression";

/**
 * Determine whether a stored {@code replayJson} value holds a
 * gzip-compressed payload (as opposed to legacy raw JSON text).
 */
export function isCompressedReplayJson(value: unknown): value is string {
  return isCompressedJsonEnvelope(value);
}

/**
 * Compress a `replayJson` string into the enveloped base64/gzip storage
 * format. `undefined` (no replay attached to the save) passes through so
 * callers can pipe the optional field straight in.
 */
export async function compressReplayJson(
  json: string | undefined,
): Promise<string | undefined> {
  if (typeof json !== "string" || json.length === 0) {
    return json;
  }
  // Idempotent: never double-wrap an already-enveloped payload (e.g. a
  // record round-tripped through backup import).
  if (isCompressedReplayJson(json)) {
    return json;
  }
  return compressJsonEnvelope(json);
}

/**
 * Decompress a stored {@code replayJson} value back into JSON text.
 *
 * Legacy uncompressed replays (written before issue #1573) are returned
 * unchanged, so pre-existing saves and backup-export files keep loading
 * without a migration step.
 */
export async function decompressReplayJson(
  value: string | undefined,
): Promise<string | undefined> {
  if (typeof value !== "string") {
    return value;
  }
  return decompressJsonEnvelope(value);
}
