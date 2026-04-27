/**
 * @fileoverview Tests for Counterspell Frequency Model
 *
 * Tests the data-driven opponent counterspell probability model.
 */

import { describe, it, expect } from '@jest/globals';
import {
  getCounterspellProbability,
  getStackContentType,
  COUNTERSPELL_FREQUENCY_MODEL,
} from '../counterspell-frequency-model';

describe('counterspell-frequency-model', () => {
  describe('getCounterspellProbability', () => {
    it('should return higher probability for control archetypes vs aggro', () => {
      const controlProb = getCounterspellProbability(
        'Draw-Go',
        4, // medium mana
        'medium_threat'
      );

      const aggroProb = getCounterspellProbability(
        'Burn',
        4, // medium mana
        'medium_threat'
      );

      expect(controlProb).toBeGreaterThan(aggroProb);
      expect(controlProb).toBeGreaterThanOrEqual(0.7); // Control should counter >70%
      expect(aggroProb).toBeLessThanOrEqual(0.3); // Aggro should counter <30%
    });

    it('should return higher probability for high threat vs low threat', () => {
      const highThreatProb = getCounterspellProbability(
        'Draw-Go',
        4, // medium mana
        'game_winning'
      );

      const lowThreatProb = getCounterspellProbability(
        'Draw-Go',
        4, // medium mana
        'low_threat'
      );

      expect(highThreatProb).toBeGreaterThan(lowThreatProb);
      expect(highThreatProb).toBeGreaterThan(0.9); // Control counters game-winning threats
    });

    it('should return higher probability with more mana available', () => {
      const lowManaProb = getCounterspellProbability(
        'Draw-Go',
        1, // low mana
        'medium_threat'
      );

      const highManaProb = getCounterspellProbability(
        'Draw-Go',
        6, // high mana
        'medium_threat'
      );

      expect(highManaProb).toBeGreaterThan(lowManaProb);
    });

    it('should handle unknown archetypes with conservative default', () => {
      const prob = getCounterspellProbability(
        'UnknownArchetype',
        4,
        'medium_threat'
      );

      // Should return conservative default (0.25)
      expect(prob).toBe(0.25);
    });

    it('should return valid probabilities (0-1) for all inputs', () => {
      const archetypes = ['Draw-Go', 'Burn', 'Good Stuff', 'Elves', 'Storm'];
      const manaLevels = [1, 4, 7];
      const stackContents = ['low_threat', 'medium_threat', 'high_threat', 'game_winning'];

      for (const archetype of archetypes) {
        for (const mana of manaLevels) {
          for (const stackContent of stackContents) {
            const prob = getCounterspellProbability(
              archetype,
              mana,
              stackContent as any
            );
            expect(prob).toBeGreaterThanOrEqual(0);
            expect(prob).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it('should return probabilities for hybrid archetypes', () => {
      const tempoControlProb = getCounterspellProbability(
        'Tempo-Control',
        4, // medium mana
        'medium_threat'
      );

      expect(tempoControlProb).toBeGreaterThan(0.4);
      expect(tempoControlProb).toBeLessThan(0.8);
      // Tempo-Control should be between control and aggro probabilities
    });

    it('should return low probability for empty stack content (no threat)', () => {
      const prob = getCounterspellProbability(
        'Draw-Go',
        4,
        'empty'
      );

      // Empty stack should have lower probability (50% of low_threat)
      expect(prob).toBeGreaterThanOrEqual(0.2);
      expect(prob).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Control vs Aggro Counterspell Probability Differences', () => {
    it('should show significant difference between Draw-Go and Burn', () => {
      const scenarios = [
        { mana: 1, threat: 'low_threat' },
        { mana: 4, threat: 'medium_threat' },
        { mana: 7, threat: 'high_threat' },
        { mana: 4, threat: 'game_winning' },
      ];

      for (const scenario of scenarios) {
        const controlProb = getCounterspellProbability(
          'Draw-Go',
          scenario.mana,
          scenario.threat as any
        );
        const aggroProb = getCounterspellProbability(
          'Burn',
          scenario.mana,
          scenario.threat as any
        );

        // Control should counter significantly more often than aggro
        const difference = controlProb - aggroProb;
        expect(difference).toBeGreaterThan(0.3); // At least 30% difference
      }
    });

    it('should show moderate difference between Tempo-Control and Aggro-Midrange', () => {
      const tempoControlProb = getCounterspellProbability(
        'Tempo-Control',
        4,
        'medium_threat'
      );
      const aggroMidrangeProb = getCounterspellProbability(
        'Aggro-Midrange',
        4,
        'medium_threat'
      );

      // Tempo-Control should counter more than Aggro-Midrange
      expect(tempoControlProb).toBeGreaterThan(aggroMidrangeProb);
      const difference = tempoControlProb - aggroMidrangeProb;
      expect(difference).toBeGreaterThan(0.1); // At least 10% difference
    });

    it('should show similar probability for same archetype categories', () => {
      const drawGoProb = getCounterspellProbability(
        'Draw-Go',
        4,
        'medium_threat'
      );
      const staxProb = getCounterspellProbability(
        'Stax',
        4,
        'medium_threat'
      );

      // Both control archetypes should have similar high probability
      expect(Math.abs(drawGoProb - staxProb)).toBeLessThan(0.3);
      expect(drawGoProb).toBeGreaterThan(0.5);
      expect(staxProb).toBeGreaterThan(0.3);
    });

    it('should show aggro archetypes have low counterspell probability', () => {
      const aggroArchetypes = ['Burn', 'Zoo', 'Sligh'];

      for (const archetype of aggroArchetypes) {
        const prob = getCounterspellProbability(
          archetype,
          4,
          'medium_threat'
        );

        expect(prob).toBeLessThan(0.35); // Aggro rarely counters
      }
    });

    it('should show tribal archetypes have moderate counterspell probability', () => {
      const tribalArchetypes = ['Elves', 'Goblins', 'Zombies'];

      for (const archetype of tribalArchetypes) {
        const prob = getCounterspellProbability(
          archetype,
          4,
          'medium_threat'
        );

        // Tribal archetypes are creature-focused, moderate counterspells
        expect(prob).toBeGreaterThan(0.15);
        expect(prob).toBeLessThan(0.45);
      }
    });
  });

  describe('getStackContentType', () => {
    it('should return game_winning for high threat levels', () => {
      const contentType = getStackContentType(0.9, 5);
      expect(contentType).toBe('game_winning');
    });

    it('should return high_threat for moderate-high threat', () => {
      const contentType = getStackContentType(0.7, 5);
      expect(contentType).toBe('high_threat');
    });

    it('should return medium_threat for moderate threat', () => {
      const contentType = getStackContentType(0.4, 5);
      expect(contentType).toBe('medium_threat');
    });

    it('should return low_threat for low threat', () => {
      const contentType = getStackContentType(0.1, 5);
      expect(contentType).toBe('low_threat');
    });

    it('should return empty for zero threat', () => {
      const contentType = getStackContentType(0, 5);
      expect(contentType).toBe('empty');
    });
  });

  describe('Frequency Model Data Integrity', () => {
    it('should have entries for all archetypes', () => {
      const archetypes = new Set(
        COUNTERSPELL_FREQUENCY_MODEL.map(entry => entry.archetype)
      );

      // Check for all major archetype categories
      const expectedCategories = [
        'Draw-Go', 'Stax', 'Prison', // Control
        'Burn', 'Zoo', 'Sligh', // Aggro
        'Good Stuff', 'Rock', 'Value', // Midrange
        'Storm', 'Reanimator', 'Infinite', // Combo
        'Elves', 'Goblins', 'Zombies', 'Dragons', // Tribal
        'Lands', 'Superfriends', // Special
        'Midrange Pile', 'Tempo-Control', 'Aggro-Midrange', 'Control-Midrange', 'Jund-style', // Hybrid
      ];

      for (const expected of expectedCategories) {
        expect(archetypes.has(expected)).toBe(true);
      }
    });

    it('should have all mana categories for each archetype', () => {
      const archetypes = new Set(
        COUNTERSPELL_FREQUENCY_MODEL.map(entry => entry.archetype)
      );

      for (const archetype of archetypes) {
        const entries = COUNTERSPELL_FREQUENCY_MODEL.filter(
          entry => entry.archetype === archetype
        );

        const manaCategories = new Set(
          entries.map(entry => entry.manaAvailable)
        );

        // Each archetype should have entries for low, medium, and high mana
        expect(manaCategories.has('low')).toBe(true);
        expect(manaCategories.has('medium')).toBe(true);
        expect(manaCategories.has('high')).toBe(true);
      }
    });

    it('should have all stack content types for each archetype', () => {
      const archetypes = new Set(
        COUNTERSPELL_FREQUENCY_MODEL.map(entry => entry.archetype)
      );

      for (const archetype of archetypes) {
        const entries = COUNTERSPELL_FREQUENCY_MODEL.filter(
          entry => entry.archetype === archetype
        );

        const stackContentTypes = new Set(
          entries.map(entry => entry.stackContent)
        );

        // Each archetype should have entries for all threat levels
        expect(stackContentTypes.has('low_threat')).toBe(true);
        expect(stackContentTypes.has('medium_threat')).toBe(true);
        expect(stackContentTypes.has('high_threat')).toBe(true);
        expect(stackContentTypes.has('game_winning')).toBe(true);
      }
    });

    it('should have valid probability values (0-1)', () => {
      for (const entry of COUNTERSPELL_FREQUENCY_MODEL) {
        expect(entry.probability).toBeGreaterThanOrEqual(0);
        expect(entry.probability).toBeLessThanOrEqual(1);
      }
    });
  });
});
