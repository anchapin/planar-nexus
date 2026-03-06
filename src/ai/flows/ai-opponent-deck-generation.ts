'use server';
/**
 * @fileOverview Opponent deck generation using enhanced heuristic algorithms
 *
 * This module has been updated to use client-side heuristic algorithms instead of AI providers.
 * Issue #441: Eliminate AI provider dependencies for opponent generation
 *
 * - generateAIOpponentDeck - A function that generates opponent decks using heuristic algorithms
 * - AIOpponentDeckGenerationInput - The input type for the generateAIOpponentDeck function
 * - AIOpponentDeckGenerationOutput - The return type for the generateAIOpponentDeck function
 */

import { generateOpponentDeck, generateRandomDeck, generateThemedDeck } from '@/lib/opponent-deck-generator';
import type { Format } from '@/lib/game-rules';

// Input Schema - simplified for heuristic generation
interface AIOpponentDeckGenerationInput {
  theme?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  format?: Format;
  colorIdentity?: string[];
}

interface AIOpponentDeckGenerationOutput {
  deckList: string[];
  strategicApproach: string;
}

// Wrapper function - now uses heuristic generation instead of AI
export async function generateAIOpponentDeck(
  input: AIOpponentDeckGenerationInput
): Promise<AIOpponentDeckGenerationOutput> {
  try {
    const { theme, difficulty = 'medium', format = 'commander', colorIdentity } = input;

    // Generate deck using heuristic algorithms
    const generatedDeck = theme
      ? generateThemedDeck(theme as any, format, difficulty as any)
      : generateOpponentDeck({
          format,
          difficulty: difficulty as any,
          colorIdentity: colorIdentity,
        });

    // Convert card objects to string format for backward compatibility
    const deckList = generatedDeck.cards.map((card) => {
      return card.quantity > 1 ? `${card.name} x${card.quantity}` : card.name;
    });

    return {
      deckList,
      strategicApproach: generatedDeck.strategicApproach,
    };
  } catch (error) {
    console.error('Error generating opponent deck:', error);
    throw new Error('Failed to generate opponent deck.');
  }
}

/**
 * Generate random opponent deck
 */
export async function generateRandomOpponent(format: Format = 'commander'): Promise<AIOpponentDeckGenerationOutput> {
  try {
    const generatedDeck = generateRandomDeck(format);

    const deckList = generatedDeck.cards.map((card) => {
      return card.quantity > 1 ? `${card.name} x${card.quantity}` : card.name;
    });

    return {
      deckList,
      strategicApproach: generatedDeck.strategicApproach,
    };
  } catch (error) {
    console.error('Error generating random opponent deck:', error);
    throw new Error('Failed to generate random opponent deck.');
  }
}

// Export types for backward compatibility
export type { AIOpponentDeckGenerationInput, AIOpponentDeckGenerationOutput };
