/**
 * @fileOverview Genkit conversational AI coach flow.
 */

import { z } from 'zod';
import { ai, defineFlow, defineTool } from '../genkit';
import { 
  buildCoachSystemPrompt, 
  prepareConversationHistory, 
  formatDeckForLLM,
  formatDigestedContextForLLM
} from './context-builder';
import { executeCardSearch } from '../tools/card-search';
import { CoachFlowInputSchema } from '../types';

/**
 * Define the Genkit tool for card search.
 */
export const genkitSearchCardsTool = defineTool(
  {
    name: 'searchCards',
    description: 'Search for Magic: The Gathering cards in the database by name, type, or oracle text.',
    inputSchema: z.object({
      query: z.string().describe('The search query (e.g., "Sol Ring", "Elf", "Flying")'),
      format: z.string().optional().describe('Filter by format legality (e.g., "commander", "standard")'),
      limit: z.number().optional().default(5).describe('Maximum number of results to return'),
    }),
    outputSchema: z.object({
      message: z.string(),
      cards: z.array(z.any()),
      error: z.string().optional(),
    }),
  },
  async ({ query, format, limit }) => {
    return executeCardSearch(query, format, limit);
  }
);

/**
 * Define the conversational AI coach flow using Genkit.
 */
export const coachFlow = defineFlow(
  {
    name: 'coachFlow',
    inputSchema: CoachFlowInputSchema,
    outputSchema: z.string(),
  },
  async (input) => {
    const { 
      messages, 
      deckCards, 
      digestedContext,
      format, 
      archetype, 
      strategy, 
      provider = 'googleai', // Genkit defaults to Google AI
      modelId = 'gemini-1.5-flash'
    } = input;

    // 1. Format the deck for the LLM (only if full deck is provided)
    const deckListText = deckCards ? formatDeckForLLM(deckCards as any) : '';

    // 2. Format digested context if provided
    const digestedText = digestedContext ? formatDigestedContextForLLM(digestedContext) : '';

    // 3. Build the system prompt with context
    const systemPrompt = buildCoachSystemPrompt(
      format,
      deckListText,
      archetype,
      strategy,
      digestedText
    );

    // 4. Prepare message history
    const history = prepareConversationHistory(messages).map(m => ({
      role: m.role as 'user' | 'model' | 'system',
      content: [{ text: m.content }],
    }));

    // 5. Execute the AI call within Genkit
    const result = await ai.generate({
      model: `${provider}/${modelId}`,
      system: systemPrompt,
      messages: history as any,
      tools: [genkitSearchCardsTool],
      config: {
        temperature: 0.7,
        maxOutputTokens: 2000,
      },
    });

    return result.text;
  }
);
