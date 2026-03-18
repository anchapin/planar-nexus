/**
 * Pool Storage and Session Management
 *
 * Provides IndexedDB-based persistence for sealed/draft sessions.
 * Implements strict isolation from regular deck collection.
 *
 * ISOL-01: Pool cards stored in separate 'limited-sessions' store (NOT 'decks')
 * ISOL-02: Pool scoped to specific session ID
 * ISOL-03: Each session has unique UUID
 * SEAL-03: Pool filtering by color, type, CMC
 * SEAL-04, SEAL-05: Pool persistence and save/resume
 * LBld-06: Save/load limited deck for session
 */

import Dexie from 'dexie';
import type {
  LimitedSession,
  PoolCard,
  LimitedDeckCard,
  PoolFilters,
  CreateSessionOptions,
} from './types';
import {
  filterByColor,
  filterByType,
  filterByCMC,
  applyFilters,
} from '@/lib/search/filter-cards';
import type { CardFilters } from '@/lib/search/filter-types';

// ============================================================================
// Database
// ============================================================================

/**
 * Separate IndexedDB database for limited sessions
 * NOT connected to the main deck storage - ensures isolation
 */
class LimitedDatabase extends Dexie {
  sessions!: Dexie.Table<LimitedSession, string>;

  constructor() {
    super('PlanarNexusLimited');

    this.version(1).stores({
      // Primary key: id (UUID)
      // Indexes for common queries
      sessions: 'id, setCode, mode, status, createdAt, updatedAt',
    });
  }
}

// Singleton instance
let db: LimitedDatabase | null = null;

/**
 * Get or create the limited database instance
 */
function getDatabase(): LimitedDatabase {
  if (!db) {
    db = new LimitedDatabase();
  }
  return db;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new limited session
 */
export async function createSession(
  options: CreateSessionOptions
): Promise<LimitedSession> {
  const database = getDatabase();

  const session: LimitedSession = {
    id: crypto.randomUUID(), // ISOL-03: Unique UUID
    setCode: options.setCode,
    setName: options.setName,
    mode: options.mode,
    status: 'in_progress',
    pool: [],
    deck: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: options.name,
  };

  // ISOL-01: Store in 'limited-sessions', not 'decks'
  await database.sessions.add(session);

  return session;
}

/**
 * Get a session by ID
 * SEAL-05: Resume session
 */
export async function getSession(id: string): Promise<LimitedSession | null> {
  const database = getDatabase();
  const session = await database.sessions.get(id);
  return session || null;
}

/**
 * Get all sessions
 * Useful for session browser/list
 */
export async function getAllSessions(): Promise<LimitedSession[]> {
  const database = getDatabase();
  const sessions = await database.sessions.toArray();

  // Sort by updatedAt descending (most recent first)
  return sessions.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Get sessions by mode (sealed or draft)
 */
export async function getSessionsByMode(
  mode: 'sealed' | 'draft'
): Promise<LimitedSession[]> {
  const database = getDatabase();
  return database.sessions.where('mode').equals(mode).toArray();
}

/**
 * Delete a session
 * ISOL-01: Also removes pool and deck data
 */
export async function deleteSession(id: string): Promise<void> {
  const database = getDatabase();
  await database.sessions.delete(id);
}

/**
 * Delete all sessions
 * Useful for testing or user reset
 */
export async function deleteAllSessions(): Promise<void> {
  const database = getDatabase();
  await database.sessions.clear();
}

// ============================================================================
// Pool Operations
// ============================================================================

/**
 * Update pool cards in a session
 * SEAL-04: Persists pool changes immediately
 */
export async function updatePool(
  sessionId: string,
  pool: PoolCard[]
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Update pool and timestamp
  await database.sessions.update(sessionId, {
    pool,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Add a card to the pool
 */
export async function addToPool(
  sessionId: string,
  card: PoolCard
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  await database.sessions.update(sessionId, {
    pool: [...session.pool, card],
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Remove a card from the pool
 */
export async function removeFromPool(
  sessionId: string,
  cardId: string
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  await database.sessions.update(sessionId, {
    pool: session.pool.filter((c) => c.id !== cardId),
    updatedAt: new Date().toISOString(),
  });
}

// ============================================================================
// Deck Operations
// ============================================================================

/**
 * Update deck cards in a session
 * LBld-06: Save deck within session scope
 */
export async function updateDeck(
  sessionId: string,
  deck: LimitedDeckCard[]
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  await database.sessions.update(sessionId, {
    deck,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Add a card to the limited deck
 */
export async function addToDeck(
  sessionId: string,
  card: LimitedDeckCard
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Check if card already in deck
  const existingIndex = session.deck.findIndex(
    (d) => d.card.id === card.card.id
  );

  let newDeck: LimitedDeckCard[];
  if (existingIndex >= 0) {
    // Increment count
    newDeck = session.deck.map((d, i) =>
      i === existingIndex ? { ...d, count: d.count + card.count } : d
    );
  } else {
    // Add new
    newDeck = [...session.deck, card];
  }

  await database.sessions.update(sessionId, {
    deck: newDeck,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Remove a card from the limited deck
 */
export async function removeFromDeck(
  sessionId: string,
  cardId: string,
  count: number = 1
): Promise<void> {
  const database = getDatabase();
  const session = await database.sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const newDeck = session.deck
    .map((d) => {
      if (d.card.id === cardId) {
        return { ...d, count: d.count - count };
      }
      return d;
    })
    .filter((d) => d.count > 0); // Remove cards with 0 count

  await database.sessions.update(sessionId, {
    deck: newDeck,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Save deck for session (alias for updateDeck)
 * LBld-06: Explicit save functionality
 */
export async function saveDeck(
  sessionId: string,
  deck: LimitedDeckCard[]
): Promise<void> {
  return updateDeck(sessionId, deck);
}

/**
 * Clear deck in session
 */
export async function clearDeck(sessionId: string): Promise<void> {
  return updateDeck(sessionId, []);
}

// ============================================================================
// Pool Filtering
// ============================================================================

/**
 * Convert PoolFilters to CardFilters for filter-cards functions
 */
function poolFiltersToCardFilters(filters: PoolFilters): CardFilters {
  const cardFilters: CardFilters = {};

  if (filters.color) {
    cardFilters.color = {
      mode: filters.color.mode,
      colors: filters.color.colors,
      matchColorIdentity: filters.color.matchColorIdentity,
    };
  }

  if (filters.type) {
    cardFilters.type = {
      types: filters.type.types,
      supertypes: filters.type.supertypes,
      subtypes: filters.type.subtypes,
    };
  }

  if (filters.cmc) {
    cardFilters.cmc = {
      mode: filters.cmc.mode,
      value: filters.cmc.value,
      min: filters.cmc.min,
      max: filters.cmc.max,
    };
  }

  return cardFilters;
}

/**
 * Filter pool by color, type, CMC
 * SEAL-03: Browse/filter sealed pool
 */
export function filterPool(
  pool: PoolCard[],
  filters: PoolFilters
): PoolCard[] {
  if (!filters || Object.keys(filters).length === 0) {
    return pool;
  }

  // Convert to CardFilters and use applyFilters
  const cardFilters = poolFiltersToCardFilters(filters);

  // Search query filtering (simple name match)
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    const filteredByQuery = pool.filter(
      (card) =>
        card.name.toLowerCase().includes(query) ||
        card.type_line.toLowerCase().includes(query)
    );
    // Apply other filters to the search results
    const remainingFilters = { ...cardFilters };
    delete remainingFilters.searchQuery;
    if (Object.keys(remainingFilters).length > 0) {
      return applyFilters(filteredByQuery, remainingFilters) as PoolCard[];
    }
    return filteredByQuery;
  }

  return applyFilters(pool, cardFilters) as PoolCard[];
}

/**
 * Filter pool by color (convenience function)
 */
export function filterPoolByColor(
  pool: PoolCard[],
  mode: 'exact' | 'include' | 'exclude',
  colors: string[]
): PoolCard[] {
  return filterPool(pool, { color: { mode, colors } });
}

/**
 * Filter pool by type (convenience function)
 */
export function filterPoolByType(
  pool: PoolCard[],
  types: string[]
): PoolCard[] {
  return filterPool(pool, { type: { types } });
}

/**
 * Filter pool by CMC (convenience function)
 */
export function filterPoolByCMC(
  pool: PoolCard[],
  mode: 'exact' | 'range',
  value?: number,
  min?: number,
  max?: number
): PoolCard[] {
  return filterPool(pool, { cmc: { mode, value, min, max } });
}

// ============================================================================
// Session Status
// ============================================================================

/**
 * Update session status
 */
export async function updateSessionStatus(
  sessionId: string,
  status: 'in_progress' | 'completed' | 'abandoned'
): Promise<void> {
  const database = getDatabase();
  await database.sessions.update(sessionId, {
    status,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark session as completed
 */
export async function completeSession(sessionId: string): Promise<void> {
  return updateSessionStatus(sessionId, 'completed');
}

/**
 * Mark session as abandoned
 */
export async function abandonSession(sessionId: string): Promise<void> {
  return updateSessionStatus(sessionId, 'abandoned');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get cards not yet in deck (remaining pool)
 */
export function getPoolRemaining(
  session: LimitedSession
): PoolCard[] {
  const deckCardIds = new Set(session.deck.map((d) => d.card.id));
  return session.pool.filter((p) => !deckCardIds.has(p.id));
}

/**
 * Count cards by rarity in pool
 */
export function countPoolByRarity(
  pool: PoolCard[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const card of pool) {
    const rarity = card.rarity || 'unknown';
    counts[rarity] = (counts[rarity] || 0) + 1;
  }

  return counts;
}

/**
 * Count cards by color in pool
 */
export function countPoolByColor(pool: PoolCard[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const card of pool) {
    if (card.colors.length === 0) {
      counts['colorless'] = (counts['colorless'] || 0) + 1;
    } else {
      for (const color of card.colors) {
        counts[color] = (counts[color] || 0) + 1;
      }
    }
  }

  return counts;
}

// ============================================================================
// Exports
// ============================================================================

export { LimitedDatabase };
