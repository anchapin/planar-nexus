
import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import { generateAIOpponentDeck, AIOpponentDeckGenerationInput } from "@/ai/flows/ai-opponent-deck-generation";
import { MinimalCard } from "@/lib/card-database";
import { type Format } from "@/lib/game-rules";

export interface ScryfallCard extends MinimalCard {
  power?: string;
  toughness?: string;
  keywords?: string[];
  // Whether this is a double-faced card
  faces?: number;
}

export interface DeckCard extends ScryfallCard {
  count: number;
}

export interface SavedDeck {
  id: string;
  name:string;
  format: Format;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Server action for AI deck review
 */
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

/**
 * Server action for AI opponent generation
 */
export async function generateOpponent(input: AIOpponentDeckGenerationInput) {
    try {
        const opponent = await generateAIOpponentDeck(input);
        return opponent;
    } catch(error) {
        console.error("Error generating AI opponent:", error);
        throw new Error("Failed to generate AI opponent.");
    }
}
