
import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import { generateAIOpponentDeck, AIOpponentDeckGenerationInput } from "@/ai/flows/ai-opponent-deck-generation";
import {
  MinimalCard,
  GenericCard,
  GenericDeckCard,
  GenericSavedDeck,
  searchCardsOffline,
  getCardByName,
  getCardById,
  isCardLegal,
  initializeCardDatabase,
  isGenericCard,
  isMinimalCard,
  minimalCardToGenericCard,
  genericCardToMinimalCard
} from "@/lib/card-database";

// ============================================================================
// UNIFIED CARD TYPES (Unit 2: Original Card Data Schema)
// ============================================================================

/**
 * Unified card type that can represent either a Scryfall card or a Generic card
 * This allows the system to work with both legacy and new card formats
 */
export type UnifiedCard = ScryfallCard | GenericCard;

/**
 * Unified deck card type with quantity
 */
export type UnifiedDeckCard = DeckCard | GenericDeckCard;

/**
 * Unified saved deck type
 */
export type UnifiedSavedDeck = SavedDeck | GenericSavedDeck;

// ============================================================================
// LEGACY SCRYFALL TYPES
// ============================================================================

export interface ScryfallCard extends MinimalCard {
  power?: string;
  toughness?: string;
  keywords?: string[];
  // Whether this is a double-faced card
  faces?: number;
}

export interface DeckCard extends ScryfallCard {
  count: number;
}

export interface SavedDeck {
  id: string;
  name:string;
  format: string;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a unified card is a GenericCard
 */
export function isGenericCardType(card: UnifiedCard): card is GenericCard {
  return isGenericCard(card);
}

/**
 * Type guard to check if a unified card is a ScryfallCard
 */
export function isScryfallCard(card: UnifiedCard): card is ScryfallCard {
  return isMinimalCard(card);
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a Scryfall card to a Generic card
 * This removes MTG-specific terminology while preserving mechanics
 */
export function scryfallToGenericCard(scryfallCard: ScryfallCard): GenericCard {
  return minimalCardToGenericCard(scryfallCard);
}

/**
 * Convert a Generic card to a Scryfall card
 * This allows generic cards to be used with legacy code
 */
export function genericToScryfallCard(genericCard: GenericCard): ScryfallCard {
  return genericCardToMinimalCard(genericCard) as ScryfallCard;
}

/**
 * Convert a unified card to a GenericCard
 * If the card is already generic, returns it as-is. If it's a Scryfall card, converts it.
 */
export function toGenericCard(card: UnifiedCard): GenericCard {
  if (isGenericCardType(card)) {
    return card;
  }
  return scryfallToGenericCard(card);
}

/**
 * Convert a unified card to a ScryfallCard
 * If the card is already a Scryfall card, returns it as-is. If it's generic, converts it.
 */
export function toScryfallCard(card: UnifiedCard): ScryfallCard {
  if (isScryfallCard(card)) {
    return card;
  }
  return genericToScryfallCard(card);
}


/**
 * Search for cards using local IndexedDB database with fuzzy search
 * This provides instant results and works offline
 */
export async function searchScryfall(query: string): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    // Perform fuzzy search
    const results = await searchCardsOffline(query, {
      maxCards: 50,
      includeImages: true,
    });

    return results as ScryfallCard[];
  } catch (error) {
    console.error("Failed to search local card database", error);
    return [];
  }
}

/**
 * Search for cards in a specific format
 * @param query Search query
 * @param format Magic format (e.g., "commander", "modern", "standard")
 */
export async function searchCards(query: string, format: string = "commander"): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    // Perform fuzzy search with format filter
    const results = await searchCardsOffline(query, {
      maxCards: 50,
      format,
      includeImages: true,
    });

    return results as ScryfallCard[];
  } catch (error) {
    console.error("Failed to search local card database", error);
    return [];
  }
}

export async function getDeckReview(input: DeckReviewInput) {
  try {
    const review = await reviewDeck(input);
    return review;
  } catch (error) {
    console.error("Error getting deck review:", error);
    if (error instanceof Error) {
        throw new Error(error.message);
    }
    throw new Error("Failed to get deck review from AI.");
  }
}

export async function generateOpponent(input: AIOpponentDeckGenerationInput) {
    try {
        const opponent = await generateAIOpponentDeck(input);
        return opponent;
    } catch(error) {
        console.error("Error generating AI opponent:", error);
        throw new Error("Failed to generate AI opponent.");
    }
}

/**
 * Validate card legality using local IndexedDB database
 * This works offline and provides instant results
 */
export async function validateCardLegality(
  cards: { name: string; quantity: number }[],
  format: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    // 1. Sanitize and aggregate input
    const cardRequestMap = new Map<string, { originalName: string; quantity: number }>();
    const malformedInputs: string[] = [];

    for (const card of cards) {
      if (!card || typeof card.name !== 'string' || card.name.trim() === '' || typeof card.quantity !== 'number' || card.quantity <= 0) {
        malformedInputs.push(card?.name || 'Malformed Input');
        continue;
      }
      const lowerCaseName = card.name.toLowerCase();
      const existing = cardRequestMap.get(lowerCaseName);
      if (existing) {
        existing.quantity += card.quantity;
      } else {
        cardRequestMap.set(lowerCaseName, { originalName: card.name, quantity: card.quantity });
      }
    }

    if (cardRequestMap.size === 0) {
      return { found: [], notFound: malformedInputs, illegal: [] };
    }

    // 2. Fetch from local database
    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set(cardRequestMap.keys());

    // Process each card request
    for (const [lowerCaseName, requestDetails] of cardRequestMap.entries()) {
      try {
        const dbCard = await getCardByName(requestDetails.originalName);

        if (dbCard) {
          notFoundNames.delete(lowerCaseName);
          const isLegal = dbCard.legalities?.[format] === 'legal';
          if (isLegal) {
            found.push({ ...dbCard, count: requestDetails.quantity } as DeckCard);
          } else {
            illegal.push(requestDetails.originalName);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch card: ${requestDetails.originalName}`, error);
      }
    }

    const notFound = Array.from(notFoundNames).map(name => cardRequestMap.get(name)!.originalName);

    return { found, notFound: [...notFound, ...malformedInputs], illegal };
  } catch (error) {
    console.error('Failed to validate card legality from local database', error);
    return { found: [], notFound: cards.map(c => c.name), illegal: [] };
  }
}

export async function importDecklist(
  decklist: string,
  format?: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const cardDetails: { name: string; quantity: number }[] = [];
  
  for (const line of lines) {
    // Improved regex to better handle various decklist formats
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.+)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      // Ensure name is not just tokens like "Sideboard"
      if (name && !/^\/\//.test(name) && name.toLowerCase() !== 'sideboard') {
        cardDetails.push({ name, quantity: count });
      }
    }
  }

  if (cardDetails.length === 0) {
    // If no parsable card lines were found, return all original lines as "not found"
    return { found: [], notFound: lines, illegal: [] };
  }
  
  // `validateCardLegality` is now the single source of truth for validation.
  const { found, notFound, illegal } = await validateCardLegality(cardDetails, format || 'commander');

  // Aggregate found cards by their Scryfall ID to combine different prints of the same card.
  const aggregatedFound = Array.from(
      found.reduce((acc, card) => {
        const existing = acc.get(card.id);
        if(existing) {
            existing.count += card.count;
        } else {
            acc.set(card.id, {...card});
        }
        return acc;
      }, new Map<string, DeckCard>()).values()
  );

  return { found: aggregatedFound, notFound, illegal };
}
