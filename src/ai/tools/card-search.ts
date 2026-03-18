import { tool } from 'ai';
import { z } from 'zod';
import { searchCards } from '@/lib/server-card-operations';

/**
 * Server-side card search tool for Vercel AI SDK.
 * 
 * Allows the LLM to search for MTG cards in the local/server database.
 */
export const searchCardsTool = tool({
  description: 'Search for Magic: The Gathering cards in the database by name, type, or oracle text.',
  parameters: z.object({
    query: z.string().describe('The search query (e.g., "Sol Ring", "Elf", "Flying")'),
    format: z.string().optional().describe('Filter by format legality (e.g., "commander", "standard")'),
    limit: z.number().optional().default(5).describe('Maximum number of results to return'),
  }),
  execute: async ({ query, format, limit }) => {
    try {
      const results = await searchCards(query, { format, maxCards: limit });
      
      if (results.length === 0) {
        return { 
          message: `No cards found for query: "${query}"`,
          cards: [] 
        };
      }
      
      // Simplify the output for the LLM to save tokens
      return {
        message: `Found ${results.length} cards matching "${query}"`,
        cards: results.map(card => ({
          name: card.name,
          type: card.type_line,
          cost: card.mana_cost,
          text: card.oracle_text,
          cmc: card.cmc,
          colors: card.colors,
          legalities: card.legalities
        }))
      };
    } catch (error: any) {
      return { 
        error: `Failed to search cards: ${error.message}`,
        cards: [] 
      };
    }
  },
});
