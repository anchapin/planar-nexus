
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
): Promise<{ found: DeckCard[]; notFound: string[], illegal: string[] }> {
  const lines = decklist.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const cardRequests: { name: string; count: number }[] = lines.map((line) => {
    // Regex to capture count (optional) and card name, ignoring set codes and collector numbers
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?([^()]+)/);
    if (match) {
      const count = parseInt(match[1] || '1', 10);
      const name = match[2].trim();
      return { name, count };
    }
    // Fallback for lines that don't match, e.g., just card name
    return { name: line.trim(), count: 1 };
  });

  const uniqueNames = [...new Set(cardRequests.map(c => c.name))].filter(Boolean);
  const identifiers = uniqueNames.map(name => ({name}));

  if (identifiers.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }
  
  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifiers }),
      // To avoid rate limits on Scryfall
      next: { revalidate: 3600 }
    });

    if (!res.ok) {
      console.error(`Scryfall API error: ${res.status} ${res.statusText}`);
      const errorData = await res.json();
      console.error("Scryfall error details:", errorData);
      // Defensively map and filter in case of malformed error response
      const notFound = errorData?.details?.not_found?.map((item: any) => item?.name).filter(Boolean) || uniqueNames;
      return { found: [], notFound, illegal: [] };
    }

    const result = await res.json();
    
    // Defensively map and filter `not_found` array
    const notFoundNames: string[] = (result.not_found || []).map((item: any) => item?.name).filter(Boolean);
    
    const nameToCountMap = new Map<string, number>();
    for (const req of cardRequests) {
      if (req.name) {
        const lowerCaseName = req.name.toLowerCase();
        nameToCountMap.set(lowerCaseName, (nameToCountMap.get(lowerCaseName) || 0) + req.count);
      }
    }
    
    // Defensively filter `data` array for null/undefined entries or objects without a name.
    const allFoundScryfallCards: ScryfallCard[] = (result.data || []).filter(
      (card: ScryfallCard | null): card is ScryfallCard => card !== null && typeof card.name === 'string'
    );

    const legalCards: DeckCard[] = [];
    const illegalCardNames: string[] = [];

    allFoundScryfallCards.forEach((card: ScryfallCard) => {
        // card and card.name are now guaranteed to exist due to the filter above.
        const isLegal = format ? card.legalities?.[format] === 'legal' : true;
        const count = nameToCountMap.get(card.name.toLowerCase());

        if (count) {
          if (isLegal) {
            legalCards.push({ ...card, count });
          } else {
            illegalCardNames.push(card.name);
          }
        }
    });
    
    return { found: legalCards, notFound: notFoundNames, illegal: illegalCardNames };

  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    return { found: [], notFound: uniqueNames, illegal: [] };
  }
}
