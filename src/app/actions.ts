
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

  const nameToCountMap = new Map<string, number>();
  const unprocessedLines: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.*)/);
    if (match && match[2]) {
      const name = match[2].trim();
      if (name) {
        const lowerCaseName = name.toLowerCase();
        const count = parseInt(match[1] || '1', 10);
        nameToCountMap.set(lowerCaseName, (nameToCountMap.get(lowerCaseName) || 0) + count);
      } else {
        unprocessedLines.push(line);
      }
    } else {
      unprocessedLines.push(line);
    }
  }

  const uniqueNames = Array.from(nameToCountMap.keys());
  if (uniqueNames.length === 0) {
    return { found: [], notFound: unprocessedLines, illegal: [] };
  }

  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: uniqueNames.map(name => ({ name })) }),
      next: { revalidate: 3600 },
    });

    const result = await res.json();

    if (!res.ok) {
      console.error(`Scryfall API error: ${res.status}`, result);
      const apiNotFoundNames = (result?.not_found || []).map((item: any) => item?.name).filter(Boolean);
      return { found: [], notFound: [...unprocessedLines, ...apiNotFoundNames], illegal: [] };
    }
    
    const foundCards: DeckCard[] = [];
    const illegalCardNames: string[] = [];
    const processedLowerNames = new Set<string>();

    if (result.data && Array.isArray(result.data)) {
      result.data.forEach((card: ScryfallCard) => {
        if (!card || !card.name) return;

        const lowerCaseName = card.name.toLowerCase();
        processedLowerNames.add(lowerCaseName);

        if (nameToCountMap.has(lowerCaseName)) {
          const count = nameToCountMap.get(lowerCaseName)!;
          const isLegal = format ? card.legalities?.[format] === 'legal' : true;

          if (isLegal) {
            foundCards.push({ ...card, count });
          } else {
            illegalCardNames.push(card.name);
          }
        }
      });
    }

    const apiNotFoundNames = (result.not_found || [])
      .map((item: any) => item?.name)
      .filter(Boolean);

    const requestedButNotReturned = uniqueNames.filter(name => !processedLowerNames.has(name) && !apiNotFoundNames.some((nf: string) => nf.toLowerCase() === name));

    return {
      found: foundCards,
      notFound: [...unprocessedLines, ...apiNotFoundNames, ...requestedButNotReturned],
      illegal: illegalCardNames,
    };

  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    return { found: [], notFound: [...unprocessedLines, ...uniqueNames], illegal: [] };
  }
}
