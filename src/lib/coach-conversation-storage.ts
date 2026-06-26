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
