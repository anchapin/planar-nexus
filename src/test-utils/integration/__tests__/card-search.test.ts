/**
 * Integration tests for card search and filtering
 * 
 * These tests verify card search functionality using mock card data
 * for testing card filtering and sorting logic.
 */

// Simple mock card creator for Node.js environment (no MSW imports)
function createMockScryfallCard(overrides: Partial<{
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  collector_number: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  rarity: string;
  power: string;
  toughness: string;
}> = {}) {
  return {
    id: overrides.id || 'mock-card-id-1',
    oracle_id: overrides.oracle_id || 'mock-oracle-id-1',
    name: overrides.name || 'Mock Card',
    set: overrides.set || 'm21',
    collector_number: overrides.collector_number || '1',
    cmc: overrides.cmc || 2,
    type_line: overrides.type_line || 'Creature — Human Wizard',
    oracle_text: overrides.oracle_text || '{T}: Draw a card.',
    colors: overrides.colors || ['U'],
    color_identity: overrides.color_identity || ['U'],
    rarity: overrides.rarity || 'rare',
    power: overrides.power || '2',
    toughness: overrides.toughness || '2',
    image_uris: {
      small: 'https://cards.scryfall.io/small/front/m/o/mock-card-id-1.jpg',
      normal: 'https://cards.scryfall.io/normal/front/m/o/mock-card-id-1.jpg',
      large: 'https://cards.githubusercontent.com/large/front/m/o/mock-card-id-1.jpg',
      png: 'https://cards.githubusercontent.com/png/front/m/o/mock-card-id-1.png',
      art_crop: 'https://cards.githubusercontent.com/art_crop/front/m/o/mock-card-id-1.jpg',
      border_crop: 'https://cards.githubusercontent.com/border_crop/front/m/o/mock-card-id-1.jpg',
    },
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
    },
    mana_cost: '{2U}',
    flavor_text: 'A mock card for testing.',
    artist: 'Mock Artist',
  };
}

describe('Card Search Integration Tests', () => {
  beforeAll(async () => {
    // In a real browser environment, we would start the worker
    // For Node.js tests, we use the server module instead
  });

  describe('createMockScryfallCard', () => {
    it('should create a mock card with default values', () => {
      const card = createMockScryfallCard();
      
      expect(card).toBeDefined();
      expect(card.name).toBe('Mock Card');
      expect(card.type_line).toBe('Creature — Human Wizard');
      expect(card.cmc).toBe(2);
      expect(card.colors).toEqual(['U']);
    });

    it('should create a custom card with overrides', () => {
      const card = createMockScryfallCard({
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        colors: ['R'],
        rarity: 'common',
      });
      
      expect(card.name).toBe('Lightning Bolt');
      expect(card.cmc).toBe(1);
      expect(card.type_line).toBe('Instant');
      expect(card.oracle_text).toBe('Lightning Bolt deals 3 damage to any target.');
      expect(card.colors).toEqual(['R']);
      expect(card.rarity).toBe('common');
    });

    it('should include image URIs', () => {
      const card = createMockScryfallCard();
      
      expect(card.image_uris).toBeDefined();
      expect(card.image_uris.small).toContain('cards.scryfall.io');
      expect(card.image_uris.normal).toContain('cards.scryfall.io');
    });

    it('should include legalities', () => {
      const card = createMockScryfallCard();
      
      expect(card.legalities).toBeDefined();
      expect(card.legalities.standard).toBe('legal');
      expect(card.legalities.modern).toBe('legal');
      expect(card.legalities.commander).toBe('legal');
    });
  });

  describe('Card Filtering', () => {
    it('should filter cards by color', () => {
      const redCards = [
        createMockScryfallCard({ name: 'Fireball', colors: ['R'] }),
        createMockScryfallCard({ name: 'Lightning Bolt', colors: ['R'] }),
      ];
      
      const blueCards = [
        createMockScryfallCard({ name: 'Counterspell', colors: ['U'] }),
      ];
      
      // Filter for red cards
      const filteredRed = [...redCards, ...blueCards].filter(card => 
        card.colors.includes('R')
      );
      
      expect(filteredRed).toHaveLength(2);
      expect(filteredRed.every(c => c.colors.includes('R'))).toBe(true);
    });

    it('should filter cards by CMC', () => {
      const cards = [
        createMockScryfallCard({ name: 'One', cmc: 1 }),
        createMockScryfallCard({ name: 'Two', cmc: 2 }),
        createMockScryfallCard({ name: 'Three', cmc: 3 }),
      ];
      
      const oneManaCards = cards.filter(card => card.cmc === 1);
      
      expect(oneManaCards).toHaveLength(1);
      expect(oneManaCards[0].name).toBe('One');
    });

    it('should filter cards by type', () => {
      const cards = [
        createMockScryfallCard({ name: 'Elves', type_line: 'Creature — Elf' }),
        createMockScryfallCard({ name: 'Lightning Bolt', type_line: 'Instant' }),
        createMockScryfallCard({ name: 'Forest', type_line: 'Land' }),
      ];
      
      const creatures = cards.filter(card => 
        card.type_line.includes('Creature')
      );
      
      expect(creatures).toHaveLength(1);
      expect(creatures[0].name).toBe('Elves');
    });

    it('should filter cards by rarity', () => {
      const cards = [
        createMockScryfallCard({ name: 'Common Card', rarity: 'common' }),
        createMockScryfallCard({ name: 'Rare Card', rarity: 'rare' }),
        createMockScryfallCard({ name: 'Mythic Card', rarity: 'mythic' }),
      ];
      
      const rareAndMythic = cards.filter(card => 
        ['rare', 'mythic'].includes(card.rarity)
      );
      
      expect(rareAndMythic).toHaveLength(2);
    });
  });

  describe('Card Sorting', () => {
    it('should sort cards by CMC ascending', () => {
      const cards = [
        createMockScryfallCard({ name: 'Three', cmc: 3 }),
        createMockScryfallCard({ name: 'One', cmc: 1 }),
        createMockScryfallCard({ name: 'Two', cmc: 2 }),
      ];
      
      const sorted = [...cards].sort((a, b) => a.cmc - b.cmc);
      
      expect(sorted[0].name).toBe('One');
      expect(sorted[1].name).toBe('Two');
      expect(sorted[2].name).toBe('Three');
    });

    it('should sort cards by name alphabetically', () => {
      const cards = [
        createMockScryfallCard({ name: 'Zebra' }),
        createMockScryfallCard({ name: 'Apple' }),
        createMockScryfallCard({ name: 'Mango' }),
      ];
      
      const sorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));
      
      expect(sorted[0].name).toBe('Apple');
      expect(sorted[1].name).toBe('Mango');
      expect(sorted[2].name).toBe('Zebra');
    });

    it('should sort cards by rarity', () => {
      const cards = [
        createMockScryfallCard({ name: 'Common', rarity: 'common' }),
        createMockScryfallCard({ name: 'Mythic', rarity: 'mythic' }),
        createMockScryfallCard({ name: 'Rare', rarity: 'rare' }),
        createMockScryfallCard({ name: 'Uncommon', rarity: 'uncommon' }),
      ];
      
      const rarityOrder = { common: 1, uncommon: 2, rare: 3, mythic: 4 };
      const sorted = [...cards].sort((a, b) => 
        (rarityOrder[a.rarity as keyof typeof rarityOrder] || 0) - 
        (rarityOrder[b.rarity as keyof typeof rarityOrder] || 0)
      );
      
      expect(sorted[0].name).toBe('Common');
      expect(sorted[1].name).toBe('Uncommon');
      expect(sorted[2].name).toBe('Rare');
      expect(sorted[3].name).toBe('Mythic');
    });
  });

  describe('Multi-color Cards', () => {
    it('should handle multi-color cards', () => {
      const card = createMockScryfallCard({
        name: 'Fire // Ice',
        colors: ['R', 'U'],
      });
      
      expect(card.colors).toHaveLength(2);
      expect(card.colors).toContain('R');
      expect(card.colors).toContain('U');
    });

    it('should handle colorless cards', () => {
      const card = createMockScryfallCard({
        name: 'Sol Ring',
        colors: [],
      });
      
      expect(card.colors).toHaveLength(0);
    });

    it('should filter multicolored cards', () => {
      const cards = [
        createMockScryfallCard({ name: 'Red', colors: ['R'] }),
        createMockScryfallCard({ name: 'Blue', colors: ['U'] }),
        createMockScryfallCard({ name: 'Izzet', colors: ['R', 'U'] }),
      ];
      
      const multicolored = cards.filter(card => card.colors.length > 1);
      
      expect(multicolored).toHaveLength(1);
      expect(multicolored[0].name).toBe('Izzet');
    });
  });

  describe('Card Type Line Parsing', () => {
    it('should identify creature types', () => {
      const creature = createMockScryfallCard({ type_line: 'Creature — Human Wizard' });
      const instant = createMockScryfallCard({ type_line: 'Instant' });
      const enchantment = createMockScryfallCard({ type_line: 'Enchantment — Aura' });
      
      expect(creature.type_line).toContain('Creature');
      expect(instant.type_line).not.toContain('Creature');
      expect(enchantment.type_line).not.toContain('Creature');
    });

    it('should identify planeswalker types', () => {
      const planeswalker = createMockScryfallCard({ type_line: 'Planeswalker — Jace' });
      
      expect(planeswalker.type_line).toContain('Planeswalker');
    });

    it('should identify land types', () => {
      const land = createMockScryfallCard({ type_line: 'Land — Forest' });
      
      expect(land.type_line).toContain('Land');
    });
  });
});
