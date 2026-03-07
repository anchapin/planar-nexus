/**
 * @fileOverview Tests for heuristic deck coach module
 */

import { describe, it, expect } from '@jest/globals';
import { reviewDeckHeuristic } from '../heuristic-deck-coach';

describe('heuristic-deck-coach', () => {
  const sampleDeck = [
    { name: 'Sol Ring', count: 1, id: '1', cmc: 1, colors: [], legalities: {}, type_line: 'Artifact', mana_cost: '{1}', color_identity: [] },
    { name: 'Counterspell', count: 4, id: '2', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
    { name: 'Thoughtseize', count: 2, id: '3', cmc: 1, colors: ['B'], legalities: {}, type_line: 'Sorcery', mana_cost: '{B}', color_identity: ['B'] },
    { name: 'Cryptic Command', count: 2, id: '4', cmc: 4, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}{U}{U}', color_identity: ['U'] },
  ];

  describe('reviewDeckHeuristic', () => {
    it('should return a valid DeckReviewOutput structure', () => {
      const result = reviewDeckHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result).toHaveProperty('reviewSummary');
      expect(result).toHaveProperty('deckOptions');
      expect(result.reviewSummary).toBeInstanceOf(String);
      expect(result.deckOptions).toBeInstanceOf(Array);
    });

    it('should analyze archetype correctly', () => {
      const result = reviewDeckHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result.reviewSummary).toBeDefined();
      expect(result.deckOptions.length).toBeGreaterThan(0);
    });

    it('should provide deck size analysis for Commander', () => {
      const smallDeck = [
        { name: 'Sol Ring', count: 1, id: '1', cmc: 1, colors: [], legalities: {}, type_line: 'Artifact', mana_cost: '{1}', color_identity: [] },
      ];
      const result = reviewDeckHeuristic('1 Sol Ring', 'commander', smallDeck);

      expect(result.reviewSummary).toContain('Deck size');
    });

    it('should provide mana curve analysis', () => {
      const result = reviewDeckHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result.reviewSummary).toContain('mana curve');
    });

    it('should suggest deck options', () => {
      const result = reviewDeckHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result.deckOptions.length).toBeGreaterThan(0);
      result.deckOptions.forEach(option => {
        expect(option).toHaveProperty('title');
        expect(option).toHaveProperty('description');
      });
    });

    it('should handle aggro archetype correctly', () => {
      const aggroDeck = [
        { name: 'Goblin Guide', count: 4, id: '1', cmc: 1, colors: ['R'], legalities: {}, type_line: 'Creature', mana_cost: '{R}', color_identity: ['R'] },
        { name: 'Lightning Bolt', count: 4, id: '2', cmc: 1, colors: ['R'], legalities: {}, type_line: 'Instant', mana_cost: '{R}', color_identity: ['R'] },
        { name: 'Monastery Swiftspear', count: 4, id: '3', cmc: 1, colors: ['R'], legalities: {}, type_line: 'Creature', mana_cost: '{R}', color_identity: ['R'] },
      ];
      const result = reviewDeckHeuristic('4 Goblin Guide', 'modern', aggroDeck);

      expect(result.reviewSummary).toMatch(/aggro/i);
    });

    it('should handle control archetype correctly', () => {
      const controlDeck = [
        { name: 'Counterspell', count: 4, id: '1', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
        { name: 'Brainstorm', count: 4, id: '2', cmc: 1, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}', color_identity: ['U'] },
        { name: 'Ponder', count: 4, id: '3', cmc: 1, colors: ['U'], legalities: {}, type_line: 'Sorcery', mana_cost: '{U}', color_identity: ['U'] },
      ];
      const result = reviewDeckHeuristic('4 Counterspell', 'legacy', controlDeck);

      expect(result.reviewSummary).toMatch(/control/i);
    });

    it('should handle empty deck gracefully', () => {
      const result = reviewDeckHeuristic('', 'commander', []);

      expect(result).toBeDefined();
      expect(result.reviewSummary).toBeDefined();
      expect(result.deckOptions).toBeDefined();
    });

    it('should provide format-specific recommendations', () => {
      const modernResult = reviewDeckHeuristic('1 Sol Ring', 'modern', sampleDeck);
      expect(modernResult.reviewSummary).toBeDefined();

      const commanderResult = reviewDeckHeuristic('1 Sol Ring', 'commander', sampleDeck);
      expect(commanderResult.reviewSummary).toBeDefined();

      const standardResult = reviewDeckHeuristic('1 Sol Ring', 'standard', sampleDeck);
      expect(standardResult.reviewSummary).toBeDefined();
    });

    it('should detect color distribution', () => {
      const monoBlueDeck = [
        { name: 'Counterspell', count: 4, id: '1', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
        { name: 'Brainstorm', count: 4, id: '2', cmc: 1, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}', color_identity: ['U'] },
      ];
      const result = reviewDeckHeuristic('4 Counterspell', 'modern', monoBlueDeck);

      expect(result.reviewSummary).toMatch(/blue/i);
    });
  });
});
