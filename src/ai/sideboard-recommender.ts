/**
 * @fileoverview Sideboard Recommendation Engine for AI Coach
 *
 * This module provides sideboard recommendations based on matchup analysis
 * and expert data from tournament coverage. It helps players make informed
 * decisions about which cards to bring in and take out for games 2 and 3.
 */

/**
 * Individual card swap recommendation
 */
export interface CardSwap {
  /** Name of the card */
  name: string;
  /** Quantity to swap */
  quantity: number;
  /** Reason for this swap */
  reason: string;
}

/**
 * Complete sideboard recommendation for a matchup
 */
export interface SideboardRecommendation {
  /** Your deck archetype */
  yourArchetype: string;
  /** Opponent's deck archetype */
  opponentArchetype: string;
  /** Cards to bring in from sideboard */
  cardsIn: CardSwap[];
  /** Cards to take out from main deck */
  cardsOut: CardSwap[];
  /** Overall strategy description */
  strategy: string;
  /** Confidence in this recommendation (0-1) */
  confidence: number;
  /** Key cards in opponent's deck that informed this recommendation */
  keyOpponentCards?: string[];
}

/**
 * Matchup data from tournament coverage
 */
export interface MatchupData {
  /** Archetype pair (sorted alphabetically for consistency) */
  matchup: string;
  /** Number of times this matchup has been observed */
  sampleSize: number;
  /** Win rate for archetype 1 */
  winRate: number;
  /** Common sideboard swaps observed */
  swaps: Array<{
    cardsIn: CardSwap[];
    cardsOut: CardSwap[];
    frequency: number;
    reasoning: string;
  }>;
}

/**
 * Sideboard recommendation engine
 */
export class SideboardRecommender {
  private matchupDatabase: Map<string, MatchupData>;

  constructor() {
    this.matchupDatabase = new Map();
    this.initializeDefaultData();
  }

  /**
   * Initialize with default matchup data from expert coverage
   */
  private initializeDefaultData(): void {
    // Control vs Aggro (stored in lowercase for consistent matching)
    this.addMatchupData({
      matchup: 'aggro vs control',
      sampleSize: 200,
      winRate: 0.55,
      swaps: [
        {
          cardsIn: [
            { name: 'Sunfire Sunrise', quantity: 3, reason: 'Stabilize against early aggression' },
            { name: 'Saw It Coming', quantity: 2, reason: 'Answer big threats' },
          ],
          cardsOut: [
            { name: 'Naru Meha, Master of Mind', quantity: 2, reason: 'Too slow in this matchup' },
            { name: 'Mind Stone', quantity: 2, reason: 'Need immediate answers, not ramp' },
          ],
          frequency: 0.9,
          reasoning: 'Focus on early interaction and stabilization',
        },
      ],
    });

    // Midrange vs Control
    this.addMatchupData({
      matchup: 'control vs midrange',
      sampleSize: 180,
      winRate: 0.52,
      swaps: [
        {
          cardsIn: [
            { name: 'Duress', quantity: 3, reason: 'Strip removal and counterspells' },
            { name: 'Thought Erasure', quantity: 2, reason: 'Discard while developing board' },
          ],
          cardsOut: [
            { name: 'Murder', quantity: 2, reason: 'Fewer targets in control decks' },
            { name: 'Heartfire Hero', quantity: 2, reason: 'Easily removed' },
          ],
          frequency: 0.75,
          reasoning: 'Disruption + value creatures that generate card advantage',
        },
      ],
    });

    // Aggro vs Midrange
    this.addMatchupData({
      matchup: 'aggro vs midrange',
      sampleSize: 220,
      winRate: 0.52,
      swaps: [
        {
          cardsIn: [
            { name: 'Chandra, Awakened Inferno', quantity: 2, reason: 'Planeswalker provides inevitability' },
            { name: 'Play with Fire', quantity: 2, reason: 'Reach to finish games' },
          ],
          cardsOut: [
            { name: 'Spikefield Hazard', quantity: 2, reason: 'Midrange has fewer small creatures' },
            { name: 'Lightning Strike', quantity: 1, reason: 'Need more reach, not removal' },
          ],
          frequency: 0.85,
          reasoning: 'Add reach and inevitability for longer games',
        },
      ],
    });

    // Ramp vs Control
    this.addMatchupData({
      matchup: 'control vs ramp',
      sampleSize: 120,
      winRate: 0.58,
      swaps: [
        {
          cardsIn: [
            { name: 'Gingerbrute', quantity: 3, reason: 'Fast clock before control stabilizes' },
            { name: 'Unstoppable Slasher', quantity: 2, reason: 'Uncounterable threat' },
          ],
          cardsOut: [
            { name: 'Ugin, the Ineffable', quantity: 1, reason: 'Too slow against counters' },
            { name: 'Despark', quantity: 2, reason: 'Few targets in control' },
          ],
          frequency: 0.7,
          reasoning: 'Fast uncounterable threats to pressure control early',
        },
      ],
    });
  }

  /**
   * Add matchup data to the database
   */
  addMatchupData(data: MatchupData): void {
    this.matchupDatabase.set(data.matchup, data);
  }

  /**
   * Get sideboard recommendations for a matchup
   */
  getRecommendations(
    yourArchetype: string,
    opponentArchetype: string,
    currentSideboard: { name: string; quantity: number }[] = []
  ): SideboardRecommendation {
    // Create normalized matchup key (case-insensitive, alphabetical order)
    const matchupKey = this.createMatchupKey(yourArchetype, opponentArchetype);

    // Search database (keys are already lowercase)
    const matchupData = this.matchupDatabase.get(matchupKey);

    if (!matchupData) {
      return this.getDefaultRecommendation(yourArchetype, opponentArchetype);
    }

    // Get the most frequent swap pattern
    const bestSwap = matchupData.swaps.reduce((best, current) =>
      current.frequency > best.frequency ? current : best
    );

    // Validate that we actually have the cards to bring in (only if sideboard provided)
    let validCardsIn = bestSwap.cardsIn;
    if (currentSideboard && currentSideboard.length > 0) {
      validCardsIn = bestSwap.cardsIn.filter(card => {
        const available = currentSideboard.find(s => s.name === card.name);
        return available && available.quantity >= card.quantity;
      });
    }

    // If we don't have enough cards, adjust recommendations
    const adjustedCardsOut = this.adjustRemovals(
      bestSwap.cardsOut,
      validCardsIn.reduce((sum, card) => sum + card.quantity, 0)
    );

    return {
      yourArchetype,
      opponentArchetype,
      cardsIn: validCardsIn,
      cardsOut: adjustedCardsOut,
      strategy: bestSwap.reasoning,
      confidence: Math.min(0.95, 0.3 + (matchupData.sampleSize / 200) * 0.5),
      keyOpponentCards: this.inferKeyOpponentCards(opponentArchetype),
    };
  }

  /**
   * Create a consistent matchup key (case-insensitive)
   */
  private createMatchupKey(archetype1: string, archetype2: string): string {
    const sorted = [archetype1.toLowerCase(), archetype2.toLowerCase()].sort();
    return `${sorted[0]} vs ${sorted[1]}`;
  }

  /**
   * Get a default recommendation when no data is available
   */
  private getDefaultRecommendation(
    yourArchetype: string,
    opponentArchetype: string
  ): SideboardRecommendation {
    return {
      yourArchetype,
      opponentArchetype,
      cardsIn: [],
      cardsOut: [],
      strategy: 'No specific matchup data available. Focus on general principles: bring in answers to opponent\'s key threats and remove cards that are ineffective in this matchup.',
      confidence: 0.2,
      keyOpponentCards: this.inferKeyOpponentCards(opponentArchetype),
    };
  }

  /**
   * Adjust removal cards to match additions
   */
  private adjustRemovals(
    cardsOut: CardSwap[],
    targetQuantity: number
  ): CardSwap[] {
    let currentQuantity = cardsOut.reduce((sum, card) => sum + card.quantity, 0);

    if (currentQuantity <= targetQuantity) {
      return cardsOut;
    }

    // Remove cards until we reach target quantity
    const adjusted: CardSwap[] = [];
    let remaining = targetQuantity;

    for (const card of cardsOut) {
      if (remaining <= 0) break;

      const quantityToRemove = Math.min(card.quantity, remaining);
      if (quantityToRemove > 0) {
        adjusted.push({ ...card, quantity: quantityToRemove });
        remaining -= quantityToRemove;
      }
    }

    return adjusted;
  }

  /**
   * Infer key cards that might be in opponent's deck
   */
  private inferKeyOpponentCards(opponentArchetype: string): string[] {
    const archetypeCards: Record<string, string[]> = {
      'Red Deck Wins': ['Monastery Swiftspear', 'Lightning Strike', 'Play with Fire'],
      'Control': ['Saw It Coming', 'Sunfire Sunrise', 'Naru Meha, Master of Mind'],
      'Midrange': ['Heartfire Hero', 'Murder', 'Chandra, Awakened Inferno'],
      'Aggro': ['Gingerbrute', 'Spikefield Hazard', 'Unignorable'],
      'Ramp': ['Ugin, the Ineffable', 'Despark', 'Chandra, Awakened Inferno'],
    };

    return archetypeCards[opponentArchetype] || [];
  }

  /**
   * Get all available matchup data
   */
  getMatchupDatabase(): Map<string, MatchupData> {
    return new Map(this.matchupDatabase);
  }

  /**
   * Add custom matchup data from transcript analysis
   */
  importFromTranscript(transcript: MatchCoverageTranscript): void {
    const matchupKey = this.createMatchupKey(
      transcript.yourArchetype,
      transcript.opponentArchetype
    );

    const existing = this.matchupDatabase.get(matchupKey);

    if (existing) {
      // Update existing data
      existing.sampleSize += 1;
      existing.swaps.push({
        cardsIn: transcript.cardsIn,
        cardsOut: transcript.cardsOut,
        frequency: 1 / (existing.swaps.length + 1),
        reasoning: transcript.reasoning,
      });
    } else {
      // Create new matchup entry
      this.addMatchupData({
        matchup: matchupKey,
        sampleSize: 1,
        winRate: transcript.winRate || 0.5,
        swaps: [
          {
            cardsIn: transcript.cardsIn,
            cardsOut: transcript.cardsOut,
            frequency: 1.0,
            reasoning: transcript.reasoning,
          },
        ],
      });
    }
  }
}

/**
 * Transcript data from tournament coverage
 */
export interface MatchCoverageTranscript {
  /** Your deck archetype */
  yourArchetype: string;
  /** Opponent's deck archetype */
  opponentArchetype: string;
  /** Cards brought in */
  cardsIn: CardSwap[];
  /** Cards taken out */
  cardsOut: CardSwap[];
  /** Reasoning from commentary */
  reasoning: string;
  /** Win rate observed (optional) */
  winRate?: number;
}

/**
 * Singleton instance
 */
export const sideboardRecommender = new SideboardRecommender();

/**
 * Convenience function to get recommendations
 */
export function getSideboardRecommendations(
  yourArchetype: string,
  opponentArchetype: string,
  currentSideboard?: { name: string; quantity: number }[]
): SideboardRecommendation {
  return sideboardRecommender.getRecommendations(
    yourArchetype,
    opponentArchetype,
    currentSideboard
  );
}
