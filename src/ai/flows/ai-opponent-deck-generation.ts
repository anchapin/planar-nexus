'use server';
/**
 * @fileOverview A Genkit flow for generating an AI opponent's deck and strategic approach based on a chosen theme and difficulty.
 * 
 * This module has been updated to use the provider-agnostic AI architecture.
 * Issue #97: Migrate from hardcoded Gemini-only AI to provider-agnostic architecture
 *
 * - generateAIOpponentDeck - A function that handles the AI opponent deck generation process.
 * - AIOpponentDeckGenerationInput - The input type for the generateAIOpponentDeck function.
 * - AIOpponentDeckGenerationOutput - The return type for the generateAIOpponentDeck function.
 */

import { ai } from '@/ai/genkit';
import { getModelString } from '@/ai/providers';
import { z } from 'genkit';

// Get the model string using the provider-agnostic approach
const currentModel = getModelString();

// Input Schema
const AIOpponentDeckGenerationInputSchema = z.object({
  theme: z.string().describe('The thematic focus or archetype for the opponent deck (e.g., "aggressive red", "control blue", "token generation", "mill").'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('The desired difficulty level for the AI opponent, influencing deck complexity and strategy.'),
});
export type AIOpponentDeckGenerationInput = z.infer<typeof AIOpponentDeckGenerationInputSchema>;

// Output Schema
const AIOpponentDeckGenerationOutputSchema = z.object({
  deckList: z.array(z.string()).describe('A list of card names (including basic lands) that constitute the AI opponent\'s deck. Include quantities where appropriate (e.g., "Lightning Bolt x4", "Mountain x18").'),
  strategicApproach: z.string().describe('A high-level description of how the AI should play this deck, detailing its win conditions, key interactions, and overall game plan.'),
});
export type AIOpponentDeckGenerationOutput = z.infer<typeof AIOpponentDeckGenerationOutputSchema>;

// Wrapper function
export async function generateAIOpponentDeck(
  input: AIOpponentDeckGenerationInput
): Promise<AIOpponentDeckGenerationOutput> {
  return aiOpponentDeckGenerationFlow(input);
}

// Define the prompt - using provider-agnostic model
const aiOpponentDeckGenerationPrompt = ai.definePrompt({
  name: 'aiOpponentDeckGenerationPrompt',
  model: currentModel,
  input: {schema: AIOpponentDeckGenerationInputSchema},
  output: {schema: AIOpponentDeckGenerationOutputSchema},
  prompt: `You are an expert Magic: The Gathering deck builder and strategist.\nYour task is to create a 60-card Magic: The Gathering deck for an AI opponent and define its strategic approach based on a given theme and difficulty.\n\nTheme: {{{theme}}}\nDifficulty: {{{difficulty}}}\n\nFor the deck list, provide specific card names. Include basic lands in appropriate quantities. For the strategic approach, describe the deck's primary win conditions, key cards, and general play patterns.\n\nExample for a "Red Aggro" theme with "easy" difficulty:\nDeck List:\nLightning Bolt x4\nGoblin Guide x4\nMonastery Swiftspear x4\nEidolon of the Great Revel x3\nBoros Charm x2\nSkullcrack x2\nSearing Blaze x3\nRift Bolt x4\nLava Spike x4\nGrim Lavamancer x2\nBloodstained Mire x4\nWooded Foothills x4\nStomping Ground x2\nSacred Foundry x2\nMountain x12\n\nStrategic Approach: This deck aims to win quickly by dealing direct damage to the opponent with cheap, efficient creatures and burn spells. Prioritize attacking with creatures in the early turns and use burn spells to remove blockers or finish off the opponent's life total. Be mindful of opponent's life total and switch from creature-based damage to direct burn when lethal is possible. Mulligan aggressively for hands with multiple one-drop creatures.\n\nNow, generate the deck and strategic approach based on the input.`,
});

// Define the flow
const aiOpponentDeckGenerationFlow = ai.defineFlow(
  {
    name: 'aiOpponentDeckGenerationFlow',
    inputSchema: AIOpponentDeckGenerationInputSchema,
    outputSchema: AIOpponentDeckGenerationOutputSchema,
  },
  async (input) => {
    const {output} = await aiOpponentDeckGenerationPrompt(input);
    if (!output) {
      throw new Error('Failed to generate AI opponent deck and strategy.');
    }
    return output;
  }
);
