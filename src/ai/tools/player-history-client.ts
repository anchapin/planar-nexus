import { tool } from 'ai';
import { z } from 'zod';
import { getRecentGames, getPlayerStats } from '@/lib/game-history';
import { searchGameHistory, getRecentGamesServer } from './game-history-server';

/**
 * Client-side tool for player history retrieval.
 * 
 * This tool is meant to be executed on the client side because it
 * reads from localStorage. It should be passed to the `useChat` hook.
 */
export const playerHistoryTool = tool({
  description: 'Retrieve the players recent game history, including win/loss records, deck statistics, and semantic search over past game situations.',
  parameters: z.object({
    query: z.string().optional().describe('Natural language query to search past games (e.g., "games where I lost with red decks", "games against aggro decks")'),
    limit: z.number().optional().default(5).describe('Number of recent games to retrieve'),
    includeStats: z.boolean().optional().default(true).describe('Whether to include overall player statistics'),
    searchMode: z.enum(['recent', 'semantic']).optional().default('recent').describe('Search mode: "recent" for recent games, "semantic" for natural language search'),
  }),
  execute: async ({ query, limit, includeStats, searchMode }) => {
    // If semantic search is requested with a query, use server-side search
    if (searchMode === 'semantic' && query) {
      try {
        const results = await searchGameHistory(query, { limit });
        
        return {
          searchResults: results.map(game => ({
            id: game.id,
            summary: game.summary,
            result: game.result,
            playerDeck: game.deck,
            opponentDeck: game.opponentDeck,
            mode: game.mode,
            turns: game.turns,
            relevanceScore: game.score
          })),
          playerStats: includeStats ? {
            totalGames: getRecentGames(1000).length,
            winRate: `${Math.round((getPlayerStats().wins / Math.max(getPlayerStats().totalGames, 1)) * 100)}%`,
            wins: getPlayerStats().wins,
            losses: getPlayerStats().losses
          } : undefined,
          searchPerformed: true
        };
      } catch (error: any) {
        return {
          error: `Failed to search game history: ${error.message}`,
          searchPerformed: false
        };
      }
    }

    // Default: return recent games
    try {
      const recentGames = getRecentGames(limit);
      const playerStats = includeStats ? getPlayerStats() : undefined;
      
      return {
        recentGames: recentGames.map(game => ({
          date: new Date(game.date).toLocaleDateString(),
          mode: game.mode,
          result: game.result,
          playerDeck: game.playerDeck,
          opponentDeck: game.opponentDeck,
          turns: game.turns,
          playerLifeAtEnd: game.playerLifeAtEnd,
          notes: game.notes
        })),
        playerStats: playerStats ? {
          totalGames: playerStats.totalGames,
          winRate: `${playerStats.winRate}%`,
          wins: playerStats.wins,
          losses: playerStats.losses,
          avgTurnsPerGame: playerStats.avgTurnsPerGame,
          recentForm: playerStats.recentForm.join(', ')
        } : undefined,
        searchPerformed: false
      };
    } catch (error: any) {
      return { 
        error: `Failed to retrieve player history: ${error.message}` 
      };
    }
  },
});
