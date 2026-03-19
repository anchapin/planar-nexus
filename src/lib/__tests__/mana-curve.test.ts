/**
 * Unit tests for mana-curve.ts
 * 
 * Phase 20-02: Mana Curve Optimization
 * Requirements: MANA-01, MANA-02, MANA-03
 */

import {
  analyzeDeckManaCurve,
  determineStrategy,
  getStrategyProfile,
  getManaCurveRecommendations,
  getLandCountRecommendations,
  STRATEGY_CURVES,
} from '../mana-curve';

// Mock DeckCard type
const createMockDeckCard = (overrides: Partial<{
  name: string;
  cmc: number;
  type_line: string;
  mana_cost: string;
  count: number;
}> = {}): any => ({
  id: 'mock-card-1',
  name: 'Mock Card',
  cmc: 0,
  type_line: '',
  mana_cost: '',
  count: 1,
  ...overrides,
});

describe('analyzeDeckManaCurve', () => {
  it('should correctly count lands and non-lands', () => {
    const deck = [
      createMockDeckCard({ name: 'Forest', type_line: 'Land', count: 10 }),
      createMockDeckCard({ name: 'Elf', cmc: 1, type_line: 'Creature — Elf Warrior', count: 4 }),
      createMockDeckCard({ name: 'Llanowar Elves', cmc: 1, type_line: 'Creature — Elf Druid', count: 4 }),
      createMockDeckCard({ name: 'Wild Growth', cmc: 1, type_line: 'Enchantment', count: 2 }),
      createMockDeckCard({ name: 'Giant Growth', cmc: 1, type_line: 'Instant', count: 2 }),
    ];

    const result = analyzeDeckManaCurve(deck);

    expect(result.lands).toBe(10);
    expect(result.nonLands).toBe(12);
  });

  it('should calculate average CMC correctly', () => {
    const deck = [
      createMockDeckCard({ name: 'Forest', type_line: 'Land', count: 10 }),
      createMockDeckCard({ name: 'One Drop', cmc: 1, count: 4 }),
      createMockDeckCard({ name: 'Two Drop', cmc: 2, count: 4 }),
      createMockDeckCard({ name: 'Three Drop', cmc: 3, count: 4 }),
      createMockDeckCard({ name: 'Four Drop', cmc: 4, count: 4 }),
    ];

    const result = analyzeDeckManaCurve(deck);
    // (4*1 + 4*2 + 4*3 + 4*4) / 16 = (4+8+12+16)/16 = 40/16 = 2.5
    expect(result.averageCMC).toBeCloseTo(2.5, 1);
  });

  it('should handle empty deck', () => {
    const result = analyzeDeckManaCurve([]);
    
    expect(result.totalCards).toBe(0);
    expect(result.lands).toBe(0);
    expect(result.nonLands).toBe(0);
    expect(result.averageCMC).toBe(0);
  });

  it('should build correct curve points', () => {
    const deck = [
      createMockDeckCard({ name: 'Forest', type_line: 'Land', count: 20 }),
      createMockDeckCard({ name: 'One', cmc: 1, count: 8 }),
      createMockDeckCard({ name: 'Two', cmc: 2, count: 6 }),
      createMockDeckCard({ name: 'Three', cmc: 3, count: 4 }),
      createMockDeckCard({ name: 'Four', cmc: 4, count: 2 }),
    ];

    const result = analyzeDeckManaCurve(deck);

    expect(result.points[1].count).toBe(8);
    expect(result.points[2].count).toBe(6);
    expect(result.points[3].count).toBe(4);
    expect(result.points[4].count).toBe(2);
  });
});

describe('determineStrategy', () => {
  it('should return aggro for low CMC', () => {
    expect(determineStrategy(1.5)).toBe('aggro');
    expect(determineStrategy(2.0)).toBe('aggro');
    expect(determineStrategy(2.4)).toBe('aggro');
  });

  it('should return midrange for medium CMC', () => {
    expect(determineStrategy(2.5)).toBe('midrange');
    expect(determineStrategy(3.0)).toBe('midrange');
    expect(determineStrategy(3.9)).toBe('midrange');
  });

  it('should return control for high CMC', () => {
    expect(determineStrategy(4.0)).toBe('control');
    expect(determineStrategy(5.0)).toBe('control');
    expect(determineStrategy(6.5)).toBe('control');
  });
});

describe('getStrategyProfile', () => {
  it('should return aggro profile for aggro decks', () => {
    const profile = getStrategyProfile('Red Aggro');
    expect(profile.archetype).toBe('aggro');
  });

  it('should return control profile for control decks', () => {
    const profile = getStrategyProfile('Blue Control');
    expect(profile.archetype).toBe('control');
  });

  it('should return midrange profile for midrange decks', () => {
    const profile = getStrategyProfile('Green Midrange');
    expect(profile.archetype).toBe('midrange');
  });

  it('should return combo profile for combo decks', () => {
    const profile = getStrategyProfile('Storm Combo');
    expect(profile.archetype).toBe('combo');
  });

  it('should default to midrange for unknown archetypes', () => {
    const profile = getStrategyProfile('Unknown Archetype');
    expect(profile.archetype).toBe('midrange');
  });
});

describe('getManaCurveRecommendations', () => {
  it('should return recommendations for imbalanced curves', () => {
    const deckCurve = {
      points: [
        { cmc: 0, count: 0 },
        { cmc: 1, count: 2 }, // Too few 1-drops
        { cmc: 2, count: 10 }, // Too many 2-drops
        { cmc: 3, count: 2 },
        { cmc: 4, count: 2 },
        { cmc: 5, count: 2 },
        { cmc: 6, count: 0 },
        { cmc: 7, count: 0 },
      ],
      totalCards: 20,
      lands: 0,
      nonLands: 20,
      averageCMC: 2.6,
      curveScore: 50,
    };

    const recommendations = getManaCurveRecommendations(deckCurve);
    
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.some(r => r.cmc === 1 && r.type === 'add')).toBe(true);
  });
});

describe('getLandCountRecommendations', () => {
  it('should recommend fewer lands for aggro decks', () => {
    const deckCurve = {
      points: [],
      totalCards: 60,
      lands: 20,
      nonLands: 40,
      averageCMC: 2.0,
      curveScore: 70,
    };

    const rec = getLandCountRecommendations(deckCurve, 'aggro');
    
    expect(rec.recommended).toBeLessThanOrEqual(20);
  });

  it('should recommend more lands for control decks', () => {
    const deckCurve = {
      points: [],
      totalCards: 60,
      lands: 20,
      nonLands: 40,
      averageCMC: 4.5,
      curveScore: 70,
    };

    const rec = getLandCountRecommendations(deckCurve, 'control');
    
    expect(rec.recommended).toBeGreaterThanOrEqual(24);
  });
});

describe('STRATEGY_CURVES', () => {
  it('should have aggro, midrange, control, and combo profiles', () => {
    expect(STRATEGY_CURVES.aggro).toBeDefined();
    expect(STRATEGY_CURVES.midrange).toBeDefined();
    expect(STRATEGY_CURVES.control).toBeDefined();
    expect(STRATEGY_CURVES.combo).toBeDefined();
  });

  it('should have valid CMC ranges for each strategy', () => {
    expect(STRATEGY_CURVES.aggro.maxAverageCMC).toBeLessThanOrEqual(STRATEGY_CURVES.midrange.minAverageCMC);
    expect(STRATEGY_CURVES.midrange.maxAverageCMC).toBeLessThanOrEqual(STRATEGY_CURVES.control.minAverageCMC);
  });

  it('should have ideal distributions for each strategy', () => {
    Object.values(STRATEGY_CURVES).forEach(profile => {
      expect(profile.idealDistribution).toBeDefined();
      expect(profile.idealDistribution.length).toBeGreaterThan(0);
      
      // All values should be non-negative
      profile.idealDistribution.forEach(point => {
        expect(point.count).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
