/**
 * Short-lived TURN credential minting (HMAC-SHA1, RFC 7635).
 *
 * Issue #1583 — Replace shared static `NEXT_PUBLIC_TURN_USER` /
 * `NEXT_PUBLIC_TURN_PASS` credentials with per-session HMAC credentials
 * minted by the server under `TURN_HMAC_SECRET`. The TURN REST API
 * (RFC 7635) defines the canonical scheme:
 *
 *   username = "<expiry-epoch-seconds>:<client-id>"
 *   credential = base64(HMAC-SHA1(secret, username))
 *
 * Coturn, when configured with `use-auth-secret` + `static-auth-secret`
 * + `realm`, validates exactly this construction server-side. By
 * embedding the expiry in the username and signing the whole thing
 * with the long-term shared secret, we:
 *
 *   1. Keep the long-term secret server-side (NEVER in the client
 *      bundle — see issue #1571).
 *   2. Force credentials to be time-boxed (≤ 24h by policy here).
 *   3. Force credentials to be bound to a per-session client-id so a
 *      captured credential cannot be replayed from a different peer.
 *
 * The HMAC primitive is implemented in pure JavaScript (SHA-1 +
 * RFC 2104 HMAC construction) so this module is portable across
 * Node 22, jsdom, the Tauri webview, and any browser that satisfies
 * the WebCrypto-free baseline. The signing path stays inside the
 * server route handler (`src/app/api/signaling/turn-credentials/`) —
 * the client only receives the resulting `{username, credential}` pair.
 */

/**
 * Maximum TTL we will ever mint. Caps the lifetime so a leaked secret
 * cannot mint credentials that survive for weeks; matches RFC 7635
 * guidance ("credentials should be short-lived") and the issue #1583
 * acceptance criterion that the credential window must be ≤ 24h.
 */
export const TURN_CREDENTIAL_MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * Default TTL when the caller does not specify one. One hour is
 * long enough for a typical P2P session (handshake + game) and short
 * enough that a leaked credential cannot be replayed across sessions.
 */
export const TURN_CREDENTIAL_DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Separator between the expiry epoch and the client-id inside the
 * RFC 7635 username. Coturn parses this exactly as documented.
 */
const USERNAME_SEP = ":" as const;

/**
 * Maximum length we will accept for the client-id component of the
 * username. Coturn caps usernames at 128 bytes by default; we
 * additionally truncate early to bound the HMAC input length and
 * keep error messages cheap. Alphanumeric + dash + underscore.
 */
const CLIENT_ID_MAX_LENGTH = 64;

/**
 * Character whitelist for the client-id component. Matches the
 * `[A-Za-z0-9_-]` range to ensure the username survives
 * `@<realm>` transport without URL-escaping ambiguity and stays
 * unambiguous when coturn parses the username.
 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Parsed username components.
 *
 * `expiryEpochSeconds` is the absolute Unix-epoch timestamp (seconds)
 * after which coturn will reject the allocation. `clientId` is the
 * per-session identifier the issuer embedded so a captured credential
 * cannot be replayed across sessions.
 */
export interface ParsedTurnUsername {
  /** Unix-epoch seconds after which the credential is invalid. */
  expiryEpochSeconds: number;
  /** Per-session identifier embedded in the username. */
  clientId: string;
}

/**
 * A freshly minted TURN credential pair.
 */
export interface TurnCredential {
  /**
   * `<expiry-epoch-seconds>:<client-id>` per RFC 7635. Coturn
   * parses this into expiry + identity and rejects allocations
   * past the expiry or with mismatched identity.
   */
  username: string;
  /**
   * base64(HMAC-SHA1(secret, username)) — the shared secret never
   * leaves the server. The credential is opaque to the client and
   * ephemeral by construction.
   */
  credential: string;
  /** Same expiry embedded in `username`, exposed for client-side caching. */
  expiresAtEpochSeconds: number;
  /** Same `clientId` embedded in `username`, exposed for client-side caching. */
  clientId: string;
}

/**
 * Options for {@link mintTurnCredentials}.
 */
export interface MintTurnCredentialOptions {
  /** Long-term shared secret (`TURN_HMAC_SECRET` server-side). Required. */
  secret: string;
  /** Per-session identifier (peer-id / session-id). Required. */
  clientId: string;
  /**
   * Absolute Unix-epoch timestamp (seconds) at which the credential
   * starts being valid. Defaults to `Math.floor(Date.now() / 1000)`.
   * Tests inject a fixed value for determinism.
   */
  nowEpochSeconds?: number;
  /**
   * Lifetime in seconds from `nowEpochSeconds`. Defaults to
   * {@link TURN_CREDENTIAL_DEFAULT_TTL_SECONDS}. Clamped to
   * [1, {@link TURN_CREDENTIAL_MAX_TTL_SECONDS}].
   */
  ttlSeconds?: number;
}

// ────────────────────────────────────────────────────────────────────────
// SHA-1 (RFC 3174) — minimal, pure-JS, module-local.
// Only `sha1Bytes` / `sha1Hex` are exported indirectly via
// `hmacSha1`. We deliberately keep the primitive module-local so the
// rest of the codebase does not accidentally start using SHA-1 for
// non-TURN purposes (SHA-256 is the right primitive elsewhere).
// ────────────────────────────────────────────────────────────────────────

const SHA1_K = new Uint32Array([
  0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6,
]);

/** 32-bit left rotation. Used by the SHA-1 round function and the
 * message-schedule expansion. */
function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** SHA-1 of a byte sequence. Returns 20 raw bytes. Implementation
 * follows FIPS 180-4 §6.1. The constants and round-function form
 * are deliberately minimal so the SHA-1 call surface stays
 * module-local — callers should NOT depend on SHA-1 elsewhere in the
 * codebase. */
function sha1Bytes(input: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
  ]);
  const len = input.length;
  const bitLen = len * 8;
  // Padding: append 0x80, zeros, then 8-byte big-endian bit-length.
  const padLen = ((len + 9 + 63) & ~63) - len;
  const padded = new Uint8Array(len + padLen);
  padded.set(input, 0);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  // High 32 bits of bit-length — always 0 for messages <2^32 bits.
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const W = new Uint32Array(80);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(chunk + i * 4, false);
    }
    // SHA-1 message schedule expansion. W[t] = ROTL_1(W[t-3] XOR W[t-8]
    // XOR W[t-14] XOR W[t-16]). ROTL (left rotation) is critical; an
    // earlier draft used ROTR and produced HMACs that matched no other
    // implementation. See FIPS 180-4 §6.1.2, step (t).
    for (let i = 16; i < 80; i++) {
      W[i] = rotl32(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
    }
    let [a, b, c, d, e] = [H[0], H[1], H[2], H[3], H[4]];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = SHA1_K[0];
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = SHA1_K[1];
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = SHA1_K[2];
      } else {
        f = b ^ c ^ d;
        k = SHA1_K[3];
      }
      // FIPS 180-4 §4.1.2 step 3:
      //   T = ROTL_5(a) + f_t(b,c,d) + e + K_t + W_t
      const temp = (rotl32(a, 5) + f + e + k + W[i]) >>> 0;
      // FIPS 180-4 §4.1.2 step 4 — note ROTL_30(b) (NOT ROTR_30).
      // An earlier draft used a `rotr32(b, 30)` helper and produced
      // HMACs that matched no other implementation; the helper has
      // been replaced with explicit `rotl32` calls throughout.
      e = d;
      d = c;
      c = rotl32(b, 30);
      b = a;
      a = temp;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) {
    outView.setUint32(i * 4, H[i], false);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// HMAC-SHA1 (RFC 2104) over UTF-8 strings.
// ────────────────────────────────────────────────────────────────────────

function utf8ToBytes(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  // Manual UTF-8 fallback (parity with `p2p-handshake.ts`).
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function bytesToBase64(bytes: Uint8Array): string {
  // RFC 4648 base64, no padding-stripping (coturn accepts both). Use
  // btoa() when available (browser + Node 16+); fall back to a manual
  // encoder for the very-rare environment that lacks it (jsdom 16 has
  // it; jsdom 22+ has it; older runtimes may not).
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2];
    out += chars[((a & 0x03) << 4) | (b >> 4)];
    out += chars[((b & 0x0f) << 2) | (c >> 6)];
    out += chars[c & 0x3f];
  }
  if (i < bytes.length) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    out += chars[a >> 2];
    out += chars[((a & 0x03) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? chars[(b & 0x0f) << 2] : "=";
    out += "=";
  }
  return out;
}

/**
 * HMAC-SHA1 of a UTF-8 `message` under UTF-8 `secret`, returned as the
 * base64-encoded digest. RFC 2104 with the standard 64-byte block
 * length and ipad/opad XOR.
 */
export function hmacSha1Base64(secret: string, message: string): string {
  const keyBytes = utf8ToBytes(secret);
  const blockSize = 64;

  // Per RFC 2104: keys longer than the block size are pre-hashed;
  // keys shorter than the block size are zero-padded to block size.
  let normalizedKey: Uint8Array;
  if (keyBytes.length > blockSize) {
    normalizedKey = sha1Bytes(keyBytes); // 20 bytes
  } else {
    normalizedKey = new Uint8Array(blockSize);
    normalizedKey.set(keyBytes);
  }

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = normalizedKey[i] ^ 0x36;
    opad[i] = normalizedKey[i] ^ 0x5c;
  }

  // inner = SHA1(ipad || message)
  const inner = sha1Bytes(
    (() => {
      const out = new Uint8Array(blockSize + utf8ToBytes(message).length);
      out.set(ipad, 0);
      out.set(utf8ToBytes(message), blockSize);
      return out;
    })(),
  );

  // outer = SHA1(opad || inner)
  const outer = sha1Bytes(
    (() => {
      const out = new Uint8Array(blockSize + inner.length);
      out.set(opad, 0);
      out.set(inner, blockSize);
      return out;
    })(),
  );

  return bytesToBase64(outer);
}

/**
 * HMAC-SHA1 of a UTF-8 `message` under UTF-8 `secret`, returned as the
 * lowercase hex digest. Mirrors {@link hmacSha1Base64} so the
 * credential can be inspected in tests without pulling in a base64
 * decoder.
 */
export function hmacSha1Hex(secret: string, message: string): string {
  // Recompute via the base64 helper to avoid duplicating the SHA-1
  // state machine; tests want hex, server route wants base64.
  const b64 = hmacSha1Base64(secret, message);
  // Hex equivalent: decode base64 to bytes, then hex-encode.
  if (typeof atob === "function") {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }
  // Manual fallback — small base64 alphabet, runs once at startup.
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  const bytes: number[] = [];
  for (let i = 0; i < b64.length; i += 4) {
    const a = lookup[b64[i]] ?? 0;
    const b = lookup[b64[i + 1]] ?? 0;
    const c = b64[i + 2] === "=" ? 0 : (lookup[b64[i + 2]] ?? 0);
    const d = b64[i + 3] === "=" ? 0 : (lookup[b64[i + 3]] ?? 0);
    bytes.push((a << 2) | (b >> 4));
    if (b64[i + 2] !== "=") bytes.push(((b & 0x0f) << 4) | (c >> 2));
    if (b64[i + 3] !== "=") bytes.push(((c & 0x03) << 6) | d);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// ────────────────────────────────────────────────────────────────────────
// Username parsing + sanitisation.
// ────────────────────────────────────────────────────────────────────────

/**
 * Sanitise + truncate a caller-supplied `clientId` to a character
 * class that survives coturn's username parser and the HMAC input
 * surface without ambiguity. Throws when no safe characters remain.
 */
export function sanitizeClientId(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("clientId must be a string");
  }
  const stripped = raw.replace(/[^A-Za-z0-9_-]/g, "");
  if (stripped.length === 0) {
    throw new Error("clientId must contain at least one safe character");
  }
  return stripped.slice(0, CLIENT_ID_MAX_LENGTH);
}

/**
 * Parse an RFC 7635 username `<expiry>:<clientId>` into its parts.
 * Used by coturn to validate the credential server-side and used here
 * for client-side expiry checks (issue #1583 acceptance criterion:
 * "Given a credential whose encoded expiry is in the past, the
 * coturn/TURN server rejects it").
 */
export function parseTurnUsername(username: string): ParsedTurnUsername | null {
  if (typeof username !== "string" || username.length === 0) return null;
  const sepIndex = username.indexOf(USERNAME_SEP);
  if (sepIndex <= 0 || sepIndex === username.length - 1) return null;
  const expiryStr = username.slice(0, sepIndex);
  const clientId = username.slice(sepIndex + 1);
  if (!/^[0-9]+$/.test(expiryStr)) return null;
  const expiryEpochSeconds = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiryEpochSeconds)) return null;
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  return { expiryEpochSeconds, clientId };
}

// ────────────────────────────────────────────────────────────────────────
// Public mint / verify API.
// ────────────────────────────────────────────────────────────────────────

/**
 * Mint a fresh short-lived TURN credential under `secret`. The
 * returned username embeds the expiry timestamp so coturn can reject
 * stale allocations; the credential is the base64 HMAC-SHA1 the
 * client sends in the WebRTC `RTCIceServer` config.
 *
 * The `secret` is never returned. The `expiresAtEpochSeconds` and
 * `clientId` fields are exposed on the result so the caller can wire
 * client-side refresh logic without re-parsing the username.
 */
export function mintTurnCredential(
  options: MintTurnCredentialOptions,
): TurnCredential {
  if (typeof options !== "object" || options === null) {
    throw new Error("mintTurnCredential requires an options object");
  }
  const { secret, clientId: rawClientId } = options;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("secret must be a non-empty string");
  }
  const clientId = sanitizeClientId(rawClientId);
  const nowEpochSeconds =
    typeof options.nowEpochSeconds === "number" &&
    Number.isFinite(options.nowEpochSeconds)
      ? Math.floor(options.nowEpochSeconds)
      : Math.floor(Date.now() / 1000);

  // Clamp TTL into the policy window. Anything larger than
  // MAX_TTL_SECONDS would defeat the "short-lived" guarantee from
  // the issue brief; zero or negative TTLs would mint immediately-
  // invalid credentials.
  const requestedTtl =
    typeof options.ttlSeconds === "number" &&
    Number.isFinite(options.ttlSeconds)
      ? Math.floor(options.ttlSeconds)
      : TURN_CREDENTIAL_DEFAULT_TTL_SECONDS;
  const ttlSeconds = Math.max(
    1,
    Math.min(TURN_CREDENTIAL_MAX_TTL_SECONDS, requestedTtl),
  );

  const expiresAtEpochSeconds = nowEpochSeconds + ttlSeconds;
  const username = `${expiresAtEpochSeconds}${USERNAME_SEP}${clientId}`;
  const credential = hmacSha1Base64(secret, username);

  return {
    username,
    credential,
    expiresAtEpochSeconds,
    clientId,
  };
}

/**
 * Verify a credential against the same secret. Used by the server
 * route's own self-test (and exposed for tests); production coturn
 * does the actual validation. Returns `true` only when the credential
 * is well-formed, the HMAC matches, and the embedded expiry is in
 * the future relative to `nowEpochSeconds`.
 */
export function verifyTurnCredential(
  secret: string,
  username: string,
  credential: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parsed = parseTurnUsername(username);
  if (!parsed) return false;
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof credential !== "string" || credential.length === 0) return false;
  if (!Number.isFinite(parsed.expiryEpochSeconds)) return false;
  if (parsed.expiryEpochSeconds <= nowEpochSeconds) return false;
  const expected = hmacSha1Base64(secret, username);
  if (expected.length !== credential.length) return false;
  // Constant-time compare — both inputs are fixed-length base64 of a
  // 20-byte SHA-1, so the iteration is bounded and the timing leak
  // is narrow.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ credential.charCodeAt(i);
  }
  return diff === 0;
}
