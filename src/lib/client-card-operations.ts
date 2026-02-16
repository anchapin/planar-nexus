/**
 * @fileOverview Client-side card operations
 * 
 * These functions work in the browser without server actions.
 * Use these when running in static export mode (Tauri/PWA).
 */

import type { ScryfallCard, DeckCard } from '@/app/actions';

// Scryfall API base URL (can work client-side)
const SCRYFALL_API_BASE = 'https://api.scryfall.com';

/**
 * Search for cards on Scryfall (client-side)
 */
export async function searchCardsClient(query: string): Promise<ScryfallCard[]> {
  if (!query || query.length < 2) {
    return [];
  }

  const searchQuery = `${query} (game:paper)`;

  try {
    const res = await fetch(
      `${SCRYFALL_API_BASE}/cards/search?q=${encodeURIComponent(searchQuery)}`
    );
    if (!res.ok) {
      if (res.status === 404) return [];
      console.error(`Scryfall API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (error) {
    console.error("Failed to fetch from Scryfall API", error);
    return [];
  }
}

/**
 * Fetch a card by name (client-side)
 */
export async function fetchCardByNameClient(name: string): Promise<ScryfallCard | null> {
  try {
    const res = await fetch(
      `${SCRYFALL_API_BASE}/cards/named?exact=${encodeURIComponent(name)}`
    );
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error("Failed to fetch card:", error);
    return null;
  }
}

/**
 * Validate card legality (client-side via Scryfall API)
 */
export async function validateCardLegalityClient(
  cards: { name: string; quantity: number }[],
  format: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  // Sanitize input
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

  // Fetch from Scryfall
  const identifiersToFetch = Array.from(cardRequestMap.values()).map(c => ({ name: c.originalName }));

  try {
    const res = await fetch(`${SCRYFALL_API_BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: identifiersToFetch }),
    });

    if (!res.ok) {
      console.error(`Scryfall API error on collection fetch: ${res.status}`);
      return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
    }

    const collection = await res.json();

    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set(cardRequestMap.keys());

    if (collection?.data && Array.isArray(collection.data)) {
      for (const scryfallCard of collection.data as ScryfallCard[]) {
        if (!scryfallCard || typeof scryfallCard.name !== 'string' || !scryfallCard.name) {
          continue;
        }

        const lowerCaseName = scryfallCard.name.toLowerCase();
        const requestDetails = cardRequestMap.get(lowerCaseName);

        if (requestDetails) {
          notFoundNames.delete(lowerCaseName);
          const isLegal = scryfallCard.legalities?.[format] === 'legal';
          if (isLegal) {
            found.push({ ...scryfallCard, count: requestDetails.quantity });
          } else {
            illegal.push(requestDetails.originalName);
          }
        }
      }
    }

    const notFound = Array.from(notFoundNames).map(name => cardRequestMap.get(name)!.originalName);

    return { found, notFound: [...notFound, ...malformedInputs], illegal };
  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
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

  const { found, notFound, illegal } = await validateCardLegalityClient(cardDetails, format || 'commander');

  // Aggregate found cards by ID
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
