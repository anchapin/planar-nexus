/**
 * @fileOverview Server-side card operations
 *
 * These functions work in Node.js server environment for AI flows.
 * They use embedded card data and do not require IndexedDB.
 */

import Fuse from 'fuse.js';
import type { ScryfallCard, DeckCard } from '@/app/actions';
import { ESSENTIAL_CARDS } from './card-database';

// In-memory cache for fuzzy search
let fuseInstance: Fuse<MinimalCard> | null = null;
let isInitialized = false;

interface MinimalCard {
  id: string;
  oracle_id?: string;
  name: string;
  set?: string;
  collector_number?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  mana_cost?: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
}

/**
 * Initialize server-side card operations with embedded data
 */
async function initializeServerCardOperations(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    // Initialize Fuse.js with embedded card data
    const fuseOptions: Fuse.IFuseOptions<MinimalCard> = {
      keys: [
        { name: 'name', weight: 0.7 },
        { name: 'type_line', weight: 0.2 },
        { name: 'oracle_text', weight: 0.1 },
      ],
      threshold: 0.3,
      distance: 100,
      minMatchCharLength: 2,
      includeScore: true,
    };

    fuseInstance = new Fuse(ESSENTIAL_CARDS, fuseOptions);
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
  format: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  await initializeServerCardOperations();

  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const found: DeckCard[] = [];
  const illegal: string[] = [];
  const notFoundNames = new Set<string>();

  // Create a map of normalized card names to original names
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

  // Find cards in embedded data
  for (const [lowerCaseName, requestDetails] of cardRequestMap.entries()) {
    const cardInDb = ESSENTIAL_CARDS.find(c => c.name.toLowerCase() === lowerCaseName);

    if (cardInDb) {
      const isLegal = cardInDb.legalities?.[format] === 'legal';
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

  const { found, notFound, illegal } = await validateCardLegality(cardDetails, format || 'commander');

  // Aggregate found cards by their ID to combine different prints of the same card
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
