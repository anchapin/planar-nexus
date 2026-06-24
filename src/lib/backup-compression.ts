/**
 * @fileOverview Backup Compression Utilities
 *
 * Compresses backup exports (gzip) and restores them with backward
 * compatibility for legacy uncompressed JSON files.
 *
 * File format:
 * - New format: RFC 1952 gzip stream (magic bytes 0x1f 0x8b) wrapping the
 *   JSON-encoded {@link BackupData}. The gzip magic header doubles as the
 *   format marker so restore can reliably distinguish compressed exports
 *   from legacy raw-JSON files.
 * - Legacy format: raw UTF-8 JSON text (previously pretty-printed), always
 *   starting with "{" (0x7b) so there is no collision with the gzip magic.
 */

import { gzip, ungzip } from "pako";
import type { BackupData } from "./indexeddb-storage";

/** MIME type for compressed backup exports. */
export const BACKUP_COMPRESSED_MIME = "application/gzip";

/** Recommended file extension for compressed backups. */
export const BACKUP_COMPRESSED_EXTENSION = ".json.gz";

/** First two bytes of every RFC 1952 gzip stream (the format marker). */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Determine whether a byte buffer holds a gzip-compressed backup.
 *
 * Detection relies on the standard gzip magic header (0x1f 0x8b). Legacy
 * uncompressed backups are JSON objects and therefore always begin with "{"
 * (0x7b), so the two formats are unambiguous.
 */
export function isGzipBackup(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
  );
}

/**
 * Serialize an arbitrary object into a compressed byte buffer.
 *
 * The JSON is emitted compactly (no indentation) because whitespace defeats
 * compression; readability of the on-disk artifact is not a goal for the
 * compressed format. Generic so it can back both full ({@link BackupData})
 * and incremental backup payloads.
 */
export function compressData<T>(data: T): Uint8Array {
  const json = JSON.stringify(data);
  return gzip(json);
}

/**
 * Deserialize a compressed/raw byte buffer back into an object of type `T`.
 *
 * Accepts BOTH the gzip-compressed format and legacy raw-JSON text for
 * backward compatibility. Detection is performed via the gzip magic header.
 */
export function decompressData<T>(input: ArrayBuffer | Uint8Array): T {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let text: string;
  if (isGzipBackup(bytes)) {
    text = ungzip(bytes, { to: "string" }) as string;
  } else {
    text = new TextDecoder().decode(bytes);
  }

  return JSON.parse(text) as T;
}

/**
 * Serialize a {@link BackupData} object into a compressed byte buffer.
 *
 * Thin typed wrapper around the generic {@link compressData}.
 */
export function compressBackup(data: BackupData): Uint8Array {
  return compressData(data);
}

/**
 * Deserialize a backup byte buffer back into a {@link BackupData} object.
 *
 * Thin typed wrapper around the generic {@link decompressData}.
 */
export function decompressBackup(input: ArrayBuffer | Uint8Array): BackupData {
  return decompressData<BackupData>(input);
}
