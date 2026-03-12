/**
 * Tests for the card database test fixtures
 * 
 * Ensures test fixtures are properly structured and utilities work correctly.
 */

import {
  testCards,
  basicCard,
  sampleDeck,
  createCardCopy,
  createShuffledDeck,
  getCardsByColor,
  getCardsByType,
  getCardsByCmcRange,
} from '../__fixtures__/test-cards';

describe('Card Database Fixtures', () => {
  describe('testCards Array', () => {
    it('should contain at least 10 cards', () => {
      expect(testCards.length).toBeGreaterThanOrEqual(10);
    });

    it('should include all basic lands', () => {
      const landNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
      landNames.forEach(name => {
        const land = testCards.find(card => card.name === name);
        expect(land).toBeDefined();
        expect(land?.type_line).toContain('Land');
      });
    });

    it('should include cards from all colors', () => {
      const colors = ['W', 'U', 'B', 'R', 'G'];
      colors.forEach(color => {
        const coloredCards = testCards.filter(card => card.colors?.includes(color));
        expect(coloredCards.length).toBeGreaterThan(0);
      });
    });

    it('should include all card types', () => {
      const types = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land'];
      types.forEach(type => {
        const typedCards = testCards.filter(card => card.type_line?.includes(type));
        expect(typedCards.length).toBeGreaterThan(0);
      });
    });

    it('should have unique card names', () => {
      const names = testCards.map(card => card.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have valid card structure', () => {
      testCards.forEach(card => {
        expect(card).toHaveProperty('name');
        expect(card).toHaveProperty('cmc');
        expect(card).toHaveProperty('type_line');
        expect(typeof card.cmc).toBe('number');
        expect(typeof card.type_line).toBe('string');
      });
    });
  });

  describe('basicCard Fixture', () => {
    it('should have correct properties', () => {
      expect(basicCard.name).toBe('Test Creature');
      expect(basicCard.cmc).toBe(3);
      expect(basicCard.mana_cost).toBe('{2}{R}');
      expect(basicCard.type_line).toContain('Creature');
    });

    it('should be a red creature', () => {
      expect(basicCard.colors).toContain('R');
      expect(basicCard.power).toBe('3');
      expect(basicCard.toughness).toBe('2');
    });
  });

  describe('sampleDeck Fixture', () => {
    it('should have a name and format', () => {
      expect(sampleDeck.name).toBe('Test Aggro Deck');
      expect(sampleDeck.format).toBe('Standard');
    });

    it('should contain cards', () => {
      expect(sampleDeck.cards.length).toBeGreaterThan(0);
    });

    it('should have valid card quantities', () => {
      sampleDeck.cards.forEach(cardEntry => {
        expect(cardEntry.quantity).toBeGreaterThan(0);
        expect(cardEntry.quantity).toBeLessThanOrEqual(4);
      });
    });
  });

  describe('createCardCopy Utility', () => {
    it('should create a deep copy of a card', () => {
      const copy = createCardCopy(basicCard);
      
      // Should have same values
      expect(copy.name).toBe(basicCard.name);
      expect(copy.cmc).toBe(basicCard.cmc);
      
      // Should be a different object
      expect(copy).not.toBe(basicCard);
      
      // Modifying copy should not affect original
      copy.name = 'Modified Name';
      expect(basicCard.name).toBe('Test Creature');
    });
  });

  describe('createShuffledDeck Utility', () => {
    it('should return all cards', () => {
      const shuffled = createShuffledDeck();
      expect(shuffled.length).toBe(testCards.length);
    });

    it('should contain the same cards as original', () => {
      const shuffled = createShuffledDeck();
      const originalNames = testCards.map(card => card.name).sort();
      const shuffledNames = shuffled.map(card => card.name).sort();
      expect(originalNames).toEqual(shuffledNames);
    });

    it('should produce different order on each call', () => {
      const shuffle1 = createShuffledDeck();
      const shuffle2 = createShuffledDeck();
      
      // Probability of same order twice is extremely low
      // This test could theoretically fail, but very unlikely
      const sameOrder = shuffle1.every((card, i) => card.name === shuffle2[i].name);
      expect(sameOrder).toBe(false);
    });
  });

  describe('getCardsByColor Utility', () => {
    it('should filter cards by white color', () => {
      const whiteCards = getCardsByColor('W');
      expect(whiteCards.length).toBeGreaterThan(0);
      whiteCards.forEach(card => {
        expect(card.colors).toContain('W');
      });
    });

    it('should filter cards by blue color', () => {
      const blueCards = getCardsByColor('U');
      expect(blueCards.length).toBeGreaterThan(0);
      blueCards.forEach(card => {
        expect(card.colors).toContain('U');
      });
    });

    it('should return empty array for non-existent color', () => {
      const cards = getCardsByColor('X');
      expect(cards).toEqual([]);
    });
  });

  describe('getCardsByType Utility', () => {
    it('should filter creature cards', () => {
      const creatures = getCardsByType('Creature');
      expect(creatures.length).toBeGreaterThan(0);
      creatures.forEach(card => {
        expect(card.type_line).toContain('Creature');
      });
    });

    it('should filter instant cards', () => {
      const instants = getCardsByType('Instant');
      expect(instants.length).toBeGreaterThan(0);
      instants.forEach(card => {
        expect(card.type_line).toContain('Instant');
      });
    });

    it('should return empty array for non-existent type', () => {
      const cards = getCardsByType('NonExistent');
      expect(cards).toEqual([]);
    });
  });

  describe('getCardsByCmcRange Utility', () => {
    it('should get cards with CMC between 0 and 2', () => {
      const lowCostCards = getCardsByCmcRange(0, 2);
      expect(lowCostCards.length).toBeGreaterThan(0);
      lowCostCards.forEach(card => {
        expect(card.cmc).toBeGreaterThanOrEqual(0);
        expect(card.cmc).toBeLessThanOrEqual(2);
      });
    });

    it('should get cards with CMC between 4 and 6', () => {
      const highCostCards = getCardsByCmcRange(4, 6);
      expect(highCostCards.length).toBeGreaterThan(0);
      highCostCards.forEach(card => {
        expect(card.cmc).toBeGreaterThanOrEqual(4);
        expect(card.cmc).toBeLessThanOrEqual(6);
      });
    });

    it('should return all lands (CMC 0)', () => {
      const lands = getCardsByCmcRange(0, 0);
      const landCount = lands.filter(card => card.type_line?.includes('Land')).length;
      expect(landCount).toBe(5); // 5 basic lands
    });
  });

  describe('Fixture Data Integrity', () => {
    it('should not have negative CMC values', () => {
      testCards.forEach(card => {
        expect(card.cmc).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have valid color identities', () => {
      const validColors = ['W', 'U', 'B', 'R', 'G'];
      testCards.forEach(card => {
        if (card.color_identity && card.color_identity.length > 0) {
          card.color_identity.forEach((color: string) => {
            expect(validColors).toContain(color);
          });
        }
      });
    });

    it('should have rarity values', () => {
      const validRarities = ['L', 'C', 'U', 'R', 'M'];
      testCards.forEach(card => {
        expect(validRarities).toContain(card.rarity);
      });
    });
  });
});
