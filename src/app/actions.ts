
"use server";

import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import { generateAIOpponentDeck, AIOpponentDeckGenerationInput } from "@/ai/flows/ai-opponent-deck-generation";

export interface ScryfallCard {
  id: string;
  name: string;
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

export async function importDecklist(
  decklist: string,
  format?: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  // 1. Parse input to get identifiers and counts
  const counts = new Map<string, number>(); // lowercase name -> count
  const identifiersToFetch: { name: string }[] = [];
  const unprocessedLines: string[] = [];

  for (const line of lines) {
    // This regex is safer and ensures the captured name is not empty.
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(\S.*)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      if (name) {
        const lowerCaseName = name.toLowerCase();
        counts.set(lowerCaseName, (counts.get(lowerCaseName) || 0) + count);
      } else {
        unprocessedLines.push(line);
      }
    } else {
      unprocessedLines.push(line);
    }
  }

  for (const name of counts.keys()) {
    // Scryfall fuzzy matches, so we send the original name casing if possible, but map by lowercase.
    // We're just sending the lowercase keys for simplicity here.
    identifiersToFetch.push({ name });
  }

  if (identifiersToFetch.length === 0) {
    return { found: [], notFound: unprocessedLines, illegal: [] };
  }
  
  // 2. Call Scryfall API
  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: identifiersToFetch }),
      next: { revalidate: 3600 * 24 },
    });

    if (!res.ok) {
      console.error(`Scryfall API error: ${res.status}`);
      return { found: [], notFound: Array.from(counts.keys()), illegal: [] };
    }

    const collection = await res.json();
    
    // 3. Process the response robustly
    const found: DeckCard[] = [];
    const illegal: string[] = [];

    // Process found cards from collection.data
    if (collection?.data && Array.isArray(collection.data)) {
        for (const card of collection.data) {
            // SUPER defensive check to prevent crashes from malformed API responses.
            if (!card || typeof card.name !== 'string') continue;
            
            const lowerCaseName = card.name.toLowerCase();
            const count = counts.get(lowerCaseName);
            
            // We only care about cards that match something we actually requested.
            if (count === undefined) continue;

            const isLegal = format ? card.legalities?.[format] === 'legal' : true;
            if (isLegal) {
                found.push({ ...card, count });
            } else {
                illegal.push(card.name);
            }
        }
    }

    // Process not found cards from collection.not_found
    const notFound: string[] = [...unprocessedLines];
    if (collection?.not_found && Array.isArray(collection.not_found)) {
        for (const item of collection.not_found) {
            // SUPER defensive check. The item should be an identifier object, e.g., { name: '...' }
            if (!item || typeof item.name !== 'string') continue;
            notFound.push(item.name);
        }
    }
    
    return { found, notFound, illegal };

  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    // On failure, assume all requested cards were not found.
    return { found: [], notFound: Array.from(counts.keys()), illegal: [] };
  }
}
