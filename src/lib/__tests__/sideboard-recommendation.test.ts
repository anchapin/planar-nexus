/**
 * Tests for Sideboard Recommendation Engine
 * Tests 5 common matchup pairs as specified in GH#678
 */

import {
  SideboardRecommendationDatabase,
  MatchCoverageData,
  getSideboardRecommendation,
  addMatchCoverage,
  getRecommendationsByFormat,
  initializeSideboardDatabase,
} from '../sideboard-recommendation';
import { MagicFormat } from '../meta';

describe('Sideboard Recommendation Engine', () => {
  let db: SideboardRecommendationDatabase;

  beforeEach(() => {
    db = new SideboardRecommendationDatabase();
  });

  describe('Matchup 1: Red Aggro vs Blue Control (Standard)', () => {
    test('should provide sideboard recommendations', () => {
      const coverage: MatchCoverageData = {
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
            ],
            commentary: 'Need to grind through counterspells and removal',
          },
        ],
        source: 'Pro Tour 2025',
        date: '2025-03-15',
      };

      db.addMatchCoverage(coverage);
      const rec = db.getRecommendation('standard', 'Red Aggro', 'Blue Control');

      expect(rec).not.toBeNull();
      expect(rec?.yourArchetype).toBe('Red Aggro');
      expect(rec?.opponentArchetype).toBe('Blue Control');
      expect(rec?.cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Abrade' })
      );
      expect(rec?.cardsOut).toContainEqual(
        expect.objectContaining({ cardName: 'Goblin Guide' })
      );
    });
  });

  describe('Matchup 2: Blue Control vs Red Aggro (Standard)', () => {
    test('should provide reverse matchup recommendations', () => {
      const coverage: MatchCoverageData = {
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
            ],
            cardsOut: [
              { cardName: 'Orcish Bowmasters', count: 2, reason: 'Too slow against aggro' },
            ],
            commentary: 'Need cheap interaction to survive early game',
          },
        ],
        source: 'SCG Tour',
        date: '2025-04-01',
      };

      db.addMatchCoverage(coverage);
      const rec = db.getRecommendation('standard', 'Blue Control', 'Red Aggro');

      expect(rec).not.toBeNull();
      expect(rec?.cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Negate' })
      );
      expect(rec?.cardsOut).toContainEqual(
        expect.objectContaining({ cardName: 'Orcish Bowmasters' })
      );
    });
  });

  describe('Matchup 3: Jund vs Burn (Modern)', () => {
    test('should provide modern matchup recommendations', () => {
      const coverage: MatchCoverageData = {
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
            ],
            cardsOut: [
              { cardName: 'Thoughtseize', count: 2, reason: 'Life loss is too risky' },
            ],
            commentary: 'Life loss is enemy',
          },
        ],
        source: 'Modern Challenge',
        date: '2025-02-20',
      };

      db.addMatchCoverage(coverage);
      const rec = db.getRecommendation('modern', 'Jund', 'Burn');

      expect(rec).not.toBeNull();
      expect(rec?.format).toBe('modern');
      expect(rec?.cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Kitchen Finks' })
      );
    });
  });

  describe('Matchup 4: UW Control vs Tron (Modern)', () => {
    test('should provide control vs big mana recommendations', () => {
      const coverage: MatchCoverageData = {
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
            ],
            cardsOut: [
              { cardName: 'Teferi, Time Raveler', count: 2, reason: 'Too slow against Tron' },
            ],
            commentary: 'Need to disrupt Tron assembly',
          },
        ],
        source: 'Modern League',
        date: '2025-03-01',
      };

      db.addMatchCoverage(coverage);
      const rec = db.getRecommendation('modern', 'UW Control', 'Tron');

      expect(rec).not.toBeNull();
      expect(rec?.cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Force of Negation' })
      );
    });
  });

  describe('Matchup 5: Commander Aggro vs Commander Control (Commander)', () => {
    test('should provide commander matchup recommendations', () => {
      const coverage: MatchCoverageData = {
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
            commentary: 'Uncounterable threats are key',
          },
        ],
        source: 'Commander Night',
        date: '2025-04-10',
      };

      db.addMatchCoverage(coverage);
      const rec = db.getRecommendation('commander', 'Commander Aggro', 'Commander Control');

      expect(rec).not.toBeNull();
      expect(rec?.format).toBe('commander');
      expect(rec?.cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Vexing Shusher' })
      );
    });
  });

  describe('Confidence Calculation', () => {
    test('should calculate higher confidence with more games', () => {
      const coverage1: MatchCoverageData = {
        format: 'standard',
        yourArchetype: 'Test Archetype 1',
        opponentArchetype: 'Test Archetype 2',
        transcript: '',
        sideboardSwaps: [
          {
            gameNumber: 2,
            cardsIn: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            cardsOut: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            commentary: 'Short',
          },
        ],
        source: 'Test',
        date: '2025-01-01',
      };

      const coverage2: MatchCoverageData = {
        format: 'standard',
        yourArchetype: 'Test Archetype 1',
        opponentArchetype: 'Test Archetype 2',
        transcript: '',
        sideboardSwaps: [
          {
            gameNumber: 2,
            cardsIn: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            cardsOut: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            commentary: 'Detailed commentary with much more information about why these cards are good in the matchup and how they interact with the opponent strategy',
          },
          {
            gameNumber: 3,
            cardsIn: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            cardsOut: [{ cardName: 'Card', count: 1, reason: 'Test' }],
            commentary: 'More detailed information',
          },
        ],
        source: 'Test',
        date: '2025-01-01',
      };

      db.addMatchCoverage(coverage1);
      const rec1 = db.getRecommendation('standard', 'Test Archetype 1', 'Test Archetype 2');

      const db2 = new SideboardRecommendationDatabase();
      db2.addMatchCoverage(coverage2);
      const rec2 = db2.getRecommendation('standard', 'Test Archetype 1', 'Test Archetype 2');

      expect(rec2?.confidence).toBeGreaterThan(rec1?.confidence || 0);
    });
  });

  describe('Format Filtering', () => {
    test('should return only recommendations for specified format', () => {
      db.addMatchCoverage({
        format: 'standard',
        yourArchetype: 'Deck A',
        opponentArchetype: 'Deck B',
        transcript: '',
        sideboardSwaps: [],
        source: 'Test',
        date: '2025-01-01',
      });

      db.addMatchCoverage({
        format: 'modern',
        yourArchetype: 'Deck C',
        opponentArchetype: 'Deck D',
        transcript: '',
        sideboardSwaps: [],
        source: 'Test',
        date: '2025-01-01',
      });

      const standardRecs = db.getRecommendationsByFormat('standard');
      const modernRecs = db.getRecommendationsByFormat('modern');

      expect(standardRecs).toHaveLength(1);
      expect(modernRecs).toHaveLength(1);
      expect(standardRecs[0].format).toBe('standard');
      expect(modernRecs[0].format).toBe('modern');
    });
  });

  describe('Matchup Key Generation', () => {
    test('should handle case-insensitive archetype matching', () => {
      db.addMatchCoverage({
        format: 'standard',
        yourArchetype: 'Red Aggro',
        opponentArchetype: 'Blue Control',
        transcript: '',
        sideboardSwaps: [],
        source: 'Test',
        date: '2025-01-01',
      });

      const rec1 = db.getRecommendation('standard', 'red aggro', 'blue control');
      const rec2 = db.getRecommendation('standard', 'RED AGGRO', 'BLUE CONTROL');

      expect(rec1).not.toBeNull();
      expect(rec2).not.toBeNull();
    });
  });
});
