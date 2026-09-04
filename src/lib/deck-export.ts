/**
 * @fileOverview Deck export formatters for MTGO (.dec) and MTG Arena plaintext.
 *
 * Issue #1543: previously the deck-builder only emitted JSON or a bare
 * "Count Name" .txt dump. Both are unusable as-is by MTGO and MTG Arena,
 * forcing players to hand-edit exports before importing. This module adds
 * the two plaintext dialects MTGO and Arena's importers actually accept,
 * along with matching parsers so the export round-trip is testable.
 *
 *  - MTGO .dec:  mainboard lines, blank line, literal `Sideboard`,
 *                sideboard lines. No `Mainboard` / `Deck` header (MTGO's
 *                importer treats the file as mainboard by default).
 *  - Arena .txt: literal `Deck`, mainboard lines, blank line, literal
 *                `Sideboard`, sideboard lines. The `Deck` header is what
 *                tells Arena's importer where the mainboard starts.
 *
 * Both formats use `COUNT CARDNAME` lines without set codes. Double-faced /
 * split-card names use ` // ` (matches the normalization in
 * {@link parseMTGOLine}).
 *
 * Sideboard is omitted entirely when empty (Commander-family formats):
 * neither importer requires a sideboard section, and Arena rejects decks
 * with an empty `Sideboard` block.
 *
 * @see https://github.com/anchapin/planar-nexus/issues/1543
 */

export type DeckExportFormat = "json" | "mtgo" | "arena";

export interface DeckEntry {
  name: string;
  quantity: number;
}

export interface DeckExportPayload {
  mainboard: DeckEntry[];
  sideboard?: DeckEntry[];
}

/**
 * Render one card as `COUNT NAME`. Defensive: trims the name, normalizes
 * double-faced separators to ` // `, and strips any set code / collector
 * suffix that might have slipped through from upstream tools. Quantity is
 * floored to a positive integer — non-positive quantities are dropped by
 * the caller rather than silently written as `0 Name`.
 */
export function formatCardLine(entry: DeckEntry): string {
  const qty = Math.max(0, Math.floor(entry.quantity || 0));
  const name = normalizeCardNameForExport(entry.name);
  if (qty <= 0 || !name) return "";
  return `${qty} ${name}`;
}

/**
 * Normalize a card name for plaintext export. Mirrors the import-side
 * normalization in {@link parseMTGOLine} so the export is recognised by
 * the same parsers:
 *
 *  - trim whitespace
 *  - collapse `/` (with optional surrounding whitespace) into ` // `
 *    so double-faced cards like "Delver of Secrets / Insectile Aberration"
 *    export as "Delver of Secrets // Insectile Aberration".
 *  - strip trailing set/collector suffixes such as "(M21) 75" or
 *    "[CMR] 632" — neither importer expects these in a .dec/.txt file.
 *
 * Arena-only display names are intentionally NOT translated here: the
 * canonical card name is what MTGO's importer expects, and Arena's
 * importer also accepts canonical names. The `ARENA_NAME_ALIASES`
 * translation is applied on the import path in {@link parseMTGOLine}.
 */
export function normalizeCardNameForExport(rawName: string): string {
  let name = (rawName || "").trim();
  if (!name) return "";

  // Drop trailing "(SET) 123" / "[SET] 123" suffixes
  name = name.replace(/\s*[([][A-Za-z0-9]{2,5}[)\]]\s*\d+.*$/i, "").trim();
  // Drop trailing "(SET)" / "[SET]" without a collector number
  name = name.replace(/\s*[([][A-Za-z0-9]{2,5}[)\]]\s*$/i, "").trim();

  // Normalize double-faced separator to " // " (matches parseMTGOLine)
  if (name.includes("/") && !name.includes(" // ")) {
    name = name.replace(/\s*\/\s*/g, " // ");
  }
  // Collapse double spaces introduced by stripping
  name = name.replace(/\s{2,}/g, " ").trim();

  return name;
}

/**
 * Render the mainboard section (no header). Lines are emitted in the order
 * the caller supplied — neither MTGO nor Arena requires a particular sort,
 * so we preserve whatever order the deck-builder UI uses (typically
 * mana-cost ascending then alphabetical).
 */
function renderMainboard(cards: readonly DeckEntry[]): string[] {
  const lines: string[] = [];
  for (const card of cards || []) {
    const line = formatCardLine(card);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Render the sideboard section (no header). Returns an empty array when
 * the sideboard is absent or empty so callers can decide whether to emit
 * the section at all.
 */
function renderSideboard(cards: readonly DeckEntry[] | undefined): string[] {
  if (!cards || cards.length === 0) return [];
  const lines: string[] = [];
  for (const card of cards) {
    const line = formatCardLine(card);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Format a deck as an MTGO `.dec` payload.
 *
 *   4 Sol Ring
 *   2 Arcane Signet
 *
 *   Sideboard
 *   1 Counterspell
 *
 * If `sideboard` is empty/undefined the Sideboard section is omitted
 * entirely (Commander decks have no sideboard).
 */
export function formatDeckAsMTGO(payload: DeckExportPayload): string {
  const mainboard = renderMainboard(payload.mainboard);
  const sideboard = renderSideboard(payload.sideboard);
  const out: string[] = [...mainboard];
  if (sideboard.length > 0) {
    // Blank separator + literal "Sideboard" header (MTGO's importer treats
    // this token as the sideboard section marker).
    out.push("", "Sideboard", ...sideboard);
  }
  return out.join("\n");
}

/**
 * Format a deck as an MTG Arena plaintext payload.
 *
 *   Deck
 *   4 Sol Ring
 *   2 Arcane Signet
 *
 *   Sideboard
 *   1 Counterspell
 *
 * The literal `Deck` line tells Arena's importer where the mainboard
 * starts; without it Arena treats the first card as belonging to the
 * sideboard. The sideboard section is omitted when the deck has no
 * sideboard (Commander-family formats).
 */
export function formatDeckAsArena(payload: DeckExportPayload): string {
  const mainboard = renderMainboard(payload.mainboard);
  const sideboard = renderSideboard(payload.sideboard);
  const out: string[] = ["Deck", ...mainboard];
  if (sideboard.length > 0) {
    out.push("", "Sideboard", ...sideboard);
  }
  return out.join("\n");
}

/**
 * Format a deck in any supported plaintext format. JSON is intentionally
 * not handled here — callers continue to use the existing JSON path so
 * the round-trip metadata (`name`, `format`, `exportedAt`) keeps flowing.
 */
export function formatDeck(
  format: DeckExportFormat,
  payload: DeckExportPayload,
): string {
  switch (format) {
    case "mtgo":
      return formatDeckAsMTGO(payload);
    case "arena":
      return formatDeckAsArena(payload);
    case "json":
      throw new Error(
        "formatDeck does not emit JSON; use the JSON export path directly so " +
          "the deck metadata (name, format, exportedAt) is preserved.",
      );
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported deck export format: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Compute the suggested filename for a given deck name + format.
 *
 *   "My Deck" + "json"  -> "My-Deck.json"
 *   "My Deck" + "mtgo"  -> "My-Deck.dec"
 *   "My Deck" + "arena" -> "My-Deck.txt"
 *
 * The deck name is sanitized to `[A-Za-z0-9._-]+`; any other character
 * (including spaces and slashes) becomes a dash so the filename is
 * portable across Windows / macOS / Linux and survives being passed
 * through `URL.createObjectURL`.
 */
export function getExportFilename(
  deckName: string | undefined,
  format: DeckExportFormat,
): string {
  const extension = format === "mtgo" ? "dec" : format === "arena" ? "txt" : "json";
  const base = sanitizeExportFilename(deckName);
  return `${base}.${extension}`;
}

/**
 * Sanitize a free-form deck name for use as a filename. Replaces any
 * non `[A-Za-z0-9._-]` character with a dash and collapses runs of
 * dashes. Falls back to `deck` when the result would be empty.
 */
export function sanitizeExportFilename(deckName: string | undefined): string {
  const cleaned = (deckName || "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .trim();
  return cleaned || "deck";
}

// ---------------------------------------------------------------------------
// Parsers — reverse the formatters above. Used by the round-trip tests and
// available to any future feature that wants to validate an exported file
// before sending it to /api/deck-import. Behaviour is intentionally lenient
// (blank lines / trailing whitespace tolerated) so user-edited files still
// parse.
// ---------------------------------------------------------------------------

const SKIP_TOKENS = new Set([
  "sideboard",
  "deck",
  "about",
  "name",
  "mainboard",
  "maybeboard",
]);

/**
 * Parse one `COUNT NAME` line into a {@link DeckEntry}. Returns `null`
 * for blank lines, comments, and section headers. Set codes / collector
 * numbers are stripped and `//` separators are normalized, matching
 * {@link normalizeCardNameForExport}.
 */
export function parsePlaintextDeckLine(
  line: string,
): DeckEntry | null {
  const trimmed = (line || "").trim();
  if (!trimmed) return null;

  // Match either "1 Card Name" / "1x Card Name" (quantity + whitespace +
  // name) or just "Card Name" (default quantity 1). The first branch
  // requires whitespace between the count and the name; the second
  // branch accepts any non-empty name with no leading integer so plain
  // "Sol Ring" lines still parse.
  const match = trimmed.match(/^(?:(\d+)\s*x?\s+)?(.+)$/i);
  if (!match) return null;

  if (SKIP_TOKENS.has(trimmed.toLowerCase())) return null;

  const quantity = match[1] ? parseInt(match[1], 10) : 1;
  const name = normalizeCardNameForExport(match[2]);
  if (!name) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { name, quantity };
}

/**
 * Parse an MTGO `.dec` payload into mainboard + sideboard. The format is
 * mainboard lines, optional blank line, optional `Sideboard` header,
 * sideboard lines. Anything before `Sideboard` is mainboard; anything
 * after is sideboard. Cards listed after a second `Sideboard` token are
 * folded back into the sideboard (lenient — tolerates user edits).
 */
export function parseMTGOExport(text: string): DeckExportPayload {
  const mainboard: DeckEntry[] = [];
  const sideboard: DeckEntry[] = [];
  let inSideboard = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "sideboard") {
      inSideboard = true;
      continue;
    }
    if (trimmed.toLowerCase() === "deck") {
      // Some MTGO exporters leak an Arena-style header; skip it.
      inSideboard = false;
      continue;
    }
    const entry = parsePlaintextDeckLine(rawLine);
    if (!entry) continue;
    if (inSideboard) sideboard.push(entry);
    else mainboard.push(entry);
  }
  return {
    mainboard,
    sideboard: sideboard.length > 0 ? sideboard : undefined,
  };
}

/**
 * Parse an Arena plaintext payload. Same shape as MTGO except the
 * mainboard is preceded by a literal `Deck` header. `Deck` tokens after
 * the first one are ignored (tolerates `Deck` lines appearing inside
 * the sideboard — they reset the section pointer to mainboard, matching
 * Arena's importer behaviour).
 */
export function parseArenaExport(text: string): DeckExportPayload {
  const mainboard: DeckEntry[] = [];
  const sideboard: DeckEntry[] = [];
  let section: "mainboard" | "sideboard" = "mainboard";
  let seenDeckHeader = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === "deck") {
      seenDeckHeader = true;
      section = "mainboard";
      continue;
    }
    if (lower === "sideboard") {
      section = "sideboard";
      continue;
    }
    const entry = parsePlaintextDeckLine(rawLine);
    if (!entry) continue;
    if (section === "mainboard") mainboard.push(entry);
    else sideboard.push(entry);
  }
  // If the file never opened with `Deck`, treat it as mainboard anyway so
  // a plain "COUNT NAME" file still round-trips. This matches MTGO's
  // importer which treats the whole file as mainboard when no header is
  // present.
  const result: DeckExportPayload = { mainboard };
  if (!seenDeckHeader && sideboard.length === 0) {
    return result;
  }
  if (sideboard.length > 0) result.sideboard = sideboard;
  return result;
}

// ---------------------------------------------------------------------------
// Browser-only download helper. Kept in this module (rather than split into
// a client-only file) so the import-export menu can call a single function.
// Caller is expected to be a `"use client"` component.
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of `content` as `filename`. No-op in
 * non-browser environments (jsdom in tests stubs `URL.createObjectURL`).
 */
export function triggerBrowserDownload(
  content: string,
  filename: string,
  mimeType: string,
): void {
  if (typeof window === "undefined") return;
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}