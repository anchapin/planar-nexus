/**
 * @fileOverview Backup Compression + Integrity Utilities
 *
 * Compresses backup exports (gzip) and restores them with integrity
 * verification (SHA-256) and backward compatibility for legacy formats.
 *
 * ## File formats (issue #1084)
 *
 * - **New format (v1, `pn1`)**: an RFC 1952 gzip stream (magic bytes
 *   `0x1f 0x8b`) whose header carries an `FCOMMENT` field of the form
 *   `pn1:sha256=<64 lowercase hex chars>`. The SHA-256 digest is computed
 *   over the **UTF-8 bytes of the compact JSON payload** (the exact bytes
 *   that are deflate-compressed). Because the digest lives in the standard
 *   gzip comment field, the file is still a regular `.json.gz` that any gzip
 *   tool can decompress — the checksum is pure metadata.
 * - **Old compressed format (pre-#1084)**: a gzip stream WITHOUT an
 *   `FCOMMENT` checksum. Restore still works but logs a warning, because the
 *   payload cannot be verified (backward compatibility — see
 *   {@link decompressData}).
 * - **Legacy format**: raw UTF-8 JSON text (pretty or compact), always
 *   starting with `{` (`0x7b`) so it never collides with the gzip magic.
 *   Restored as-is.
 *
 * ## Integrity policy
 *
 * On restore the digest is recomputed over the decompressed JSON text and
 * compared to the value embedded in the gzip comment. A mismatch raises a
 * {@link BackupIntegrityError} and the (potentially corrupted) payload is
 * **never** returned. Backups that predate checksums are restored as-is with
 * a `console.warn`, preserving access to existing user backups.
 *
 * ## Why a synchronous SHA-256?
 *
 * The compress/decompress entry points are intentionally synchronous: they
 * have several synchronous call sites in the storage hook, and converting
 * them to `async` would cascade through callers and tests. The Web Crypto
 * `crypto.subtle.digest` API is asynchronous-only, so a self-contained
 * synchronous implementation ({@link sha256Hex}) is used instead. It runs in
 * every runtime (browser, Tauri, Node) without environment-specific bindings,
 * and backups are small enough that hashing is negligible next to gzip.
 */

import { gzip, ungzip } from "pako";
import type Pako from "pako";
import type { BackupData } from "./indexeddb-storage";

/** MIME type for compressed backup exports. */
export const BACKUP_COMPRESSED_MIME = "application/gzip";

/** Recommended file extension for compressed backups. */
export const BACKUP_COMPRESSED_EXTENSION = ".json.gz";

/** First two bytes of every RFC 1952 gzip stream (the format marker). */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Gzip header `FLG` bit flags (RFC 1952 §2.3.1). */
const FLG_FEXTRA = 0x04;
const FLG_FNAME = 0x08;
const FLG_FCOMMENT = 0x10;

/**
 * Prefix used for the integrity marker stored in the gzip `FCOMMENT` field.
 * `pn1` = "Planar Nexus backup envelope, version 1".
 */
export const BACKUP_CHECKSUM_PREFIX = "pn1:sha256=";

/** Matches a `pn1:sha256=<hex>` marker inside a gzip comment field. */
const CHECKSUM_PATTERN = /pn1:sha256=([0-9a-fA-F]{64})/;

/**
 * Error raised when a backup's embedded checksum does not match its payload.
 *
 * Thrown (not silently swallowed) so callers / the UI can surface that a
 * restore was refused because the backup is corrupted or has been modified.
 */
export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupIntegrityError";
    // Restore the prototype chain when targeting ES5 transpilation targets.
    Object.setPrototypeOf(this, BackupIntegrityError.prototype);
  }
}

// ---------------------------------------------------------------------------
// SHA-256 (synchronous, self-contained)
// ---------------------------------------------------------------------------

/** SHA-256 round constants (FIPS 180-4 §4.2.2). */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 initial hash values (FIPS 180-4 §5.3.3). */
const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

const HEX_CHARS = "0123456789abcdef";

/** Rotate a 32-bit value right by `n` bits. */
function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Compute the SHA-256 digest of `bytes` and return it as 64 lowercase hex
 * characters.
 *
 * Synchronous and dependency-free so that the compress/restore API can stay
 * synchronous (see module docs). Results are byte-for-byte identical to the
 * Web Crypto `crypto.subtle.digest("SHA-256", bytes)` output.
 */
export function sha256Hex(bytes: Uint8Array): string {
  // --- Padding (FIPS 180-4 §5.1.1): append 0x80, zero-fill, then 64-bit length.
  const bitLength = bytes.length * 8;
  // 1 byte for 0x80 + 8 bytes for the length, rounded up to a 64-byte block.
  const minPadded = bytes.length + 9;
  const paddedLength = Math.ceil(minPadded / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;

  // 64-bit big-endian bit length. Payloads are well under 512 MiB, so the high
  // 32 bits only ever carry `bytes.length * 8` overflow.
  const hi = Math.floor(bitLength / 0x100000000);
  const lo = bitLength >>> 0;
  message[paddedLength - 8] = (hi >>> 24) & 0xff;
  message[paddedLength - 7] = (hi >>> 16) & 0xff;
  message[paddedLength - 6] = (hi >>> 8) & 0xff;
  message[paddedLength - 5] = hi & 0xff;
  message[paddedLength - 4] = (lo >>> 24) & 0xff;
  message[paddedLength - 3] = (lo >>> 16) & 0xff;
  message[paddedLength - 2] = (lo >>> 8) & 0xff;
  message[paddedLength - 1] = lo & 0xff;

  const hash = SHA256_H0.slice();
  const schedule = new Uint32Array(64);

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    // Build the message schedule (first 16 words are the big-endian input).
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      schedule[i] =
        (message[j] << 24) |
        (message[j + 1] << 16) |
        (message[j + 2] << 8) |
        message[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const w15 = schedule[i - 15];
      const w2 = schedule[i - 2];
      const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + schedule[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const word = hash[i];
    for (let shift = 28; shift >= 0; shift -= 4) {
      hex += HEX_CHARS.charAt((word >>> shift) & 0xf);
    }
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Gzip header parsing
// ---------------------------------------------------------------------------

/**
 * Determine whether a byte buffer holds a gzip-compressed backup.
 *
 * Detection relies on the standard gzip magic header (`0x1f 0x8b`). Legacy
 * uncompressed backups are JSON objects and therefore always begin with `{`
 * (`0x7b`), so the two formats are unambiguous.
 */
export function isGzipBackup(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
  );
}

/**
 * Extract the `FCOMMENT` field from a gzip stream (RFC 1952 §2.3.1).
 *
 * Returns the raw comment string (Latin-1 decoded) or `null` when the buffer
 * is not a gzip stream or has no comment field. Defensive bounds checks are
 * used throughout so a malformed header never causes an out-of-bounds read.
 */
function readGzipComment(bytes: Uint8Array): string | null {
  // Minimum gzip header is 10 bytes: ID1 ID2 CM FLG MTIME(4) XFL OS.
  if (bytes.length < 10 || bytes[0] !== GZIP_MAGIC_0 || bytes[1] !== GZIP_MAGIC_1) {
    return null;
  }

  const flags = bytes[3];
  let index = 10;

  // Optional FEXTRA: 2-byte little-endian length, then that many bytes.
  if (flags & FLG_FEXTRA) {
    if (index + 2 > bytes.length) return null;
    const xlen = bytes[index] | (bytes[index + 1] << 8);
    index += 2 + xlen;
    if (index > bytes.length) return null;
  }

  // Optional FNAME: zero-terminated original filename.
  if (flags & FLG_FNAME) {
    while (index < bytes.length && bytes[index] !== 0) index++;
    index++; // consume the null terminator
    if (index > bytes.length) return null;
  }

  // Optional FCOMMENT: zero-terminated comment (Latin-1 / ISO-8859-1).
  if (flags & FLG_FCOMMENT) {
    const start = index;
    while (index < bytes.length && bytes[index] !== 0) index++;
    let comment = "";
    for (let i = start; i < index; i++) {
      comment += String.fromCharCode(bytes[i]);
    }
    return comment;
  }

  return null;
}

/**
 * Report whether `input` carries an embedded `pn1:sha256` integrity checksum.
 *
 * Useful for surfacing integrity status in the restore UI without performing
 * a full restore. Returns `false` for legacy raw-JSON backups and for old
 * compressed backups that predate checksums.
 */
export function hasIntegrityChecksum(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isGzipBackup(bytes)) return false;
  const comment = readGzipComment(bytes);
  return comment !== null && CHECKSUM_PATTERN.test(comment);
}

// ---------------------------------------------------------------------------
// Compress / decompress
// ---------------------------------------------------------------------------

/**
 * Serialize an arbitrary object into a compressed byte buffer with an embedded
 * SHA-256 integrity checksum.
 *
 * The JSON is emitted compactly (no indentation) because whitespace defeats
 * compression. The SHA-256 of the JSON's UTF-8 bytes is stored in the gzip
 * `FCOMMENT` field so restore can detect corruption. Generic so it can back
 * both full ({@link BackupData}) and incremental backup payloads.
 */
export function compressData<T>(data: T): Uint8Array {
  const json = JSON.stringify(data);
  const checksum = sha256Hex(new TextEncoder().encode(json));
  // pako's gzip() honors `header.comment` at runtime (it sets the gzip
  // FCOMMENT field), but its `DeflateFunctionOptions` type omits `header`.
  // Typing the options as the wider `DeflateOptions` keeps the `comment`
  // field type-checked while remaining assignable to the gzip() parameter.
  const gzipOptions: Pako.DeflateOptions = {
    header: { comment: `${BACKUP_CHECKSUM_PREFIX}${checksum}` },
  };
  return gzip(json, gzipOptions);
}

/**
 * Deserialize a backup byte buffer back into an object of type `T`, verifying
 * its integrity checksum when one is present.
 *
 * Accepts three formats:
 * 1. **New compressed backups** (gzip + `pn1:sha256` comment): the SHA-256 is
 *    recomputed over the decompressed JSON text and compared to the embedded
 *    value. On mismatch a {@link BackupIntegrityError} is thrown and no data
 *    is returned.
 * 2. **Old compressed backups** (gzip, no comment): restored as-is with a
 *    `console.warn`, because the payload cannot be verified.
 * 3. **Legacy raw-JSON backups**: restored as-is (with a `console.warn`).
 *
 * A corrupted backup is therefore either rejected explicitly (checksum
 * mismatch) or fails during decompression/parse — it is never silently
 * restored as wrong data.
 */
export function decompressData<T>(input: ArrayBuffer | Uint8Array): T {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let text: string;
  if (isGzipBackup(bytes)) {
    text = ungzip(bytes, { to: "string" }) as string;

    const comment = readGzipComment(bytes);
    const match = comment ? comment.match(CHECKSUM_PATTERN) : null;
    if (match) {
      const recomputed = sha256Hex(new TextEncoder().encode(text));
      if (recomputed.toLowerCase() !== match[1].toLowerCase()) {
        throw new BackupIntegrityError(
          "Backup integrity check failed: the stored checksum does not match " +
            "the payload. The backup is corrupted or has been modified and " +
            "will not be restored.",
        );
      }
    } else {
      // Backward compatibility (#1084): pre-checksum compressed backup.
      console.warn(
        "[planar-nexus:backup] Restoring a compressed backup without an " +
          "integrity checksum. This backup predates integrity verification " +
          "and will be restored without corruption checks.",
      );
    }
  } else {
    text = new TextDecoder().decode(bytes);
    console.warn(
      "[planar-nexus:backup] Restoring a legacy uncompressed JSON backup " +
        "without an integrity checksum.",
    );
  }

  return JSON.parse(text) as T;
}

/**
 * Serialize a {@link BackupData} object into a compressed, checksummed byte
 * buffer.
 *
 * Thin typed wrapper around the generic {@link compressData}.
 */
export function compressBackup(data: BackupData): Uint8Array {
  return compressData(data);
}

/**
 * Deserialize a backup byte buffer back into a {@link BackupData} object,
 * verifying its integrity checksum when present.
 *
 * Thin typed wrapper around the generic {@link decompressData}.
 */
export function decompressBackup(input: ArrayBuffer | Uint8Array): BackupData {
  return decompressData<BackupData>(input);
}
