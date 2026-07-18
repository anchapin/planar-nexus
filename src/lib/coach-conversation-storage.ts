/**
 * @fileoverview IndexedDB persistence for AI Coach conversations.
 *
 * Issue #1074: coaching conversations were lost on refresh/restart because the
 * coach route is fully stateless and the chat hook only mirrored its history to
 * localStorage (small, synchronous, easily evicted). This module stores whole
 * conversations — messages plus the deck context they were discussing — in a
 * dedicated IndexedDB object store so a user returning to the coach sees their
 * prior history and can resume.
 *
 * Design notes:
 *  - Reuses the shared {@link IndexedDBStorage} wrapper so quota classification
 *    (#1085), atomic single-transaction writes, and lazy initialisation are
 *    inherited rather than re-implemented. A *separate* database name keeps the
 *    coach store isolated from the main app stores — no version bump on the
 *    shared config, no migration risk.
 *  - Local-first: everything lives in the browser/Tauri IndexedDB. No telemetry
 *    of conversation content leaves the device.
 *  - Graceful degrade: read helpers never throw (they return `[]`/`null` on any
 *    failure, including IndexedDB being unavailable in private mode / SSR), and
 *    writes go through {@link withQuotaGuard} so quota exhaustion is surfaced as
 *    a typed result instead of crashing the in-session coach.
 */

import type { ChatMessage } from "@/types/chat";
import type { DeckCard } from "@/ai/flows/context-builder";
import { IndexedDBStorage } from "./indexeddb-storage";
import { withQuotaGuard, type QuotaGuardResult } from "./storage-quota";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Snapshot of the deck context a conversation is anchored to. Stored alongside
 * the messages so a resumed conversation is self-contained — the coach can
 * re-establish context without the user re-explaining format, archetype, etc.
 */
export interface CoachConversationDeckContext {
  format?: string;
  archetype?: string;
  strategy?: string;
  deckCards?: DeckCard[];
  /** Opaque digest used for payload reduction; preserved verbatim if present. */
  digestedContext?: unknown;
}

/**
 * A persisted coaching conversation. Stored as a single document keyed by `id`
 * so saving/updating is one atomic IndexedDB `put`.
 */
export interface CoachConversation {
  id: string;
  /** Deck this conversation is scoped to ("default" when unscoped). */
  deckId: string;
  /** Short human-readable summary derived from the first user message. */
  title: string;
  /** Deck-context snapshot (format/archetype/strategy/cards). */
  deckContext: CoachConversationDeckContext;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * JSON-serialisable envelope for one or more persisted coach conversations.
 *
 * Versioned and tagged so future schema changes can be detected and rejected
 * by {@link parseCoachConversationExport}. The envelope is intentionally
 * self-describing — a user opening the JSON in any editor can tell what it is
 * and when it was produced without consulting external docs (issue #1242).
 */
export interface CoachConversationExport {
  /** Discriminator that lets {@link parseCoachConversationExport} validate shape. */
  type: "planar-nexus-coach-conversations";
  /** Envelope schema version. Bumped when the on-disk shape changes. */
  version: 1;
  /** ISO timestamp at which the export was produced. */
  exportedAt: string;
  /** Deck id the conversations were scoped to, or `null` for multi-deck exports. */
  deckId: string | null;
  /** Conversations, newest-first (matches {@link loadConversations} ordering). */
  conversations: CoachConversation[];
}

/** Result returned from {@link importConversationsFromJSON}. */
export interface CoachConversationImportResult {
  /** Number of conversations persisted to IndexedDB. */
  imported: number;
  /** Number of entries that were rejected (e.g. malformed). */
  skipped: number;
  /** Per-record error messages for the skipped entries (if any). */
  errors: string[];
}

// ============================================================================
// CONFIG
// ============================================================================

/** IndexedDB object store name for coach conversations. */
export const COACH_CONVERSATION_STORE = "coach-conversations";

/** deckId used when the coach is opened without a specific deck. */
export const DEFAULT_DECK_ID = "default";

/** Max length of an auto-derived conversation title. */
const TITLE_MAX_LENGTH = 60;

/**
 * Default cap on persisted conversations per deck (oldest are pruned first).
 * Tuned to keep IndexedDB usage bounded without surprising users who chat a lot
 * — 50 full transcripts comfortably fits under the IndexedDB quota even with
 * large deck-context snapshots, while still pruning long-abandoned sessions
 * (issue #1242).
 */
export const DEFAULT_MAX_CONVERSATIONS_PER_DECK = 50;

/**
 * Dedicated IndexedDB database for coach conversations. Kept separate from the
 * main "PlanarNexusStorage" database so adding this store cannot version-conflict
 * with existing app stores or require migrating them.
 */
const coachStorage = new IndexedDBStorage({
  dbName: "PlanarNexusCoach",
  version: 1,
  stores: [COACH_CONVERSATION_STORE],
});

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Derive a short, human-readable title from a list of messages (the first user
 * message is the most descriptive). Falls back to a generic label when there is
 * no user content yet.
 */
export function deriveConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  const text = firstUser?.content.trim();
  if (!text) return "New coaching session";
  const single = text.replace(/\s+/g, " ");
  return single.length > TITLE_MAX_LENGTH
    ? `${single.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : single;
}

/**
 * Normalise a raw stored message's timestamp back into a `Date`. IndexedDB
 * preserves `Date` instances via structured clone, but the value may also arrive
 * as an ISO string (e.g. after a JSON backup round-trip), so handle both.
 */
function normalizeMessage(raw: ChatMessage): ChatMessage {
  return {
    ...raw,
    timestamp: new Date(
      (raw.timestamp as unknown as string | Date) ?? Date.now(),
    ),
  };
}

/** True when IndexedDB can be used in the current environment. */
function indexedDBAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return typeof indexedDB !== "undefined";
}

// ============================================================================
// READS (never throw — degrade to empty/null)
// ============================================================================

/**
 * Load every persisted conversation for a deck, newest-first. Returns `[]` when
 * IndexedDB is unavailable or the read fails so callers (the chat hook) can
 * render an empty state without crashing.
 */
export async function loadConversations(
  deckId: string = DEFAULT_DECK_ID,
): Promise<CoachConversation[]> {
  if (!indexedDBAvailable()) return [];
  try {
    const all = await coachStorage.getAll<CoachConversation>(
      COACH_CONVERSATION_STORE,
    );
    return all
      .filter((c) => c && c.deckId === deckId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  } catch (error) {
    console.error("Failed to load coach conversations:", error);
    return [];
  }
}

/**
 * Load a single conversation by id (any deck). Returns `null` when not found or
 * when IndexedDB is unavailable.
 */
export async function loadConversation(
  id: string,
): Promise<CoachConversation | null> {
  if (!indexedDBAvailable() || !id) return null;
  try {
    const conv = await coachStorage.get<CoachConversation>(
      COACH_CONVERSATION_STORE,
      id,
    );
    if (!conv) return null;
    return {
      ...conv,
      messages: Array.isArray(conv.messages)
        ? conv.messages.map(normalizeMessage)
        : [],
    };
  } catch (error) {
    console.error("Failed to load coach conversation:", error);
    return null;
  }
}

/**
 * Load the most recently updated conversation for a deck (the auto-resume
 * target on page open). Returns `null` when there is none.
 */
export async function loadMostRecentConversation(
  deckId: string = DEFAULT_DECK_ID,
): Promise<CoachConversation | null> {
  const list = await loadConversations(deckId);
  if (list.length === 0) return null;
  // list is newest-first; re-normalise messages for the chosen conversation.
  return loadConversation(list[0].id);
}

// ============================================================================
// WRITES (quota-guarded, non-crashing)
// ============================================================================

/**
 * Persist (create or replace) a conversation atomically. Quota exhaustion is
 * returned as a typed {@link QuotaGuardResult} (`{ ok: false, error }`) so the
 * caller can surface a notice and keep the in-session coach working; other
 * unexpected errors are logged and also returned as a failed result rather than
 * thrown.
 */
export async function saveConversation(
  conversation: CoachConversation,
): Promise<QuotaGuardResult<CoachConversation>> {
  if (!indexedDBAvailable()) {
    // Nothing we can do (SSR / private mode); report as a non-crashing failure.
    return {
      ok: false,
      error: new Error("IndexedDB unavailable — conversation not persisted"),
    };
  }
  try {
    const result = await withQuotaGuard(() =>
      coachStorage.set(COACH_CONVERSATION_STORE, conversation),
    );
    if (!result.ok) return result;
    return { ok: true, value: conversation };
  } catch (error) {
    // Defensive: withQuotaGuard rethrows non-quota errors; never let a persistence
    // failure crash the coach. Log and report.
    console.error("Failed to save coach conversation:", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to save coach conversation"),
    };
  }
}

/**
 * Delete a single conversation by id. Never throws — a failure is logged and the
 * caller can continue.
 */
export async function deleteConversation(id: string): Promise<void> {
  if (!indexedDBAvailable() || !id) return;
  try {
    await coachStorage.delete(COACH_CONVERSATION_STORE, id);
  } catch (error) {
    console.error("Failed to delete coach conversation:", error);
  }
}

/**
 * Delete every conversation scoped to a deck. Used by "clear" flows.
 */
export async function deleteConversationsForDeck(
  deckId: string = DEFAULT_DECK_ID,
): Promise<void> {
  const list = await loadConversations(deckId);
  await Promise.all(list.map((c) => deleteConversation(c.id)));
}

/**
 * Remove every coach conversation regardless of deck. Primarily a test/utility
 * helper (e.g. wiping the store between unit tests); also used by full clears.
 */
export async function clearAllCoachConversations(): Promise<void> {
  if (!indexedDBAvailable()) return;
  try {
    await coachStorage.clear(COACH_CONVERSATION_STORE);
  } catch (error) {
    console.error("Failed to clear coach conversations:", error);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Build a fresh, unsaved conversation object with sensible defaults. The caller
 * persists it via {@link saveConversation} (typically indirectly through the
 * chat hook).
 */
export function createConversationRecord(opts: {
  id: string;
  deckId?: string;
  messages?: ChatMessage[];
  deckContext?: CoachConversationDeckContext;
  now?: Date;
}): CoachConversation {
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const messages = opts.messages ?? [];
  return {
    id: opts.id,
    deckId: opts.deckId ?? DEFAULT_DECK_ID,
    title: deriveConversationTitle(messages),
    deckContext: opts.deckContext ?? {},
    messages,
    createdAt: iso,
    updatedAt: iso,
  };
}

// ============================================================================
// EXPORT / IMPORT (issue #1242 — portability across browsers/machines)
// ============================================================================

/**
 * Validate a single conversation record from a parsed JSON payload. Returns
 * `null` if the record is unusable; otherwise returns a normalised copy with
 * `Date` timestamps and a sanitised `deckId`. The function never throws so the
 * import helper can collect *all* bad records instead of bailing on the first.
 */
function sanitiseImportedConversation(
  raw: unknown,
  fallbackDeckId: string,
): { ok: true; value: CoachConversation } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not an object" };
  }
  const rec = raw as Partial<CoachConversation> & {
    messages?: unknown;
    deckContext?: unknown;
  };
  if (typeof rec.id !== "string" || !rec.id) {
    return { ok: false, reason: "missing id" };
  }
  if (!Array.isArray(rec.messages)) {
    return { ok: false, reason: "missing messages array" };
  }
  const messages: ChatMessage[] = [];
  for (const m of rec.messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Partial<ChatMessage>;
    if (typeof msg.role !== "string" || typeof msg.content !== "string") {
      continue;
    }
    const ts =
      msg.timestamp instanceof Date
        ? msg.timestamp
        : new Date(
            (msg.timestamp as unknown as string | number | undefined) ??
              Date.now(),
          );
    messages.push({
      id: typeof msg.id === "string" && msg.id ? msg.id : crypto.randomUUID(),
      role: msg.role as ChatMessage["role"],
      content: msg.content,
      timestamp: ts,
      provider: typeof msg.provider === "string" ? msg.provider : undefined,
      usage: msg.usage as ChatMessage["usage"] | undefined,
      cancelled: typeof msg.cancelled === "boolean" ? msg.cancelled : undefined,
      lowConfidence:
        typeof msg.lowConfidence === "boolean" ? msg.lowConfidence : undefined,
      needsReview:
        typeof msg.needsReview === "boolean" ? msg.needsReview : undefined,
      groundingFailures: Array.isArray(msg.groundingFailures)
        ? (msg.groundingFailures as string[])
        : undefined,
    });
  }
  if (messages.length === 0) {
    return { ok: false, reason: "no usable messages" };
  }
  const createdAt =
    typeof rec.createdAt === "string" && rec.createdAt
      ? rec.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rec.updatedAt === "string" && rec.updatedAt
      ? rec.updatedAt
      : createdAt;
  const deckId =
    typeof rec.deckId === "string" && rec.deckId ? rec.deckId : fallbackDeckId;
  const ctx =
    rec.deckContext && typeof rec.deckContext === "object"
      ? (rec.deckContext as CoachConversationDeckContext)
      : {};
  return {
    ok: true,
    value: {
      id: rec.id,
      deckId,
      title:
        typeof rec.title === "string" && rec.title
          ? rec.title
          : deriveConversationTitle(messages),
      deckContext: ctx,
      messages,
      createdAt,
      updatedAt,
    },
  };
}

/**
 * Build a JSON-safe export envelope for every conversation on a single deck.
 * Returns an empty envelope when there are no conversations (still valid JSON).
 */
export async function exportConversationsForDeck(
  deckId: string = DEFAULT_DECK_ID,
): Promise<CoachConversationExport> {
  const conversations = await loadConversations(deckId);
  return {
    type: "planar-nexus-coach-conversations",
    version: 1,
    exportedAt: new Date().toISOString(),
    deckId,
    conversations,
  };
}

/**
 * Build a JSON-safe export envelope for every conversation in the store
 * (across all decks). Use this for full-backup-style exports; for per-deck
 * portability prefer {@link exportConversationsForDeck}.
 */
export async function exportAllConversations(): Promise<CoachConversationExport> {
  if (!indexedDBAvailable()) {
    return {
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: null,
      conversations: [],
    };
  }
  try {
    const conversations = await coachStorage.getAll<CoachConversation>(
      COACH_CONVERSATION_STORE,
    );
    conversations.sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
    return {
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: null,
      conversations,
    };
  } catch (error) {
    console.error("Failed to export coach conversations:", error);
    return {
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: null,
      conversations: [],
    };
  }
}

/**
 * Validate + parse a JSON string into a {@link CoachConversationExport}.
 *
 * Returns `null` when the input is not the expected envelope (wrong `type` or
 * unsupported `version`). On parse errors the thrown `SyntaxError` is caught
 * and surfaced as `null` so the import UI can show a user-friendly error rather
 * than crashing.
 */
export function parseCoachConversationExport(
  raw: string,
): CoachConversationExport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Partial<CoachConversationExport>;
  if (obj.type !== "planar-nexus-coach-conversations") return null;
  if (obj.version !== 1) return null;
  if (!Array.isArray(obj.conversations)) return null;
  return {
    type: "planar-nexus-coach-conversations",
    version: 1,
    exportedAt:
      typeof obj.exportedAt === "string"
        ? obj.exportedAt
        : new Date().toISOString(),
    deckId: typeof obj.deckId === "string" ? obj.deckId : null,
    conversations: obj.conversations as CoachConversation[],
  };
}

/**
 * Import conversations from a parsed export envelope into IndexedDB.
 *
 * Each imported record is given a fresh `id` by default (preserves the original
 * id when `replace: true`) so importing the same export twice does not clobber
 * the local store. The `targetDeckId` parameter re-scopes every conversation
 * to a specific deck — pass `null` to keep each record's original `deckId`.
 *
 * Returns counts so the UI can show a meaningful toast ("Imported 3, skipped 1").
 */
export async function importConversationsFromJSON(
  envelope: CoachConversationExport,
  opts: {
    /** Deck to assign to imported conversations. `null` keeps the original deckId. */
    targetDeckId?: string | null;
    /** When true, overwrite an existing record with the same id. */
    replace?: boolean;
  } = {},
): Promise<CoachConversationImportResult> {
  const result: CoachConversationImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
  };
  const { targetDeckId = null, replace = false } = opts;
  const fallbackDeckId = targetDeckId ?? DEFAULT_DECK_ID;

  for (let i = 0; i < envelope.conversations.length; i++) {
    const raw = envelope.conversations[i];
    const sanitised = sanitiseImportedConversation(raw, fallbackDeckId);
    if (!sanitised.ok) {
      result.skipped += 1;
      result.errors.push(`conversation #${i + 1}: ${sanitised.reason}`);
      continue;
    }
    let conv = sanitised.value;
    if (targetDeckId !== null) {
      conv = { ...conv, deckId: targetDeckId };
    }
    if (!replace) {
      // Avoid clobbering a local record with the same id (e.g. user double-imports).
      const existing = await loadConversation(conv.id);
      if (existing) {
        conv = { ...conv, id: crypto.randomUUID() };
      }
    }
    const saved = await saveConversation(conv);
    if (saved.ok) {
      result.imported += 1;
    } else {
      result.skipped += 1;
      result.errors.push(
        `conversation #${i + 1}: ${saved.error.message ?? "save failed"}`,
      );
    }
  }
  return result;
}

// ============================================================================
// BOUNDED RETENTION + ORPHAN CLEANUP (issue #1242)
// ============================================================================

/**
 * Prune oldest conversations for a single deck so at most `maxConversations`
 * records remain. Newest-first ordering is reused from
 * {@link loadConversations}. Returns the number of records deleted so callers
 * can surface a notice ("Pruned 4 old conversations").
 */
export async function pruneOldestConversationsForDeck(
  deckId: string,
  maxConversations: number = DEFAULT_MAX_CONVERSATIONS_PER_DECK,
): Promise<number> {
  if (maxConversations < 0) return 0;
  const list = await loadConversations(deckId);
  if (list.length <= maxConversations) return 0;
  const toDelete = list.slice(maxConversations);
  await Promise.all(toDelete.map((c) => deleteConversation(c.id)));
  return toDelete.length;
}

/**
 * Delete every conversation whose `deckId` is NOT in `validDeckIds`. Used to
 * clean up orphaned per-deck histories when a saved deck is removed from the
 * user's collection, preventing an unbounded growth of unreachable transcripts
 * (issue #1242).
 *
 * The constant `DEFAULT_DECK_ID` is always preserved so unscoped ("default")
 * sessions survive a deck deletion.
 */
export async function pruneOrphanedConversations(
  validDeckIds: Iterable<string>,
): Promise<number> {
  if (!indexedDBAvailable()) return 0;
  const valid = new Set<string>([DEFAULT_DECK_ID, ...validDeckIds]);
  let all: CoachConversation[];
  try {
    all = await coachStorage.getAll<CoachConversation>(
      COACH_CONVERSATION_STORE,
    );
  } catch (error) {
    console.error("Failed to read conversations for orphan pruning:", error);
    return 0;
  }
  const orphans = all.filter((c) => c && !valid.has(c.deckId));
  if (orphans.length === 0) return 0;
  await Promise.all(orphans.map((c) => deleteConversation(c.id)));
  return orphans.length;
}
