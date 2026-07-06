/**
 * @fileOverview Safe JSON parsing helpers for untrusted P2P / signaling data.
 *
 * Data received from peers or signaling channels (QR codes, manual code entry,
 * copy-paste, WebRTC data-channel messages) is UNTRUSTED. Parsing it safely
 * requires two guarantees:
 *   1. Never throw on malformed input — wrap JSON.parse so a bad payload
 *      cannot crash or hang the connection.
 *   2. Validate the SHAPE of the parsed value before treating it as a typed
 *      object. A successful JSON.parse only proves syntactic validity, not
 *      that the payload matches the expected schema. Blind `as T` casts let
 *      attacker-controlled shapes flow into business logic.
 *
 * Resource-exhaustion hardening (issue #1111):
 *   3. A peer must not be able to exhaust memory or CPU by sending an
 *      arbitrarily large string, an arbitrarily deeply-nested object, or an
 *      object with an unbounded number of keys. `safeParseJson` therefore
 *      enforces three resource limits — a hard byte cap BEFORE JSON.parse, and
 *      a depth + total-key-count cap DURING structural validation. This is the
 *      same class of bug as the `ws` advisory GHSA-96hv-2xvq-fx4p (DoS via
 *      unbounded memory allocation on untrusted websocket payloads), applied
 *      to our P2P data channel where peers are joined by shared game codes and
 *      are effectively anonymous.
 *
 * HMAC-signed message envelopes (issue #1252):
 *   4. Peer impersonation after host migration is defeated by binding every
 *      outbound `GameMessage` to a per-session symmetric key via an HMAC-SHA-256
 *      envelope. Sequence numbers (#1091) reject duplicates but do not bind a
 *      message to its declared sender — a captured envelope could be re-emitted
 *      with a swapped `senderId` and slip past the anti-replay check. The
 *      envelope adds `hmac = HMAC(key, canonical(payload))` so any tampering
 *      with `senderId`, `seq`, `type`, or `data` invalidates the signature and
 *      the receiver drops the message before state mutation.
 *
 * See issue #924 (shape validation), issue #1111 (resource limits), and
 * issue #1252 (HMAC-signed envelopes).
 */

/**
 * Absolute hard cap on the byte length of a single P2P message string,
 * enforced BEFORE JSON.parse so the parser never allocates an unbounded
 * buffer. 256 KiB is generous for any legitimate game-state sync (full
 * Commander game states serialize well under 100 KiB) while bounding the
 * worst-case allocation per message.
 *
 * Cf. GHSA-96hv-2xvq-fx4p.
 */
export const MAX_MESSAGE_SIZE_BYTES = 256 * 1024;

/**
 * Maximum nesting depth of arrays/objects permitted during structural
 * validation. V8's JSON.parse accepts deeply nested input that would blow
 * the call stack during a naive recursive walk; capping depth keeps the
 * validator itself non-recursive-blowup-safe. 64 levels is far above any
 * legitimate game payload.
 */
export const MAX_NESTING_DEPTH = 64;

/**
 * Maximum total number of enumerable keys (object properties + array
 * indices) visited across the whole parsed tree during structural
 * validation. Bounds the CPU cost of validating an attacker-controlled
 * payload with millions of keys.
 */
export const MAX_KEY_COUNT = 10_000;

/**
 * Resource limits applied to an untrusted message. Callers may override the
 * defaults (e.g. tests, or a channel that legitimately needs a larger cap).
 */
export interface StructuralLimits {
  /** Max byte length of the raw message string (checked before JSON.parse). */
  maxMessageBytes: number;
  /** Max array/object nesting depth. */
  maxDepth: number;
  /** Max total enumerable keys visited across the whole tree. */
  maxKeys: number;
}

/**
 * Default resource limits. See the named constants above for rationale.
 */
export const DEFAULT_STRUCTURAL_LIMITS: StructuralLimits = {
  maxMessageBytes: MAX_MESSAGE_SIZE_BYTES,
  maxDepth: MAX_NESTING_DEPTH,
  maxKeys: MAX_KEY_COUNT,
};

/**
 * Options for {@link safeParseJson}.
 */
export interface SafeParseJsonOptions {
  /**
   * Override the default resource limits. All limits are inclusive upper
   * bounds; a payload equal to a limit is accepted, one exceeding it is
   * rejected.
   */
  limits?: Partial<StructuralLimits>;
}

/**
 * Verify that a parsed JSON value stays within the structural resource limits
 * (nesting depth + total key count). Exposed so receive paths that parse with
 * their own JSON.parse (rather than {@link safeParseJson}) can still apply the
 * same depth/key caps without duplicating the walker.
 *
 * The walk is itself DoS-safe: recursion is bounded by {@link maxDepth} and
 * iteration is bounded by {@link maxKeys}, so it visits at most
 * `maxKeys` entries and recurses at most `maxDepth` levels regardless of the
 * input shape.
 *
 * @returns `true` if the value is within limits, `false` otherwise.
 */
export function withinStructuralLimits(
  value: unknown,
  limits: Partial<StructuralLimits> = {},
): boolean {
  const maxDepth = limits.maxDepth ?? DEFAULT_STRUCTURAL_LIMITS.maxDepth;
  const maxKeys = limits.maxKeys ?? DEFAULT_STRUCTURAL_LIMITS.maxKeys;

  let keysVisited = 0;

  const walk = (node: unknown, depth: number): boolean => {
    // Scalars (and null) carry no structural cost.
    if (node === null || typeof node !== "object") {
      return true;
    }
    // depth counts object/array nesting levels. The top-level value parsed by
    // safeParseJson is already guaranteed to be an object, so the first
    // container is depth 1.
    if (depth > maxDepth) {
      return false;
    }

    const iterable = Array.isArray(node)
      ? node
      : (node as Record<string, unknown>);

    for (const key in iterable) {
      // Bound total work across the whole tree. Stop as soon as we exceed the
      // cap so a hostile payload cannot keep us iterating.
      if (keysVisited >= maxKeys) {
        return false;
      }
      keysVisited++;
      const child = (iterable as Record<string, unknown>)[key];
      if (!walk(child, depth + 1)) {
        return false;
      }
    }
    return true;
  };

  return walk(value, 1);
}

/**
 * Is `value` a non-negative integer (a valid sequence number)?
 *
 * Sequence numbers (`GameMessage.seq`, issue #1091) must be:
 *   - a `number` (reject strings/objects),
 *   - an integer (reject 1.5 — seqs are discrete),
 *   - non-negative (reject -1 — seqs start at 0),
 *   - finite (reject NaN / Infinity — they break `<=` comparisons).
 *
 * Exposed here so every shape guard that asserts a seq field validates it the
 * same way without duplicating the predicate.
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Safely parse a JSON string, enforce resource limits, and validate its shape.
 *
 * Order of checks (fail-closed at every step, never throws to the caller):
 *   1. Input must be a string.
 *   2. Byte length must not exceed {@link maxMessageBytes} (checked BEFORE
 *      JSON.parse to bound parser memory — cf. GHSA-96hv-2xvq-fx4p).
 *   3. JSON.parse is wrapped so syntactically invalid input returns null.
 *   4. A valid JSON scalar (number, string, boolean, null) is never a message.
 *   5. The parsed object must satisfy the structural depth/key limits.
 *   6. The caller's type guard must accept the shape (e.g. {@link isGameMessage}
 *      in `p2p-game-connection.ts`, which uses {@link isNonNegativeInteger} to
 *      require the `seq` anti-replay field added in issue #1091).
 *
 * @param raw      - Raw string received from an untrusted source (peer/signal).
 * @param validate - Type guard returning true only when the parsed value has
 *                   the expected shape. Receives `unknown`.
 * @param options  - Optional resource-limit overrides.
 * @returns The validated value, or `null` if parsing, limits, or validation
 *          fail.
 */
export function safeParseJson<T>(
  raw: string,
  validate: (value: unknown) => value is T,
  options?: SafeParseJsonOptions,
): T | null {
  if (typeof raw !== "string") {
    return null;
  }

  const limits: StructuralLimits = {
    ...DEFAULT_STRUCTURAL_LIMITS,
    ...options?.limits,
  };

  // Reject oversize messages before allocating a parser AST. This is the
  // primary memory-exhaustion defense (GHSA-96hv-2xvq-fx4p class of bug).
  if (raw.length > limits.maxMessageBytes) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON — reject gracefully without throwing to the caller.
    return null;
  }

  // A valid JSON scalar (number, string, boolean, null) is never a message.
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }

  // Reject pathologically deep or wide payloads before handing them to the
  // (potentially recursive) shape guard, which could otherwise be made to do
  // unbounded work on attacker-controlled input.
  if (!withinStructuralLimits(parsed, limits)) {
    return null;
  }

  return validate(parsed) ? parsed : null;
}

// ──────────────────────────────────────────────────────────────────────────
// HMAC-signed message envelopes (issue #1252).
//
// The peer-impersonation gap left open by the anti-replay sequence-number
// scheme (#1091) is closed here by signing every outbound GameMessage with a
// per-session symmetric key. The transport layer in `p2p-game-connection.ts`
// negotiates the key during the base handshake (see `p2p-handshake.ts`)
// and rotates it after host migration (issue #946). The receiver recomputes
// the HMAC over the canonical payload and drops any message whose signature
// does not match — BEFORE any state mutation.
//
// Threat model (issue #1252):
//   After host migration, the new host inherits peer identities and the new
//   peer slots are trusted on the basis of a re-announced peerId. Without
//   sender binding, a malicious peer who captured an outbound envelope could
//   re-emit a `PlayerActionMessage` with a swapped `senderId` and defeat the
//   authoritative-host validation (#1089). Sequence numbers reject duplicates
//   but do not bind a message to a sender.
//
// Envelope shape (on the wire):
//   {
//     payload: GameMessage,   // type, senderId, timestamp, seq, data
//     hmac: string            // hex HMAC-SHA-256(keyHex, canonicalMessage(payload))
//   }
//
// Canonical form is a length-prefixed pipe-delimited string so that distinct
// (senderId, seq, type, data) tuples cannot collide. `payload.data` is
// canonicalised via `JSON.stringify` with sorted keys so the receiver computes
// the same digest regardless of key ordering on the wire.
// ──────────────────────────────────────────────────────────────────────────

import { hmacSha256Hex } from "./p2p-handshake";

/**
 * A signed message envelope: an existing {@link GameMessage} bound to a
 * per-session symmetric key via an HMAC-SHA-256 tag. The transport attaches
 * the envelope on every outbound message and verifies it on every inbound
 * message before dispatching into the existing per-type handlers.
 *
 * The HMAC is computed over the canonical serialisation of `payload`, so
 * any tamper with `payload.type`, `payload.senderId`, `payload.seq`, or
 * `payload.data` invalidates the signature. `timestamp` is intentionally
 * excluded from the canonical form (display-only per #1091) — a malicious
 * peer can rewrite the timestamp without invalidating the signature, but
 * timestamps do not gate trust so this is harmless.
 *
 * Issue #1252.
 */
export interface MessageEnvelope<T extends GameMessageLike = GameMessageLike> {
  payload: T;
  hmac: string;
}

/**
 * Structural subset of {@link GameMessage} used by the envelope helpers.
 * Typed structurally (not by name) so the helpers can also wrap handshake
 * messages or any other shaped payload without forcing the envelope type to
 * depend on `p2p-game-connection.ts` (which would create a circular import
 * via `p2p-handshake.ts`).
 *
 * Only the fields that participate in the HMAC are required here; `timestamp`
 * is optional because handshake messages carry one and game messages do too.
 */
export interface GameMessageLike {
  type: string;
  senderId: string;
  timestamp?: number;
  seq: number;
  data: unknown;
}

/**
 * Canonical string the HMAC is computed over. Length-prefixed with `:` so
 * concatenated fields cannot collide (e.g. `("ab","c")` and `("a","bc")`
 * are distinguished). The data field is canonicalised via JSON.stringify
 * with sorted keys to make the digest deterministic regardless of the
 * order keys happen to arrive on the wire.
 */
export function canonicalMessageForHmac(message: GameMessageLike): string {
  const type = String(message.type ?? "");
  const senderId = String(message.senderId ?? "");
  const seq = String(message.seq ?? "");
  const dataCanonical = canonicalizeData(message.data);
  return [
    `${type.length}:${type}`,
    `${senderId.length}:${senderId}`,
    `${seq.length}:${seq}`,
    `${dataCanonical.length}:${dataCanonical}`,
  ].join("|");
}

/**
 * Canonicalise an arbitrary JSON-serialisable value with sorted keys so
 * {@link canonicalMessageForHmac} produces the same digest regardless of the
 * property order on the wire. Recurses into nested objects and arrays; falls
 * back to `JSON.stringify` for values the walker cannot enumerate (functions,
 * symbols, etc., which should never appear in a `GameMessage.data` payload).
 */
function canonicalizeData(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      // Match JSON.stringify's behaviour: NaN/Infinity → null.
      return "null";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalizeData(v));
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeData(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  // Functions, symbols, etc. — fall back to JSON.stringify so the digest
  // remains stable for pathological inputs (a `game-action` data should not
  // carry these, but defensive canonicalisation beats throwing).
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

/**
 * Sign a {@link GameMessageLike} payload into a {@link MessageEnvelope}.
 *
 * @param message      The payload to sign (typically a `GameMessage`).
 * @param sessionKeyHex The per-session HMAC key as a hex-encoded string. Must
 *                      be a non-empty even-length hex string (the same
 *                      constraint {@link hmacSha256Hex} enforces).
 * @returns A new envelope with the HMAC attached. The input `message` is not
 *          mutated.
 *
 * Throws on a missing/invalid key — callers that receive envelopes from
 * untrusted sources must validate the key string upstream (the transport
 * already enforces this in {@link verifyMessageEnvelope}).
 */
export function signMessageEnvelope<T extends GameMessageLike>(
  message: T,
  sessionKeyHex: string,
): MessageEnvelope<T> {
  if (typeof sessionKeyHex !== "string" || sessionKeyHex.length === 0) {
    throw new Error("signMessageEnvelope: sessionKeyHex must be a non-empty string");
  }
  const hmac = hmacSha256Hex(sessionKeyHex, canonicalMessageForHmac(message));
  return { payload: message, hmac };
}

/**
 * Verify a {@link MessageEnvelope} against the per-session symmetric key.
 *
 * Order of checks (fail-closed at every step, never throws to the caller):
 *   1. `envelope` is an object with a `payload` and an `hmac` string.
 *   2. `envelope.payload` satisfies {@link isGameMessageLike} (type, senderId,
 *      seq present and well-formed) so the canonical form is well-defined.
 *   3. `expectedSenderId` (when supplied) matches `envelope.payload.senderId`
 *      EXACTLY — a captured envelope with a swapped `senderId` is rejected
 *      here even before the HMAC check, so the diagnostic log can fire the
 *      `envelope-sender-mismatch` event described in the issue.
 *   4. The recomputed HMAC equals `envelope.hmac` (constant-time compare to
 *      avoid leaking signature bytes via early-exit timing).
 *
 * @param envelope         The candidate envelope received on the wire.
 * @param sessionKeyHex    The per-session HMAC key (hex).
 * @param expectedSenderId When provided, also requires `envelope.payload.senderId
 *                         === expectedSenderId`. Optional — pass `undefined`
 *                         to skip the extra check (e.g. when the caller
 *                         trusts the embedded senderId alone).
 * @returns `true` when every check passes, `false` otherwise. Returns a plain
 *          `boolean` (not a type guard) so the falsy branch keeps `envelope`
 *          typed as `unknown` and a subsequent diagnostic read of
 *          `envelope.payload?.senderId` compiles cleanly.
 */
export function verifyMessageEnvelope(
  envelope: unknown,
  sessionKeyHex: string,
  expectedSenderId?: string,
): boolean {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    typeof (envelope as { hmac?: unknown }).hmac !== "string"
  ) {
    return false;
  }
  const payload = (envelope as { payload?: unknown }).payload;
  if (!isGameMessageLike(payload)) {
    return false;
  }
  if (expectedSenderId !== undefined && payload.senderId !== expectedSenderId) {
    return false;
  }
  if (typeof sessionKeyHex !== "string" || sessionKeyHex.length === 0) {
    return false;
  }
  const expected = hmacSha256Hex(sessionKeyHex, canonicalMessageForHmac(payload));
  const actual = (envelope as { hmac: string }).hmac;
  // Constant-time compare: same shape as the capability-token verifier in
  // p2p-handshake.ts. Both sides are hex SHA-256 (64 chars), iteration bounded.
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Type guard: is `value` structurally a {@link GameMessageLike} (the subset
 * of `GameMessage` fields that participate in the HMAC)? Exposed so
 * `safeParseJson` callers can validate envelope-shaped wire payloads with the
 * same shape-guard idiom they use for `GameMessage`.
 */
export function isGameMessageLike(value: unknown): value is GameMessageLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    typeof v.senderId === "string" &&
    typeof v.seq === "number" &&
    Number.isFinite(v.seq) &&
    Number.isInteger(v.seq) &&
    v.seq >= 0
  );
}

/**
 * Type guard: is `value` a well-formed {@link MessageEnvelope}? Does NOT
 * verify the HMAC (use {@link verifyMessageEnvelope} for that) — this only
 * checks the wire SHAPE (envelope has `{ payload, hmac: string }` and the
 * payload looks like a message). Used by `safeParseJson`-style callers that
 * want to validate the envelope shape before handing it to the verifier.
 */
export function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hmac === "string" &&
    v.hmac.length > 0 &&
    isGameMessageLike(v.payload)
  );
}
