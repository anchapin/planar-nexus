/**
 * Limited Validator Tests
 *
 * Tests for LBld-01 through LBld-06 requirements:
 * - LBld-01: Pool-only deck building validation
 * - LBld-02: Limited filter restricting to pool
 * - LBld-03: 40-card minimum
 * - LBld-04: 4-copy limit
 * - LBld-05: No sideboard
 * - LBld-06: Save/load deck for session
 */

import {
  validateLimitedDeck,
  canAddCardToDeck,
  isPoolCard,
  LIMITED_RULES,
} from '../limited-validator';
import type { PoolCard, LimitedDeckCard } from '../types';
import type { MinimalCard } from '@/lib/card-database';

// Mock minimal card for testing
const createMockCard = (id: string, name: string): MinimalCard => ({
  id,
  name,
  set: 'M21',
  rarity: 'common',
  type_line: 'Creature',
  mana_cost: '',
  cmc: 0,
  colors: [],
  color_identity: [],
  legalities: {},
});

// Mock pool card
const createMockPoolCard = (id: string, name: string): PoolCard => ({
  ...createMockCard(id, name),
  packId: 0,
  packSlot: 0,
  addedAt: new Date().toISOString(),
});

// ============================================================================
// LBld-01: Pool-only deck building validation
// ============================================================================

describe('LBld-01: Pool-only deck building', () => {
  it('should verify card is in pool', () => {
    const pool: PoolCard[] = [
      createMockPoolCard('card-1', 'Giant Growth'),
      createMockPoolCard('card-2', 'Lightning Bolt'),
    ];

    expect(isPoolCard('card-1', pool)).toBe(true);
    expect(isPoolCard('card-2', pool)).toBe(true);
  });

  it('should reject card not in pool', () => {
    const pool: PoolCard[] = [createMockPoolCard('card-1', 'Giant Growth')];

    expect(isPoolCard('card-999', pool)).toBe(false);
  });

  it('should handle empty pool', () => {
    expect(isPoolCard('card-1', [])).toBe(false);
  });
});

// ============================================================================
// LBld-02: Limited filter restricting to pool
// ============================================================================

describe('LBld-02: Limited filter mode', () => {
  it('should check if card can be added in limited mode', () => {
    const pool: PoolCard[] = [
      createMockPoolCard('card-1', 'Giant Growth'),
    ];

    const deck: LimitedDeckCard[] = [];

    // Should be able to add
    expect(canAddCardToDeck(pool[0], deck)).toBe(true);
  });

  it('should restrict to pool cards only', () => {
    const pool: PoolCard[] = [createMockPoolCard('card-1', 'Giant Growth')];
    const nonPoolCard = createMockPoolCard('card-999', 'Not In Pool');

    expect(isPoolCard('card-999', pool)).toBe(false);
  });
});

// ============================================================================
// LBld-03: 40-card minimum validation
// ============================================================================

describe('LBld-03: 40-card minimum', () => {
  it('should pass valid deck with exactly 40 cards', () => {
    const deck: LimitedDeckCard[] = [];
    for (let i = 0; i < 40; i++) {
      deck.push({
        card: createMockCard(`card-${i}`, `Card ${i}`),
        count: 1,
        addedAt: new Date().toISOString(),
      });
    }

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass deck with more than 40 cards', () => {
    const deck: LimitedDeckCard[] = [];
    for (let i = 0; i < 50; i++) {
      deck.push({
        card: createMockCard(`card-${i}`, `Card ${i}`),
        count: 1,
        addedAt: new Date().toISOString(),
      });
    }

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
  });

  it('should fail deck with 39 cards', () => {
    const deck: LimitedDeckCard[] = [];
    for (let i = 0; i < 39; i++) {
      deck.push({
        card: createMockCard(`card-${i}`, `Card ${i}`),
        count: 1,
        addedAt: new Date().toISOString(),
      });
    }

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('40'))).toBe(true);
  });

  it('should fail empty deck', () => {
    const result = validateLimitedDeck([]);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('40'))).toBe(true);
  });

  it('should count card quantities correctly', () => {
    // 8 cards: 4 of Giant Growth + 4 of Forest = 8 total
    // Add more cards to reach 40 minimum
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 4, addedAt: new Date().toISOString() },
      { card: createMockCard('card-2', 'Forest'), count: 4, addedAt: new Date().toISOString() },
      ...Array.from({ length: 32 }, (_, i) => ({
        card: createMockCard(`card-${i + 3}`, `Card ${i + 3}`),
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
    expect(result.totalCards).toBe(40);
  });
});

// ============================================================================
// LBld-04: 4-copy limit validation
// ============================================================================

describe('LBld-04: 4-copy limit', () => {
  it('should pass deck with exactly 4 copies of a card (with 40 cards total)', () => {
    // 4 copies of one card + 36 other unique cards
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 4, addedAt: new Date().toISOString() },
      ...Array.from({ length: 36 }, (_, i) => ({
        card: createMockCard(`card-${i + 2}`, `Card ${i + 2}`),
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
    expect(result.totalCards).toBe(40);
  });

  it('should pass deck with fewer than 4 copies (with 40 cards total)', () => {
    // 3 copies of one card + 37 other unique cards
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 3, addedAt: new Date().toISOString() },
      ...Array.from({ length: 37 }, (_, i) => ({
        card: createMockCard(`card-${i + 2}`, `Card ${i + 2}`),
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
  });

  it('should fail deck with 5 copies of a card', () => {
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 5, addedAt: new Date().toISOString() },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('4 copies') || e.includes('maximum'))).toBe(true);
  });

  it('should fail deck exceeding 4 copies across multiple entries', () => {
    // Simulate deck with 2 copies added twice (total 5)
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 2, addedAt: new Date().toISOString() },
      { card: createMockCard('card-1', 'Giant Growth'), count: 3, addedAt: new Date().toISOString() },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(false);
  });

  it('should allow canAddCardToDeck when below limit', () => {
    const poolCard = createMockPoolCard('card-1', 'Giant Growth');
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 3, addedAt: new Date().toISOString() },
    ];

    expect(canAddCardToDeck(poolCard, deck)).toBe(true);
  });

  it('should prevent canAddCardToDeck when at limit', () => {
    const poolCard = createMockPoolCard('card-1', 'Giant Growth');
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 4, addedAt: new Date().toISOString() },
    ];

    expect(canAddCardToDeck(poolCard, deck)).toBe(false);
  });
});

// ============================================================================
// LBld-05: No sideboard
// ============================================================================

describe('LBld-05: No sideboard', () => {
  it('should define limited rules without sideboard', () => {
    expect(LIMITED_RULES.usesSideboard).toBe(false);
    expect(LIMITED_RULES.sideboardSize).toBe(0);
  });

  it('should have 40-card minimum', () => {
    expect(LIMITED_RULES.minCards).toBe(40);
  });

  it('should have 4-copy max', () => {
    expect(LIMITED_RULES.maxCopies).toBe(4);
  });
});

// ============================================================================
// LBld-06: Save/load deck for session
// ============================================================================

describe('LBld-06: Session deck persistence', () => {
  it('should validate deck for session storage', () => {
    const deck: LimitedDeckCard[] = [];
    for (let i = 0; i < 40; i++) {
      deck.push({
        card: createMockCard(`card-${i}`, `Card ${i}`),
        count: 1,
        addedAt: new Date().toISOString(),
      });
    }

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
    expect(result.totalCards).toBe(40);
  });

  it('should provide type breakdown in validation result', () => {
    const deck: LimitedDeckCard[] = [
      { card: createMockCard('card-1', 'Giant Growth'), count: 1, addedAt: new Date().toISOString() },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.typeBreakdown).toBeDefined();
    expect(typeof result.typeBreakdown.creatures).toBe('number');
  });
});

// ============================================================================
// Integration: Full limited deck workflow
// ============================================================================

describe('Limited deck building workflow', () => {
  it('should support complete deck building workflow', () => {
    // Create pool
    const pool: PoolCard[] = [
      createMockPoolCard('card-1', 'Giant Growth'),
      createMockPoolCard('card-2', 'Forest'),
      createMockPoolCard('card-3', 'Lightning Bolt'),
      createMockPoolCard('card-4', 'Mountain'),
      createMockPoolCard('card-5', 'Serra Angel'),
    ];

    // Verify all cards in pool
    expect(isPoolCard('card-1', pool)).toBe(true);
    expect(isPoolCard('card-5', pool)).toBe(true);

    // Start building deck
    const deck: LimitedDeckCard[] = [];

    // Add cards to deck
    pool.forEach((poolCard) => {
      if (canAddCardToDeck(poolCard, deck)) {
        deck.push({
          card: poolCard,
          count: 1,
          addedAt: new Date().toISOString(),
        });
      }
    });

    // Verify validation
    const result = validateLimitedDeck(deck);

    // Pool has 5 cards, deck is incomplete
    expect(deck).toHaveLength(5);
  });
});
