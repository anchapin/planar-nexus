/**
 * Test scaffolding for sealed pool generation
 *
 * Covers: SEAL-01, SEAL-02
 *
 * SEAL-01: Start new Sealed session with selected set
 * SEAL-02: Open 6 packs immediately, all cards revealed
 */

import type { MinimalCard } from '@/lib/card-database';
import type { PoolCard, LimitedSession } from '../types';

// Mock minimal card for testing
const createMockCard = (overrides: Partial<MinimalCard> = {}): MinimalCard => ({
  id: 'mock-card-1',
  name: 'Test Card',
  set: 'M21',
  collector_number: '1',
  cmc: 3,
  type_line: 'Creature — Elf Warrior',
  colors: ['G'],
  color_identity: ['G'],
  rarity: 'common',
  legalities: { standard: 'legal' },
  ...overrides,
});

// Mock cards by rarity
const mockCommons: MinimalCard[] = Array.from({ length: 50 }, (_, i) =>
  createMockCard({
    id: `common-${i}`,
    name: `Common Card ${i + 1}`,
    rarity: 'common',
    colors: i % 5 === 0 ? [] : ['W', 'U', 'B', 'R', 'G'].slice(0, (i % 3) + 1),
  })
);

const mockUncommons: MinimalCard[] = Array.from({ length: 30 }, (_, i) =>
  createMockCard({
    id: `uncommon-${i}`,
    name: `Uncommon Card ${i + 1}`,
    rarity: 'uncommon',
    colors: ['W', 'U', 'B', 'R', 'G'].slice(0, (i % 3) + 1),
  })
);

const mockRares: MinimalCard[] = Array.from({ length: 15 }, (_, i) =>
  createMockCard({
    id: `rare-${i}`,
    name: `Rare Card ${i + 1}`,
    rarity: 'rare',
    colors: ['W', 'U', 'B', 'R', 'G'].slice(0, (i % 4) + 1),
  })
);

const mockMythics: MinimalCard[] = Array.from({ length: 8 }, (_, i) =>
  createMockCard({
    id: `mythic-${i}`,
    name: `Mythic Card ${i + 1}`,
    rarity: 'mythic',
    colors: ['W', 'U', 'B', 'R', 'G'].slice(0, (i % 4) + 1),
  })
);

describe('SEAL-01: Session Creation', () => {
  // TODO: Implement actual sealed-generator module
  it.todo('should create a sealed session with UUID');
  it.todo('should associate session with set code');
  it.todo('should generate pool immediately on session creation');
});

describe('SEAL-02: Pack Generation (6 packs × 14 cards = 84 total)', () => {
  it.todo('should generate exactly 6 packs');
  it.todo('should generate 14 cards per pack');
  it.todo('should generate exactly 84 cards total (6 × 14)');
  it.todo('should distribute rarities: ~10 commons per pack');
  it.todo('should distribute rarities: ~3 uncommons per pack');
  it.todo('should distribute rarities: 1 rare or mythic per pack');
  it.todo('should have ~1:8 mythic ratio for rare slot');
  it.todo('should reveal all cards immediately (no face-down cards)');
  it.todo('should handle sets without enough cards gracefully');
  it.todo('should cache rarity distribution per set');
});

// Placeholder exports for type checking
export { mockCommons, mockUncommons, mockRares, mockMythics };
