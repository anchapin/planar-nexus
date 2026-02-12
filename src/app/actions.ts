
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
  const lines = decklist.split('\n');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const cardRequests: { name: string; count: number }[] = [];
  const unprocessedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Match count (e.g. "2", "2x", "2 x") and the rest of the line as the name
    const match = trimmedLine.match(/^(?:(\d+)\s*x?\s*)?(.*)/);
    
    if (match && match[2]) {
      const name = match[2].trim();
      if (name) {
        const count = parseInt(match[1] || '1', 10);
        cardRequests.push({ name, count });
      } else {
        // Line was just a number or whitespace
        unprocessedLines.push(trimmedLine);
      }
    } else {
      // Should not happen with the regex, but as a fallback
      unprocessedLines.push(trimmedLine);
    }
  }

  if (cardRequests.length === 0) {
    return { found: [], notFound: unprocessedLines, illegal: [] };
  }
  
  // Group requests for the same card name (case-insensitive) and sum their counts
  const nameToCountMap = new Map<string, number>();
  cardRequests.forEach(req => {
      const lowerCaseName = req.name.toLowerCase();
      nameToCountMap.set(lowerCaseName, (nameToCountMap.get(lowerCaseName) || 0) + req.count);
  });
  
  const uniqueNames = Array.from(nameToCountMap.keys());
  const identifiers = uniqueNames.map(name => ({ name }));

  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
      next: { revalidate: 3600 }
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ details: { not_found: [] }}));
        console.error(`Scryfall API error: ${res.status} ${res.statusText}`, errorData);
        const notFoundFromApi = (errorData?.details?.not_found || []).map((item: any) => item?.name).filter(Boolean);
        const allNotFound = uniqueNames.filter(name => notFoundFromApi.some((nf: string) => nf.toLowerCase() === name));
        return { found: [], notFound: [...unprocessedLines, ...allNotFound], illegal: [] };
    }

    const result = await res.json();
    
    // Get the list of names that Scryfall explicitly said it couldn't find
    const notFoundNames: string[] = (result.not_found || []).map((item: any) => item?.name?.toLowerCase()).filter(Boolean);
    
    const allFoundScryfallCards: ScryfallCard[] = (result.data || []).filter(
      (card: ScryfallCard | null): card is ScryfallCard => card !== null && typeof card.name === 'string'
    );

    const legalCards: DeckCard[] = [];
    const illegalCardNames: string[] = [];

    // Create a copy of the map to track which cards we've found.
    const requestedCards = new Map(nameToCountMap);

    allFoundScryfallCards.forEach((card: ScryfallCard) => {
        const lowerCaseName = card.name.toLowerCase();
        
        // Find the matching request. Scryfall may fuzzy match, so we check if our map has it.
        // We find the original key to preserve casing for user display if needed, but match case-insensitively.
        const originalRequestKey = Array.from(requestedCards.keys()).find(k => k === lowerCaseName);

        if (originalRequestKey) {
            const isLegal = format ? card.legalities?.[format] === 'legal' : true;
            const count = requestedCards.get(originalRequestKey)!;

            if (isLegal) {
                legalCards.push({ ...card, count });
            } else {
                illegalCardNames.push(card.name);
            }
            // Remove from map to mark it as found.
            requestedCards.delete(originalRequestKey);
        }
    });
    
    // Any names left in the map were requested but not returned in the Scryfall 'data' field.
    const remainingNotFound = Array.from(requestedCards.keys());

    return { found: legalCards, notFound: [...unprocessedLines, ...notFoundNames, ...remainingNotFound], illegal: illegalCardNames };

  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    return { found: [], notFound: [...unprocessedLines, ...uniqueNames], illegal: [] };
  }
}
