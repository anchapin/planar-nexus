/**
 * Sideboard Recommendation Engine
 *
 * Provides data-driven sideboard recommendations based on match coverage analysis.
 * Extracted from Pro Tour, SCG Tour, and competitive tournament coverage transcripts.
 */

import { MagicFormat } from './meta';

/**
 * A sideboard swap recommendation for a specific card
 */
export interface SideboardSwap {
  cardName: string;
  count: number;
  reason: string;
}

/**
 * A complete sideboard plan recommendation for a matchup
 */
export interface SideboardRecommendation {
  id: string;
  format: MagicFormat;
  yourArchetype: string;
  opponentArchetype: string;
  cardsIn: SideboardSwap[];
  cardsOut: SideboardSwap[];
  strategyNotes: string;
  confidence: number;
  source: string;
  lastUpdated: string;
}

/**
 * Match coverage data extracted from tournament transcripts
 */
export interface MatchCoverageData {
  format: MagicFormat;
  yourArchetype: string;
  opponentArchetype: string;
  transcript: string;
  sideboardSwaps: {
    gameNumber: number;
    cardsIn: SideboardSwap[];
    cardsOut: SideboardSwap[];
    commentary: string;
  }[];
  source: string; // e.g., "Pro Tour 2025", "SCG Tour"
  date: string;
}

/**
 * In-memory database of sideboard recommendations
 * In production, this would be loaded from a persistent store
 */
export class SideboardRecommendationDatabase {
  private recommendations: Map<string, SideboardRecommendation> = new Map();
  private coverageData: MatchCoverageData[] = [];

  /**
   * Generate a unique key for matchup lookup
   */
  private getMatchupKey(format: MagicFormat, yourArchetype: string, opponentArchetype: string): string {
    return `${format}:${yourArchetype.toLowerCase()}:vs:${opponentArchetype.toLowerCase()}`;
  }

  /**
   * Add a match coverage record to the database
   */
  addMatchCoverage(data: MatchCoverageData): void {
    this.coverageData.push(data);

    // Aggregate sideboard swaps into recommendations
    const key = this.getMatchupKey(data.format, data.yourArchetype, data.opponentArchetype);

    // Aggregate cards in
    const cardsInMap = new Map<string, { count: number; reasons: string[] }>();
    data.sideboardSwaps.forEach(swap => {
      swap.cardsIn.forEach(card => {
        const existing = cardsInMap.get(card.cardName) || { count: 0, reasons: [] };
        existing.count += card.count;
        if (card.reason && !existing.reasons.includes(card.reason)) {
          existing.reasons.push(card.reason);
        }
        cardsInMap.set(card.cardName, existing);
      });
    });

    // Aggregate cards out
    const cardsOutMap = new Map<string, { count: number; reasons: string[] }>();
    data.sideboardSwaps.forEach(swap => {
      swap.cardsOut.forEach(card => {
        const existing = cardsOutMap.get(card.cardName) || { count: 0, reasons: [] };
        existing.count += card.count;
        if (card.reason && !existing.reasons.includes(card.reason)) {
          existing.reasons.push(card.reason);
        }
        cardsOutMap.set(card.cardName, existing);
      });
    });

    // Create or update recommendation
    const numGames = data.sideboardSwaps.length || 1;
    const cardsIn: SideboardSwap[] = Array.from(cardsInMap.entries()).map(([name, data]) => ({
      cardName: name,
      count: Math.ceil(data.count / numGames), // Average count
      reason: data.reasons.join('; '),
    }));

    const cardsOut: SideboardSwap[] = Array.from(cardsOutMap.entries()).map(([name, data]) => ({
      cardName: name,
      count: Math.ceil(data.count / numGames),
      reason: data.reasons.join('; '),
    }));

    const recommendation: SideboardRecommendation = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      format: data.format,
      yourArchetype: data.yourArchetype,
      opponentArchetype: data.opponentArchetype,
      cardsIn,
      cardsOut,
      strategyNotes: this.generateStrategyNotes(data),
      confidence: this.calculateConfidence(data),
      source: data.source,
      lastUpdated: new Date().toISOString(),
    };

    this.recommendations.set(key, recommendation);
  }

  /**
   * Generate strategy notes from match coverage
   */
  private generateStrategyNotes(data: MatchCoverageData): string {
    const notes: string[] = [];

    data.sideboardSwaps.forEach((swap, index) => {
      if (swap.commentary) {
        notes.push(`Game ${index + 1}: ${swap.commentary}`);
      }
    });

    return notes.join('\n');
  }

  /**
   * Calculate confidence score based on data quality
   */
  private calculateConfidence(data: MatchCoverageData): number {
    let score = 0.5; // Base confidence

    // More games = higher confidence
    score += Math.min(data.sideboardSwaps.length * 0.1, 0.3);

    // Detailed commentary = higher confidence
    const hasDetailedCommentary = data.sideboardSwaps.some(
      swap => swap.commentary && swap.commentary.length > 50
    );
    if (hasDetailedCommentary) score += 0.1;

    // Consistent swaps = higher confidence
    const uniqueInCards = new Set(data.sideboardSwaps.flatMap(s => s.cardsIn.map(c => c.cardName)));
    const uniqueOutCards = new Set(data.sideboardSwaps.flatMap(s => s.cardsOut.map(c => c.cardName)));
    const swapConsistency = Math.min((uniqueInCards.size + uniqueOutCards.size) / 10, 0.1);
    score += swapConsistency;

    return Math.min(score, 1.0);
  }

  /**
   * Get recommendation for a specific matchup
   */
  getRecommendation(
    format: MagicFormat,
    yourArchetype: string,
    opponentArchetype: string
  ): SideboardRecommendation | null {
    const key = this.getMatchupKey(format, yourArchetype, opponentArchetype);
    return this.recommendations.get(key) || null;
  }

  /**
   * Get all recommendations for a format
   */
  getRecommendationsByFormat(format: MagicFormat): SideboardRecommendation[] {
    return Array.from(this.recommendations.values()).filter(
      rec => rec.format === format
    );
  }

  /**
   * Get all coverage data
   */
  getCoverageData(): MatchCoverageData[] {
    return [...this.coverageData];
  }

  /**
   * Initialize database with sample data (for testing/demo)
   */
  initializeWithSampleData(): void {
    // Sample: Red Aggro vs Blue Control in Standard
    this.addMatchCoverage({
      format: 'standard',
      yourArchetype: 'Red Aggro',
      opponentArchetype: 'Blue Control',
      transcript: '',
      sideboardSwaps: [
        {
          gameNumber: 2,
          cardsIn: [
            { cardName: 'Abrade', count: 2, reason: 'Remove their key permanents' },
            { cardName: 'Rogue Refinery', count: 2, reason: 'Card advantage against removal' },
          ],
          cardsOut: [
            { cardName: 'Goblin Guide', count: 2, reason: 'Too slow against removal' },
            { cardName: 'Lavamancer', count: 2, reason: 'Needs graveyard access they deny' },
          ],
          commentary: 'Need to grind through their counterspells and removal. Abrade hits Teferi and other threats.',
        },
        {
          gameNumber: 3,
          cardsIn: [
            { cardName: 'Unquenchable Thirst', count: 2, reason: 'Counters their card draw' },
          ],
          cardsOut: [
            { cardName: 'Viashino Sandscout', count: 2, reason: 'Dies to instant removal' },
          ],
          commentary: 'Focus on disrupting their card advantage engines.',
        },
      ],
      source: 'Pro Tour 2025',
      date: '2025-03-15',
    });

    // Sample: Blue Control vs Red Aggro in Standard
    this.addMatchCoverage({
      format: 'standard',
      yourArchetype: 'Blue Control',
      opponentArchetype: 'Red Aggro',
      transcript: '',
      sideboardSwaps: [
        {
          gameNumber: 2,
          cardsIn: [
            { cardName: 'Negate', count: 2, reason: 'Counter burn spells' },
            { cardName: 'Aether Gust', count: 2, reason: 'Handle red threats efficiently' },
            { cardName: 'Cleansing Wildfire', count: 2, reason: 'Deal with problematic lands' },
          ],
          cardsOut: [
            { cardName: 'Orcish Bowmasters', count: 2, reason: 'Too slow against aggro' },
            { cardName: 'The One Ring', count: 1, reason: 'Too much mana against fast decks' },
          ],
          commentary: 'Need cheap interaction to survive early game. Negate is excellent here.',
        },
      ],
      source: 'SCG Tour',
      date: '2025-04-01',
    });

    // Sample: Modern Jund vs Burn
    this.addMatchCoverage({
      format: 'modern',
      yourArchetype: 'Jund',
      opponentArchetype: 'Burn',
      transcript: '',
      sideboardSwaps: [
        {
          gameNumber: 2,
          cardsIn: [
            { cardName: 'Collector Ouphe', count: 2, reason: 'Stops artifact burn spells' },
            { cardName: 'Kitchen Finks', count: 2, reason: 'Life gain and blocker' },
            { cardName: 'Tireless Tracker', count: 2, reason: 'Grinds through burn' },
          ],
          cardsOut: [
            { cardName: 'Thoughtseize', count: 2, reason: 'Life loss is too risky' },
            { cardName: 'Kolaghan\'s Command', count: 1, reason: 'Less relevant against burn' },
          ],
          commentary: 'Life loss is the enemy. Focus on gaining life and disruption.',
        },
      ],
      source: 'Modern Challenge',
      date: '2025-02-20',
    });

    // Sample: UW Control vs Tron
    this.addMatchCoverage({
      format: 'modern',
      yourArchetype: 'UW Control',
      opponentArchetype: 'Tron',
      transcript: '',
      sideboardSwaps: [
        {
          gameNumber: 2,
          cardsIn: [
            { cardName: 'Mystical Dispute', count: 2, reason: 'Counters their big spells' },
            { cardName: 'Force of Negation', count: 2, reason: 'Free counter for turn 3 Karn' },
            { cardName: 'Rip Apart', count: 2, reason: 'Answers to artifacts and enchantments' },
          ],
          cardsOut: [
            { cardName: 'Teferi, Time Raveler', count: 2, reason: 'Too slow against Tron' },
          ],
          commentary: 'Need to disrupt Tron assembly. Force of Negation is crucial.',
        },
      ],
      source: 'Modern League',
      date: '2025-03-01',
    });

    // Sample: Commander Aggro vs Commander Control
    this.addMatchCoverage({
      format: 'commander',
      yourArchetype: 'Commander Aggro',
      opponentArchetype: 'Commander Control',
      transcript: '',
      sideboardSwaps: [
        {
          gameNumber: 2,
          cardsIn: [
            { cardName: 'Vexing Shusher', count: 1, reason: 'Prevent counterspells' },
            { cardName: 'Veil of Summer', count: 1, reason: 'Protection from blue/black' },
          ],
          cardsOut: [
            { cardName: 'Sol Ring', count: 1, reason: 'Already fast enough' },
          ],
          commentary: 'In a multiplayer setting, uncounterable threats are key.',
        },
      ],
      source: 'Commander Night',
      date: '2025-04-10',
    });
  }
}

/**
 * Singleton database instance
 */
const database = new SideboardRecommendationDatabase();

/**
 * Get sideboard recommendations for a matchup
 */
export function getSideboardRecommendation(
  format: MagicFormat,
  yourArchetype: string,
  opponentArchetype: string
): SideboardRecommendation | null {
  return database.getRecommendation(format, yourArchetype, opponentArchetype);
}

/**
 * Add match coverage data to build recommendations
 */
export function addMatchCoverage(data: MatchCoverageData): void {
  database.addMatchCoverage(data);
}

/**
 * Get all recommendations for a format
 */
export function getRecommendationsByFormat(format: MagicFormat): SideboardRecommendation[] {
  return database.getRecommendationsByFormat(format);
}

/**
 * Initialize database with sample data
 */
export function initializeSideboardDatabase(): void {
  database.initializeWithSampleData();
}

/**
 * Get raw coverage data for analysis
 */
export function getCoverageData(): MatchCoverageData[] {
  return database.getCoverageData();
}

// Auto-initialize with sample data for demo purposes
if (typeof window !== 'undefined') {
  initializeSideboardDatabase();
}
