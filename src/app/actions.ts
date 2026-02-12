
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

  // 1. Parse input
  const cardRequests = new Map<string, { originalName: string; count: number }>();
  const unprocessedLines: string[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.+)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      if (name) {
        const lowerCaseName = name.toLowerCase();
        const existing = cardRequests.get(lowerCaseName);
        cardRequests.set(lowerCaseName, {
          originalName: name,
          count: (existing?.count || 0) + count,
        });
      } else {
        unprocessedLines.push(line);
      }
    } else {
      unprocessedLines.push(line);
    }
  }

  const identifiersToFetch = Array.from(cardRequests.keys()).map(name => ({ name }));
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
      return { found: [], notFound: Array.from(cardRequests.values()).map(req => req.originalName), illegal: [] };
    }

    const collection = await res.json();
    
    // 3. Process the response robustly
    const foundCards: DeckCard[] = [];
    const illegalCards: string[] = [];
    const notFoundCards: string[] = [];

    const scryfallFoundMap = new Map<string, ScryfallCard>();
    if (collection.data && Array.isArray(collection.data)) {
        for (const card of collection.data) {
            if (card && card.name) {
                scryfallFoundMap.set(card.name.toLowerCase(), card);
            }
        }
    }

    for (const [lowerCaseName, requestInfo] of cardRequests.entries()) {
        const scryfallCard = scryfallFoundMap.get(lowerCaseName);
        if (scryfallCard) {
            const isLegal = format ? scryfallCard.legalities?.[format] === 'legal' : true;
            if (isLegal) {
                foundCards.push({ ...scryfallCard, count: requestInfo.count });
            } else {
                illegalCards.push(requestInfo.originalName);
            }
        } else {
            notFoundCards.push(requestInfo.originalName);
        }
    }
    
    return {
      found: foundCards,
      notFound: [...notFoundCards, ...unprocessedLines],
      illegal: illegalCards,
    };

  } catch (error) {
    console.error('Failed to fetch from Scryfall API', error);
    return { found: [], notFound: Array.from(cardRequests.values()).map(req => req.originalName), illegal: [] };
  }
}
