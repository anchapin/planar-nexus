/**
 * @fileOverview P2P chat-message sanitization (issue #1428)
 *
 * Chat is the only P2P message type whose `data.text` is arbitrary,
 * peer-controlled content rendered to other peers — players AND spectators
 * (per #1253, `DEFAULT_SPECTATOR_PERMISSIONS.canChat = true`). The
 * transport-level guards from #1111 cap wire SIZE and RATE but NOT
 * single-message length, and #1276 only sanitizes card/coach text at
 * RENDER time. This module is the application-layer cap + sanitize for
 * chat on BOTH the send and receive paths — defense in depth:
 *
 *   SEND path  → {@link sanitizeChatMessage} + REJECT over-length
 *                (P2PGameConnection.sendChat / MeshGameConnection.broadcastChat)
 *   RECV path  → {@link sanitizeChatMessage} + {@link capMessageLength}
 *                (handleChat / mesh inbound) so a buggy or hostile sender can
 *                never slip an oversized or markup-laden payload past the
 *                receiver, even if the render layer is later changed.
 *
 * Design notes:
 *   - {@link sanitizeChatMessage} is a deny-list STRIP of characters that have
 *     no legitimate place in chat and that could inject markup (raw `<`/`>`/
 *     backtick) or smuggle payloads (C0/C1 controls, bidi overrides,
 *     zero-width). It does NOT HTML-escape: escaping belongs to the render
 *     layer (`game-chat.tsx` already runs `sanitizeCardText` from #1276, and
 *     React's JSX interpolation auto-escapes). Escaping here would
 *     double-escape at render (`<` → `&lt;` → `&amp;lt;`). Stripping the
 *     chars at the source is the intentional transport-layer defense so they
 *     never reach a renderer even if a future change bypasses sanitizeCardText.
 *   - {@link capMessageLength} truncates with a single ellipsis. The send
 *     path REJECTS over-length (returns false); the receive path TRUNCATES
 *     (never trust peer input — a legacy/malformed peer may emit a huge blob).
 *   - NFC normalization defeats homoglyph/confusable abuse that relies on
 *     decomposed forms and makes byte-length comparisons stable.
 */

/**
 * Default maximum length (chars) of a single P2P chat message. Chosen to fit
 * a sensible UI line count and well below any plausible wire-size threshold
 * (#1111). Overridable per-connection via
 * `P2PGameConnectionOptions.maxChatMessageLength` /
 * `MeshGameConnectionOptions.maxChatMessageLength`.
 */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

/**
 * C0 control chars (`\u0000`-`\u001F`) EXCEPT tab (`\u0009`), newline
 * (`\u000A`), and carriage return (`\u000D`); plus DEL (`\u007F`) and the
 * C1 8-bit control range (`\u0080`-`\u009F`). Chat is line-oriented so
 * `\n` / `\r` / `\t` are intentionally preserved.
 */
// eslint-disable-next-line no-control-regex -- intentionally targets control chars
const CHAT_CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Bidi override / embedding controls and zero-width / BOM characters used to
 * spoof text direction or hide payloads (Trojan-source attacks). These have
 * no place in chat. Mirrors the `SMUGGLE_CHARS` set in `sanitize-text.ts`
 * (#1276) so the two layers agree on what is smuggle-grade.
 */
const CHAT_BIDI_ZW_CHARS = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;

/**
 * Raw HTML / markdown-significant characters stripped at the transport
 * layer. Removing `<`, `>`, and the backtick prevents a future or buggy
 * renderer from ever materialising tags or inline-code spans from peer
 * chat. The render layer (`sanitizeCardText`) would escape these; stripping
 * here is the redundant defense so the characters are absent on the wire
 * entirely (and survives any code path that bypasses the render sanitizer).
 */
const CHAT_MARKUP_CHARS = /[<>`]/g;

/**
 * Runs of 2+ horizontal whitespace (spaces / tabs / other horizontal
 * spaces, but NOT newlines) collapsed to a single space. Defeats
 * spacing-based log-spam and normalizes rendering across peers. Newlines
 * are preserved because chat is line-oriented.
 */
const CHAT_WHITESPACE_RUNS = /[^\S\r\n]{2,}/g;

/**
 * Normalize and strip control / bidi / zero-width / markup characters from
 * a raw chat string. Pure and idempotent: applying it twice yields the same
 * string. Does NOT cap length and does NOT HTML-escape (the render layer's
 * job). Safe for non-string input — coerces to `""`.
 *
 * @param raw - the untrusted chat text (any type; non-strings coerced)
 * @returns the sanitized string (never null/undefined; may be empty)
 */
export function sanitizeChatMessage(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return (
    text
      // NFC first so subsequent strips see the canonical form.
      .normalize("NFC")
      .replace(CHAT_CONTROL_CHARS, "")
      .replace(CHAT_BIDI_ZW_CHARS, "")
      .replace(CHAT_MARKUP_CHARS, "")
      .replace(CHAT_WHITESPACE_RUNS, " ")
  );
}

/**
 * Truncate a chat message to `maxLength` chars, appending a single ellipsis
 * (`…`) when truncation occurs so the receiver can tell the message was
 * capped. Used on the RECEIVE path (defense in depth — never trust peer
 * input even after sanitization). The SEND path rejects over-length instead
 * of truncating so the sender gets feedback to shorten the message.
 *
 * The returned string is guaranteed `<= maxLength` chars (the ellipsis is
 * counted within the budget).
 *
 * @param message - the (ideally already-sanitized) chat text
 * @param maxLength - inclusive max length of the RETURNED string including
 *   the ellipsis marker; defaults to {@link MAX_CHAT_MESSAGE_LENGTH}
 */
export function capMessageLength(
  message: unknown,
  maxLength: number = MAX_CHAT_MESSAGE_LENGTH,
): string {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  // Reserve room for the ellipsis so the result never exceeds maxLength.
  const marker = "…";
  return text.slice(0, Math.max(0, maxLength - marker.length)) + marker;
}
