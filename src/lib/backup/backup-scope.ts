/**
 * @fileOverview Backup scope extension for the three "not in scope until
 * #1812" databases — `PlanarNexusCoach`, `LocalIntelligenceDB`, and
 * `PlanarNexusLimited` (persistence ADR §5.6 / §7).
 *
 * Background
 * ----------
 * The app's user-data-of-record (`PlanarNexusStorage`) has always been the
 * target of the backup pipeline. The §5.6 "in backup?" column, however, marks
 * three additional databases as containing user-authored or user-meaningful
 * content that a round-trip through the export/import cycle silently lost:
 *
 *   - `PlanarNexusCoach.coach-conversations` — AI coach chat history.
 *     Persisted to a dedicated DB (see ADR §1 row 3) so coach-store version
 *     bumps cannot conflict with the main app stores.
 *   - `LocalIntelligenceDB.match_records` — per-(gameId, playerId) match
 *     history written by `use-p2p-connection.ts` on `game-ended`
 *     (issue #1570). The DB also carries derived re-computable analytics
 *     (embeddings, snapshots, game_history, player_decisions,
 *     game_embeddings) that stay out of scope.
 *   - `PlanarNexusLimited.sessions` — sealed / draft / rochester / winston
 *     pool sessions. Persisted in a dedicated DB by ISOL-01 (ADR §1 row 10)
 *     so a pool-sessions version bump cannot conflict with the main deck
 *     collection.
 *
 * This module is the single seam between `indexeddb-storage.ts`'s
 * `exportBackup` / `importBackup` machinery and the three external-DB
 * helpers. Centralising the wiring here means the ADR §5.6 "in backup?" table
 * has exactly one place to update when a future issue folds more databases
 * into scope.
 *
 * Failure policy
 * --------------
 * Every read is wrapped in a try/catch returning `[]`, every write in a
 * try/catch logging the failure — a backup gathered on a device that never
 * opened the coach route (or never sealed a pool) must still produce a
 * well-formed envelope, and a restore on a fresh device that does not have a
 * given external DB (e.g. never opened the coach) must never crash. The
 * envelope therefore carries the three new fields as optional, and missing
 * / empty arrays are a no-op on restore.
 *
 * Forward compatibility
 * ---------------------
 * The owning `{@link BackupData}` type carries `schemaVersion?: number`; this
 * module populates that field with `BACKUP_SCOPE_SCHEMA_VERSION` (currently
 * `2`). Legacy envelopes (no `schemaVersion`) read as schemaVersion=1 by
 * convention and continue to import cleanly because the three new fields are
 * additive.
 */

import { getAllCoachConversationsForBackup, restoreCoachConversationsForBackup } from "../coach-conversation-storage";
import type { CoachConversation } from "../coach-conversation-storage";
import { getAllMatchRecordsForBackup, restoreMatchRecordsForBackup } from "../db/local-intelligence-db";
import type { MatchRecord } from "../db/local-intelligence-db";
import {
  getAllLimitedSessionsForBackup,
  restoreLimitedSessionsForBackup,
} from "../limited/pool-storage";
import type { LimitedSession } from "../limited/types";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Wire-format schema version stamped into `BackupData.schemaVersion` by
 * `collectBackupScopeData`. New fields added under issue #1812 are additive
 * (optional), so legacy envelopes that pre-date this constant (`schemaVersion
 * undefined` → reads as `1`) continue to import without modification. Bump
 * this on the next forward-incompatible change.
 */
export const BACKUP_SCOPE_SCHEMA_VERSION = 2;

/**
 * Issue #1812 — the three excluded databases listed in the §5.6 / §7
 * "included in backup" table, named exactly as the production code opens
 * them (lowercase store-name convention from §5.1). Documented here so the
 * test suite and any future audit tooling can reference one source of truth.
 */
export const BACKUP_SCOPE_DB_NAMES = {
  coach: "PlanarNexusCoach",
  localIntelligence: "LocalIntelligenceDB",
  limited: "PlanarNexusLimited",
} as const;

/**
 * Object-store names for the three newly-backed-up tables on their respective
 * databases. Mirrors `IndexedDBStorage`'s `SAVED_GAMES_META_STORE` /
 * `COACH_CONVERSATION_STORE` constants so the string stays single-sourced.
 */
export const BACKUP_SCOPE_STORE_NAMES = {
  coachConversations: "coach-conversations",
  matchRecords: "match_records",
  limitedSessions: "sessions",
} as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * The slice of `BackupData` owned by this module — the three optional,
 * additive fields that round-trip coach conversations, match records, and
 * limited-format sessions through the backup pipeline. Kept as a
 * standalone shape so the public `BackupData` interface can stay in
 * `indexeddb-storage.ts` (the storage-layer seam).
 */
export interface BackupScopeData {
  /** Every row in `PlanarNexusCoach.coach-conversations`. */
  coachConversations: CoachConversation[];
  /** Every row in `LocalIntelligenceDB.match_records`. */
  matchRecords: MatchRecord[];
  /** Every row in `PlanarNexusLimited.sessions`. */
  limitedSessions: LimitedSession[];
}

// ============================================================================
// GATHER (export side)
// ============================================================================

/**
 * Issue #1812 — gather the three excluded stores for inclusion in a full
 * backup. Each leg is fail-soft (returns `[]` on read failure) so a broken /
 * never-initialised external DB never aborts the export pipeline.
 *
 * The three reads are sequential rather than parallelised: each external
 * database is opened lazily on first use, so concurrent opens against two
 * Dexie singletons and an `IndexedDBStorage` instance can deadlock fake-
 * indexeddb under load (issue #1811 set the precedent for sequential lazy
 * initialisation). For a backup that runs once per user-action the
 * latency is negligible next to the SHA-256 digest.
 */
export async function collectBackupScopeData(): Promise<BackupScopeData> {
  const coachConversations = await getAllCoachConversationsForBackup();
  const matchRecords = await getAllMatchRecordsForBackup();
  const limitedSessions = await getAllLimitedSessionsForBackup();
  return { coachConversations, matchRecords, limitedSessions };
}

// ============================================================================
// RESTORE (import side)
// ============================================================================

/**
 * Issue #1812 — restore the three excluded stores from a backup envelope.
 * Each leg is fail-soft and skips missing / empty arrays so a legacy
 * envelope (which carries `undefined` for the three new fields) restores
 * cleanly without touching the external DBs. A pre-existing local row in
 * any of the three stores is replaced by the backup row (idempotent on the
 * row's primary key — coach `id`, match `${gameId}@${playerId}`, limited
 * session UUID).
 */
export async function restoreBackupScopeData(
  scope: BackupScopeData,
): Promise<void> {
  await restoreCoachConversationsForBackup(
    scope?.coachConversations ?? [],
  );
  await restoreMatchRecordsForBackup(scope?.matchRecords ?? []);
  await restoreLimitedSessionsForBackup(scope?.limitedSessions ?? []);
}
