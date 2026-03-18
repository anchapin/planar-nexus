/**
 * Sealed Pool Generator
 *
 * Generates sealed pools with authentic Magic: The Gathering rarity distribution.
 * SEAL-01: Session creation with selected set
 * SEAL-02: 6 packs × 14 cards = 84 cards total, all revealed immediately
 *
 * Uses the card database to fetch cards by set and rarity.
 * Weighted random selection for rare/mythic slot (~1:8 mythic ratio).
 */

import type { MinimalCard } from '@/lib/card-database';
import { getAllCards, initializeCardDatabase } from '@/lib/card-database';
import type { PoolCard, LimitedSession, LimitedMode } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Standard booster pack: 14 cards */
const CARDS_PER_PACK = 14;

/** Commons per pack */
const COMMONS_PER_PACK = 10;

/** Uncommons per pack */
const UNCOMMONS_PER_PACK = 3;

/** Rare/mythic per pack */
const RARES_PER_PACK = 1;

/** Sealed packs per session */
const PACKS_PER_SEALED = 6;

/** Mythic ratio (~1 in 8 packs) */
const MYTHIC_RATIO = 1 / 8;

// ============================================================================
// Types
// ============================================================================

/**
 * Rarity distribution in a pack
 */
interface PackContents {
  commons: MinimalCard[];
  uncommons: MinimalCard[];
  rareOrMythic: MinimalCard;
}

/**
 * Pool generation result
 */
interface PoolGenerationResult {
  pool: PoolCard[];
  packContents: PackContents[];
}

// ============================================================================
// Cached Data
// ============================================================================

/** Cache for cards by set and rarity */
const cardCache = new Map<string, Map<string, MinimalCard[]>>();

/**
 * Clear the card cache (useful for testing)
 */
export function clearCardCache(): void {
  cardCache.clear();
}

// ============================================================================
// Card Retrieval
// ============================================================================

/**
 * Get cards by set and rarity from the card database
 * Results are cached per set for performance
 */
async function getCardsBySetAndRarity(
  setCode: string,
  rarity: string
): Promise<MinimalCard[]> {
  // Initialize cache for this set if needed
  if (!cardCache.has(setCode)) {
    cardCache.set(setCode, new Map());
  }

  const setCache = cardCache.get(setCode)!;

  // Return cached results if available
  if (setCache.has(rarity)) {
    return setCache.get(rarity)!;
  }

  // Initialize database if needed
  await initializeCardDatabase();

  // Get all cards and filter by set and rarity
  const allCards = await getAllCards();
  const filteredCards = allCards.filter(
    (card) =>
      card.set?.toLowerCase() === setCode.toLowerCase() &&
      card.rarity?.toLowerCase() === rarity.toLowerCase()
  );

  // Cache and return
  setCache.set(rarity, filteredCards);
  return filteredCards;
}

/**
 * Weighted random selection from an array
 */
function weightedRandom<T>(items: T[]): T {
  if (items.length === 0) {
    throw new Error('Cannot select from empty array');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

/**
 * Shuffle an array in place (Fisher-Yates)
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Pack Generation
// ============================================================================

/**
 * Generate a single booster pack
 *
 * Standard distribution:
 * - 10 commons
 * - 3 uncommons
 * - 1 rare or mythic (~1:8 ratio)
 */
export async function generatePack(setCode: string): Promise<PackContents> {
  // Get cards by rarity
  const commons = await getCardsBySetAndRarity(setCode, 'common');
  const uncommons = await getCardsBySetAndRarity(setCode, 'uncommon');
  const rares = await getCardsBySetAndRarity(setCode, 'rare');
  const mythics = await getCardsBySetAndRarity(setCode, 'mythic');

  // Validate we have enough cards
  if (commons.length < COMMONS_PER_PACK) {
    throw new Error(
      `Not enough commons in set ${setCode}: need ${COMMONS_PER_PACK}, have ${commons.length}`
    );
  }

  if (uncommons.length < UNCOMMONS_PER_PACK) {
    throw new Error(
      `Not enough uncommons in set ${setCode}: need ${UNCOMMONS_PER_PACK}, have ${uncommons.length}`
    );
  }

  // Select commons (10 cards)
  const shuffledCommons = shuffle(commons);
  const selectedCommons = shuffledCommons.slice(0, COMMONS_PER_PACK);

  // Select uncommons (3 cards)
  const shuffledUncommons = shuffle(uncommons);
  const selectedUncommons = shuffledUncommons.slice(0, UNCOMMONS_PER_PACK);

  // Select rare or mythic (1 card)
  const isMythic = Math.random() < MYTHIC_RATIO;
  const rarePool = isMythic && mythics.length > 0 ? mythics : rares;

  if (rarePool.length === 0) {
    throw new Error(
      `No ${isMythic ? 'mythics' : 'rares'} available in set ${setCode}`
    );
  }

  const rareOrMythic = weightedRandom(rarePool);

  return {
    commons: selectedCommons,
    uncommons: selectedUncommons,
    rareOrMythic,
  };
}

// ============================================================================
// Pool Generation
// ============================================================================

/**
 * Convert pack contents to pool cards
 */
function packToPoolCards(
  packContents: PackContents,
  packId: number
): PoolCard[] {
  const poolCards: PoolCard[] = [];
  const now = new Date().toISOString();

  // Add commons
  packContents.commons.forEach((card, slot) => {
    poolCards.push({
      ...card,
      packId,
      packSlot: slot,
      addedAt: now,
    });
  });

  // Add uncommons
  packContents.uncommons.forEach((card, slot) => {
    poolCards.push({
      ...card,
      packId,
      packSlot: COMMONS_PER_PACK + slot,
      addedAt: now,
    });
  });

  // Add rare/mythic
  poolCards.push({
    ...packContents.rareOrMythic,
    packId,
    packSlot: COMMONS_PER_PACK + UNCOMMONS_PER_PACK,
    addedAt: now,
  });

  return poolCards;
}

/**
 * Generate a complete sealed pool (6 packs × 14 cards = 84 cards)
 */
export async function generateSealedPool(
  setCode: string
): Promise<PoolCard[]> {
  const packContents: PackContents[] = [];

  // Generate 6 packs
  for (let i = 0; i < PACKS_PER_SEALED; i++) {
    const pack = await generatePack(setCode);
    packContents.push(pack);
  }

  // Convert all packs to pool cards
  const allPoolCards: PoolCard[] = [];
  packContents.forEach((pack, packId) => {
    const poolCards = packToPoolCards(pack, packId);
    allPoolCards.push(...poolCards);
  });

  return allPoolCards;
}

/**
 * Generate pool with detailed pack information
 * Useful for showing pack-by-pack opening experience
 */
export async function generateSealedPoolWithPacks(
  setCode: string
): Promise<PoolGenerationResult> {
  const packContents: PackContents[] = [];

  // Generate 6 packs
  for (let i = 0; i < PACKS_PER_SEALED; i++) {
    const pack = await generatePack(setCode);
    packContents.push(pack);
  }

  // Convert all packs to pool cards
  const pool: PoolCard[] = [];
  packContents.forEach((pack, packId) => {
    const poolCards = packToPoolCards(pack, packId);
    pool.push(...poolCards);
  });

  return { pool, packContents };
}

// ============================================================================
// Session Creation
// ============================================================================

/**
 * Create a new sealed session with pool
 */
export async function createSealedSession(
  setCode: string,
  setName: string
): Promise<LimitedSession> {
  // Generate the pool
  const pool = await generateSealedPool(setCode);

  // Create session
  const session: LimitedSession = {
    id: crypto.randomUUID(),
    setCode,
    setName,
    mode: 'sealed' as LimitedMode,
    status: 'in_progress',
    pool,
    deck: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return session;
}

/**
 * Generate a draft pack (same as sealed pack for now)
 * Phase 15 will add draft-specific logic
 */
export async function generateDraftPack(setCode: string): Promise<PoolCard[]> {
  const pack = await generatePack(setCode);
  return packToPoolCards(pack, 0);
}

// ============================================================================
// Exports
// ============================================================================

export { CARDS_PER_PACK, PACKS_PER_SEALED, COMMONS_PER_PACK, UNCOMMONS_PER_PACK };
