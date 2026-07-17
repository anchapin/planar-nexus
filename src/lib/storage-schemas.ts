/**
 * @fileoverview Runtime-validated localStorage read helpers (issue #1429).
 *
 * Several player-data surfaces read JSON from `localStorage` with a bare
 * `JSON.parse` and no schema check. Poisoned data (browser extension, a
 * malicious imported file that shares a key prefix, a truncated UTF-8 string
 * from an iOS Safari private-mode rollback, or a shape from a previous app
 * version) then flows straight into React state and crashes the tree on mount.
 *
 * This module provides:
 *  - {@link stripDangerousKeys}: a recursive sanitizer that drops prototype-
 *    pollution payloads (`__proto__` / `constructor` / `prototype`) BEFORE any
 *    schema sees them. (zod v4 does not strip `__proto__` keys — verified — so
 *    this is required, not optional.)
 *  - Zod schemas matching the real shapes written by deck-statistics,
 *    replay-viewer, achievements, and the player-stats map.
 *  - {@link safeParseJson}: a `JSON.parse` + `schema.safeParse` helper that
 *    never throws — on any failure it returns a discriminated `failure` result
 *    and optionally clears the poisoned key, so callers always fall back to a
 *    safe default.
 *
 * Schemas are deliberately permissive about clearly-optional fields (so
 * legitimate cross-version data still loads) but strict on the scalars and
 * enums a render path dereferences (so a wrong shape is rejected instead of
 * crashing `React` on first paint).
 */

import { z, type ZodType } from "zod";

// ---------------------------------------------------------------------------
// Prototype-pollution defense
// ---------------------------------------------------------------------------

/**
 * Object property names that can mutate the prototype chain when assigned via
 * `JSON.parse` + later mutation. `JSON.parse` itself uses `[[DefineOwnProperty]]`
 * (so it does not pollute on its own), but a downstream `Object.assign` /
 * spread / `{...parsed}` will happily propagate these keys. Drop them
 * defensively before validation.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively rebuild `value`, omitting any `__proto__` / `constructor` /
 * `prototype` keys from plain objects and arrays. Special object kinds
 * (`Map`, `Set`, `Date`, `RegExp`, typed arrays) are passed through untouched
 * so game-state structures serialized alongside replays are preserved.
 *
 * Returns a freshly-allocated tree, so the caller can never observe a polluted
 * prototype even if the raw payload attempted one.
 */
export function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripDangerousKeys(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  // Preserve non-plain objects verbatim.
  if (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof RegExp
  ) {
    return value;
  }
  // Typed arrays / DataView (e.g. from a serialized game state).
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = stripDangerousKeys((value as Record<string, unknown>)[key]);
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Deck statistics — written by src/components/deck-statistics.tsx
// ---------------------------------------------------------------------------

export const DeckRecordSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  deckName: z.string(),
  format: z.string(),
  result: z.enum(["win", "loss", "draw"]),
  opponentName: z.string().optional(),
  date: z.number(),
  duration: z.number().optional(),
});

export const DeckStatisticsSchema = z.object({
  deckId: z.string(),
  deckName: z.string(),
  format: z.string(),
  totalGames: z.number(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  winRate: z.number(),
  averageGameDuration: z.number(),
  records: z.array(DeckRecordSchema),
  lastPlayed: z.number().optional(),
  // JSON object keys are always strings, so the record key schema is `string`
  // for both maps regardless of the in-memory TS type.
  colorDistribution: z.record(z.string(), z.number()),
  manaCurve: z.record(z.string(), z.number()),
});

export const DeckStatisticsArraySchema = z.array(DeckStatisticsSchema);

// ---------------------------------------------------------------------------
// Replays — written by src/components/replay-viewer.tsx (useReplayStorage)
// ---------------------------------------------------------------------------

export const ReplayMetadataSchema = z.object({
  format: z.string(),
  playerNames: z.array(z.string()),
  startingLife: z.number(),
  isCommander: z.boolean(),
  winners: z.array(z.string()).optional(),
  gameStartDate: z.number(),
  gameEndDate: z.number().optional(),
  endReason: z.string().optional(),
});

/**
 * A recorded replay action. `action` (GameAction) and `resultingState`
 * (GameState) are huge, version-varying structures that are not dereferenced
 * structurally by the replay list UI — they are only fed back into the playback
 * engine. Validate them as `unknown` so a legitimate cross-version replay still
 * loads while the outer envelope (the part the list renders) stays strict.
 */
export const ReplayActionSchema = z.object({
  sequenceNumber: z.number(),
  action: z.unknown(),
  resultingState: z.unknown(),
  description: z.string(),
  recordedAt: z.number(),
});

export const ReplaySchema = z.object({
  id: z.string(),
  metadata: ReplayMetadataSchema,
  actions: z.array(ReplayActionSchema),
  currentPosition: z.number(),
  totalActions: z.number(),
  createdAt: z.number(),
  lastModifiedAt: z.number(),
});

export const ReplayArraySchema = z.array(ReplaySchema);

// ---------------------------------------------------------------------------
// Achievements — written by src/lib/achievements.ts
// ---------------------------------------------------------------------------

export const AchievementProgressSchema = z.object({
  achievementId: z.string(),
  currentProgress: z.number(),
  unlocked: z.boolean(),
  unlockedAt: z.number().optional(),
});

export const PlayerAchievementsSchema = z.object({
  playerId: z.string(),
  achievements: z.array(AchievementProgressSchema),
  totalPoints: z.number(),
  lastUpdated: z.number(),
});

/**
 * The `planar_nexus_stats_${playerId}` map is `Record<string, number>`. Stored
 * keys are always strings.
 */
export const PlayerStatsSchema = z.record(z.string(), z.number());

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

export type SafeParseJsonFailureReason =
  "empty" | "invalid-json" | "schema-failed";

export type SafeParseJsonResult<T> =
  | { success: true; value: T }
  | { success: false; value: null; reason: SafeParseJsonFailureReason };

export interface SafeParseJsonOptions {
  /** Label used in the structured console warning (e.g. "deck-statistics"). */
  label?: string;
  /**
   * When set, a failed read also removes the poisoned key from `localStorage`
   * so the next mount starts clean instead of re-throwing. Pass the *exact*
   * key the caller read from.
   */
  removeOnFailure?: string;
}

/**
 * Parse + validate a `localStorage`-sourced string without ever throwing.
 *
 * Flow:
 *  1. `null`/`undefined`/`""`  → `{ success: false, reason: "empty" }`.
 *  2. `JSON.parse` throws       → log + optionally clear key → `"invalid-json"`.
 *  3. prototype-pollution keys  → stripped by {@link stripDangerousKeys}.
 *  4. `schema.safeParse` fails  → log which fields failed + optionally clear →
 *     `"schema-failed"`.
 *  5. otherwise                 → `{ success: true, value }`.
 *
 * Callers should treat any non-`success` result as "use the module's safe
 * default". The helper never mutates the parsed value into caller state on
 * failure, which is the property that prevents the React-mount crash.
 */
export function safeParseJson<T>(
  stored: string | null | undefined,
  schema: ZodType<T>,
  options: SafeParseJsonOptions = {},
): SafeParseJsonResult<T> {
  const { label = "value", removeOnFailure } = options;

  if (stored === null || stored === undefined || stored === "") {
    return { success: false, value: null, reason: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    console.warn(
      `[storage] Failed to JSON.parse ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    clearKeyIfRequested(removeOnFailure);
    return { success: false, value: null, reason: "invalid-json" };
  }

  // Neutralize prototype-pollution payloads before they reach the schema or
  // downstream React state.
  const sanitized = stripDangerousKeys(parsed);

  const result = schema.safeParse(sanitized);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    console.warn(`[storage] Schema validation failed for ${label}: ${details}`);
    clearKeyIfRequested(removeOnFailure);
    return { success: false, value: null, reason: "schema-failed" };
  }

  return { success: true, value: result.data };
}

function clearKeyIfRequested(key: string | undefined): void {
  if (!key) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore — we are already on the failure path.
  }
}
