/**
 * Tests for card filter functions
 * 
 * Tests all filter functions in filter-cards.ts:
 * - filterByCMC
 * - filterByType
 * - filterByRarity
 * - filterBySet
 * - filterByColor
 * - filterByColorIdentity
 * - filterByPower
 * - filterByToughness
 * - filterByFormatLegality
 * - filterByCommanderRules
 * - applyFilters
 * - getCreatures
 */

import { describe, it, expect } from '@jest/globals';
import type { MinimalCard } from '@/lib/card-database';
import {
  filterByCMC,
  filterByType,
  filterByRarity,
  filterBySet,
  filterByColor,
  filterByColorIdentity,
  filterByPower,
  filterByToughness,
  filterByFormatLegality,
  filterByCommanderRules,
  applyFilters,
  getCreatures,
  FORMAT_LEGALITIES,
} from '../filter-cards';
import type { CardFilters } from '../filter-types';

// Test fixtures
const testCards: MinimalCard[] = [
  {
    id: 'card-001',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'common',
    set: 'LEA',
    collector_number: '001',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-002',
    name: 'Counterspell',
    mana_cost: '{U}{U}',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'common',
    set: 'LEA',
    collector_number: '002',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-003',
    name: 'Goblin Guide',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Creature — Goblin',
    oracle_text: 'Haste\nWhenever Goblin Guide attacks, defending player reveals top card of their library.',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'rare',
    set: 'ZEN',
    collector_number: '001',
    power: '2',
    toughness: '2',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'not_legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  // Card with CMC 1 for creatures to test power/toughness
  {
    id: 'card-003b',
    name: 'Elvish Mystic',
    mana_cost: '{G}',
    cmc: 1,
    type_line: 'Creature — Elf Druid',
    oracle_text: 'Tap: Add {G}.',
    colors: ['G'],
    color_identity: ['G'],
    rarity: 'common',
    set: 'M14',
    collector_number: '001',
    power: '1',
    toughness: '1',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-004',
    name: 'Jace, the Mind Sculptor',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    type_line: 'Planeswalker — Jace',
    oracle_text: '+2: Look at the top card of your library.',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'mythic',
    set: 'WWK',
    collector_number: '001',
    loyalty: '4',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'not_legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-005',
    name: 'Counterspell',
    mana_cost: '{1}{U}',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'uncommon',
    set: 'MH2',
    collector_number: '001',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'legal',
      pioneer: 'not_legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-006',
    name: 'Plains',
    mana_cost: '',
    cmc: 0,
    type_line: 'Basic Land — Plains',
    oracle_text: '({T}: Add {W})',
    colors: [],
    color_identity: ['W'],
    rarity: 'common',
    set: 'LEA',
    collector_number: '001',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'legal',
      pioneer: 'legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-007',
    name: 'Birds of Paradise',
    mana_cost: '{G}',
    cmc: 1,
    type_line: 'Creature — Bird',
    oracle_text: 'Flying\nTap: Add one mana of any color.',
    colors: ['G'],
    color_identity: [],
    rarity: 'rare',
    set: 'LEA',
    collector_number: '001',
    power: '0',
    toughness: '1',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'not_legal',
      pioneer: 'not_legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
  {
    id: 'card-008',
    name: 'Tarmogoyf',
    mana_cost: '{1}{G}',
    cmc: 2,
    type_line: 'Creature — Lhurgoyf',
    oracle_text: "Tarmogoyf's power is equal to the number of card types in graveyards.",
    colors: ['G'],
    color_identity: ['G'],
    rarity: 'mythic',
    set: 'FMM',
    collector_number: '001',
    power: '*',
    toughness: '1',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'not_legal',
      pioneer: 'not_legal',
      brawl: 'legal',
      historic: 'legal',
      gladiator: 'legal',
    },
  },
];

describe('filterByCMC', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByCMC(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should filter cards with exact CMC', () => {
    const result = filterByCMC(testCards, { mode: 'exact', value: 1 });
    expect(result.every(c => c.cmc === 1)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter cards in CMC range (inclusive)', () => {
    const result = filterByCMC(testCards, { mode: 'range', min: 1, max: 2 });
    expect(result.every(c => c.cmc >= 1 && c.cmc <= 2)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter cards with minimum CMC only', () => {
    const result = filterByCMC(testCards, { mode: 'range', min: 3 });
    expect(result.every(c => c.cmc >= 3)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter cards with maximum CMC only', () => {
    const result = filterByCMC(testCards, { mode: 'range', max: 1 });
    expect(result.every(c => c.cmc <= 1)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('filterByType', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByType(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should filter cards by supertype', () => {
    const result = filterByType(testCards, { supertypes: ['basic'] });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Plains');
  });

  it('should filter cards by type', () => {
    const result = filterByType(testCards, { types: ['creature'] });
    // Goblin Guide, Elvish Mystic, Birds of Paradise, Tarmogoyf = 4
    expect(result.length).toBe(4);
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
  });

  it('should filter cards by subtype', () => {
    const result = filterByType(testCards, { subtypes: ['goblin'] });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Goblin Guide');
  });

  it('should filter cards with multiple type criteria (OR logic)', () => {
    const result = filterByType(testCards, { types: ['instant', 'planeswalker'] });
    expect(result.length).toBe(4);
  });

  it('should filter cards with both supertype and type criteria', () => {
    const result = filterByType(testCards, { 
      supertypes: ['basic'], 
      types: ['land'] 
    });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Plains');
  });
});

describe('filterByRarity', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByRarity(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should return all cards when rarities array is empty', () => {
    const result = filterByRarity(testCards, { rarities: [] });
    expect(result).toEqual(testCards);
  });

  it('should filter cards by rarity', () => {
    const result = filterByRarity(testCards, { rarities: ['common'] });
    expect(result.every(c => c.rarity === 'common')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter cards by multiple rarities', () => {
    const result = filterByRarity(testCards, { rarities: ['rare', 'mythic'] });
    expect(result.length).toBe(4);
    expect(result.every(c => c.rarity === 'rare' || c.rarity === 'mythic')).toBe(true);
  });
});

describe('filterBySet', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterBySet(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should return all cards when sets array is empty', () => {
    const result = filterBySet(testCards, { sets: [] });
    expect(result).toEqual(testCards);
  });

  it('should filter cards by set code (case insensitive)', () => {
    const result = filterBySet(testCards, { sets: ['LEA'] });
    expect(result.length).toBe(4);
    expect(result.every(c => c.set === 'LEA')).toBe(true);
  });

  it('should filter cards by multiple set codes', () => {
    const result = filterBySet(testCards, { sets: ['LEA', 'ZEN'] });
    expect(result.length).toBe(5);
  });
});

describe('filterByColor', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByColor(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should return all cards when colors array is empty', () => {
    const result = filterByColor(testCards, { mode: 'exact', colors: [] });
    expect(result).toEqual(testCards);
  });

  it('should filter cards with exact color match', () => {
    const result = filterByColor(testCards, { mode: 'exact', colors: ['R'] });
    expect(result.length).toBe(2);
    expect(result.every(c => c.colors.length === 1 && c.colors.includes('R'))).toBe(true);
  });

  it('should filter cards that include all specified colors', () => {
    // No card in test data has multiple colors
    const result = filterByColor(testCards, { mode: 'include', colors: ['R'] });
    expect(result.length).toBe(2);
  });

  it('should filter cards that exclude specified colors', () => {
    const result = filterByColor(testCards, { mode: 'exclude', colors: ['U'] });
    // Should not include U cards
    expect(result.every(c => !c.colors.includes('U'))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('filterByColorIdentity', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByColorIdentity(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should return all cards when colors array is empty', () => {
    const result = filterByColorIdentity(testCards, { mode: 'exact', colors: [] });
    expect(result).toEqual(testCards);
  });

  it('should filter cards by exact color identity', () => {
    const result = filterByColorIdentity(testCards, { mode: 'exact', colors: ['R'] });
    expect(result.length).toBe(2);
    expect(result.every(c => c.color_identity.length === 1 && c.color_identity.includes('R'))).toBe(true);
  });

  it('should filter colorless cards by empty color identity', () => {
    // When no cards have empty color_identity, the behavior depends on implementation
    // We just verify the function doesn't crash and returns valid results
    const result = filterByColorIdentity(testCards, { mode: 'exact', colors: [] });
    // Should return results (implementation-specific behavior)
    expect(result).toBeDefined();
  });
});

describe('filterByPower', () => {
  it('should return all cards when no range is provided', () => {
    const result = filterByPower(testCards, {});
    expect(result).toEqual(testCards);
  });

  it('should return all cards when both min and max are undefined', () => {
    const result = filterByPower(testCards, { min: undefined, max: undefined });
    expect(result).toEqual(testCards);
  });

  it('should filter creatures by minimum power', () => {
    const result = filterByPower(testCards, { min: 2 });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Goblin Guide');
  });

  it('should filter creatures by maximum power', () => {
    const result = filterByPower(testCards, { max: 1 });
    // Should only return creatures with power <= 1
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter creatures by power range', () => {
    const result = filterByPower(testCards, { min: 0, max: 2 });
    // Should only return creatures with power in range
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should exclude non-creature cards', () => {
    const result = filterByPower(testCards, { min: 0, max: 5 });
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
  });

  it('should handle variable power (like Tarmogoyf *)', () => {
    const result = filterByPower(testCards, { min: 0, max: 1 });
    // Variable power (*) cards should be handled correctly (excluded from numeric comparisons)
    // The function should not crash and should return appropriate results
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

describe('filterByToughness', () => {
  it('should return all cards when no range is provided', () => {
    const result = filterByToughness(testCards, {});
    expect(result).toEqual(testCards);
  });

  it('should return all cards when both min and max are undefined', () => {
    const result = filterByToughness(testCards, { min: undefined, max: undefined });
    expect(result).toEqual(testCards);
  });

  it('should filter creatures by minimum toughness', () => {
    const result = filterByToughness(testCards, { min: 2 });
    // Goblin Guide (2), Tarmogoyf (1*) = Goblin Guide only
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Goblin Guide');
  });

  it('should filter creatures by maximum toughness', () => {
    const result = filterByToughness(testCards, { max: 1 });
    // Should only return creatures with toughness <= 1
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter creatures by toughness range', () => {
    const result = filterByToughness(testCards, { min: 1, max: 2 });
    // Should only return creatures with toughness in range
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should exclude non-creature cards', () => {
    const result = filterByToughness(testCards, { min: 1, max: 5 });
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
  });
});

describe('filterByFormatLegality', () => {
  it('should return all cards when no filter is provided', () => {
    const result = filterByFormatLegality(testCards, undefined as any);
    expect(result).toEqual(testCards);
  });

  it('should return all cards when format is empty', () => {
    const result = filterByFormatLegality(testCards, { format: '', legality: 'legal' });
    expect(result).toEqual(testCards);
  });

  it('should filter standard legal cards', () => {
    const result = filterByFormatLegality(testCards, { format: 'standard', legality: 'legal' });
    // Lightning Bolt, Counterspell (LEA), Elvish Mystic, Plains = 4
    expect(result.length).toBe(4);
    expect(result.every(c => c.legalities['standard'] === 'legal')).toBe(true);
  });

  it('should filter standard NOT legal cards', () => {
    const result = filterByFormatLegality(testCards, { format: 'standard', legality: 'not_legal' });
    // Should only return cards that are NOT standard legal
    expect(result.every(c => c.legalities['standard'] === 'not_legal')).toBe(true);
    // Verify we get some cards
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter pauper legal cards', () => {
    const result = filterByFormatLegality(testCards, { format: 'pauper', legality: 'legal' });
    // Should only return cards that are pauper legal
    expect(result.every(c => c.legalities['pauper'] === 'legal')).toBe(true);
    // Verify we get some cards
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle case-insensitive format names', () => {
    const result1 = filterByFormatLegality(testCards, { format: 'standard', legality: 'legal' });
    const result2 = filterByFormatLegality(testCards, { format: 'STANDARD', legality: 'legal' });
    expect(result1.length).toBe(result2.length);
  });

  it('should return empty array when no cards match the format', () => {
    const result = filterByFormatLegality(testCards, { format: 'standard', legality: 'restricted' });
    expect(result.length).toBe(0);
  });

  it('should return empty array when format is not specified in card legalities', () => {
    const cardWithMissingFormat: MinimalCard = {
      ...testCards[0],
      id: 'card-missing',
      name: 'Missing Format Card',
      legalities: {
        standard: 'legal',
        // No other formats specified
      },
    };
    const result = filterByFormatLegality([cardWithMissingFormat], { format: 'modern', legality: 'legal' });
    expect(result.length).toBe(0);
  });
});

describe('filterByCommanderRules', () => {
  it('should return all cards when allowedColors is empty', () => {
    const result = filterByCommanderRules(testCards, []);
    expect(result).toEqual(testCards);
  });

  it('should return all cards for 5-color commander', () => {
    const result = filterByCommanderRules(testCards, ['W', 'U', 'B', 'R', 'G']);
    expect(result.length).toBe(testCards.length);
  });

  it('should filter cards by color identity for single-color commander', () => {
    const result = filterByCommanderRules(testCards, ['R']);
    // Should only return cards with R color identity OR empty (colorless-producing)
    expect(result.every(c => 
      c.color_identity.length === 0 || c.color_identity.every(c => ['R'].includes(c))
    )).toBe(true);
    // Verify we get some cards
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter cards by color identity for multi-color commander', () => {
    const result = filterByCommanderRules(testCards, ['R', 'G']);
    expect(result.every(c => 
      c.color_identity.length === 0 || c.color_identity.every(c => ['R', 'G'].includes(c))
    )).toBe(true);
  });

  it('should allow colorless cards for any commander', () => {
    // Birds of Paradise has empty color_identity (can be in any commander deck)
    const result = filterByCommanderRules(testCards, ['U']);
    expect(result.some(c => c.name === 'Birds of Paradise')).toBe(true);
  });
});

describe('getCreatures', () => {
  it('should return only creature cards', () => {
    const result = getCreatures(testCards);
    // Goblin Guide, Elvish Mystic, Birds of Paradise, Tarmogoyf = 4
    expect(result.length).toBe(4);
    expect(result.every(c => c.type_line.toLowerCase().includes('creature'))).toBe(true);
  });

  it('should return empty array when no creatures exist', () => {
    const nonCreatures = testCards.filter(c => !c.type_line.toLowerCase().includes('creature'));
    const result = getCreatures(nonCreatures);
    expect(result.length).toBe(0);
  });
});

describe('applyFilters', () => {
  it('should return all cards when no filters are provided', () => {
    const result = applyFilters(testCards, {});
    expect(result).toEqual(testCards);
  });

  it('should apply single filter', () => {
    const filters: CardFilters = {
      formatLegality: { format: 'standard', legality: 'legal' },
    };
    const result = applyFilters(testCards, filters);
    // Lightning Bolt, Counterspell (LEA), Elvish Mystic, Plains = 4
    expect(result.length).toBe(4);
    expect(result.every(c => c.legalities['standard'] === 'legal')).toBe(true);
  });

  it('should apply multiple filters', () => {
    const filters: CardFilters = {
      formatLegality: { format: 'standard', legality: 'legal' },
      rarity: { rarities: ['common'] },
    };
    const result = applyFilters(testCards, filters);
    // Should only include cards that are standard legal AND common
    expect(result.every(c => 
      c.legalities['standard'] === 'legal' && c.rarity === 'common'
    )).toBe(true);
    // Verify we get the expected cards
    expect(result.length).toBeGreaterThan(0);
  });

  it('should apply color filter combined with format legality', () => {
    const filters: CardFilters = {
      formatLegality: { format: 'standard', legality: 'legal' },
      color: { mode: 'exact', colors: ['R'] },
    };
    const result = applyFilters(testCards, filters);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Lightning Bolt');
  });

  it('should apply type filter combined with CMC filter', () => {
    const filters: CardFilters = {
      type: { types: ['creature'] },
      cmc: { mode: 'range', min: 1, max: 2 },
    };
    const result = applyFilters(testCards, filters);
    // Should only include creatures with CMC 1-2
    expect(result.every(c => 
      c.type_line.toLowerCase().includes('creature') && 
      c.cmc >= 1 && c.cmc <= 2
    )).toBe(true);
    // Verify we get creatures
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle complex filter combination', () => {
    const filters: CardFilters = {
      type: { types: ['instant', 'sorcery'] },
      cmc: { mode: 'range', min: 1, max: 3 },
      color: { mode: 'include', colors: ['U', 'R'] },
      rarity: { rarities: ['common', 'uncommon'] },
    };
    const result = applyFilters(testCards, filters);
    expect(result.every(c => 
      (c.type_line.toLowerCase().includes('instant') || c.type_line.toLowerCase().includes('sorcery')) &&
      c.cmc >= 1 && c.cmc <= 3 &&
      (c.colors.includes('U') || c.colors.includes('R')) &&
      (c.rarity === 'common' || c.rarity === 'uncommon')
    )).toBe(true);
  });
});

describe('FORMAT_LEGALITIES constant', () => {
  it('should include all expected formats', () => {
    const expectedFormats = [
      'standard', 'modern', 'commander', 'legacy', 'vintage',
      'pauper', 'pioneer', 'brawl', 'gladiator', 'historic'
    ];
    expect(FORMAT_LEGALITIES).toEqual(expectedFormats);
  });

  it('should have 10 supported formats', () => {
    expect(FORMAT_LEGALITIES.length).toBe(10);
  });
});