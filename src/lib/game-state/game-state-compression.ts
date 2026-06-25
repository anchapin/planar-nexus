/**
 * @fileoverview Game State JSON Compression
 *
 * Issue #1020: Reduce saved-game storage footprint.
 *
 * Compresses the compact game-state JSON emitted by {@link serializeGameState}
 * into a gzip stream and envelopes it as base64 text so it can live in the
 * existing string-typed {@code gameStateJson} storage field without rippling
 * type changes through consumers.
 *
 * Format:
 * - New format: the literal {@link COMPRESSED_MARKER} prefix followed by the
 *   base64 encoding of an RFC 1952 gzip stream wrapping the compact JSON.
 * - Legacy format: raw UTF-8 JSON text (pretty-printed or compact) written by
 *   prior versions. Such payloads always begin with "{" (0x7b), so they never
 *   collide with the marker and are returned unchanged for backward
 *   compatibility.
 */

import { gzip, ungzip } from "pako";

/**
 * Prefix marking a compressed payload. base64 output never starts with these
 * characters and raw JSON objects always begin with "{", so detection is
 * unambiguous.
 */
export const COMPRESSED_MARKER = "gzn:";

/** Base64 chunk size kept below the Function call limit to avoid stack overflow. */
const B64_CHUNK = 0x8000;

/**
 * Encode a byte buffer to a base64 string. Uses chunked {@code fromCharCode}
 * to stay within call-stack limits for large payloads.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + B64_CHUNK)),
    );
  }
  return btoa(binary);
}

/** Decode a base64 string into a byte buffer. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Determine whether a stored {@code gameStateJson} value holds a
 * gzip-compressed payload.
 */
export function isCompressedGameState(value: string): boolean {
  return typeof value === "string" && value.startsWith(COMPRESSED_MARKER);
}

/**
 * Compress a compact game-state JSON string into the enveloped base64/gzip
 * storage format.
 */
export function compressGameStateJson(json: string): string {
  const compressed = gzip(json);
  return COMPRESSED_MARKER + bytesToBase64(compressed);
}

/**
 * Decompress a stored {@code gameStateJson} value back into JSON text.
 *
 * Accepts both the new compressed format and legacy raw JSON for backward
 * compatibility with saves written by prior versions. Legacy payloads are
 * returned unchanged.
 */
export function decompressGameStateJson(value: string): string {
  if (!isCompressedGameState(value)) {
    return value;
  }
  const b64 = value.slice(COMPRESSED_MARKER.length);
  return ungzip(base64ToBytes(b64), { to: "string" }) as string;
}
