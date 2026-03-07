/**
 * @fileOverview Server-side card operations
 *
 * These functions work in Node.js server environment for AI flows.
 * They use embedded card data and do not require IndexedDB.
 */

import {
  type MinimalCard,
  type GenericCard,
  isGenericCard,
  isMinimalCard,
  getCardByName,
  initializeCardDatabase
} from './card-database';

// Local type for database card (union of GenericCard and MinimalCard)
type DatabaseCard = GenericCard | MinimalCard;
import { type Format } from '@/lib/game-rules';
import { sanitizeCardInput, aggregateCardsById } from './decklist-utils';

// Type definitions for card operations (server-side compatibility)
export type ScryfallCard = MinimalCard;

// Server-side DeckCard type with count property
export interface DeckCard extends ScryfallCard {
  count: number;
}

/**
 * Initialize server-side card operations with embedded data
 */
async function initializeServerCardOperations(): Promise<void> {
  try {
    await initializeCardDatabase();
  } catch (error) {
    console.error('Failed to initialize server-side card operations:', error);
    throw error;
  }
}

/**
 * Validate card legality using embedded card data
 * This works in server-side Node.js environment
 */
export async function validateCardLegality(
  cards: { name: string; quantity: number }[],
  format: Format
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  await initializeServerCardOperations();

  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const { cardMap, malformedInputs } = sanitizeCardInput(cards);

  if (cardMap.size === 0) {
    return { found: [], notFound: malformedInputs, illegal: [] };
  }

  // Find cards in embedded data
  const found: DeckCard[] = [];
  const illegal: string[] = [];
  const notFoundNames = new Set<string>();

  for (const [lowerCaseName, requestDetails] of cardMap.entries()) {
    const cardInDb = getCardByName(requestDetails.originalName);

    if (cardInDb) {
      // Check card legality based on format
      let isLegal = false;
      if (isGenericCard(cardInDb)) {
        // Generic cards have specific legalities object
        const legalities = cardInDb.legalities as Record<string, 'legal' | 'banned' | 'restricted'>;
        isLegal = legalities[format] === 'legal';
      } else if (isMinimalCard(cardInDb)) {
        // Minimal cards also have legalities
        const legalities = cardInDb.legalities as Record<string, 'legal' | 'banned' | 'restricted'>;
        isLegal = legalities[format] === 'legal';
      }

      if (isLegal) {
        found.push({ ...cardInDb, count: requestDetails.quantity } as DeckCard);
      } else {
        illegal.push(requestDetails.originalName);
      }
    } else {
      notFoundNames.add(requestDetails.originalName);
    }
  }

  const notFound = Array.from(notFoundNames);

  return { found, notFound: [...notFound, ...malformedInputs], illegal };
}

/**
 * Import a decklist (server-side)
 */
export async function importDecklist(
  decklist: string,
  format?: Format
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const cardDetails: { name: string; quantity: number }[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.+)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      if (name && !/^\/\//.test(name) && name.toLowerCase() !== 'sideboard') {
        cardDetails.push({ name, quantity: count });
      }
    }
  }

  if (cardDetails.length === 0) {
    return { found: [], notFound: lines, illegal: [] };
  }

  const { found, notFound, illegal } = await validateCardLegality(cardDetails, format || 'commander');

  // Aggregate found cards by their ID to combine different prints of same card
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