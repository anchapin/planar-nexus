'use server';
/**
 * @fileOverview AI-powered real-time gameplay assistance
 * 
 * Issue #54: Phase 3.4: Implement real-time gameplay assistance
 *
 * Provides:
 * - analyzeCurrentGameState - Analyze current game state and suggest plays
 * - getPlayRecommendation - Get specific card play recommendations
 * - getManaUsageAdvice - Suggest optimal mana usage
 * - evaluateBoardState - Provide overall board evaluation
 */

import { ai } from '@/ai/genkit';
import { getModelString } from '@/ai/providers';
import { z } from 'genkit';

// Input schema for game state analysis
const GameStateAnalysisInputSchema = z.object({
  gameState: z.record(z.any()).describe("Current game state including hand, board, mana, etc."),
  playerName: z.string().describe("The player to provide assistance for"),
});

// Output schema for game state analysis
const GameStateAnalysisOutputSchema = z.object({
  overallAssessment: z.string().describe("Brief assessment of current board state"),
  suggestedPlays: z.array(z.object({
    cardName: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
    reasoning: z.string(),
    manaCost: z.number().optional(),
    expectedImpact: z.string(),
  })).describe("Recommended plays in priority order"),
  warnings: z.array(z.object({
    type: z.enum(['danger', 'caution', 'info']),
    message: z.string(),
    relatedCards: z.array(z.string()).optional(),
  })).describe("Warnings about potentially bad moves or dangerous situations"),
  manaUsage: z.object({
    optimal: z.boolean(),
    suggestions: z.array(z.string()),
    unusedMana: z.number(),
  }).describe("Mana usage analysis"),
  boardThreats: z.array(z.object({
    card: z.string(),
    threat: z.string(),
    priority: z.enum(['immediate', 'high', 'medium', 'low']),
  })).describe("Active threats on the board"),
  strategicAdvice: z.array(z.string()).describe("General strategic advice for this game state"),
});

// Input schema for specific play analysis
const PlayAnalysisInputSchema = z.object({
  gameState: z.record(z.any()).describe("Current game state"),
  playerName: z.string().describe("The player"),
  cardName: z.string().describe("Card being considered"),
  target: z.string().optional().describe("Intended target (if any)"),
});

// Output schema for play analysis
const PlayAnalysisOutputSchema = z.object({
  isRecommended: z.boolean().describe("Whether this play is recommended"),
  rating: z.enum(['excellent', 'good', 'okay', 'poor', 'terrible']).describe("Rating of the play"),
  reasoning: z.string().describe("Detailed explanation"),
  alternativePlays: z.array(z.object({
    cardName: z.string(),
    rating: z.string(),
    reason: z.string(),
  })).describe("Better alternatives if any"),
  potentialUpgrades: z.array(z.string()).describe("How this play could be improved"),
});

// Input schema for mana advice
const ManaAdviceInputSchema = z.object({
  gameState: z.record(z.any()).describe("Current game state"),
  playerName: z.string().describe("The player"),
});

// Output schema for mana advice
const ManaAdviceOutputSchema = z.object({
  availableMana: z.object({
    total: z.number(),
    colored: z.record(z.string(), z.number()),
    colorless: z.number(),
  }).describe("Current available mana"),
  suggestions: z.array(z.object({
    cardName: z.string().optional(),
    action: z.string(),
    manaCost: z.number(),
    priority: z.string(),
    reasoning: z.string(),
  })).describe("Suggestions for using available mana"),
  shouldHoldMana: z.boolean().describe("Whether player should hold mana for something"),
  holdReason: z.string().optional().describe("Reason for holding mana"),
});

// Input schema for board evaluation
const BoardEvaluationInputSchema = z.object({
  gameState: z.record(z.any()).describe("Current game state"),
  playerName: z.string().describe("The player to evaluate for"),
});

// Output schema for board evaluation
const BoardEvaluationOutputSchema = z.object({
  playerWinChance: z.number().min(0).max(100).describe("Estimated win chance percentage"),
  boardAdvantage: z.enum(['winning', 'slightly_ahead', 'even', 'slightly_behind', 'losing']).describe("Board advantage assessment"),
  keyFactors: z.array(z.string()).describe("Factors contributing to the assessment"),
  cardsInHand: z.number().describe("Player's cards in hand"),
  cardsInPlay: z.number().describe("Player's cards in play"),
  opponentCardsInHand: z.number().describe("Opponent's estimated cards in hand"),
  opponentCardsInPlay: z.number().describe("Opponent's cards in play"),
  recommendations: z.array(z.string()).describe("Recommendations based on board state"),
});

/**
 * Analyze current game state and provide comprehensive assistance
 */
export async function analyzeCurrentGameState(
  input: z.infer<typeof GameStateAnalysisInputSchema>
): Promise<z.infer<typeof GameStateAnalysisOutputSchema>> {
  const result = await gameStateAnalysisFlow(input);
  return result;
}

/**
 * Analyze a specific play being considered
 */
export async function analyzePlay(
  input: z.infer<typeof PlayAnalysisInputSchema>
): Promise<z.infer<typeof PlayAnalysisOutputSchema>> {
  const result = await playAnalysisFlow(input);
  return result;
}

/**
 * Get mana usage advice
 */
export async function getManaAdvice(
  input: z.infer<typeof ManaAdviceInputSchema>
): Promise<z.infer<typeof ManaAdviceOutputSchema>> {
  const result = await manaAdviceFlow(input);
  return result;
}

/**
 * Evaluate overall board state
 */
export async function evaluateBoardState(
  input: z.infer<typeof BoardEvaluationInputSchema>
): Promise<z.infer<typeof BoardEvaluationOutputSchema>> {
  const result = await boardEvaluationFlow(input);
  return result;
}

// Use provider-agnostic model string
const currentModel = getModelString();

// Main game state analysis prompt
const gameStateAnalysisPrompt = ai.definePrompt({
  name: 'gameStateAnalysisPrompt',
  model: currentModel,
  input: { schema: GameStateAnalysisInputSchema },
  output: { schema: GameStateAnalysisOutputSchema },
  prompt: `You are an expert Magic: The Gathering advisor. Analyze the current game state and provide helpful suggestions to improve the player's chances of winning.

**GAME STATE:**
{{#json gameState}}{{gameState}}{{/json}}

**PLAYER:** {{playerName}}

**YOUR TASK:**
Analyze this game state and provide:

1. **Overall Assessment**: Brief summary of the current board state
2. **Suggested Plays**: 2-5 recommended plays in priority order
3. **Warnings**: Any potentially bad moves or dangerous situations to be aware of
4. **Mana Usage**: Analysis of how available mana should be used
5. **Board Threats**: Active threats that need to be addressed
6. **Strategic Advice**: General strategic guidance for this game state

Focus on:
- Card advantage and card draw
- Board presence and tempo
- Threat assessment and removal priorities
- Mana curve and resource management
- Win condition progression

Be specific and actionable. Provide actual card names when possible.`,
});

// Play analysis prompt
const playAnalysisPrompt = ai.definePrompt({
  name: 'playAnalysisPrompt',
  model: currentModel,
  input: { schema: PlayAnalysisInputSchema },
  output: { schema: PlayAnalysisOutputSchema },
  prompt: `You are an expert Magic: The Gathering advisor. Analyze whether a specific play is good or bad.

**GAME STATE:**
{{#json gameState}}{{gameState}}{{/json}}

**PLAYER:** {{playerName}}

**PROPOSED PLAY:**
- Card: {{cardName}}
{{#if target}}- Target: {{target}}{{/if}}

**YOUR TASK:**
Evaluate this play and provide:
1. **Recommendation**: Is this play recommended?
2. **Rating**: excellent, good, okay, poor, or terrible
3. **Reasoning**: Detailed explanation
4. **Alternatives**: Better plays if available
5. **Upgrades**: How this play could be improved

Be honest but constructive. Don't hesitate to call out poor plays.`,
});

// Mana advice prompt
const manaAdvicePrompt = ai.definePrompt({
  name: 'manaAdvicePrompt',
  model: currentModel,
  input: { schema: ManaAdviceInputSchema },
  output: { schema: ManaAdviceOutputSchema },
  prompt: `You are a Magic: The Gathering mana management expert. Help the player optimize their mana usage.

**GAME STATE:**
{{#json gameState}}{{gameState}}{{/json}}

**PLAYER:** {{playerName}}

**YOUR TASK:**
Analyze available mana and provide:
1. **Available Mana**: Breakdown of current mana pool
2. **Suggestions**: How to best spend available mana this turn
3. **Hold Decision**: Whether to save mana for something later

Consider:
- Upcoming turns and future mana needs
- Cards in hand that could be played
- Emergency mana sinks (lands, mana rocks)
- Color fixing needs

Provide specific, actionable advice.`,
});

// Board evaluation prompt
const boardEvaluationPrompt = ai.definePrompt({
  name: 'boardEvaluationPrompt',
  model: currentModel,
  input: { schema: BoardEvaluationInputSchema },
  output: { schema: BoardEvaluationOutputSchema },
  prompt: `You are a Magic: The Gathering strategic analyst. Evaluate the current board state from the player's perspective.

**GAME STATE:**
{{#json gameState}}{{gameState}}{{/json}}

**PLAYER:** {{playerName}}

**YOUR TASK:**
Evaluate the board state and provide:
1. **Win Chance**: Estimate probability of winning (0-100%)
2. **Board Advantage**: winning, slightly_ahead, even, slightly_behind, losing
3. **Key Factors**: What's driving this assessment
4. **Card Counts**: Your cards in hand/play vs opponent's
5. **Recommendations**: What should the player focus on

Be objective and data-driven. Use all available information to make the assessment.`,
});

// Define the flows
const gameStateAnalysisFlow = ai.defineFlow(
  {
    name: 'gameStateAnalysisFlow',
    inputSchema: GameStateAnalysisInputSchema,
    outputSchema: GameStateAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await gameStateAnalysisPrompt(input);
    if (!output) {
      throw new Error('Failed to analyze game state');
    }
    return output;
  }
);

const playAnalysisFlow = ai.defineFlow(
  {
    name: 'playAnalysisFlow',
    inputSchema: PlayAnalysisInputSchema,
    outputSchema: PlayAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await playAnalysisPrompt(input);
    if (!output) {
      throw new Error('Failed to analyze play');
    }
    return output;
  }
);

const manaAdviceFlow = ai.defineFlow(
  {
    name: 'manaAdviceFlow',
    inputSchema: ManaAdviceInputSchema,
    outputSchema: ManaAdviceOutputSchema,
  },
  async (input) => {
    const { output } = await manaAdvicePrompt(input);
    if (!output) {
      throw new Error('Failed to get mana advice');
    }
    return output;
  }
);

const boardEvaluationFlow = ai.defineFlow(
  {
    name: 'boardEvaluationFlow',
    inputSchema: BoardEvaluationInputSchema,
    outputSchema: BoardEvaluationOutputSchema,
  },
  async (input) => {
    const { output } = await boardEvaluationPrompt(input);
    if (!output) {
      throw new Error('Failed to evaluate board state');
    }
    return output;
  }
);
