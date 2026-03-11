/**
 * @fileOverview Card operations using embedded data
 *
 * These functions work with embedded card data for AI flows.
 * They use embedded card data and work in both server and client environments.
 * Originally designed for server-side but now compatible with client-side execution.
 */

import type { MinimalCard } from './card-database';
import { ESSENTIAL_CARDS } from './card-database';
import { type Format } from '@/lib/game-rules';
import { sanitizeCardInput } from './decklist-utils';

// Type definitions for card operations (server-side compatibility)
export interface ServerDeckCard extends MinimalCard {
  count: number;
}

// In-memory cache for fuzzy search
let isInitialized = false;

/**
 * Initialize server-side card operations with embedded data
 */
async function initializeServerCardOperations(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    isInitialized = true;
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
): Promise<{ found: ServerDeckCard[]; notFound: string[]; illegal: string[] }> {
  await initializeServerCardOperations();

  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const { cardMap, malformedInputs } = sanitizeCardInput(cards);

  if (cardMap.size === 0) {
    return { found: [], notFound: malformedInputs, illegal: [] };
  }

  // Find cards in embedded data
  const found: ServerDeckCard[] = [];
  const illegal: string[] = [];
  const notFoundNames = new Set<string>();

  for (const [lowerCaseName, requestDetails] of cardMap.entries()) {
    const cardInDb = ESSENTIAL_CARDS.find(c => c.name.toLowerCase() === lowerCaseName);

    if (cardInDb) {
      const isLegal = cardInDb.legalities?.[format] === 'legal';
      if (isLegal) {
        found.push({ ...cardInDb, count: requestDetails.quantity } as ServerDeckCard);
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
): Promise<{ found: ServerDeckCard[]; notFound: string[]; illegal: string[] }> {
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
    }, new Map<string, ServerDeckCard>()).values()
  );

  return { found: aggregatedFound, notFound, illegal };
}
