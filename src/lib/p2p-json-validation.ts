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
 * See issue #924.
 */

/**
 * Safely parse a JSON string and validate its shape.
 *
 * @param raw      - Raw string received from an untrusted source (peer/signal).
 * @param validate - Type guard returning true only when the parsed value has
 *                   the expected shape. Receives `unknown`.
 * @returns The validated value, or `null` if parsing or validation fails.
 */
export function safeParseJson<T>(
  raw: string,
  validate: (value: unknown) => value is T,
): T | null {
  if (typeof raw !== "string") {
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

  return validate(parsed) ? parsed : null;
}
