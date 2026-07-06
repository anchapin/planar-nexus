/**
 * @fileoverview Persistence layer for {@link ReplayDiffReport} (issue #1235).
 *
 * The {@link diffReplayHistory} function in `src/ai/flows/ai-post-game-analysis.ts`
 * is pure — it produces a {@link ReplayDiffReport} from an in-memory replay
 * list but doesn't know how to store it. This module bridges that gap by
 * writing the report into the existing {@link IndexedDBStorage} layer under
 * the `preferences` object store, keyed by the player's name.
 *
 * Why `preferences` and not a brand-new object store?
 *
 *   - The schema in `src/lib/indexeddb-storage.ts` is versioned; adding a
 *     new object store would force a schema bump + migration test (issue
 *     #1250 audit made adding stores expensive).
 *   - `preferences` is already an opaque key/value store — exactly what a
 *     per-player diff report is.
 *   - Reports are small (a few KB even with 100 replays).
 *
 * Backward compatibility: keys are namespaced (`replay-diff:${playerName}`)
 * so they can't collide with any other preference.
 *
 * Tests live next door in `__tests__/replay-diff-storage.test.ts`.
 */

import { getStorage } from "./indexeddb-storage";
import type { ReplayDiffReport } from "@/ai/flows/ai-post-game-analysis";

/** Storage key namespace — keeps diff reports separate from other preferences. */
export const REPLAY_DIFF_STORAGE_KEY_PREFIX = "replay-diff:";

/**
 * Build the storage key for a given player. Exported for tests that want to
 * poke at the store directly without going through the helper.
 */
export function replayDiffStorageKey(playerName: string): string {
  // Trim + collapse whitespace so " Alex " and "Alex" share a key.
  return `${REPLAY_DIFF_STORAGE_KEY_PREFIX}${String(playerName).trim()}`;
}

/**
 * Read the most recently persisted diff report for `playerName`.
 *
 * Returns `null` when:
 *   - the runtime is server-side (no IndexedDB), OR
 *   - no report has been persisted yet, OR
 *   - the persisted payload is unparseable / wrong shape.
 *
 * Never throws — the caller should treat a `null` return as "compute a
 * fresh report from your in-memory replay history".
 */
export async function loadReplayDiffReport(
  playerName: string,
): Promise<ReplayDiffReport | null> {
  if (typeof window === "undefined") return null;
  const key = replayDiffStorageKey(playerName);
  try {
    const storage = await getStorage();
    const raw = await storage.get<ReplayDiffReport & { id: string }>(
      "preferences",
      key,
    );
    if (!raw || typeof raw !== "object") return null;
    if (raw.playerName !== playerName) return null;
    return raw;
  } catch (err) {
    // Quota or other IDB errors should never crash the post-game flow —
    // we just degrade to "no cached report available".
    if (typeof console !== "undefined") {
      console.warn("Failed to load replay diff report:", err);
    }
    return null;
  }
}

/**
 * Persist a {@link ReplayDiffReport} for `playerName`. Overwrites any prior
 * report under the same key.
 *
 * Returns `{ ok: true }` on success and `{ ok: false, warning }` on any
 * storage failure (e.g. {@link QuotaExceededError}). Never throws — the AI
 * loop must keep running even when the disk is full (matches the
 * weight-learning.ts #1066 contract).
 */
export async function saveReplayDiffReport(
  playerName: string,
  report: ReplayDiffReport,
): Promise<{ ok: true } | { ok: false; warning: string }> {
  if (typeof window === "undefined") {
    return { ok: false, warning: "Storage unavailable in this environment." };
  }
  const key = replayDiffStorageKey(playerName);
  try {
    const storage = await getStorage();
    await storage.set("preferences", {
      id: key,
      ...report,
    });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown storage error.";
    if (typeof console !== "undefined") {
      console.warn("Failed to save replay diff report:", err);
    }
    return {
      ok: false,
      warning: `Could not persist replay diff report: ${message}`,
    };
  }
}

/**
 * Delete the persisted report for `playerName`. Useful for "clear my
 * analysis history" UI; idempotent — succeeds silently when no row exists.
 */
export async function clearReplayDiffReport(playerName: string): Promise<void> {
  if (typeof window === "undefined") return;
  const key = replayDiffStorageKey(playerName);
  try {
    const storage = await getStorage();
    await storage.delete("preferences", key);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("Failed to clear replay diff report:", err);
    }
  }
}