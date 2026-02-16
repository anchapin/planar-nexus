
"use server";

import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import { generateAIOpponentDeck, AIOpponentDeckGenerationInput } from "@/ai/flows/ai-opponent-deck-generation";

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  keywords?: string[];
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  legalities?: { [format: string]: string };
  // Card faces for double-faced/transform cards
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
  // Layout type (normal, transform, modal_dfc, etc.)
  layout?: string;
  // Whether this is a double-faced card
  faces?: number;
}

export interface DeckCard extends ScryfallCard {
  count: number;
};

export interface SavedDeck {
  id: string;
  name:string;
  format: string;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}


export async function searchScryfall(query: string): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  // Add type:commander to narrow down search for commander format relevant cards.
  const searchQuery = `${query} (game:paper)`;

  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
        searchQuery
      )}`
    );
    if (!res.ok) {
      if (res.status === 404) return []; // No cards found is a valid outcome
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

export async function validateCardLegality(
  cards: { name: string; quantity: number }[],
  format: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

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
  
  // 2. Fetch from Scryfall
  const identifiersToFetch = Array.from(cardRequestMap.values()).map(c => ({ name: c.originalName }));

  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: identifiersToFetch }),
      next: { revalidate: 3600 * 24 },
    });

    if (!res.ok) {
      console.error(`Scryfall API error on collection fetch: ${res.status}`);
      return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
    }

    const collection = await res.json();
    
    // 3. Process response
    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set(cardRequestMap.keys());

    if (collection?.data && Array.isArray(collection.data)) {
      for (const scryfallCard of collection.data as ScryfallCard[]) {
        // Super defensive check
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
    console.error('Failed to fetch or process from Scryfall API', error);
    return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
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
