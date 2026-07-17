/**
 * @fileOverview Storage quota estimation & graceful degradation helpers.
 *
 * Issue #1085: IndexedDB writes can exceed the origin storage quota for users
 * with very large card collections, failing opaquely and losing data. This
 * module centralises everything the app needs to be capacity-aware:
 *
 *  - typed storage estimation via navigator.storage.estimate() (guarded for
 *    contexts where it is unavailable — private mode, old browsers, some Tauri
 *    webviews)
 *  - persistence requests (navigator.storage.persist / persisted, guarded)
 *  - configurable warning/critical thresholds (exported as constants)
 *  - a typed, recoverable QuotaExceededError plus classification helpers so
 *    callers can distinguish quota exhaustion from other failures and degrade
 *  - a no-throw write guard (withQuotaGuard) for the graceful read-only degrade
 *  - a predictive pre-flight check (predictQuotaHeadroom, issue #1424) so large
 *    batched writes can be aborted *before* opening an IDB transaction instead
 *    of failing opaquely mid-write
 *
 * Designed to be unit-testable with no React/DOM coupling.
 */

// ============================================================================
// THRESHOLDS
// ============================================================================

/** Usage ratio at/above which we surface a non-blocking "approaching quota" warning. */
export const QUOTA_WARN_THRESHOLD = 0.9;

/** Usage ratio at/above which writes are very likely to fail; treated as critical. */
export const QUOTA_CRITICAL_THRESHOLD = 0.98;

/** Bytes assumed as the quota when the browser cannot report one (fallback heuristic). */
export const FALLBACK_QUOTA_BYTES = 50 * 1024 * 1024;

/**
 * Average serialized byte size assumed per {@link MinimalCard} row written to
 * the offline card database. Used by {@link estimateCardWriteBytes} to predict
 * the footprint of a bulk card import before any transaction opens. Chosen
 * conservatively from sampling Scryfall `MinimalCard` payloads (name, type
 * line, oracle text, legalities, image uris) — most rows land in 300–700 B.
 */
export const AVG_CARD_BYTES = 512;

/**
 * Extra bytes reserved on top of a predicted write to absorb IDB bookkeeping
 * (B+tree index growth, transaction journals) and drift in the browser's
 * `navigator.storage.estimate()` figures. Writes that fit nominally but leave
 * less free space than this margin are downgraded to a warning.
 */
export const QUOTA_SAFETY_MARGIN_BYTES = 5 * 1024 * 1024;

// ============================================================================
// TYPES
// ============================================================================

export type QuotaLevel = "ok" | "warning" | "critical" | "unknown";

export interface StorageQuotaEstimate {
  /** Current usage in bytes. */
  usage: number;
  /** Quota in bytes (0 when unknown). */
  quota: number;
  /** usage / quota in [0, 1]; 0 when quota is unknown. */
  ratio: number;
  /** Whether navigator.storage.estimate was available and returned a value. */
  available: boolean;
  /** Coarse classification derived from ratio + thresholds. */
  level: QuotaLevel;
}

export type QuotaGuardResult<T> =
  { ok: true; value: T } | { ok: false; error: QuotaExceededError };

// ============================================================================
// TYPED ERROR
// ============================================================================

/**
 * Typed, recoverable error raised when an IndexedDB write fails due to quota.
 *
 * Callers can use `instanceof` or {@link isQuotaExceededError} to distinguish it
 * from other failures and degrade (surface a toast, fall back to read-only)
 * instead of crashing. The storage layer normalises native QuotaExceededError
 * DOMExceptions into this type via {@link classifyWriteError}.
 */
export class QuotaExceededError extends Error {
  readonly storeName?: string;

  constructor(message = "Storage quota exceeded", storeName?: string) {
    super(message);
    this.name = "QuotaExceededError";
    this.storeName = storeName;
    // Restore prototype chain for older ES targets (TS down-leveling).
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

/** Classify a usage ratio into a coarse quota level. */
export function getQuotaLevel(ratio: number, available: boolean): QuotaLevel {
  if (!available) return "unknown";
  if (ratio >= QUOTA_CRITICAL_THRESHOLD) return "critical";
  if (ratio >= QUOTA_WARN_THRESHOLD) return "warning";
  return "ok";
}

/**
 * True when the error is quota-related: a typed {@link QuotaExceededError}, a
 * native DOMException whose `name` is "QuotaExceededError", or any error whose
 * message mentions "quotaexceeded".
 */
export function isQuotaExceededError(err: unknown): err is QuotaExceededError {
  if (!err) return false;
  if (err instanceof QuotaExceededError) return true;
  const name = (err as { name?: unknown }).name;
  const message = (err as { message?: unknown }).message;
  if (typeof name === "string" && name === "QuotaExceededError") return true;
  if (typeof message === "string" && /quotaexceeded/i.test(message))
    return true;
  return false;
}

/**
 * Normalise an arbitrary write error: if it is quota-related, wrap it in a
 * typed {@link QuotaExceededError} (carrying `storeName`); otherwise preserve it
 * as a plain Error with the given `context` prefix. Used by the IndexedDB
 * storage layer so callers always see a typed, recoverable error on quota
 * exhaustion instead of an opaque DOMException.
 */
export function classifyWriteError(
  raw: unknown,
  context: string,
  storeName?: string,
): Error {
  if (isQuotaExceededError(raw)) {
    const detail = (raw as { message?: string }).message;
    return new QuotaExceededError(
      detail ? `${context}: ${detail}` : `${context}: quota exceeded`,
      storeName,
    );
  }
  if (raw instanceof Error) {
    return new Error(`${context}: ${raw.message}`);
  }
  return new Error(`${context}: ${String(raw ?? "unknown error")}`);
}

// ============================================================================
// ESTIMATION
// ============================================================================

/**
 * Estimate current storage usage via the Storage API. Degrades sensibly when
 * `navigator.storage.estimate` is unavailable or rejects: returns
 * `available: false` with a zeroed estimate and level "unknown" rather than
 * throwing — callers can still proceed with writes.
 */
export async function getStorageEstimate(): Promise<StorageQuotaEstimate> {
  const storage = getNavigatorStorage();
  if (!storage || typeof storage.estimate !== "function") {
    return { usage: 0, quota: 0, ratio: 0, available: false, level: "unknown" };
  }
  try {
    const raw = await storage.estimate();
    const usage = Math.max(0, raw?.usage ?? 0);
    const quota = Math.max(0, raw?.quota ?? 0);
    const ratio = quota > 0 ? Math.min(1, usage / quota) : 0;
    return {
      usage,
      quota,
      ratio,
      available: true,
      level: getQuotaLevel(ratio, true),
    };
  } catch {
    return { usage: 0, quota: 0, ratio: 0, available: false, level: "unknown" };
  }
}

/**
 * Request persistent storage so the browser evicts the origin less aggressively.
 * Returns the resulting persisted status. Always resolves (never throws); yields
 * `false` when the Storage API is unavailable.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = getNavigatorStorage();
  if (!storage || typeof storage.persist !== "function") return false;
  try {
    return Boolean(await storage.persist());
  } catch {
    return false;
  }
}

/** Query whether storage persistence has been granted. Never throws. */
export async function isStoragePersistent(): Promise<boolean> {
  const storage = getNavigatorStorage();
  if (!storage || typeof storage.persisted !== "function") return false;
  try {
    return Boolean(await storage.persisted());
  } catch {
    return false;
  }
}

// ============================================================================
// GRACEFUL DEGRADE
// ============================================================================

/**
 * Run a write operation, converting a {@link QuotaExceededError} into a typed,
 * non-throwing result so the caller can degrade gracefully (switch to
 * read-only, surface a toast) instead of crashing. Non-quota errors rethrow so
 * genuine bugs are not swallowed.
 *
 * This is the "no throw + correct degrade" path wired into user-facing writes
 * that must never brick the UI on quota exhaustion.
 */
export async function withQuotaGuard<T>(
  op: () => Promise<T>,
): Promise<QuotaGuardResult<T>> {
  try {
    const value = await op();
    return { ok: true, value };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      const detail = (err as { message?: string }).message;
      return {
        ok: false,
        error: new QuotaExceededError(
          detail || "Storage quota exceeded",
          (err as { storeName?: string }).storeName,
        ),
      };
    }
    throw err;
  }
}

// ============================================================================
// PRE-FLIGHT PREDICTION
// ============================================================================

/**
 * Result of a predictive quota pre-flight check (issue #1424).
 *
 * Callers run {@link predictQuotaHeadroom} *before* opening a large batched
 * IndexedDB write so they can warn or abort early instead of hitting a
 * `QuotaExceededError` mid-transaction (which can leave a partially-written
 * store).
 */
export interface QuotaHeadroom {
  /** Whether the write should proceed. `false` only when the estimate is available AND the write is predicted to fail. */
  ok: boolean;
  /** Free bytes remaining after the projected write (`quota - usage - requiredBytes`). Negative when over budget. */
  available: number;
  /** Predicted usage ratio after the write lands, in [0, 1] (clamped). 0 when the Storage API is unavailable. */
  projectedRatio: number;
  /** Coarse classification derived from {@link projectedRatio}. `unknown` when the Storage API is unavailable. */
  level: QuotaLevel;
  /** Current usage in bytes (0 when unavailable). */
  usage: number;
  /** Quota in bytes (0 when unknown). */
  quota: number;
  /** Bytes the caller told us it intends to write. */
  requiredBytes: number;
  /** Human-readable reason present when `ok === false`. */
  reason?: string;
}

/**
 * Predict whether a write of `bytesNeeded` bytes will fit in the origin's
 * remaining storage quota, *before* the write begins.
 *
 * Decision rule (issue #1424):
 *  - When `navigator.storage.estimate()` is unavailable (private mode, old
 *    browsers, some Tauri webviews) the check degrades to `ok: true` with
 *    `level: "unknown"` so callers fall back to the existing reactive error
 *    path — there is nothing to predict against, and blocking the write would
 *    regress environments that legitimately have no Storage API.
 *  - `ok: false` when the write would push projected usage to/above
 *    {@link QUOTA_CRITICAL_THRESHOLD}, or when it nominally exceeds the
 *    remaining quota (`available < 0`).
 *  - Otherwise `ok: true`; callers can still inspect `level` to surface a
 *    non-blocking warning when the projected ratio crosses
 *    {@link QUOTA_WARN_THRESHOLD}.
 *
 * Pure with respect to its inputs aside from reading `navigator.storage` (via
 * {@link getStorageEstimate}), so it is trivially unit-testable.
 */
export async function predictQuotaHeadroom(
  bytesNeeded: number,
): Promise<QuotaHeadroom> {
  const requiredBytes = Math.max(0, bytesNeeded);
  const est = await getStorageEstimate();

  // Graceful allow when the Storage API is unavailable — callers fall back to
  // the existing reactive QuotaExceededError path. Returning ok:true here is
  // intentional (see decision rule above) and is covered by tests.
  if (!est.available) {
    return {
      ok: true,
      available: FALLBACK_QUOTA_BYTES,
      projectedRatio: 0,
      level: "unknown",
      usage: 0,
      quota: 0,
      requiredBytes,
    };
  }

  const projectedUsage = est.usage + requiredBytes;
  const projectedRatio =
    est.quota > 0 ? Math.min(1, projectedUsage / est.quota) : 0;
  const projectedLevel = getQuotaLevel(projectedRatio, true);
  const available = est.quota - projectedUsage;

  // The write is predicted to fail: it either exceeds the raw remaining quota
  // or pushes projected usage into the critical band where the browser is very
  // likely to reject the transaction.
  if (available < 0 || projectedLevel === "critical") {
    return {
      ok: false,
      available,
      projectedRatio,
      level: projectedLevel,
      usage: est.usage,
      quota: est.quota,
      requiredBytes,
      reason:
        available < 0
          ? "This write needs more space than is available in browser storage."
          : "Browser storage is critically full; this write is very likely to fail.",
    };
  }

  return {
    ok: true,
    available,
    projectedRatio,
    level: projectedLevel,
    usage: est.usage,
    quota: est.quota,
    requiredBytes,
  };
}

/**
 * Estimate the byte footprint of writing `count` card rows to the offline card
 * database, using {@link AVG_CARD_BYTES} plus the {@link QUOTA_SAFETY_MARGIN_BYTES}
 * headroom. Exposed so call sites (bulk import, populate) and their tests share
 * one prediction formula.
 */
export function estimateCardWriteBytes(count: number): number {
  if (count <= 0) return 0;
  return count * AVG_CARD_BYTES + QUOTA_SAFETY_MARGIN_BYTES;
}

/**
 * Human-readable remediation guidance shown to users near/over quota. Kept
 * minimal — points at export + removing cached data rather than building a full
 * storage manager.
 */
export function getQuotaRemediationMessage(level: QuotaLevel): string {
  if (level === "critical") {
    return "Storage is full — recent changes can't be saved safely. Export a backup, then remove unused cards or saved games to free space.";
  }
  return "Storage is almost full — export a backup and remove unused cards soon to avoid losing data.";
}

// ============================================================================
// INTERNAL
// ============================================================================

/**
 * Accessor kept indirect so tests can stub `navigator.storage` safely. Returns
 * the StorageManager when present, otherwise undefined.
 */
function getNavigatorStorage(): StorageManager | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.storage;
}
