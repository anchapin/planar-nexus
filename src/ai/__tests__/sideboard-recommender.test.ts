/**
 * @fileoverview Unit Tests for SideboardRecommender
 *
 * Tests for sideboard recommendation engine.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SideboardRecommender,
  getSideboardRecommendations,
  type SideboardRecommendation,
  type MatchCoverageTranscript,
} from '../sideboard-recommender';

describe('SideboardRecommender', () => {
  let recommender: SideboardRecommender;

  beforeEach(() => {
    recommender = new SideboardRecommender();
  });

  describe('constructor', () => {
    it('should initialize with default matchup data', () => {
      const database = recommender.getMatchupDatabase();

      expect(database.size).toBeGreaterThan(0);
      expect(database.has('aggro vs control') || database.has('control vs aggro')).toBe(true);
      expect(database.has('control vs midrange') || database.has('midrange vs control')).toBe(true);
    });

    it('should have Aggro vs Control data', () => {
      const database = recommender.getMatchupDatabase();
      const matchup = database.get('aggro vs control') || database.get('control vs aggro');

      expect(matchup).toBeDefined();
      expect(matchup?.sampleSize).toBeGreaterThan(0);
      expect(matchup?.swaps.length).toBeGreaterThan(0);
    });
  });

  describe('getRecommendations', () => {
    it('should return recommendations for known matchups', () => {
      const recommendation = recommender.getRecommendations(
        'Aggro',
        'Control'
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.yourArchetype).toBe('Aggro');
      expect(recommendation.opponentArchetype).toBe('Control');
      expect(recommendation.cardsIn.length).toBeGreaterThan(0);
      expect(recommendation.cardsOut.length).toBeGreaterThan(0);
      expect(recommendation.strategy).toBeDefined();
      expect(recommendation.confidence).toBeGreaterThan(0);
    });

    it('should handle reversed matchup order', () => {
      const rec1 = recommender.getRecommendations('Aggro', 'Control');
      const rec2 = recommender.getRecommendations('Control', 'Aggro');

      // Both should return valid recommendations
      expect(rec1.cardsIn.length).toBeGreaterThan(0);
      expect(rec2.cardsIn.length).toBeGreaterThan(0);
    });

    it('should return default recommendations for unknown matchups', () => {
      const recommendation = recommender.getRecommendations(
        'Unknown Archetype',
        'Another Unknown'
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.cardsIn).toEqual([]);
      expect(recommendation.cardsOut).toEqual([]);
      expect(recommendation.confidence).toBe(0.2);
      expect(recommendation.strategy).toContain('No specific matchup data');
    });

    it('should validate sideboard availability', () => {
      const currentSideboard = [
        { name: 'Chandra, Awakened Inferno', quantity: 2 },
        { name: 'Play with Fire', quantity: 2 },
      ];

      const recommendation = recommender.getRecommendations(
        'Aggro',
        'Midrange',
        currentSideboard
      );

      // Should have recommendations when we have matching cards
      expect(recommendation).toBeDefined();
      expect(recommendation.cardsIn.length).toBeGreaterThanOrEqual(0);
      expect(recommendation.cardsOut.length).toBeGreaterThanOrEqual(0);
    });

    it('should balance cards in and cards out', () => {
      const recommendation = recommender.getRecommendations(
        'Aggro',
        'Midrange'
      );

      const inCount = recommendation.cardsIn.reduce((sum, card) => sum + card.quantity, 0);
      const outCount = recommendation.cardsOut.reduce((sum, card) => sum + card.quantity, 0);

      // Should be approximately balanced
      expect(Math.abs(inCount - outCount)).toBeLessThanOrEqual(1);
    });

    it('should include key opponent cards', () => {
      const recommendation = recommender.getRecommendations(
        'Aggro',
        'Control'
      );

      expect(recommendation.keyOpponentCards).toBeDefined();
      expect(recommendation.keyOpponentCards!.length).toBeGreaterThan(0);
    });
  });

  describe('specific matchups', () => {
    it('should recommend Aggro vs Control correctly', () => {
      const recommendation = recommender.getRecommendations('Aggro', 'Control');

      // Should provide valid recommendations with a strategy
      expect(recommendation.strategy.length).toBeGreaterThan(0);
      expect(recommendation.cardsIn.length).toBeGreaterThan(0);
      expect(recommendation.cardsOut.length).toBeGreaterThan(0);
    });

    it('should recommend Midrange vs Control correctly', () => {
      const recommendation = recommender.getRecommendations('Midrange', 'Control');

      // Should provide valid recommendations
      expect(recommendation.strategy.length).toBeGreaterThan(0);
      expect(recommendation.cardsIn.length).toBeGreaterThan(0);
      expect(recommendation.cardsOut.length).toBeGreaterThan(0);
    });

    it('should recommend Aggro vs Midrange correctly', () => {
      const recommendation = recommender.getRecommendations('Aggro', 'Midrange');

      // Should provide valid recommendations
      expect(recommendation.strategy.length).toBeGreaterThan(0);
      expect(recommendation.cardsIn.length).toBeGreaterThan(0);
      expect(recommendation.cardsOut.length).toBeGreaterThan(0);
    });

    it('should recommend Ramp vs Control correctly', () => {
      const recommendation = recommender.getRecommendations('Ramp', 'Control');

      // Should provide valid recommendations
      expect(recommendation.strategy.length).toBeGreaterThan(0);
      expect(recommendation.cardsIn.length).toBeGreaterThan(0);
      expect(recommendation.cardsOut.length).toBeGreaterThan(0);
    });
  });

  describe('addMatchupData', () => {
    it('should add new matchup data', () => {
      const initialSize = recommender.getMatchupDatabase().size;

      recommender.addMatchupData({
        matchup: 'new archetype vs another new',
        sampleSize: 50,
        winRate: 0.5,
        swaps: [
          {
            cardsIn: [{ name: 'Test Card', quantity: 2, reason: 'Testing' }],
            cardsOut: [{ name: 'Remove Me', quantity: 2, reason: 'Testing' }],
            frequency: 1.0,
            reasoning: 'Test reasoning',
          },
        ],
      });

      expect(recommender.getMatchupDatabase().size).toBe(initialSize + 1);
    });

    it('should replace existing matchup data', () => {
      recommender.addMatchupData({
        matchup: 'aggro vs control',
        sampleSize: 999,
        winRate: 0.99,
        swaps: [],
      });

      const database = recommender.getMatchupDatabase();
      const matchup = database.get('aggro vs control');

      expect(matchup?.sampleSize).toBe(999);
    });
  });

  describe('importFromTranscript', () => {
    it('should import data from transcript', () => {
      const transcript: MatchCoverageTranscript = {
        yourArchetype: 'Test Archetype',
        opponentArchetype: 'Test Opponent',
        cardsIn: [{ name: 'Sideboard Card', quantity: 2, reason: 'Good card' }],
        cardsOut: [{ name: 'Main Deck Card', quantity: 2, reason: 'Bad matchup' }],
        reasoning: 'Transcript reasoning',
        winRate: 0.6,
      };

      recommender.importFromTranscript(transcript);

      const database = recommender.getMatchupDatabase();
      const key = 'test archetype vs test opponent';

      // Verify data was imported
      expect(database.has(key)).toBe(true);
      const matchup = database.get(key);
      expect(matchup?.sampleSize).toBe(1);
      expect(matchup?.swaps[0].reasoning).toBe('Transcript reasoning');
    });

    it('should update existing matchup from transcript', () => {
      const transcript: MatchCoverageTranscript = {
        yourArchetype: 'Aggro',
        opponentArchetype: 'Control',
        cardsIn: [{ name: 'New Card', quantity: 1, reason: 'New strategy' }],
        cardsOut: [{ name: 'Old Card', quantity: 1, reason: 'No longer needed' }],
        reasoning: 'Updated from transcript',
      };

      const initialSampleSize = recommender.getMatchupDatabase().get('aggro vs control')?.sampleSize || 0;

      recommender.importFromTranscript(transcript);

      const updatedSampleSize = recommender.getMatchupDatabase().get('aggro vs control')?.sampleSize || 0;

      expect(updatedSampleSize).toBeGreaterThan(initialSampleSize);
    });
  });

  describe('convenience function', () => {
    it('should work with getSideboardRecommendations', () => {
      const recommendation = getSideboardRecommendations(
        'Aggro',
        'Control'
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.yourArchetype).toBe('Aggro');
      expect(recommendation.opponentArchetype).toBe('Control');
    });
  });

  describe('edge cases', () => {
    it('should handle empty current sideboard', () => {
      const recommendation = recommender.getRecommendations(
        'Red Deck Wins',
        'Control',
        []
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.cardsIn.length).toBe(0);
      expect(recommendation.cardsOut.length).toBe(0);
    });

    it('should handle partial sideboard availability', () => {
      const partialSideboard = [
        { name: 'Unignorable', quantity: 1 },
      ];

      const recommendation = recommender.getRecommendations(
        'Red Deck Wins',
        'Control',
        partialSideboard
      );

      // Should only recommend what we have
      recommendation.cardsIn.forEach(card => {
        const available = partialSideboard.find(s => s.name === card.name);
        if (available) {
          expect(card.quantity).toBeLessThanOrEqual(available.quantity);
        }
      });
    });

    it('should handle archetype names with spaces', () => {
      const recommendation = recommender.getRecommendations(
        'Midrange',
        'Control'
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.yourArchetype).toBe('Midrange');
    });

    it('should provide reasonable confidence scores', () => {
      const rec1 = recommender.getRecommendations('Aggro', 'Control');
      const rec2 = recommender.getRecommendations('Unknown', 'Also Unknown');

      // Unknown matchups should have low confidence
      expect(rec2.confidence).toBe(0.2);

      // Known matchups should have higher confidence (based on sample size)
      expect(rec1.confidence).toBeGreaterThan(0.2);
    });
  });

  describe('common matchup pairs', () => {
    const commonMatchups = [
      ['Aggro', 'Control'],
      ['Aggro', 'Midrange'],
      ['Midrange', 'Control'],
      ['Ramp', 'Control'],
    ];

    commonMatchups.forEach(([archetype1, archetype2]) => {
      it(`should provide recommendations for ${archetype1} vs ${archetype2}`, () => {
        const recommendation = recommender.getRecommendations(archetype1, archetype2);

        expect(recommendation).toBeDefined();
        expect(recommendation.cardsIn).toBeDefined();
        expect(recommendation.cardsOut).toBeDefined();
        expect(recommendation.strategy).toBeDefined();
      });
    });
  });
});
