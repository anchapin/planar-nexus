import { tool, zodSchema } from "ai";
import { z } from "zod";
import { searchCards } from "@/lib/server-card-operations";

/**
 * Server-side card search tool for Vercel AI SDK.
 *
 * Allows the LLM to search for MTG cards in the local/server database.
 *
 * The tool binds an `execute` handler so any `generateText` / `streamText`
 * call that wires `searchCardsTool` into its `tools` map actually performs
 * the lookup. Without `execute`, the AI SDK exposes the schema to the model
 * but never invokes the underlying logic — see issue #1827.
 */

/**
 * Execute a card search against the local/server database.
 *
 * Standalone, callable directly. The tool's `execute` handler (below)
 * adapts the schema-shaped object args to these positional args.
 */
export async function executeCardSearch(
  query: string,
  format?: string,
  limit?: number,
) {
  try {
    const results = await searchCards(query, { format, maxCards: limit });

    if (results.length === 0) {
      return {
        message: `No cards found for query: "${query}"`,
        cards: [] as Array<Record<string, unknown>>,
      };
    }

    // Simplify the output for the LLM to save tokens
    return {
      message: `Found ${results.length} cards matching "${query}"`,
      cards: results.map((card) => ({
        name: card.name,
        type: card.type_line,
        cost: card.mana_cost,
        text: card.oracle_text,
        cmc: card.cmc,
        colors: card.colors,
        legalities: card.legalities,
      })),
    };
  } catch (error: any) {
    return {
      error: `Failed to search cards: ${error.message}`,
      cards: [] as Array<Record<string, unknown>>,
    };
  }
}

export const searchCardsTool = tool({
  description:
    "Search for Magic: The Gathering cards in the database by name, type, or oracle text.",
  parameters: zodSchema(
    z.object({
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
  ),
  execute: async (args: { query: string; format?: string; limit?: number }) =>
    executeCardSearch(args.query, args.format, args.limit),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);
