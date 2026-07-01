/**
 * @fileOverview Render-time text sanitizers (issue #1276)
 *
 * Defense-in-depth HTML/markdown sanitizers applied to all *untrusted* text
 * that ends up in the React tree — custom-card JSON, oracle-text, chat,
 * replay-viewer notes, and AI coach markdown. React's JSX interpolation
 * (`{value}`) already escapes HTML at render time, but JSX auto-escaping is
 * not sufficient as a sole control because:
 *
 *   1. Some sites use `dangerouslySetInnerHTML`, `title=`, or other attribute
 *      sinks where attribute-encoding parity is not automatic.
 *   2. Custom-card JSON flows from `localStorage` → `importCustomCards()` →
 *      preview/render. A malicious deck shared as a `.json` file can plant a
 *      payload that survives every cache layer.
 *   3. Markdown renderers are commonly used downstream and a permissive
 *      renderer will treat `<script>` content as raw HTML.
 *
 * The functions here are *deliberately* allow-listed rather than deny-listed:
 * the markdown subset we support is intentionally tiny so a vulnerability in
 * a permissive regex cannot widen the surface.
 *
 * Threat model — what each helper blocks:
 *   - `<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, `<svg>` tags
 *   - `on*` / `formaction` / `srcdoc` / `xlink:href` handlers (script execution)
 *   - `javascript:`, `vbscript:`, `data:` (except `data:image/...`) URI schemes
 *   - `expression(...)` / `@import` CSS primitives
 *   - control / bidi / zero-width characters that smuggle payloads past log
 *     filters (also blocked by `sanitizeUserInput` upstream; we re-strip here)
 *
 * What is intentionally NOT in scope:
 *   - These helpers are for *display* sanitization. Prompt-injection defenses
 *     for LLM input live in `src/ai/prompt-security.ts`.
 *   - The helpers do NOT encode for HTML attribute context. Callers using
 *     these strings inside attribute values must still wrap with `"…"` and not
 *     allow raw double quotes from user input; we escape `"` so this is safe
 *     for typical attribute use.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/**
 * Escape the five HTML-significant characters so a string can be safely
 * embedded in element text or quoted-attribute context. Always pair this
 * with a context-appropriate wrapper (e.g. `<p>{value}</p>`, never raw
 * `dangerouslySetInnerHTML`).
 *
 * Returns `""` for non-string inputs.
 */
export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[&<>"'`]/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Default maximum length (chars) for a single sanitized card-text field.
 * Matches the upper bound used by Scryfall oracle_text in practice.
 */
export const DEFAULT_MAX_CARD_TEXT_LENGTH = 2_000;

/**
 * Default maximum length for a single sanitized markdown block.
 * Coach summaries in this app are bounded around 8 000 chars; we cap below
 * that to keep render cost predictable.
 */
export const DEFAULT_MAX_MARKDOWN_LENGTH = 16_000;

/**
 * Smuggle / hide characters that have no place in card text: C0 controls
 * (except tab/newline), DEL, bidi overrides, zero-width, and BOM. Newlines
 * (`\n`), carriage returns (`\r`) and tabs (`\t`) are intentionally retained
 * because card text is line-oriented (e.g. separate ability lines).
 */
const SMUGGLE_CHARS =
  // eslint-disable-next-line no-control-regex -- intentionally targets control/bidi/zero-width chars
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;

/**
 * URI schemes that can execute script or load HTML when followed by an
 * attacker-controlled payload. We allow `https?`, `mailto`, and the
 * `data:image/...` subset which is required for inline procedurally-
 * generated card art. Everything else with a scheme — `data:text/html`,
 * `data:application/javascript`, `vbscript:`, `file:`, `about:`, `chrome:`,
 * `jar:`, etc. — is rejected.
 *
 * The pattern is anchored with `:` *inside* the alternation for each scheme
 * (rather than at the end of the regex) so `data:text/html` is matched by
 * the `data\s*:` arm followed by the negative lookahead — the trailing `:`
 * outside the group is intentional and matches when the alternative itself
 * did not consume a colon.
 */
const DANGEROUS_URI_SCHEMES =
  /^(?:javascript:|vbscript:|data\s*:(?!image\/(?:png|jpe?g|gif|webp|svg\+xml))|file:|about:|chrome:|jar:)/i;

/**
 * Pattern that catches any HTML tag or fragment — opening, closing, or
 * self-closing. Used to strip raw HTML before markdown rendering so a
 * permissive downstream renderer cannot be tricked into materialising it.
 */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>?/g;

/**
 * Pattern that catches lone `<` characters that look like the start of an
 * unfinished tag. We do not strip these (that would corrupt MTG reminder
 * text containing `<`/`>` like `less than {C}`), but we use this when
 * verifying that no HTML survived sanitisation.
 */
const HTML_RESIDUE = /<\/?[a-zA-Z][^>]{0,200}>/;

/**
 * Sanitize a card text field for display. Applies:
 *   - coercion of non-strings to a safe string;
 *   - control / bidi / zero-width character stripping;
 *   - HTML entity escaping (`<` → `&lt;`, etc.);
 *   - length clamping.
 *
 * The Scryfall reminder-symbol arrows (`→`, `⟶`, etc.) and mana symbols
 * (`{T}`, `{R}`, `{W}`, etc.) are preserved as-is — they are unicode /
 * braces, not HTML-significant. This helper is the one to use for `name`,
 * `typeLine`, `oracleText`, `flavorText`, `power`, `toughness`, `loyalty`,
 * `artist`, and `copyright` on CustomCardDefinition.
 */
export function sanitizeCardText(value: unknown, maxLength: number = DEFAULT_MAX_CARD_TEXT_LENGTH): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  let out = raw.replace(SMUGGLE_CHARS, "");
  out = escapeHtml(out);
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + "…[truncated]";
  }
  return out;
}

/**
 * Sanitize an entire custom-card-shaped object's user-controllable string
 * fields. Returns a shallow-copied, sanitized card. Non-string fields are
 * left untouched except for HTML-sensitive fields which become strings.
 *
 * The generic constraint is intentionally loose (`object`) so this
 * function works for both validated `CustomCardDefinition` and raw
 * imported JSON blobs that may have extra / missing keys; the runtime
 * type-checks each field before sanitizing.
 */
export function sanitizeCustomCardFields<T extends object>(card: T): T {
  if (card == null || typeof card !== "object") return card;
  const out: Record<string, unknown> = { ...(card as Record<string, unknown>) };
  const fields = ["name", "typeLine", "oracleText", "flavorText", "artist", "copyright"] as const;
  for (const field of fields) {
    if (typeof out[field] === "string") {
      out[field] = sanitizeCardText(out[field]);
    }
  }
  // power/toughness/loyalty can be numeric or "1+1" / "*"; sanitize as text.
  for (const field of ["power", "toughness", "loyalty"] as const) {
    if (typeof out[field] === "string") {
      out[field] = sanitizeCardText(out[field], 16);
    }
  }
  // mana cost and collector number are short tokens; sanitize as text.
  for (const field of ["manaCost", "collectorNumber", "setCode", "setName"] as const) {
    if (typeof out[field] === "string") {
      out[field] = sanitizeCardText(out[field], 64);
    }
  }
  // Nested art object — `imageUrl` flows into <img src=…> and must be
  // scheme-validated, not just HTML-escaped, to block javascript: / data:
  // payloads that would survive HTML-escaping.
  const art = out.art;
  if (art && typeof art === "object" && (art as Record<string, unknown>).imageUrl !== undefined) {
    const a = { ...(art as Record<string, unknown>) };
    if (typeof a.imageUrl === "string") {
      a.imageUrl = sanitizeUrl(a.imageUrl);
    }
    out.art = a;
  }
  return out as unknown as T;
}

/**
 * Sanitize a URL for use in `href` / `src` attributes. Returns `""` (empty
 * string, never `null`) for anything that is not a string or that uses a
 * dangerous scheme.
 *
 * Allowed schemes: `http:`, `https:`, `mailto:`, and `data:image/...`.
 * Also allowed are root-relative (`/foo/bar`) references which inherit
 * the page's origin. `data:image/...` is permitted because card-art
 * previews use inline procedural images.
 */
export function sanitizeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  // Reject anything starting with a dangerous scheme before any
  // HTML-escaping has happened — the dangerous-scheme regex is anchored.
  if (DANGEROUS_URI_SCHEMES.test(trimmed)) return "";
  // Allow root-relative references (no scheme → safe because they inherit
  // the page's origin).
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return escapeHtml(trimmed);
  }
  // Require a permitted scheme for absolute URLs.
  const allowed = /^(?:https?|mailto|data):/i;
  if (!allowed.test(trimmed)) {
    return "";
  }
  return escapeHtml(trimmed);
}

interface MarkdownState {
  inList: boolean;
  listType: "ul" | "ol" | null;
  listCounter: number;
}

const MARKDOWN_INLINE_PATTERNS: Array<{
  name: string;
  re: RegExp;
  render: (match: RegExpExecArray) => string;
}> = [
  // Inline code: `code` — content is taken literally, not parsed for further markdown.
  {
    name: "code",
    re: /`([^`\n]+)`/,
    render: (m) => `<code>${escapeHtml(m[1])}</code>`,
  },
  // Bold: **text** or __text__
  {
    name: "bold",
    re: /\*\*([^*\n]+)\*\*|__([^_\n]+)__/,
    render: (m) => `<strong>${escapeHtml(m[1] ?? m[2] ?? "")}</strong>`,
  },
  // Italic: *text* or _text_ (but not ** / __ consumed above — order matters)
  {
    name: "italic",
    re: /(?:^|[^*])\*([^*\n]+)\*|(?:^|[^_])_([^_\n]+)_/,
    render: (m) => `<em>${escapeHtml(m[1] ?? m[2] ?? "")}</em>`,
  },
  // Auto-link: <https://example.com>
  {
    name: "autolink",
    re: /<(https?:\/\/[^>\s]+)>/,
    render: (m) => {
      const url = sanitizeUrl(m[1]);
      if (!url) return "&lt;invalid-url&gt;";
      return `<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(m[1])}</a>`;
    },
  },
  // Inline link: [text](url) — both halves are sanitized; unsafe URLs are dropped.
  {
    name: "link",
    re: /\[([^\]\n]+)\]\(([^)\n]*)\)/,
    render: (m) => {
      const text = sanitizeCardText(m[1], 200);
      const url = sanitizeUrl(m[2]);
      if (!url) return text;
      return `<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${text}</a>`;
    },
  },
];

function renderInline(line: string): string {
  // The inline patterns operate on the raw line and emit escaped fragments
  // directly; we walk the line left-to-right and at each cursor position
  // try to match any pattern. Unmatched characters are escaped individually.
  let html = "";
  let cursor = 0;
  while (cursor < line.length) {
    let matched = false;
    for (const pat of MARKDOWN_INLINE_PATTERNS) {
      const slice = line.slice(cursor);
      pat.re.lastIndex = 0;
      const m = pat.re.exec(slice);
      if (m && m.index !== undefined) {
        // Append the literal text between cursor and the match (escaped).
        html += escapeHtml(slice.slice(0, m.index));
        html += pat.render(m);
        cursor += m.index + m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      html += escapeHtml(line[cursor]!);
      cursor += 1;
    }
  }
  return html;
}

/**
 * Sanitize a markdown string and return an HTML fragment. The supported
 * subset is deliberately small:
 *
 *   - Headings: lines starting with `#`, `##`, `###` (max depth 3)
 *   - Bold: `**text**` or `__text__`
 *   - Italic: `*text*` or `_text_`
 *   - Inline code: `` `text` ``
 *   - Inline link: `[text](https://...)` — non-http(s) URLs are dropped
 *   - Auto-link: `<https://...>`
 *   - Unordered lists: lines starting with `- ` or `* `
 *   - Ordered lists: lines starting with `1. `, `2. `, etc.
 *   - Paragraphs: any other non-blank line
 *   - Blank line: paragraph / list break
 *
 * Anything that looks like an HTML tag is stripped before rendering so a
 * downstream renderer (or a copy/paste into a `dangerouslySetInnerHTML`
 * sink) cannot materialise script elements. URLs in link targets are
 * validated by {@link sanitizeUrl}.
 *
 * The returned string is safe to assign to `dangerouslySetInnerHTML` *only*
 * because every dynamic fragment is escaped; do not bypass the helper.
 */
export function sanitizeMarkdown(value: unknown, maxLength: number = DEFAULT_MAX_MARKDOWN_LENGTH): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  let out = raw.replace(SMUGGLE_CHARS, "");
  // Defensively strip any HTML tags up-front. This is belt-and-suspenders:
  // the inline renderers below also escape, so this is only protection
  // against accidental code paths that bypass them.
  out = out.replace(HTML_TAG, "");
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + "…[truncated]";
  }

  const lines = out.split(/\r?\n/);
  const html: string[] = [];
  const state: MarkdownState = { inList: false, listType: null, listCounter: 0 };

  const closeList = () => {
    if (state.inList && state.listType) {
      html.push(state.listType === "ul" ? "</ul>" : "</ol>");
      state.inList = false;
      state.listType = null;
      state.listCounter = 0;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (line.trim() === "") {
      closeList();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      html.push(`<h${level}>${renderInline(text)}</h${level}>`);
      continue;
    }

    const ulMatch = /^[-*]\s+(.+)$/.exec(line);
    if (ulMatch) {
      if (!state.inList || state.listType !== "ul") {
        closeList();
        html.push("<ul>");
        state.inList = true;
        state.listType = "ul";
      }
      html.push(`<li>${renderInline(ulMatch[1]!)}</li>`);
      continue;
    }

    const olMatch = /^\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      if (!state.inList || state.listType !== "ol") {
        closeList();
        html.push("<ol>");
        state.inList = true;
        state.listType = "ol";
      }
      html.push(`<li>${renderInline(olMatch[1]!)}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  return html.join("");
}

/**
 * Sanitize a `src`/`href` value used in card art or external image rendering.
 * Returns an empty string for any value that fails {@link sanitizeUrl}, which
 * the caller should treat as "fall back to procedural art".
 */
export function sanitizeImageUrl(value: unknown): string {
  return sanitizeUrl(value);
}

/**
 * Test-only export: expose the internal regexes so test fixtures can verify
 * that a given payload would have matched. Not part of the public API.
 * @internal
 */
export const __testing__ = {
  ESCAPE_MAP,
  SMUGGLE_CHARS,
  HTML_TAG,
  HTML_RESIDUE,
  DANGEROUS_URI_SCHEMES,
  /**
   * Tag names that are *never* safe to render in sanitized markdown output.
   * If any of these appear in the output, the sanitizer has been bypassed.
   */
  UNSAFE_TAGS: new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "style",
    "svg",
    "math",
    "link",
    "meta",
    "base",
    "frame",
    "frameset",
    "html",
    "body",
    "head",
    "video",
    "audio",
    "source",
    "track",
    "applet",
    "marquee",
  ]),
};