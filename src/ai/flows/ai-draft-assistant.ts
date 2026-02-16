'use server';
/**
 * @fileOverview AI assistant for Draft and Sealed deck building.
 * 
 * Issue #56: Phase 3.4: Add draft/sealed deck AI assistance
 *
 * Provides:
 * - draftPickRecommendation - Suggests the best card for a draft pick
 * - sealedDeckBuilding - Helps build a sealed deck from a pool
 * - colorSuggestion - Analyzes card pool to suggest best colors
 * - curveAnalysis - Analyzes mana curve for limited decks
 * - archetypeDetection - Identifies potential archetypes in the pool
 */

import { ai } from '@/ai/genkit';
import { getModelString } from '@/ai/providers';
import { z } from 'genkit';

// Input schema for draft pick recommendation
const DraftPickInputSchema = z.object({
  pool: z
    .array(z.object({
      name: z.string(),
      colors: z.array(z.string()).optional(),
      cmc: z.number().optional(),
      type: z.string().optional(),
    }))
    .describe("The cards currently in your pool/deck"),
  pickNumber: z.number().describe("The current pick number (1-15 for draft)"),
  packCards: z
    .array(z.object({
      name: z.string(),
      colors: z.array(z.string()).optional(),
      cmc: z.number().optional(),
      type: z.string().optional(),
    }))
    .describe("The cards available to pick from this pack"),
  format: z.string().describe("The format (e.g., 'draft', 'sealed', 'booster-draft')"),
});

// Output schema for draft pick
const DraftPickOutputSchema = z.object({
  recommendedPick: z.number().describe("Index of the recommended card (0-based)"),
  reasoning: z.string().describe("Detailed explanation of why this is the best pick"),
  alternativeOptions: z.array(z.object({
    index: z.number(),
    reason: z.string(),
  })).describe("Alternative picks with reasoning"),
  synergies: z.array(z.string()).describe("Synergies with existing pool"),
  colorAlignment: z.object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
  }).describe("Suggested color balance based on pool"),
});

// Input schema for sealed deck building
const SealedBuildInputSchema = z.object({
  pool: z
    .array(z.object({
      name: z.string(),
      colors: z.array(z.string()).optional(),
      cmc: z.number().optional(),
      type: z.string().optional(),
    }))
    .describe("All cards in the sealed pool"),
  format: z.string().describe("The format (usually 'sealed')"),
});

// Output schema for sealed deck building
const SealedBuildOutputSchema = z.object({
  suggestedDeck: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    reason: z.string(),
  })).describe("The suggested deck build"),
  colorRecommendation: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    reasoning: z.string(),
  }).describe("Recommended colors based on pool analysis"),
  curveAnalysis: z.object({
    creatures: z.array(z.object({ cmc: z.number(), count: z.number() })),
    spells: z.array(z.object({ cmc: z.number(), curve: z.string() })),
    assessment: z.string(),
  }).describe("Mana curve analysis"),
  sideboard: z.array(z.object({
    name: z.string(),
    reason: z.string(),
  })).describe("Cards recommended for sideboard"),
  archetypes: z.array(z.object({
    name: z.string(),
    score: z.number(),
    cards: z.array(z.string()),
  })).describe("Detected archetypes in the pool"),
});

// Input for color/archetype analysis
const PoolAnalysisInputSchema = z.object({
  pool: z
    .array(z.object({
      name: z.string(),
      colors: z.array(z.string()).optional(),
      cmc: z.number().optional(),
      type: z.string().optional(),
    }))
    .describe("The card pool to analyze"),
  format: z.string().describe("The format"),
});

// Output for pool analysis
const PoolAnalysisOutputSchema = z.object({
  colorBreakdown: z.record(z.string(), z.number()).describe("Count of cards per color"),
  curveBreakdown: z.record(z.number(), z.number()).describe("Count of cards per CMC"),
  recommendedColors: z.object({
    first: z.string(),
    second: z.string().optional(),
    reasoning: z.string(),
  }),
  archetypeSuggestions: z.array(z.object({
    name: z.string(),
    suitability: z.number(),
    keyCards: z.array(z.string()),
  })),
  powerCards: z.array(z.object({
    name: z.string(),
    rating: z.number(),
    reason: z.string(),
  })).describe("Most powerful cards in the pool"),
});

// Draft pick recommendation function
export async function getDraftPickRecommendation(
  input: z.infer<typeof DraftPickInputSchema>
): Promise<z.infer<typeof DraftPickOutputSchema>> {
  const result = await draftPickFlow(input);
  return result;
}

// Sealed deck building function
export async function buildSealedDeck(
  input: z.infer<typeof SealedBuildInputSchema>
): Promise<z.infer<typeof SealedBuildOutputSchema>> {
  const result = await sealedBuildFlow(input);
  return result;
}

// Pool analysis function
export async function analyzeLimitedPool(
  input: z.infer<typeof PoolAnalysisInputSchema>
): Promise<z.infer<typeof PoolAnalysisOutputSchema>> {
  const result = await poolAnalysisFlow(input);
  return result;
}

// Use provider-agnostic model string
const currentModel = getModelString();

// Draft pick prompt
const draftPickPrompt = ai.definePrompt({
  name: 'draftPickPrompt',
  model: currentModel,
  input: { schema: DraftPickInputSchema },
  output: { schema: DraftPickOutputSchema },
  prompt: `You are an expert Magic: The Gathering limited (draft and sealed) specialist. Your goal is to help players make optimal picks and build the best possible deck from their card pool.

**CURRENT POOL:**
{{#each pool}}
- {{this.name}} ({{#if this.colors}}{{this.colors}}{{else}}colorless{{/if}}, CMC: {{this.cmc}})
{{/each}}

**PACK CARDS (Pick #{{pickNumber}}):**
{{#each packCards}}
{{@index}}. {{this.name}} ({{#if this.colors}}{{this.colors}}{{else}}colorless{{/if}}, CMC: {{this.cmc}}, Type: {{this.type}})
{{/each}}

**FORMAT:** {{format}}

**YOUR TASK:**
1. Analyze the pack cards against the current pool
2. Recommend the BEST pick (index 0-based)
3. Provide alternative options with reasoning
4. Identify synergies between the pick and existing pool
5. Suggest color alignment based on the pool

Consider:
- Card power level
- Color consistency
- Mana curve balance
- Synergies with existing cards
- Format-specific considerations (e.g., synergies in the set)

Respond with a JSON object matching the output schema.`,
});

// Sealed build prompt
const sealedBuildPrompt = ai.definePrompt({
  name: 'sealedBuildPrompt',
  model: currentModel,
  input: { schema: SealedBuildInputSchema },
  output: { schema: SealedBuildOutputSchema },
  prompt: `You are an expert Magic: The Gathering sealed deck builder. Your task is to analyze a sealed pool and build the best possible deck.

**SEALED POOL ({{pool.length}} cards):**
{{#each pool}}
- {{this.name}} ({{#if this.colors}}{{this.colors}}{{else}}colorless{{/if}}, CMC: {{this.cmc}}, Type: {{this.type}})
{{/each}}

**FORMAT:** {{format}}

**YOUR TASK:**
1. Analyze the entire pool and identify the best colors
2. Build a 40-card deck optimized for the pool
3. Provide mana curve analysis
4. Suggest sideboard cards
5. Identify possible archetypes

Consider:
- Color depth and consistency (aim for 2 colors, max 3)
- Removal suite
- Creature curve (aim for 2-3 at each CMC 2-5)
- Bomb cards and how to protect/support them
- Commons/uncommons that fill holes in strategy

Respond with a JSON object matching the output schema.`,
});

// Pool analysis prompt
const poolAnalysisPrompt = ai.definePrompt({
  name: 'poolAnalysisPrompt',
  model: currentModel,
  input: { schema: PoolAnalysisInputSchema },
  output: { schema: PoolAnalysisOutputSchema },
  prompt: `You are an expert Magic: The Gathering limited analyst. Analyze the following card pool and provide insights.

**CARD POOL ({{pool.length}} cards):**
{{#each pool}}
- {{this.name}} ({{#if this.colors}}{{this.colors}}{{else}}colorless{{/if}}, CMC: {{this.cmc}}, Type: {{this.type}})
{{/each}}

**FORMAT:** {{format}}

**YOUR TASK:**
1. Count cards by color
2. Analyze mana curve
3. Recommend best colors
4. Suggest possible archetypes
5. Identify power cards (bombs, premium removal)

Respond with a JSON object matching the output schema.`,
});

// Define the flows
const draftPickFlow = ai.defineFlow(
  {
    name: 'draftPickFlow',
    inputSchema: DraftPickInputSchema,
    outputSchema: DraftPickOutputSchema,
  },
  async (input) => {
    const { output } = await draftPickPrompt(input);
    if (!output) {
      throw new Error('Failed to generate draft pick recommendation');
    }
    return output;
  }
);

const sealedBuildFlow = ai.defineFlow(
  {
    name: 'sealedBuildFlow',
    inputSchema: SealedBuildInputSchema,
    outputSchema: SealedBuildOutputSchema,
  },
  async (input) => {
    const { output } = await sealedBuildPrompt(input);
    if (!output) {
      throw new Error('Failed to generate sealed deck build');
    }
    return output;
  }
);

const poolAnalysisFlow = ai.defineFlow(
  {
    name: 'poolAnalysisFlow',
    inputSchema: PoolAnalysisInputSchema,
    outputSchema: PoolAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await poolAnalysisPrompt(input);
    if (!output) {
      throw new Error('Failed to generate pool analysis');
    }
    return output;
  }
);
