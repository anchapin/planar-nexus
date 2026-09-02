import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import {
  generateAIOpponentDeck,
  AIOpponentDeckGenerationInput,
} from "@/ai/flows/ai-opponent-deck-generation";

/**
 * @fileOverview Client-side wrappers around the AI flows.
 *
 * Formerly `src/app/actions.ts`, which was misnamed — it never was a
 * Next.js Server Actions file (no `"use server"` directive) and sat under
 * `src/app/` only to confuse readers. Renamed and relocated in issue
 * #1592. The canonical card-shape types (`ScryfallCard`, `DeckCard`,
 * `SavedDeck`) live in `@/lib/card-database` — do not re-colocate them
 * here.
 */

/**
 * Client-side function for AI deck review
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
 * Client-side function for AI opponent generation
 */
export async function generateOpponent(input: AIOpponentDeckGenerationInput) {
  try {
    const opponent = await generateAIOpponentDeck(input);
    return opponent;
  } catch (error) {
    console.error("Error generating AI opponent:", error);
    throw new Error("Failed to generate AI opponent.");
  }
}
