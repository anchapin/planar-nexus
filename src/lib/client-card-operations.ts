/**
 * @fileOverview Client-side card operations
 *
 * These functions work in the browser without server actions.
 * Use these when running in static export mode (Tauri/PWA).
 * All operations use the local IndexedDB card database for offline functionality.
 */

import type { ScryfallCard, DeckCard } from '@/app/actions';
import { initializeCardDatabase, searchCardsOffline, getCardByName } from '@/lib/card-database';
import { type Format } from '@/lib/game-rules';
import { sanitizeCardInput, aggregateCardsById, parseDecklist, type DecklistFormat } from './decklist-utils';

/**
 * Search for cards using local IndexedDB database with fuzzy search
 * This provides instant results and works offline
 */
export async function searchCardsClient(query: string, format?: Format): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    // Perform fuzzy search
    const results = await searchCardsOffline(query, {
      maxCards: 50,
      format: format || 'commander',
      includeImages: true,
    });

    return results as ScryfallCard[];
  } catch (error) {
    console.error("Failed to search local card database", error);
    return [];
  }
}

/**
 * Fetch a card by name from local database
 */
export async function fetchCardByNameClient(name: string): Promise<ScryfallCard | null> {
  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    const card = await getCardByName(name);
    return card as ScryfallCard || null;
  } catch (error) {
    console.error("Failed to fetch card from local database:", error);
    return null;
  }
}

/**
 * Validate card legality using local IndexedDB database
 * This works offline and provides instant results
 */
export async function validateCardLegalityClient(
  cards: { name: string; quantity: number }[],
  format: Format
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    const { cardMap, malformedInputs } = sanitizeCardInput(cards);

    if (cardMap.size === 0) {
      return { found: [], notFound: malformedInputs, illegal: [] };
    }

    // Fetch from local database - use Promise.all for parallel processing
    const cardLookupPromises = Array.from(cardMap.entries()).map(async ([lowerCaseName, requestDetails]) => {
      try {
        const dbCard = await getCardByName(requestDetails.originalName);

        if (dbCard) {
          const isLegal = dbCard.legalities?.[format] === 'legal';
          return {
            card: dbCard,
            quantity: requestDetails.quantity,
            originalName: requestDetails.originalName,
            isLegal,
            lowerCaseName,
          };
        }

        return null;
      } catch (error) {
        console.error(`Failed to fetch card: ${requestDetails.originalName}`, error);
        return null;
      }
    });

    const lookupResults = await Promise.all(cardLookupPromises);

    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set<string>(cardMap.keys());

    for (const result of lookupResults) {
      if (!result) continue;

      const { card, quantity, originalName, isLegal, lowerCaseName } = result;

      notFoundNames.delete(lowerCaseName);

      if (isLegal) {
        found.push({ ...card, count: quantity } as DeckCard);
      } else {
        illegal.push(originalName);
      }
    }

    const notFound = Array.from(notFoundNames).map(name => cardMap.get(name)!.originalName);

    return { found, notFound: [...notFound, ...malformedInputs], illegal };
  } catch (error) {
    console.error('Failed to validate card legality from local database', error);
    return { found: [], notFound: cards.map(c => c.name), illegal: [] };
  }
}

/**
 * Import a decklist (client-side)
 */
export async function importDecklistClient(
  decklist: string,
  decklistFormat?: DecklistFormat,
  format?: Format
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  // Parse decklist with format detection
  const cardDetails = parseDecklist(decklist, decklistFormat);
  
  if (cardDetails.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const { found, notFound, illegal } = await validateCardLegalityClient(cardDetails, format || 'commander');

  return { found: aggregateCardsById(found), notFound, illegal };
}