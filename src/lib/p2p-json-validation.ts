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
 * See issue #924 (shape validation) and issue #1111 (resource limits).
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
 * Safely parse a JSON string, enforce resource limits, and validate its shape.
 *
 * Order of checks (fail-closed at every step, never throws to the caller):
 *   1. Input must be a string.
 *   2. Byte length must not exceed {@link maxMessageBytes} (checked BEFORE
 *      JSON.parse to bound parser memory — cf. GHSA-96hv-2xvq-fx4p).
 *   3. JSON.parse is wrapped so syntactically invalid input returns null.
 *   4. A valid JSON scalar (number, string, boolean, null) is never a message.
 *   5. The parsed object must satisfy the structural depth/key limits.
 *   6. The caller's type guard must accept the shape.
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
