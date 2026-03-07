/**
 * @fileOverview Tests for heuristic meta analysis module
 */

import { describe, it, expect } from '@jest/globals';
import { analyzeMetaHeuristic } from '../heuristic-meta-analysis';

describe('heuristic-meta-analysis', () => {
  const sampleDeck = [
    { name: 'Sol Ring', count: 1, id: '1', cmc: 1, colors: [], legalities: {}, type_line: 'Artifact', mana_cost: '{1}', color_identity: [] },
    { name: 'Counterspell', count: 4, id: '2', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
    { name: 'Thoughtseize', count: 2, id: '3', cmc: 1, colors: ['B'], legalities: {}, type_line: 'Sorcery', mana_cost: '{B}', color_identity: ['B'] },
  ];

  describe('analyzeMetaHeuristic', () => {
    it('should return a valid MetaAnalysisOutput structure', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result).toHaveProperty('currentMeta');
      expect(result).toHaveProperty('archetypes');
      expect(result).toHaveProperty('recommendations');
      expect(result.currentMeta).toBeInstanceOf(String);
      expect(result.archetypes).toBeInstanceOf(Array);
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should provide metagame overview', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      expect(result.currentMeta).toBeDefined();
      expect(result.currentMeta.length).toBeGreaterThan(0);
    });

    it('should provide format-specific metagame data', () => {
      const commanderResult = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);
      expect(commanderResult.archetypes.length).toBeGreaterThan(0);

      const modernResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck);
      expect(modernResult.archetypes.length).toBeGreaterThan(0);

      const standardResult = analyzeMetaHeuristic('1 Sol Ring', 'standard', sampleDeck);
      expect(standardResult.archetypes.length).toBeGreaterThan(0);
    });

    it('should generate recommendations', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec).toHaveProperty('title');
        expect(rec).toHaveProperty('description');
        expect(rec).toHaveProperty('cardsToAdd');
        expect(rec).toHaveProperty('cardsToRemove');
        expect(rec).toHaveProperty('matchup');
      });
    });

    it('should handle focus archetype parameter', () => {
      const controlResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck, 'control');
      expect(controlResult.recommendations.length).toBeGreaterThan(0);

      const aggroResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck, 'aggro');
      expect(aggroResult.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect deck archetype correctly', () => {
      const controlDeck = [
        { name: 'Counterspell', count: 4, id: '1', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
        { name: 'Brainstorm', count: 4, id: '2', cmc: 1, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}', color_identity: ['U'] },
      ];
      const result = analyzeMetaHeuristic('4 Counterspell', 'legacy', controlDeck);

      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide matchup strategies', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.recommendations.forEach(rec => {
        expect(rec.matchup).toHaveProperty('against');
        expect(rec.matchup).toHaveProperty('strategy');
        expect(rec.matchup.against).toBeInstanceOf(String);
        expect(rec.matchup.strategy).toBeInstanceOf(String);
      });
    });

    it('should suggest card additions and removals', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.recommendations.forEach(rec => {
        const hasAdditions = rec.cardsToAdd && rec.cardsToAdd.length > 0;
        const hasRemovals = rec.cardsToRemove && rec.cardsToRemove.length > 0;

        expect(hasAdditions || hasRemovals).toBe(true);

        if (hasAdditions) {
          rec.cardsToAdd.forEach(card => {
            expect(card).toHaveProperty('name');
            expect(card).toHaveProperty('quantity');
            expect(typeof card.name).toBe('string');
            expect(typeof card.quantity).toBe('number');
          });
        }

        if (hasRemovals) {
          rec.cardsToRemove.forEach(card => {
            expect(card).toHaveProperty('name');
            expect(card).toHaveProperty('quantity');
            expect(typeof card.name).toBe('string');
            expect(typeof card.quantity).toBe('number');
          });
        }
      });
    });

    it('should handle empty deck gracefully', () => {
      const result = analyzeMetaHeuristic('', 'commander', []);

      expect(result).toBeDefined();
      expect(result.currentMeta).toBeDefined();
      expect(result.archetypes).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    it('should provide archetypes with required properties', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype).toHaveProperty('name');
        expect(archetype).toHaveProperty('prevalence');
        expect(archetype).toHaveProperty('playstyle');
        expect(archetype).toHaveProperty('keyCards');
        expect(archetype).toHaveProperty('weaknesses');
      });
    });

    it('should include key cards in archetypes', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype.keyCards).toBeInstanceOf(Array);
        expect(archetype.keyCards.length).toBeGreaterThan(0);
      });
    });

    it('should include weaknesses in archetypes', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype.weaknesses).toBeInstanceOf(Array);
        expect(archetype.weaknesses.length).toBeGreaterThan(0);
      });
    });
  });
});
