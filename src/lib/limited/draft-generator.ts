/**
 * Draft Generator
 *
 * Creates draft sessions with face-down packs for drafting.
 * DRFT-01: Session creation with unique UUID
 * DRFT-02: 3 packs of 14 cards each
 * DRFT-03: Pack cards face-down until user opens pack
 * DRFT-06: Default 45-second timer
 *
 * Reuses generatePack() from sealed-generator for authentic card distribution.
 */

import type { ScryfallCard } from '@/app/actions';
import { generatePack } from './sealed-generator';
import type {
  DraftSession,
  DraftPack,
  DraftCard,
  PoolCard,
  AiDifficulty,
  AiNeighbor,
} from './types';
import { saveDraftSession } from './pool-storage';

// Re-export types for convenience
export type { DraftSession, DraftPack, DraftCard };

// ============================================================================
// Constants
// ============================================================================

/** Draft packs per session */
const PACKS_PER_DRAFT = 3;

/** Cards per pack */
const CARDS_PER_PACK = 14;

/** Default timer in seconds */
const DEFAULT_TIMER_SECONDS = 45;

// ============================================================================
// Types
// ============================================================================

/**
 * Pack contents from generatePack (same format as sealed)
 */
interface PackContents {
  commons: ScryfallCard[];
  uncommons: ScryfallCard[];
  rareOrMythic: ScryfallCard;
}

// ============================================================================
// Shuffle Helper
// ============================================================================

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
// Card Conversion
// ============================================================================

/**
 * Convert ScryfallCard[] to DraftCard[]
 *
 * DRFT-02: 14 cards per pack
 *
 * @param cards - Raw cards from generatePack
 * @param packIndex - Pack number (0-2)
 * @returns DraftCard[] with metadata
 */
export function packToDraftCards(
  cards: ScryfallCard[],
  packIndex: number
): DraftCard[] {
  const now = new Date().toISOString();

  return cards.map((card, slot): DraftCard => {
    // Cast ScryfallCard to PoolCard fields, then to DraftCard
    const poolCard: PoolCard = {
      ...card,
      packId: packIndex,
      packSlot: slot,
      addedAt: now,
    };

    // DraftCard extends PoolCard
    return poolCard as DraftCard;
  });
}

/**
 * Alias for compatibility with sealed-generator pattern
 * packToPoolCards converts to PoolCard, this converts to DraftCard
 */
export { packToDraftCards as packToPoolCards };

// ============================================================================
// Pack Generation
// ============================================================================

/**
 * Generate draft pack (same distribution as sealed)
 *
 * @param setCode - Set code
 * @returns Cards for one pack
 */
async function generateDraftPackCards(
  setCode: string
): Promise<ScryfallCard[]> {
  const packContents = await generatePack(setCode);
  return packContentsToCards(packContents);
}

/**
 * Convert pack contents to flat card array
 */
function packContentsToCards(packContents: PackContents): ScryfallCard[] {
  return [
    ...packContents.commons,
    ...packContents.uncommons,
    packContents.rareOrMythic,
  ];
}

// ============================================================================
// Draft Pack Operations
// ============================================================================

/**
 * Open a pack - reveals cards to user
 *
 * DRFT-03: Cards are face-down until user opens pack
 *
 * @param pack - The pack to open
 * @returns Updated pack with isOpened: true
 */
export function openPack(pack: DraftPack): DraftPack {
  return {
    ...pack,
    isOpened: true,
  };
}

// ============================================================================
// Session Creation
// ============================================================================

/**
 * Generate all 3 draft packs for a session
 *
 * DRFT-02: 3 packs of 14 cards each
 *
 * @param setCode - Set code
 * @returns Array of 3 DraftPacks
 */
export async function generateDraftPacks(
  setCode: string
): Promise<DraftPack[]> {
  const packs: DraftPack[] = [];

  for (let i = 0; i < PACKS_PER_DRAFT; i++) {
    // Generate pack cards
    const packCards = await generateDraftPackCards(setCode);

    // Convert to DraftCards
    const draftCards = packToDraftCards(packCards, i);

    // Create DraftPack
    packs.push({
      id: crypto.randomUUID(),
      cards: draftCards,
      isOpened: false, // DRFT-03: Face-down by default
      pickedCardIds: [],
    });
  }

  return packs;
}

/**
 * Create draft session options
 * NEIB-01: AI neighbor configuration
 */
interface CreateDraftSessionOptions {
  /** AI neighbor configuration */
  aiNeighbor?: {
    enabled: boolean;
    difficulty: AiDifficulty;
    pickDelay?: number;
  };
}

/**
 * Create a new draft session
 *
 * DRFT-01: Session creation with unique UUID
 * DRFT-02: 3 packs of 14 cards
 * DRFT-03: Packs face-down
 * DRFT-06: 45-second timer
 * DRFT-10: Persists to IndexedDB immediately
 * NEIB-01: AI neighbor support
 *
 * @param setCode - Set code (e.g., 'M21')
 * @param setName - Human-readable set name
 * @param options - Optional configuration including AI neighbor
 * @returns Complete draft session (saved to IndexedDB)
 */
export async function createDraftSession(
  setCode: string,
  setName: string,
  options?: CreateDraftSessionOptions
): Promise<DraftSession> {
  // Generate packs
  const packs = await generateDraftPacks(setCode);

  const now = new Date().toISOString();

  // Build AI neighbor if enabled (NEIB-01)
  const aiNeighbor: AiNeighbor | undefined = options?.aiNeighbor?.enabled
    ? {
        enabled: true,
        difficulty: options.aiNeighbor.difficulty,
        pickDelay: options.aiNeighbor.pickDelay ?? 2000,
        state: {
          pool: [],
          isPicking: false,
          pickStartTime: null,
        },
      }
    : undefined;

  const session: DraftSession = {
    // From LimitedSession
    id: crypto.randomUUID(), // DRFT-01
    setCode,
    setName,
    mode: 'draft',
    status: 'in_progress',
    pool: [],
    deck: [],
    createdAt: now,
    updatedAt: now,

    // Draft-specific fields
    draftState: 'intro', // DRFT-04: Start with intro
    currentPackIndex: 0, // First pack
    currentPickIndex: 0, // First pick
    packs,
    timerSeconds: DEFAULT_TIMER_SECONDS, // DRFT-06
    lastHoveredCardId: null, // DRFT-08

    // AI neighbor (NEIB-01)
    aiNeighbor,
    // Pack holder - user starts with pack (NEIB-05)
    currentPackHolder: 'user',
  };

  // DRFT-10: Save to IndexedDB immediately
  await saveDraftSession(session);

  return session;
}

// ============================================================================
// State Helpers
// ============================================================================

/**
 * Check if draft is complete
 *
 * Complete when: all 3 packs finished (pack 2, pick 13 = last card)
 * OR total picked cards = 42 (3 packs × 14 cards)
 *
 * @param session - Current draft session
 * @returns true if draft is complete
 */
export function isDraftComplete(session: DraftSession): boolean {
  // All packs complete
  const allPacksComplete =
    session.currentPackIndex === PACKS_PER_DRAFT - 1 &&
    session.currentPickIndex === CARDS_PER_PACK - 1;

  // Total cards picked = 42
  const totalPicked = session.pool.length;
  const allCardsPicked = totalPicked === PACKS_PER_DRAFT * CARDS_PER_PACK;

  return allPacksComplete || allCardsPicked;
}

// ============================================================================
// Pack Passing (NEIB-05)
// ============================================================================

/**
 * Pass pack from current holder to the other player
 * In draft: pack passes left, then right, alternating
 */
export function passPack(session: DraftSession): DraftSession {
  const newHolder: 'user' | 'ai' = session.currentPackHolder === 'user' ? 'ai' : 'user';

  return {
    ...session,
    currentPackHolder: newHolder,
  };
}

/**
 * Check if it's the AI's turn to pick
 */
export function isAiPickTurn(session: DraftSession): boolean {
  return Boolean(session.aiNeighbor?.enabled && session.currentPackHolder === 'ai');
}

/**
 * Check if it's the user's turn to pick
 */
export function isUserPickTurn(session: DraftSession): boolean {
  // User picks when AI is disabled OR when pack holder is user
  return !session.aiNeighbor?.enabled || session.currentPackHolder === 'user';
}

/**
 * Get the next pack holder after a pick
 * Handles pack rotation direction changes per round
 */
export function getNextPackHolder(
  currentHolder: 'user' | 'ai',
  pickIndex: number,  // 0-13
  aiEnabled: boolean
): 'user' | 'ai' {
  if (!aiEnabled) return 'user';

  // For 2-player: user picks, passes to AI, AI picks, passes back
  return currentHolder === 'user' ? 'ai' : 'user';
}

// ============================================================================
// Exports
// ============================================================================

export {
  PACKS_PER_DRAFT,
  CARDS_PER_PACK,
  DEFAULT_TIMER_SECONDS,
};
