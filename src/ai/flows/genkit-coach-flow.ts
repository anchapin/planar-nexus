/**
 * @fileOverview Genkit conversational AI coach flow.
 */

import { z } from "zod";
import { ai } from "../genkit";
import {
  buildCoachSystemPrompt,
  prepareConversationHistory,
  formatDeckForLLM,
  formatDigestedContextForLLM,
} from "./context-builder";
import { executeCardSearch } from "../tools/card-search";
import { CoachFlowInputSchema } from "../types";

/**
 * Define the Genkit tool for card search.
 */
export const genkitSearchCardsTool = {
  name: "searchCards",
  description:
    "Search for Magic: The Gathering cards in the database by name, type, or oracle text.",
  inputSchema: z.object({
    query: z
      .string()
      .describe('The search query (e.g., "Sol Ring", "Elf", "Flying")'),
    format: z
      .string()
      .optional()
      .describe('Filter by format legality (e.g., "commander", "standard")'),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe("Maximum number of results to return"),
  }),
  outputSchema: z.object({
    message: z.string(),
    cards: z.array(z.any()),
    error: z.string().optional(),
  }),
  execute: async (input: {
    query: string;
    format?: string;
    limit?: number;
  }) => {
    return executeCardSearch(input.query, input.format, input.limit);
  },
};

/**
 * Define the conversational AI coach flow using Genkit.
 * Stubbed until Genkit dependency is restored.
 */
export const coachFlow = {
  name: "coachFlow",
  inputSchema: CoachFlowInputSchema,
  outputSchema: z.string(),
  async run(input: z.infer<typeof CoachFlowInputSchema>) {
    if (!ai) {
      throw new Error(
        "Genkit AI is not configured. Dependency was removed in Issue #446.",
      );
    }

    const {
      messages,
      deckCards,
      digestedContext,
      format,
      archetype,
      strategy,
      provider = "googleai",
      modelId = "gemini-1.5-flash",
    } = input;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub: type mismatch between Zod-inferred and declared types
    const deckListText = deckCards ? formatDeckForLLM(deckCards as any) : "";
    const digestedText = digestedContext
      ? formatDigestedContextForLLM(digestedContext)
      : "";
    const systemPrompt = buildCoachSystemPrompt(
      format,
      deckListText,
      archetype,
      strategy,
      digestedText,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub: Zod-inferred ChatMessage differs from declared ChatMessage type
    const history = prepareConversationHistory(messages as any).map((m) => ({
      role: m.role as "user" | "model" | "system",
      content: [{ text: m.content }],
    }));

    const result = await ai.generate({
      model: `${provider}/${modelId}`,
      system: systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub: Genkit message format differs from prepared history
      messages: history as any,
      tools: [genkitSearchCardsTool],
      config: { temperature: 0.7, maxOutputTokens: 2000 },
    });

    return result.text;
  },
  stream(_input: z.infer<typeof CoachFlowInputSchema>) {
    throw new Error(
      "Genkit streaming is not available. Dependency was removed in Issue #446.",
    );
  },
};
