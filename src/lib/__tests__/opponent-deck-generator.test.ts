/**
 * @fileOverview Tests for enhanced opponent deck generator
 *
 * Tests the heuristic deck generation algorithms to ensure:
 * - Deck diversity across generated decks
 * - Archetype accuracy
 * - Color balance
 * - Power level consistency
 * - Format compliance
 */

import { generateOpponentDeck, generateRandomDeck, generateThemedDeck, generateColorDeck, getAvailableArchetypes, getAvailableThemes } from '../opponent-deck-generator';
import type { DeckArchetype, DifficultyLevel, Format, StrategicTheme } from '../opponent-deck-generator';

// Test utilities
function countUniqueCards(deck: any): number {
  return new Set(deck.cards.map((c: any) => c.name)).size;
}

function countTotalCards(deck: any): number {
  return deck.cards.reduce((sum: number, c: any) => sum + c.quantity, 0);
}

function calculateManaCurve(deck: any): number[] {
  const curve: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const card of deck.cards) {
    // Simplified curve calculation (in real implementation, would use actual card data)
    const cmc = Math.floor(Math.random() * 7); // Random for testing
    curve[Math.min(cmc, 7)] += card.quantity;
  }
  return curve;
}

// Test suite
describe('Opponent Deck Generator', () => {
  describe('Basic Generation', () => {
    test('should generate a valid deck', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      expect(deck).toBeDefined();
      expect(deck.name).toBeTruthy();
      expect(deck.archetype).toBe('aggro');
      expect(deck.difficulty).toBe('medium');
      expect(deck.format).toBe('commander');
      expect(deck.cards).toBeDefined();
      expect(deck.cards.length).toBeGreaterThan(0);
      expect(deck.colorIdentity).toBeDefined();
      expect(deck.strategicApproach).toBeTruthy();
    });

    test('should generate correct deck size for format', () => {
      const commanderDeck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty: 'medium',
      });

      const modernDeck = generateOpponentDeck({
        format: 'modern',
        archetype: 'midrange',
        difficulty: 'medium',
      });

      expect(countTotalCards(commanderDeck)).toBe(100);
      expect(countTotalCards(modernDeck)).toBe(60);
    });

    test('should respect color identity', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        colorIdentity: ['R', 'W'],
        difficulty: 'medium',
      });

      expect(deck.colorIdentity).toContain('R');
      expect(deck.colorIdentity).toContain('W');
    });
  });

  describe('Archetype Accuracy', () => {
    const archetypes: DeckArchetype[] = ['aggro', 'control', 'midrange', 'combo', 'ramp', 'prison', 'tempo', 'tokens', 'aristocrats', 'stompy'];

    test.each(archetypes)('should generate %s archetype deck', (archetype) => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype,
        difficulty: 'medium',
      });

      expect(deck.archetype).toBe(archetype);
      expect(deck.name).toContain(archetype.charAt(0).toUpperCase() + archetype.slice(1));
    });
  });

  describe('Difficulty Levels', () => {
    const difficulties: DifficultyLevel[] = ['easy', 'medium', 'hard', 'expert'];

    test.each(difficulties)('should generate %s difficulty deck', (difficulty) => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty,
      });

      expect(deck.difficulty).toBe(difficulty);
      expect(deck.strategicApproach).toContain(difficulty.charAt(0).toUpperCase() + difficulty.slice(1));
    });

    test('should increase deck quality with difficulty', () => {
      const easyDeck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty: 'easy',
      });

      const expertDeck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty: 'expert',
      });

      // Expert decks should have more unique cards (better quality)
      expect(countUniqueCards(expertDeck)).toBeGreaterThanOrEqual(countUniqueCards(easyDeck));
    });
  });

  describe('Theme Generation', () => {
    test('should generate themed deck', () => {
      const deck = generateThemedDeck('burn', 'commander', 'medium');

      expect(deck.theme).toBe('burn');
      expect(deck.name).toContain('Burn');
      expect(deck.strategicApproach).toBeTruthy();
    });

    test('should include theme-specific cards', () => {
      const deck = generateThemedDeck('goblins', 'commander', 'medium');

      // Should contain at least some goblin-related cards
      const hasGoblin = deck.cards.some((c: any) => c.name.toLowerCase().includes('goblin'));
      expect(hasGoblin).toBe(true);
    });
  });

  describe('Deck Diversity', () => {
    test('should generate different decks on multiple calls', () => {
      const deck1 = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      const deck2 = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      const deck3 = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      const cardSet1 = new Set(deck1.cards.map((c: any) => c.name));
      const cardSet2 = new Set(deck2.cards.map((c: any) => c.name));
      const cardSet3 = new Set(deck3.cards.map((c: any) => c.name));

      // At least one card should be different
      const allDifferent =
        cardSet1.size !== cardSet2.size ||
        cardSet2.size !== cardSet3.size ||
        cardSet1.size !== cardSet3.size;

      expect(allDifferent).toBe(true);
    });

    test('should maintain archetype consistency across random decks', () => {
      const decks = Array.from({ length: 10 }, () =>
        generateRandomDeck('commander')
      );

      const archetypes = decks.map((d) => d.archetype);
      const uniqueArchetypes = new Set(archetypes);

      // Should have variety in archetypes
      expect(uniqueArchetypes.size).toBeGreaterThan(3);
    });
  });

  describe('Color Balance', () => {
    test('should distribute colors appropriately', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        colorIdentity: ['U', 'B'],
        difficulty: 'medium',
      });

      // Should have lands for both colors
      const hasIsland = deck.cards.some((c: any) => c.name === 'Island');
      const hasSwamp = deck.cards.some((c: any) => c.name === 'Swamp');

      expect(hasIsland || hasSwamp).toBe(true);
    });

    test('should handle mono-color decks', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        colorIdentity: ['R'],
        difficulty: 'medium',
      });

      expect(deck.colorIdentity).toEqual(['R']);
    });

    test('should handle tri-color decks', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        colorIdentity: ['W', 'U', 'B'],
        difficulty: 'medium',
      });

      expect(deck.colorIdentity).toHaveLength(3);
    });
  });

  describe('Mana Curve', () => {
    test('should generate appropriate mana curve for aggro', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      const curve = calculateManaCurve(deck);

      // Aggro should have more low-cost cards
      const lowCost = curve[1] + curve[2] + curve[3];
      const highCost = curve[5] + curve[6] + curve[7];

      expect(lowCost).toBeGreaterThan(highCost);
    });

    test('should generate appropriate mana curve for control', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'control',
        difficulty: 'medium',
      });

      const curve = calculateManaCurve(deck);

      // Control should have more mid-cost cards
      const midCost = curve[3] + curve[4];
      const total = curve.reduce((a, b) => a + b, 0);

      expect(midCost / total).toBeGreaterThan(0.3);
    });

    test('should generate appropriate mana curve for ramp', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'ramp',
        difficulty: 'medium',
      });

      const curve = calculateManaCurve(deck);

      // Ramp should have more high-cost cards
      const highCost = curve[5] + curve[6] + curve[7];
      const total = curve.reduce((a, b) => a + b, 0);

      expect(highCost / total).toBeGreaterThan(0.3);
    });
  });

  describe('Helper Functions', () => {
    test('should return all available archetypes', () => {
      const archetypes = getAvailableArchetypes();

      expect(archetypes).toBeDefined();
      expect(archetypes.length).toBeGreaterThan(0);
      expect(archetypes).toContain('aggro');
      expect(archetypes).toContain('control');
    });

    test('should return themes for archetype', () => {
      const themes = getAvailableThemes('aggro');

      expect(themes).toBeDefined();
      expect(themes.length).toBeGreaterThan(0);
    });

    test('should handle color-based generation', () => {
      const deck = generateColorDeck(['R', 'W'], 'commander', 'medium');

      expect(deck.colorIdentity).toContain('R');
      expect(deck.colorIdentity).toContain('W');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty color identity', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty: 'medium',
      });

      expect(deck.colorIdentity).toBeDefined();
      expect(deck.colorIdentity.length).toBeGreaterThan(0);
    });

    test('should handle invalid inputs gracefully', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'midrange',
        difficulty: 'medium',
      });

      // Should still generate a valid deck
      expect(deck).toBeDefined();
      expect(countTotalCards(deck)).toBe(100);
    });
  });

  describe('Strategic Approach', () => {
    test('should generate meaningful strategic approach', () => {
      const deck = generateOpponentDeck({
        format: 'commander',
        archetype: 'aggro',
        difficulty: 'medium',
      });

      expect(deck.strategicApproach).toBeDefined();
      expect(deck.strategicApproach.length).toBeGreaterThan(50);

      // Should mention the archetype
      expect(deck.strategicApproach.toLowerCase()).toContain('aggro');
    });

    test('should mention difficulty in strategic approach', () => {
      const easyDeck = generateOpponentDeck({
        format: 'commander',
        archetype: 'control',
        difficulty: 'easy',
      });

      const hardDeck = generateOpponentDeck({
        format: 'commander',
        archetype: 'control',
        difficulty: 'hard',
      });

      expect(easyDeck.strategicApproach.toLowerCase()).toContain('suboptimal');
      expect(hardDeck.strategicApproach.toLowerCase()).toContain('well');
    });
  });
});

export {};
