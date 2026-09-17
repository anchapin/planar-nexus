/**
 * @fileoverview Persisted snapshot for the Orama card-search worker
 * (issue #1792).
 *
 * The worker supports `init(snapshot)` but nobody was ever persisting
 * or passing a snapshot — `search-worker-client.ts` constructed the
 * worker with no initial data and `indexCardsInWorker()` always did a
 * fresh `clear()` + `index(allDocuments)`. Every session paid at least
 * one, typically two, full corpus re-indexes (200–600 ms of worker
 * CPU per 5 k cards per the prewarm module's own docstring).
 *
 * The main-thread `cardSearchIndex` (`./card-search-index.ts`) already
 * does `loadIndex()` / `saveIndex()` against the same Dexie table
 * (`db.orama_snapshots`). This module mirrors that pattern for the
 * worker, keyed at a separate row id (`card_search_worker`) so the
 * two indexes never collide.
 *
 * The fingerprint is a cheap FNV-1a 32-bit hash of the sorted card IDs
 * plus the card count. Restoring from a persisted snapshot is gated on
 * the current corpus matching the stored fingerprint — a card-database
 * rebuild invalidates the snapshot and triggers a full reindex, which
 * is the only safe behaviour when the underlying documents differ.
 *
 * Dexie ownership: per `docs/PERSISTENCE_ARCHITECTURE.md` (issue
 * #1722), `db.orama_snapshots` lives on `LocalIntelligenceDB` and is
 * re-derived from the canonical card database, so it is OUT of the
 * §5.6 backup scope (only `match_records` is backed up — issue #1812).
 */

import { db } from "../db/local-intelligence-db";

/**
 * Separate Dexie row id so the worker snapshot cannot collide with the
 * main-thread `cardSearchIndex` snapshot (`"card_search"`). Both use
 * the same `orama_snapshots` table — separate rows, separate fingerprints.
 */
export const WORKER_SNAPSHOT_ID = "card_search_worker";

/**
 * Stable fingerprint of the card corpus. Two fingerprints are equal iff
 * the underlying card-id sets are identical (sorted, deduped by Orama
 * dedup-on-insert semantics) — content-level mutations of cards with
 * the same id are NOT detected. That is acceptable here because the
 * snapshot is re-derived from the canonical card-database row, so a
 * content-only mutation that happens to keep the id set stable is a
 * bug to fix upstream, not a reindex trigger.
 */
export interface CardCorpusFingerprint {
  cardCount: number;
  cardIdsHash: string;
}

/**
 * FNV-1a 32-bit hash of the sorted card IDs. Picked over SHA-256 because
 * the corpus is up to ~30 k cards and we only need a stable, cheap,
 * collision-resistant-enough tag to gate snapshot reuse — a cryptographic
 * hash would just be slower for the same effective guarantee (the
 * fingerprint is best-effort, not adversarial: an attacker who can
 * forge a fingerprint collision can also forge the corpus itself).
 *
 * Exported so tests can assert order-insensitivity directly.
 */
export function cardCorpusFingerprint(
  cards: ReadonlyArray<{ id: string }>,
): CardCorpusFingerprint {
  const sortedIds = cards
    .map((c) => c.id)
    .slice()
    .sort();
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (const id of sortedIds) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
  }
  // `>>> 0` coerces to an unsigned 32-bit int so the hex string is
  // deterministic across V8 versions.
  const cardIdsHash = (hash >>> 0).toString(16).padStart(8, "0");
  return { cardCount: sortedIds.length, cardIdsHash };
}

/**
 * Internal row shape stored at the `card_search_worker` row of
 * `db.orama_snapshots`. Extends the base `OramaSnapshot` interface
 * with the fingerprint fields used for version guarding.
 *
 * Exported for tests that need to construct an envelope.
 */
export interface WorkerSnapshotRow {
  id: typeof WORKER_SNAPSHOT_ID;
  data: unknown;
  cardCount: number;
  cardIdsHash: string;
  timestamp: number;
}

/**
 * Read the persisted worker snapshot iff its fingerprint matches the
 * current card corpus. Returns `null` for: no row, fingerprint mismatch,
 * or any read failure. Mirrors the fail-soft contract of
 * `CardSearchIndex.loadIndex()` so a broken Dexie row never crashes the
 * worker warm-up path.
 */
export async function loadWorkerSnapshot(
  expected: CardCorpusFingerprint,
): Promise<string | null> {
  try {
    const row = (await db.orama_snapshots.get(WORKER_SNAPSHOT_ID)) as
      (WorkerSnapshotRow & { data: unknown }) | undefined;
    if (!row) return null;
    if (
      row.cardCount !== expected.cardCount ||
      row.cardIdsHash !== expected.cardIdsHash
    ) {
      // Corpus has changed since the snapshot was taken — invalidate
      // implicitly by not returning the snapshot. The caller will fall
      // through to a full reindex.
      return null;
    }
    return typeof row.data === "string" ? row.data : null;
  } catch {
    return null;
  }
}

/**
 * Persist the worker's serialized snapshot alongside the fingerprint
 * fields. Overwrites any previous row at `WORKER_SNAPSHOT_ID`. Errors
 * propagate to the caller — persistence is best-effort but loud, so a
 * quota / schema problem surfaces instead of silently re-indexing on
 * every session.
 */
export async function saveWorkerSnapshot(
  data: string,
  fingerprint: CardCorpusFingerprint,
): Promise<void> {
  await db.orama_snapshots.put({
    id: WORKER_SNAPSHOT_ID,
    data,
    cardCount: fingerprint.cardCount,
    cardIdsHash: fingerprint.cardIdsHash,
    timestamp: Date.now(),
  });
}

/**
 * Drop the persisted worker snapshot. Called when the card database is
 * rebuilt (the next `indexCardsInWorker()` will see no fingerprint
 * match and do a full reindex, so no explicit invalidation is required
 * for the happy path — this is the manual escape hatch for tests and
 * for a future "reset search index" admin action).
 */
export async function clearWorkerSnapshot(): Promise<void> {
  await db.orama_snapshots.delete(WORKER_SNAPSHOT_ID);
}
