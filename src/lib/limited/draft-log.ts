/**
 * Per-pick draft log capture + CSV/JSON export (issue #1558).
 *
 * A draft log is the canonical artifact every Limited player produces
 * after a draft — pack number, pick number, card name, the rest of the
 * pack at the time of the pick, and a timestamp. Planar Nexus previously
 * only recorded the resulting pool and the IDs of cards already taken
 * from each pack, leaving players with no way to export or share what
 * they actually picked.
 *
 * This module owns:
 *  1. **`appendPickRecord`** — the single mutation point invoked by
 *     `pickCard()` in `src/components/draft-picker.tsx`. It is the only
 *     writer to `DraftSession.pickLog`, so all append behavior (idempotency,
 *     correct `pickNumber` / `packNumber` indexing across the
 *     pack-2 → pack-3 transition, available-vs-skipped partitioning) lives
 *     in one place.
 *  2. **`normalizeDraftPickLog`** — a defensive default for legacy
 *     persisted sessions that pre-date the `pickLog` field. The IndexedDB
 *     schema is unchanged; old rows simply lack the array.
 *  3. **CSV / JSON serializers** — the deterministic exports wired up to
 *     the Draft Complete page buttons.
 *
 * Composition with #1559: `pickCard()` runs on the user side and is
 * untouched by the seedable PRNG plumbing (it only consumes a pre-existing
 * pack). `pickLog` therefore works whether the session was seeded or not —
 * the log is the player's *input* to a future replay, not a function of
 * the pack generator's randomness.
 */

import type {
  DraftSession,
  PickRecord,
  PoolCard,
} from "./types";
import type { Rarity } from "@/lib/search/filter-types";

// ============================================================================
// Constants
// ============================================================================

/** MTG draft: 3 packs × 14 cards = 42 user picks. Used to size the CSV
 * header assertion in tests; the serializer itself is shape-agnostic. */
export const DRAFT_TOTAL_PICKS = 42;

/** Pick count per pack (issue #1558 acceptance criteria references the
 * pack-2/pack-3 numbering transition at pick index 14). */
export const PICKS_PER_PACK = 14;

/** Number of packs in a standard MTG draft. */
export const PACKS_PER_DRAFT = 3;

/** CSV column order — issue #1558 acceptance criteria, locked. */
export const DRAFT_LOG_CSV_COLUMNS = [
  "pack",
  "pick",
  "cardId",
  "cardName",
  "rarity",
  "pickedAt",
] as const;

/** Canonical Rarity set used by the export. Persisted rows may carry
 * arbitrary strings (legacy / custom-card / unseeded test data); the
 * CSV writer falls back to the raw string for anything outside the
 * canonical set, preserving the original record verbatim. */
const CANONICAL_RARITIES: ReadonlySet<Rarity> = new Set([
  "common",
  "uncommon",
  "rare",
  "mythic",
]);

// ============================================================================
// Normalization
// ============================================================================

/**
 * Coerce a possibly-missing `pickLog` from a persisted row onto a stable
 * empty array. Idempotent: returns the same array reference if the input
 * is already a non-null array. Never mutates the input.
 *
 * Pre-#1558 sessions that were saved to IndexedDB before this field
 * existed will load with `pickLog === undefined`; the Draft Complete page
 * reads the log via this helper so a legacy row renders the empty table
 * without throwing.
 */
export function normalizeDraftPickLog(
  pickLog: PickRecord[] | undefined | null,
): PickRecord[] {
  if (Array.isArray(pickLog)) {
    return pickLog;
  }
  return [];
}

/**
 * Load a draft session from any source and return it with a guaranteed
 * `pickLog` array. The other fields are passed through untouched so this
 * is safe to call at any point in the session lifecycle (UI load,
 * export, replay).
 */
export function withNormalizedPickLog(session: DraftSession): DraftSession {
  if (Array.isArray(session.pickLog)) {
    return session;
  }
  return { ...session, pickLog: [] };
}

// ============================================================================
// Append
// ============================================================================

/**
 * Compute and append a `PickRecord` for the card the user just picked.
 *
 * Idempotent: if the supplied `cardId` is already in `session.pickLog`
 * (e.g. a double-pick edge case in the picker UI) the session is
 * returned unchanged. The check intentionally uses `pickLog` rather than
 * `currentPack.pickedCardIds` so that a re-pick of a card from a
 * previously-completed pack also no-ops.
 *
 * `pickNumber` is computed as `pickLog.length + 1` so the 1-based
 * numbering survives round-trips through IndexedDB — the renderer never
 * has to recompute it from the live `currentPackIndex` /
 * `currentPickIndex` cursors (which can desync if the user reloads the
 * page mid-pack). `packNumber` and `packPickIndex` mirror the
 * `DraftPicker` 0-based state at the moment of the pick.
 *
 * Available / skipped partitioning: `availableCardIds` is the pack
 * minus the already-picked cards (i.e. what the user actually saw on
 * this pick). `alternativesSkipped` is the same set minus the card the
 * user just took. Both are captured in pack-relative slot order so a
 * replay tool can reconstruct the exact pack layout.
 */
export function appendPickRecord(
  session: DraftSession,
  cardId: string,
  card: Pick<PoolCard, "id" | "name" | "rarity">,
  now: string = new Date().toISOString(),
): DraftSession {
  const existing = normalizeDraftPickLog(session.pickLog);

  // Idempotency: don't append a second entry for a card the user already
  // logged a pick on. This is the "double-pick" guard the issue calls out
  // — even if a UI race bypasses the picker-level `pickedCardIds`
  // check, the log stays clean.
  if (existing.some((p) => p.cardId === cardId)) {
    return session;
  }

  const currentPack = session.packs[session.currentPackIndex];
  // `currentPack` can be `undefined` if the session is in `draft_complete`
  // and the caller raced; fall back to empty arrays so the log is still
  // appendable for the rare auto-pick-after-complete edge case.
  const packCards = currentPack?.cards ?? [];
  const alreadyPicked = new Set(currentPack?.pickedCardIds ?? []);

  const availableCardIds = packCards
    .filter((c) => !alreadyPicked.has(c.id))
    .map((c) => c.id);

  // `alternativesSkipped` is everything still in the pack after this pick
  // is removed (i.e. what the user passed on). Because the picked card
  // is not yet in `alreadyPicked` at the time of the call, we exclude it
  // explicitly.
  const alternativesSkipped = availableCardIds.filter((id) => id !== cardId);

  const record: PickRecord = {
    pickNumber: existing.length + 1,
    packNumber: session.currentPackIndex,
    packPickIndex: session.currentPickIndex,
    cardId: card.id,
    cardName: card.name,
    rarity: card.rarity ?? "unknown",
    pickedAt: now,
    availableCardIds,
    alternativesSkipped,
  };

  return {
    ...session,
    pickLog: [...existing, record],
  };
}

// ============================================================================
// CSV serialization
// ============================================================================

/**
 * Escape a single CSV field per RFC 4180. Wraps in double quotes and
 * doubles any embedded double-quote whenever the field contains a
 * comma, double-quote, CR, or LF. Everything else passes through as-is
 * so simple identifiers (`card-123`, `common`, ISO timestamps) stay
 * readable in spreadsheet apps.
 */
function escapeCsvField(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize a draft session's pick log to RFC-4180 CSV. The header row
 * is fixed (per issue #1558 acceptance criteria) and exactly
 * `DRAFT_LOG_CSV_COLUMNS` wide; one data row per pick, in pick order.
 *
 * The `pack` column is the 1-based pack number (Pack 1, Pack 2, Pack 3)
 * to match the player-facing table on the Draft Complete page. The
 * `pick` column is the 1-based *overall* pick number — the same value
 * the table renders.
 *
 * Empty / undefined pick logs produce a header-only output, never a
 * throw. Legacy sessions (pre-#1558) produce a header-only CSV which
 * is the correct behavior for a "this session has no per-pick history"
 * artifact.
 */
export function serializeDraftLogCsv(
  session: Pick<DraftSession, "pickLog">,
): string {
  const rows: string[] = [DRAFT_LOG_CSV_COLUMNS.join(",")];
  const log = normalizeDraftPickLog(session.pickLog);

  for (const record of log) {
    const fields = [
      // pack: 0-based → 1-based for the player-facing table
      String(record.packNumber + 1),
      String(record.pickNumber),
      record.cardId,
      record.cardName,
      record.rarity,
      record.pickedAt,
    ];
    rows.push(fields.map(escapeCsvField).join(","));
  }

  return rows.join("\n") + "\n";
}

// ============================================================================
// JSON serialization
// ============================================================================

/**
 * Shape written to the clipboard by the "Copy as JSON" button on the
 * Draft Complete page. Includes the bare-minimum set the issue calls
 * out (`session`, `pickLog`, `finalPool`) plus a content-type tag and
 * schema version so a future migration can detect and reject pre-#1558
 * payloads.
 */
export interface DraftLogJsonExport {
  /** `"planar-nexus/draft-log/v1"` — opaque, versioned. */
  $schema: "planar-nexus/draft-log/v1";
  /** Issue #1558 — useful for coaches to see which build produced the log. */
  exportedAt: string;
  /** Slim session summary (id, set, status, mode) — pool/deck excluded because `finalPool` carries that. */
  session: {
    id: string;
    setCode: string;
    setName: string;
    status: DraftSession["status"];
    mode: DraftSession["mode"];
    /** Optional PRNG seed (issue #1559). Omitted when unseeded. */
    seed?: number;
  };
  /** Per-pick audit trail (issue #1558). Empty array for legacy sessions. */
  pickLog: PickRecord[];
  /** Final pool at draft completion — same shape as `DraftSession.pool`. */
  finalPool: PoolCard[];
}

/**
 * Build the JSON payload for the "Copy as JSON" button. The shape is
 * `DraftLogJsonExport`; callers are responsible for `JSON.stringify`
 * (and, for clipboard writes, awaiting `navigator.clipboard.writeText`).
 */
export function buildDraftLogJsonExport(
  session: DraftSession,
  now: string = new Date().toISOString(),
): DraftLogJsonExport {
  const { id, setCode, setName, status, mode, seed } = session;
  return {
    $schema: "planar-nexus/draft-log/v1",
    exportedAt: now,
    session: { id, setCode, setName, status, mode, ...(seed !== undefined ? { seed } : {}) },
    pickLog: normalizeDraftPickLog(session.pickLog),
    finalPool: session.pool,
  };
}

// ============================================================================
// Filename helper
// ============================================================================

/**
 * Build a deterministic, filesystem-safe filename for the CSV download.
 * Format: `draft-log-<setCode>-<sessionId-short>.csv`.
 *
 * `sessionId-short` is the first 8 hex characters of the session UUID
 * (lowercased) — enough to disambiguate two pods of the same set in a
 * player's downloads folder, without making the filename unwieldy.
 *
 * The set code is lowercased so the filename is stable across
 * case-variant user input (`M21` vs `m21`).
 */
export function buildDraftLogCsvFilename(
  session: Pick<DraftSession, "id" | "setCode">,
): string {
  const set = (session.setCode || "set").toLowerCase();
  const shortId = (session.id || "session").slice(0, 8).toLowerCase();
  return `draft-log-${set}-${shortId}.csv`;
}

// ============================================================================
// Type guards
// ============================================================================

/**
 * Returns true when `rarity` is a member of the canonical MTG Rarity set.
 * Used by the CSV writer to decide whether to coerce a value or pass it
 * through verbatim (the legacy data set includes strings like `"L"` from
 * fixture rows and `"basic"` from land fallbacks).
 */
export function isCanonicalRarity(rarity: string): rarity is Rarity {
  return CANONICAL_RARITIES.has(rarity as Rarity);
}
