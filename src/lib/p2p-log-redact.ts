/**
 * @fileOverview P2P log redaction utility (Issue #982)
 *
 * Strips connection metadata (session IDs, game codes, peer IDs, SDP, ICE
 * candidates, TURN credentials) from arbitrary values before they reach
 * `console.*`. This is a defensive sanitizer, NOT a logging framework —
 * it does not replace `console`, gate output by environment, or introduce
 * log levels. Adopting a structured logger is tracked separately as #987
 * and is explicitly out of scope here.
 *
 * The intent is to keep diagnostic value (error names, messages, state
 * transitions) while ensuring session identifiers and connection secrets
 * never reach the developer console, where they could be scraped by
 * browser extensions, error reporters, or production logging pipelines.
 *
 * Public surface:
 *   - {@link redactSensitive} — pure function, never throws. Use inline:
 *     `console.error("[WebRTC] init failed", redactSensitive(error))`.
 *   - {@link safeLogError} / {@link safeLogWarn} / {@link safeLogInfo} —
 *     thin convenience wrappers for the repeated catch-block pattern.
 */

/** Field names whose values are treated as sensitive connection metadata. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  // Session / game identifiers
  "sessionId",
  "sessionid",
  "session_id",
  "gameCode",
  "gamecode",
  "game_code",
  // Peer / player identifiers
  "peerId",
  "peerid",
  "peer_id",
  "playerId",
  "playerid",
  "player_id",
  "remotePlayerId",
  "localPlayerId",
  // Identity strings
  "hostName",
  "hostname",
  "host_name",
  "playerName",
  // WebRTC session description / candidates
  "sdp",
  "candidate",
  "iceCandidate",
  "iceCandidates",
  "localDescription",
  "remoteDescription",
  "offer",
  "answer",
  "localOffer",
  "remoteOffer",
  "localAnswer",
  "remoteAnswer",
  // ICE / TURN credentials
  "password",
  "credential",
  "username",
  "uris",
  "urls",
]);

/**
 * Literal session-ID patterns produced by `p2p-direct-connection.ts` and
 * related modules. Matched inside arbitrary strings and masked in place.
 *
 * Format: `host-<epoch-ms>-<base36>` or `client-<epoch-ms>-<base36>`.
 * The epoch-ms component is 13 digits (post-2001) and the base36 suffix
 * is 6+ chars — together they form a fingerprint that should never appear
 * in user-visible text, so masking them in any string is safe.
 */
const SESSION_ID_PATTERN = /\b(?:host|client)-\d{10,13}-[a-z0-9]{6,}\b/gi;

/** Maximum length of a redacted string before truncation kicks in. */
const MAX_REDACTED_LENGTH = 4096;

/**
 * Redact sensitive connection metadata from an arbitrary value, returning
 * a string that is safe to forward to `console.*`.
 *
 * Behaviour:
 *   - `null` / `undefined` → `"null"` / `"undefined"`
 *   - `string`             → input with session-ID patterns masked
 *   - `Error`              → `"<Name>: <masked message>"` (stack omitted —
 *                            stacks contain no P2P metadata and grow logs
 *                            large; callers wanting stacks can pass
 *                            `error.stack` through this function directly)
 *   - `object` / `array`   → JSON stringification with sensitive keys
 *                            replaced by `"[REDACTED]"` and cycles broken
 *   - anything else        → `String(value)` with session-IDs masked
 *
 * This function never throws — on any internal failure it returns a safe
 * placeholder so a logging bug can never crash the calling path.
 */
export function redactSensitive(value: unknown): string {
  try {
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    if (typeof value === "string") {
      return maskSessionIds(value);
    }

    if (value instanceof Error) {
      const name = value.name || "Error";
      const message = maskSessionIds(String(value.message ?? ""));
      return `${name}: ${message}`;
    }

    if (typeof value === "object") {
      // Arrays and plain objects share this branch.
      try {
        return maskSessionIds(safeStringify(value));
      } catch {
        // Object could not be serialized (exotic getters, etc.).
        return maskSessionIds(String(value));
      }
    }

    return maskSessionIds(String(value));
  } catch {
    // Defensive: never let a redaction failure propagate.
    return "[redact-error]";
  }
}

/**
 * Emit an error to `console.error` with the caught value redacted.
 *
 * Use in catch blocks where the caught error may transitively embed
 * session IDs, game codes, SDP, or ICE candidates (e.g. WebRTC API
 * failures, JSON.parse on attacker-controlled input).
 */
export function safeLogError(prefix: string, error: unknown): void {
  console.error(prefix, redactSensitive(error));
}

/**
 * Emit a warning to `console.warn` with redacted arguments.
 */
export function safeLogWarn(prefix: string, ...args: unknown[]): void {
  console.warn(prefix, ...args.map((arg) => redactSensitive(arg)));
}

/**
 * Emit an informational message to `console.info` with redacted arguments.
 */
export function safeLogInfo(prefix: string, ...args: unknown[]): void {
  console.info(prefix, ...args.map((arg) => redactSensitive(arg)));
}

/**
 * Mask session-ID patterns inside a string and truncate if oversized.
 * Repeated calls are idempotent — masked output contains no matches.
 */
function maskSessionIds(input: string): string {
  if (!input) return input;
  const truncated =
    input.length > MAX_REDACTED_LENGTH
      ? `${input.slice(0, MAX_REDACTED_LENGTH)}…[redacted-truncated]`
      : input;
  return truncated.replace(SESSION_ID_PATTERN, "[REDACTED_SESSION]");
}

/**
 * JSON.stringify with sensitive keys replaced by `"[REDACTED]"` and
 * cycle-friendly fallbacks. Never throws.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const replacer = (key: string, raw: unknown): unknown => {
    // The top-level call uses key="" — never redact the root holder.
    if (key && SENSITIVE_KEYS.has(key)) {
      return "[REDACTED]";
    }
    if (typeof raw === "object" && raw !== null) {
      if (seen.has(raw as object)) {
        return "[Circular]";
      }
      seen.add(raw as object);
    }
    return raw;
  };

  try {
    const result = JSON.stringify(value, replacer, 0);
    return result ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}
