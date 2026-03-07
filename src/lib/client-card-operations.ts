/**
 * @fileOverview Client-side card operations
 *
 * These functions work in the browser without server actions.
 * Use these when running in static export mode (Tauri/PWA).
 * All operations use the local IndexedDB card database for offline functionality.
 */

import type { ScryfallCard, DeckCard } from '@/app/actions';
import { initializeCardDatabase, searchCardsOffline, getCardByName } from '@/lib/card-database';

/**
 * Search for cards using local IndexedDB database with fuzzy search
 * This provides instant results and works offline
 */
export async function searchCardsClient(query: string, format?: string): Promise<ScryfallCard[]> {
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

/**
 * Import a decklist (client-side)
 */
export async function importDecklistClient(
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

  const { found, notFound, illegal } = await validateCardLegalityClient(cardDetails, format || 'commander');

  // Aggregate found cards by their Scryfall ID to combine different prints of the same card.
  const aggregatedFound = Array.from(
    found.reduce((acc, card) => {
      const existing = acc.get(card.id);
      if (existing) {
        existing.count += card.count;
      } else {
        acc.set(card.id, { ...card });
      }
      return acc;
    }, new Map<string, DeckCard>()).values()
  );

  return { found: aggregatedFound, notFound, illegal };
}
