'use server';
/**
 * @fileOverview AI-powered post-game analysis system.
 * 
 * Issue #55: Phase 3.4: Create post-game analysis system
 *
 * Provides:
 * - analyzeGame - Analyzes a completed game and provides improvement suggestions
 * - identifyKeyMoments - Identifies key turning points in the game
 * - generateImprovementTips - Provides actionable improvement advice
 */

import { ai } from '@/ai/genkit';
import { getModelString } from '@/ai/providers';
import { z } from 'genkit';

// Types for game replay data
interface GameAction {
  turn: number;
  player: string;
  action: string;
  card?: string;
  target?: string;
  result?: string;
}

interface GameOutcome {
  winner: string;
  finalScore?: string;
  turns: number;
  playerDecks: Record<string, string[]>;
}

// Input schema for game analysis
const GameAnalysisInputSchema = z.object({
  replay: z.record(z.any()).describe("The game replay data with actions and outcomes"),
  playerName: z.string().describe("The player to analyze (get advice for)"),
});

// Output schema for game analysis
const GameAnalysisOutputSchema = z.object({
  gameSummary: z.string().describe("A brief summary of how the game played out"),
  keyMoments: z.array(z.object({
    turn: z.number(),
    description: z.string(),
    impact: z.enum(['positive', 'negative', 'neutral']),
    alternativeAction: z.string().optional(),
  })).describe("Key turning points in the game"),
  mistakes: z.array(z.object({
    turn: z.number(),
    description: z.string(),
    severity: z.enum(['major', 'minor', 'minor']),
    suggestion: z.string(),
  })).describe("Identified mistakes or sub-optimal plays"),
  strengths: z.array(z.string()).describe("Things the player did well"),
  improvementAreas: z.array(z.string()).describe("Areas to focus on for improvement"),
  deckSuggestions: z.array(z.object({
    card: z.string(),
    reason: z.string(),
  })).describe("Specific card suggestions based on the game"),
  overallRating: z.number().min(1).max(10).describe("Overall performance rating for the game"),
  tips: z.array(z.string()).describe("Actionable tips for future games"),
});

// Input schema for key moments identification
const KeyMomentsInputSchema = z.object({
  replay: z.record(z.any()).describe("The game replay data"),
  playerName: z.string().describe("The player to focus on"),
});

// Output schema for key moments
const KeyMomentsOutputSchema = z.object({
  moments: z.array(z.object({
    turn: z.number(),
    description: z.string(),
    type: z.enum(['game_change', 'mistake', 'great_play', 'missed_opportunity']),
    whatHappened: z.string(),
    couldHaveHappened: z.string().optional(),
  })),
  summary: z.string(),
});

// Input schema for quick tips
const QuickTipsInputSchema = z.object({
  replay: z.record(z.any()).describe("The game replay data"),
  playerName: z.string().describe("The player to get tips for"),
});

// Output schema for quick tips
const QuickTipsOutputSchema = z.object({
  tips: z.array(z.string()).describe("Quick actionable tips based on the game"),
  focusAreas: z.array(z.string()).describe("Areas to focus on in future games"),
});

/**
 * Analyzes a completed game and provides comprehensive feedback.
 */
export async function analyzeGame(
  input: z.infer<typeof GameAnalysisInputSchema>
): Promise<z.infer<typeof GameAnalysisOutputSchema>> {
  const result = await gameAnalysisFlow(input);
  return result;
}

/**
 * Identifies key moments in a game that determined the outcome.
 */
export async function identifyKeyMoments(
  input: z.infer<typeof KeyMomentsInputSchema>
): Promise<z.infer<typeof KeyMomentsOutputSchema>> {
  const result = await keyMomentsFlow(input);
  return result;
}

/**
 * Generates quick actionable tips from a game.
 */
export async function generateQuickTips(
  input: z.infer<typeof QuickTipsInputSchema>
): Promise<z.infer<typeof QuickTipsOutputSchema>> {
  const result = await quickTipsFlow(input);
  return result;
}

// Use provider-agnostic model string
const currentModel = getModelString();

// Main game analysis prompt
const gameAnalysisPrompt = ai.definePrompt({
  name: 'gameAnalysisPrompt',
  model: currentModel,
  input: { schema: GameAnalysisInputSchema },
  output: { schema: GameAnalysisOutputSchema },
  prompt: `You are an expert Magic: The Gathering analyst and coach. Your task is to analyze a completed game and provide constructive feedback to help the player improve.

**GAME DATA:**
{{#json replays}}{{replay}}{{/json}}

**PLAYER TO ANALYZE:** {{playerName}}

**YOUR TASK:**
Analyze this game from the perspective of {{playerName}} and provide:

1. **Game Summary**: Brief overview of how the game played out
2. **Key Moments**: Identify 3-5 turning points in the game
3. **Mistakes**: Point out any plays that were sub-optimal (be constructive)
4. **Strengths**: Acknowledge what the player did well
5. **Improvement Areas**: General areas to focus on
6. **Deck Suggestions**: Any specific cards that could help their strategy
7. **Overall Rating**: Score from 1-10
8. **Tips**: 3-5 actionable tips for future games

Consider:
- Mana curve and resource management
- Card advantage and card draw
- Threat assessment and prioritization
- Tempo vs card advantage decisions
- Sideboarding (if applicable)
- Political plays (in multiplayer)

Be specific and constructive. Focus on actionable advice rather than generic feedback.`,
});

// Key moments identification prompt
const keyMomentsPrompt = ai.definePrompt({
  name: 'keyMomentsPrompt',
  model: currentModel,
  input: { schema: KeyMomentsInputSchema },
  output: { schema: KeyMomentsOutputSchema },
  prompt: `You are a Magic: The Gathering analyst. Identify the key moments in this game that determined the outcome.

**GAME DATA:**
{{#json replay}}{{replay}}{{/json}}

**FOCUS PLAYER:** {{playerName}}

Identify:
- Game-changing plays
- Major mistakes
- Great strategic decisions
- Missed opportunities

For each moment, explain what happened and what could have happened differently (if applicable).

Respond with a JSON object matching the output schema.`,
});

// Quick tips prompt
const quickTipsPrompt = ai.definePrompt({
  name: 'quickTipsPrompt',
  model: currentModel,
  input: { schema: QuickTipsInputSchema },
  output: { schema: QuickTipsOutputSchema },
  prompt: `You are a Magic: The Gathering coach. Give quick, actionable tips based on this game.

**GAME DATA:**
{{#json replay}}{{replay}}{{/json}}

**PLAYER:** {{playerName}}

Provide 3-5 quick tips that are specific to this game. Focus on the most important things to improve.

Respond with a JSON object matching the output schema.`,
});

// Define the flows
const gameAnalysisFlow = ai.defineFlow(
  {
    name: 'gameAnalysisFlow',
    inputSchema: GameAnalysisInputSchema,
    outputSchema: GameAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await gameAnalysisPrompt(input);
    if (!output) {
      throw new Error('Failed to generate game analysis');
    }
    return output;
  }
);

const keyMomentsFlow = ai.defineFlow(
  {
    name: 'keyMomentsFlow',
    inputSchema: KeyMomentsInputSchema,
    outputSchema: KeyMomentsOutputSchema,
  },
  async (input) => {
    const { output } = await keyMomentsPrompt(input);
    if (!output) {
      throw new Error('Failed to identify key moments');
    }
    return output;
  }
);

const quickTipsFlow = ai.defineFlow(
  {
    name: 'quickTipsFlow',
    inputSchema: QuickTipsInputSchema,
    outputSchema: QuickTipsOutputSchema,
  },
  async (input) => {
    const { output } = await quickTipsPrompt(input);
    if (!output) {
      throw new Error('Failed to generate quick tips');
    }
    return output;
  }
);
