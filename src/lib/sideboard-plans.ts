/**
 * Custom Sideboard Plans
 *
 * Provides localStorage persistence for user-created sideboard plans.
 *
 * Issue #1565: this module also handles two resilience concerns that the
 * original implementation deferred to the UI:
 *
 *  1. **Quota-resilient writes.** `localStorage.setItem` throws
 *     `QuotaExceededError` (a `DOMException` whose `name` is
 *     `"QuotaExceededError"`) once the origin's ~5 MB budget is exhausted.
 *     The original implementation let the throw escape, which the UI caught
 *     generically and silently dropped the save. We now:
 *
 *       - catch quota errors via `isQuotaExceededError` (name + message
 *         inspection that mirrors the project's `storage-quota.ts` helpers);
 *       - retry once with a *compact* representation (notes truncated to
 *         {@link COMPACT_NOTES_LIMIT} characters) — this typically recovers
 *         several KB per plan and keeps the user's data, just lossy on
 *         verbose notes;
 *       - if even the compact retry fails, return a structured
 *         `{ success: false, error: 'quota' }` result so the UI can surface
 *         a "Storage is full" message instead of silently dropping the save.
 *
 *  2. **JSON export/import.** Plain `JSON.stringify(plan)` / `JSON.parse`
 *     round-trips with a versioned envelope so blobs exported today remain
 *     importable across upgrades. The envelope is
 *     `{ version: 1, exportedAt, plans: SavedSideboardPlan[] }` and the
 *     import rejects payloads whose `version` field is missing or unknown.
 */

import { SideboardCard } from "./anti-meta";
import { MagicFormat, ArchetypeCategory } from "./meta";

export interface SavedSideboardPlan {
  id: string;
  name: string;
  format: MagicFormat;
  archetypeId: string;
  archetypeName: string;
  opponentArchetypeId: string;
  opponentArchetypeName: string;
  inCards: SideboardCard[];
  outCards: SideboardCard[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "planar-nexus-sideboard-plans";

/**
 * Maximum length of the `notes` field when persisting plans under quota
 * pressure. 200 characters is enough for a one- or two-line rationale (the
 * documented use of the field) and is short enough to recover several KB
 * across a populated store on the compact retry.
 */
const COMPACT_NOTES_LIMIT = 200;

/**
 * Truncation marker appended when notes are shortened under quota pressure.
 * Surfaced verbatim so the UI / export tooling can detect and flag the lossy
 * truncation if desired.
 */
const COMPACT_TRUNCATION_MARKER = "…";

/**
 * Current schema version of the export envelope. Bump this when the shape of
 * {@link ExportedSideboardPlanBundle} or {@link SavedSideboardPlan} changes in
 * a non-round-trippable way. Importers reject unknown / missing versions.
 */
export const SIDEBOARD_PLAN_EXPORT_VERSION = 1 as const;

/**
 * Envelope returned by {@link exportAllSideboardPlans} and accepted by
 * {@link importSideboardPlans}. The `version` field is required and is
 * checked at import time; unknown values cause `importSideboardPlans` to
 * throw a descriptive `Error`.
 */
export interface ExportedSideboardPlanBundle {
  readonly version: typeof SIDEBOARD_PLAN_EXPORT_VERSION;
  exportedAt: string;
  plans: SavedSideboardPlan[];
}

/**
 * Result of saving a new sideboard plan. Success returns the persisted
 * `plan`; quota exhaustion returns a structured failure carrying a
 * user-visible `message` that the UI should display verbatim.
 *
 * `degraded` is set to `true` when the plan was persisted in the compact
 * form (notes truncated) — UI may choose to surface a soft warning to
 * remind the user to export and clean up.
 */
export type SideboardPlanSaveResult =
  | { success: true; plan: SavedSideboardPlan; degraded?: boolean }
  | { success: false; error: "quota"; message: string };

/**
 * Result of updating an existing sideboard plan. Extends the save result
 * with the `not-found` case so the UI can distinguish "the plan vanished
 * underneath us" (e.g. deleted in another tab) from a quota failure.
 */
export type SideboardPlanUpdateResult =
  | { success: true; plan: SavedSideboardPlan; degraded?: boolean }
  | { success: false; error: "not-found" }
  | { success: false; error: "quota"; message: string };

export type SideboardPlanImportMode = "merge" | "replace";

export interface SideboardPlanImportResult {
  /** Number of plans written to the store. */
  imported: number;
  /** In merge mode, count of incoming plans whose ids collided with existing plans and were skipped. Always 0 in replace mode. */
  skipped: number;
  /** Set to `'quota'` when the write was rejected by the origin storage quota even after the compact retry. */
  error?: "quota";
  /** User-visible remediation message present when `error === 'quota'`. */
  message?: string;
}

// ============================================================================
// STORAGE DETECTION
// ============================================================================

/**
 * True when `err` looks like a `QuotaExceededError` — either a DOMException
 * with `name === 'QuotaExceededError'` (what browsers throw from
 * `localStorage.setItem`) or an `Error` whose message mentions quota. The
 * project already exports an equivalent helper from `storage-quota.ts` for
 * IndexedDB writes; we duplicate the localStorage-specific detection here so
 * this module remains dependency-light (no React, no IDB) and can be unit
 * tested in isolation. Mirrors the project's typed-error classification
 * pattern from `classifyWriteError`.
 */
function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "QuotaExceededError") return true;
    if (/quotaexceeded/i.test(err.message)) return true;
  }
  const name = (err as { name?: unknown })?.name;
  if (typeof name === "string" && name === "QuotaExceededError") return true;
  return false;
}

// ============================================================================
// PERSISTENCE (quota-resilient)
// ============================================================================

/**
 * Lossy compact projection of a plan: truncates verbose `notes` so a
 * populated store sheds bytes under quota pressure. The exported bundle (when
 * one exists) is the canonical long-form representation; the on-disk store
 * is the live, quota-constrained view.
 */
function compactPlan(plan: SavedSideboardPlan): SavedSideboardPlan {
  if (plan.notes.length <= COMPACT_NOTES_LIMIT) return plan;
  return {
    ...plan,
    notes:
      plan.notes.slice(
        0,
        COMPACT_NOTES_LIMIT - COMPACT_TRUNCATION_MARKER.length,
      ) + COMPACT_TRUNCATION_MARKER,
  };
}

function compactAllPlans(plans: SavedSideboardPlan[]): SavedSideboardPlan[] {
  return plans.map(compactPlan);
}

type PersistOutcome =
  { ok: true; degraded: boolean } | { ok: false; error: "quota" };

/**
 * Persist `plans` to localStorage with one graceful retry under quota
 * pressure. The retry writes the compact projection of all plans; this is a
 * global rewrite, not a per-plan decision, so the on-disk store ends up
 * either fully normal or fully compact (never mixed).
 *
 * - Returns `{ ok: true, degraded: false }` on the happy path.
 * - Returns `{ ok: true, degraded: true }` when the compact retry succeeded
 *   after the initial write threw quota.
 * - Returns `{ ok: false, error: 'quota' }` when even the compact retry
 *   fails; the caller is responsible for NOT mutating the in-memory plans
 *   array past this point so the on-disk store stays consistent.
 *
 * Non-quota errors propagate via `throw` so genuine bugs are not swallowed.
 */
function persistPlansWithQuotaRetry(
  plans: SavedSideboardPlan[],
): PersistOutcome {
  if (typeof window === "undefined") {
    return { ok: true, degraded: false };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    return { ok: true, degraded: false };
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    // Compact retry — try once, in compact form. If still failing, return
    // the quota failure to the caller.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactAllPlans(plans)));
      return { ok: true, degraded: true };
    } catch (compactErr) {
      if (isQuotaExceededError(compactErr)) {
        return { ok: false, error: "quota" };
      }
      throw compactErr;
    }
  }
}

const QUOTA_USER_MESSAGE =
  "Browser storage is full. Export your sideboard plans, then delete some before saving more.";

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a unique ID for a new plan
 */
export function generatePlanId(): string {
  return `sideboard-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get all saved sideboard plans from localStorage
 */
export function getAllSideboardPlans(): SavedSideboardPlan[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const plans = JSON.parse(stored);
    return Array.isArray(plans) ? plans : [];
  } catch (error) {
    console.error("Failed to load sideboard plans:", error);
    return [];
  }
}

/**
 * Get plans filtered by format
 */
export function getSideboardPlansByFormat(
  format: MagicFormat,
): SavedSideboardPlan[] {
  const plans = getAllSideboardPlans();
  return plans.filter((plan) => plan.format === format);
}

/**
 * Get a single plan by ID
 */
export function getSideboardPlanById(id: string): SavedSideboardPlan | null {
  const plans = getAllSideboardPlans();
  return plans.find((plan) => plan.id === id) || null;
}

/**
 * Save a new sideboard plan.
 *
 * Never throws on quota exhaustion — returns
 * `{ success: false, error: 'quota', message }` instead, with a user-visible
 * message the UI should surface verbatim. Returns the plan in
 * `{ success: true, plan }` form on success; the `degraded` flag is set when
 * the compact retry was used (notes truncated) so the UI can show a soft
 * warning.
 */
export function saveSideboardPlan(
  plan: Omit<SavedSideboardPlan, "id" | "createdAt" | "updatedAt">,
): SideboardPlanSaveResult {
  const newPlan: SavedSideboardPlan = {
    ...plan,
    id: generatePlanId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Snapshot the current store, append, and try to persist. We deliberately
  // do NOT mutate the existing `getAllSideboardPlans()` snapshot array up
  // front so a quota failure leaves the on-disk store byte-identical to
  // before this call (the source of truth is localStorage, not the in-memory
  // array).
  const existing = getAllSideboardPlans();
  const staged = [...existing, newPlan];
  const outcome = persistPlansWithQuotaRetry(staged);

  if (outcome.ok) {
    return outcome.degraded
      ? { success: true, plan: newPlan, degraded: true }
      : { success: true, plan: newPlan };
  }

  return { success: false, error: "quota", message: QUOTA_USER_MESSAGE };
}

/**
 * Update an existing sideboard plan.
 *
 * Returns `{ success: false, error: 'not-found' }` when no plan with `id`
 * exists, `{ success: false, error: 'quota', message }` when the persistence
 * layer rejects the write, and `{ success: true, plan, degraded? }` on
 * success. Like {@link saveSideboardPlan}, never throws on quota exhaustion.
 */
export function updateSideboardPlan(
  id: string,
  updates: Partial<Omit<SavedSideboardPlan, "id" | "createdAt">>,
): SideboardPlanUpdateResult {
  const plans = getAllSideboardPlans();
  const index = plans.findIndex((plan) => plan.id === id);

  if (index === -1) return { success: false, error: "not-found" };

  const previousPlan = plans[index];
  const updatedPlan: SavedSideboardPlan = {
    ...previousPlan,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // Stage on a shallow copy so a quota failure leaves the disk store
  // untouched. The in-memory `plans` variable is local to this function call,
  // so the next `getAllSideboardPlans()` will still see the on-disk truth.
  const staged = plans.map((plan, i) => (i === index ? updatedPlan : plan));
  const outcome = persistPlansWithQuotaRetry(staged);

  if (outcome.ok) {
    return outcome.degraded
      ? { success: true, plan: updatedPlan, degraded: true }
      : { success: true, plan: updatedPlan };
  }

  return { success: false, error: "quota", message: QUOTA_USER_MESSAGE };
}

/**
 * Delete a sideboard plan by ID. Returns `true` when a plan was removed,
 * `false` when no plan with the given id existed.
 *
 * Deletes do not increase the on-disk footprint so quota exhaustion is
 * effectively impossible here. We still wrap defensively: a quota error
 * during delete is reported by returning `false` (treated as "no plan was
 * removed"), while genuine write errors propagate so bugs are not silenced.
 */
export function deleteSideboardPlan(id: string): boolean {
  const plans = getAllSideboardPlans();
  const index = plans.findIndex((plan) => plan.id === id);

  if (index === -1) return false;

  const next = plans.slice();
  next.splice(index, 1);

  if (typeof window === "undefined") return true;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch (err) {
    if (isQuotaExceededError(err)) {
      // Defensive: deletes should never push the store past quota, but if a
      // flaky environment does, report "not removed" rather than crash.
      console.warn("deleteSideboardPlan: unexpected quota error", err);
      return false;
    }
    throw err;
  }
}

/**
 * Delete all sideboard plans
 */
export function clearAllSideboardPlans(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Validate a sideboard plan
 */
export function validateSideboardPlan(plan: Partial<SavedSideboardPlan>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!plan.name || plan.name.trim().length === 0) {
    errors.push("Plan name is required");
  }

  if (!plan.format) {
    errors.push("Format is required");
  }

  if (!plan.archetypeId) {
    errors.push("Player archetype is required");
  }

  if (!plan.opponentArchetypeId) {
    errors.push("Opponent archetype is required");
  }

  if (!plan.inCards || !Array.isArray(plan.inCards)) {
    errors.push("In-cards list is required");
  }

  if (!plan.outCards || !Array.isArray(plan.outCards)) {
    errors.push("Out-cards list is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// EXPORT / IMPORT (issue #1565)
// ============================================================================

/**
 * Export the current sideboard plan store as a versioned, JSON-serializable
 * envelope. Pure read — never throws on quota.
 *
 * Shape:
 *
 *   {
 *     version: 1,
 *     exportedAt: '<ISO-8601 timestamp>',
 *     plans: [SavedSideboardPlan, ...]
 *   }
 *
 * The `version` field is checked by {@link importSideboardPlans} and is the
 * canonical place to bump when the schema changes.
 */
export function exportAllSideboardPlans(): ExportedSideboardPlanBundle {
  const plans = getAllSideboardPlans();
  return {
    version: SIDEBOARD_PLAN_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    plans,
  };
}

/**
 * Convenience helper: same as {@link exportAllSideboardPlans} but returns a
 * pretty-printed JSON string suitable for a download or clipboard copy.
 */
export function exportAllSideboardPlansAsJson(): string {
  return JSON.stringify(exportAllSideboardPlans(), null, 2);
}

/**
 * Inverse of {@link exportAllSideboardPlans}.
 *
 * Throws an `Error` (never returns) when the payload is malformed:
 *
 *  - not a string,
 *  - not parseable as JSON,
 *  - not an object,
 *  - missing `version` field,
 *  - `version` not equal to {@link SIDEBOARD_PLAN_EXPORT_VERSION},
 *  - missing or non-array `plans` field.
 *
 * On a valid payload the function applies the requested `mode`:
 *
 *  - `'merge'` (default): incoming plans whose ids collide with an existing
 *    plan are SKIPPED (preserving the local version); the returned
 *    `{ imported, skipped }` counts the split.
 *  - `'replace'`: incoming plans overwrite the entire store; `skipped` is
 *    always 0.
 *
 * Quota exhaustion during the persistence step is reported via
 * `{ error: 'quota', imported: 0, skipped, message }` instead of throwing —
 * the validate/merge work that succeeded is preserved in the counts, and
 * the caller can surface `message` to the user.
 */
export function importSideboardPlans(
  json: string,
  options: { mode?: SideboardPlanImportMode } = {},
): SideboardPlanImportResult {
  const mode: SideboardPlanImportMode = options.mode ?? "merge";

  if (typeof json !== "string") {
    throw new Error("importSideboardPlans: json must be a string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`importSideboardPlans: invalid JSON — ${detail}`, {
      cause: err,
    });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("importSideboardPlans: payload must be an object");
  }

  const candidate = parsed as Partial<ExportedSideboardPlanBundle>;

  // Spec (issue #1565): "rejects blobs missing the version field with a
  // thrown Error". `undefined !== 1` so missing-version payloads land here.
  if (candidate.version !== SIDEBOARD_PLAN_EXPORT_VERSION) {
    throw new Error(
      `importSideboardPlans: unsupported version "${
        candidate.version === undefined
          ? "<missing>"
          : String(candidate.version)
      }" (expected ${SIDEBOARD_PLAN_EXPORT_VERSION})`,
    );
  }

  if (!Array.isArray(candidate.plans)) {
    throw new Error("importSideboardPlans: payload.plans must be an array");
  }

  const incoming = candidate.plans.filter(isValidPlanShape);

  const existing = getAllSideboardPlans();
  let nextPlans: SavedSideboardPlan[];
  let imported: number;
  let skipped: number;

  if (mode === "replace") {
    nextPlans = incoming;
    imported = incoming.length;
    skipped = 0;
  } else {
    // merge: skip ids that already exist locally.
    const existingIds = new Set(existing.map((p) => p.id));
    const novel: SavedSideboardPlan[] = [];
    let collisions = 0;
    for (const plan of incoming) {
      if (existingIds.has(plan.id)) {
        collisions += 1;
      } else {
        novel.push(plan);
        existingIds.add(plan.id);
      }
    }
    nextPlans = [...existing, ...novel];
    imported = novel.length;
    skipped = collisions;
  }

  const outcome = persistPlansWithQuotaRetry(nextPlans);
  if (!outcome.ok) {
    return {
      imported: 0,
      skipped,
      error: "quota",
      message: QUOTA_USER_MESSAGE,
    };
  }

  return outcome.degraded ? { imported, skipped } : { imported, skipped };
}

/**
 * Structural check for a single plan. The strict shape matches
 * {@link SavedSideboardPlan} and rejects anything that would not survive a
 * round trip through `getAllSideboardPlans`. Loosely-typed entries in an
 * imported bundle are silently dropped to avoid corrupting the store with
 * half-formed records.
 */
function isValidPlanShape(value: unknown): value is SavedSideboardPlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.format === "string" &&
    typeof p.archetypeId === "string" &&
    typeof p.archetypeName === "string" &&
    typeof p.opponentArchetypeId === "string" &&
    typeof p.opponentArchetypeName === "string" &&
    Array.isArray(p.inCards) &&
    Array.isArray(p.outCards) &&
    typeof p.notes === "string" &&
    typeof p.createdAt === "string" &&
    typeof p.updatedAt === "string"
  );
}
