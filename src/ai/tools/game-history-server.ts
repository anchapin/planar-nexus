import { getAllGameRecords } from '@/lib/game-history';
import { gameHistoryOramaManager } from '@/lib/search/orama-manager';
import { EmbeddingClient } from '@/lib/ai/embedding-client';

/**
 * Server-side game history search.
 * Performs semantic search over past game situations.
 */

export interface GameSearchResult {
  id: string;
  summary: string;
  result: string;
  deck: string;
  opponentDeck?: string;
  mode: string;
  turns: number;
  score: number;
}

/**
 * Search game history using natural language query.
 * Uses hybrid search (keyword + vector) via Orama.
 */
export async function searchGameHistory(
  query: string,
  options: {
    limit?: number;
    similarity?: number;
    mode?: string;
    result?: string;
  } = {}
): Promise<GameSearchResult[]> {
  const { limit = 10, similarity = 0.7, mode, result } = options;

  // Initialize the Orama index
  await gameHistoryOramaManager.init();

  // Generate embedding for the query
  const embeddingClient = EmbeddingClient.getInstance();
  
  // Create a minimal card-like object for embedding
  const queryCard = {
    id: 'query',
    name: 'query',
    oracle_text: query
  };

  const embeddingResults = await embeddingClient.generateEmbeddings([queryCard] as any);
  const queryVector = embeddingResults[0]?.embedding;

  if (!queryVector) {
    throw new Error('Failed to generate embedding for query');
  }

  // Build where clause
  const where: Record<string, any> = {};
  if (mode) {
    where.mode = mode;
  }
  if (result) {
    where.result = result;
  }

  // Perform hybrid search
  const searchResults = await gameHistoryOramaManager.searchHistory({
    term: query,
    vector: queryVector,
    similarity,
    limit,
    where: Object.keys(where).length > 0 ? where : undefined
  });

  // Transform results to GameSearchResult format
  return searchResults.hits.map(hit => ({
    id: hit.document.id as string,
    summary: hit.document.summary as string,
    result: hit.document.result as string,
    deck: hit.document.deck as string,
    opponentDeck: hit.document.opponentDeck as string | undefined,
    mode: hit.document.mode as string,
    turns: hit.document.turns as number,
    score: hit.score
  }));
}

/**
 * Get recent games with optional filters.
 */
export function getRecentGamesServer(limit: number = 10) {
  const games = getAllGameRecords().slice(0, limit);
  return games.map(game => ({
    id: game.id,
    date: new Date(game.date).toLocaleDateString(),
    mode: game.mode,
    result: game.result,
    playerDeck: game.playerDeck,
    opponentDeck: game.opponentDeck,
    turns: game.turns,
    playerLifeAtEnd: game.playerLifeAtEnd,
    notes: game.notes
  }));
}
