/**
 * Draft Generator Tests
 *
 * Tests for draft session creation, pack generation, and face-down pack mechanics.
 *
 * DRFT-01: Session creation with UUID
 * DRFT-02: 3 packs of 14 cards each
 * DRFT-03: Pack cards face-down until opened
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock crypto.randomUUID for Node < 19
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  let uuidCounter = 0;
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;
}

// Create mock cards for testing
const mockCard = {
  id: 'mock-card-1',
  name: 'Mock Card',
  type_line: 'Creature — Human',
  mana_cost: '{2}{W}',
  cmc: 3,
  colors: ['W'],
  color_identity: ['W'],
  set: 'M21',
  rarity: 'common',
};

const createMockPackContents = () => ({
  commons: Array(10).fill({ ...mockCard, rarity: 'common' }),
  uncommons: Array(3).fill({ ...mockCard, rarity: 'uncommon' }),
  rareOrMythic: { ...mockCard, rarity: 'mythic' },
});

// Mock the card database module
jest.mock('@/lib/card-database', () => ({
  initializeCardDatabase: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  getAllCards: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  MinimalCard: {},
}));

// Mock generatePack from sealed-generator
jest.mock('../sealed-generator', () => ({
  generatePack: jest.fn<() => Promise<{ commons: unknown[]; uncommons: unknown[]; rareOrMythic: unknown }>>()
    .mockResolvedValue(createMockPackContents()),
}));

// Import after mocking
import {
  createDraftSession,
  generateDraftPacks,
  openPack,
  packToDraftCards,
  isDraftComplete,
  type DraftSession,
  type DraftPack,
  type DraftCard,
} from '../draft-generator';

import type { ScryfallCard } from '@/app/actions';

describe('DRFT-01: createDraftSession', () => {
  it('should create a session with a unique UUID', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    
    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    
    // UUID format check (8-4-4-4-12)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(session.id).toMatch(uuidRegex);
  });

  it('should set mode to draft', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    expect(session.mode).toBe('draft');
  });

  it('should initialize with empty pool and deck', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    expect(session.pool).toEqual([]);
    expect(session.deck).toEqual([]);
  });

  it('should set initial draft state to intro', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    expect(session.draftState).toBe('intro');
  });
});

describe('DRFT-02: 3 packs of 14 cards each', () => {
  it('should generate exactly 3 packs', async () => {
    const packs = await generateDraftPacks('M21');
    expect(packs).toHaveLength(3);
  });

  it('should generate 14 cards per pack', async () => {
    const packs = await generateDraftPacks('M21');
    
    for (const pack of packs) {
      expect(pack.cards).toHaveLength(14);
    }
  });

  it('should generate total of 42 cards (3 packs × 14 cards)', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    const totalCards = session.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    expect(totalCards).toBe(42);
  });

  it('should assign unique IDs to each pack', async () => {
    const packs = await generateDraftPacks('M21');
    const packIds = packs.map((p) => p.id);
    const uniqueIds = new Set(packIds);
    expect(uniqueIds.size).toBe(packIds.length);
  });
});

describe('DRFT-03: Pack cards face-down until opened', () => {
  it('should have isOpened: false for all packs initially', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    
    for (const pack of session.packs) {
      expect(pack.isOpened).toBe(false);
    }
  });

  it('should set isOpened: true after opening a pack', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    const pack = session.packs[0];
    
    expect(pack.isOpened).toBe(false);
    
    const openedPack = openPack(pack);
    expect(openedPack.isOpened).toBe(true);
  });

  it('should preserve cards when opening a pack', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    const pack = session.packs[0];
    const cardCount = pack.cards.length;
    
    const openedPack = openPack(pack);
    expect(openedPack.cards).toHaveLength(cardCount);
  });
});

describe('isDraftComplete', () => {
  it('should return false when draft is not complete', async () => {
    const session = await createDraftSession('M21', 'Core Set 2021');
    expect(isDraftComplete(session)).toBe(false);
  });

  it('should return true when all packs are picked', () => {
    const session: DraftSession = {
      id: 'test-id',
      setCode: 'M21',
      setName: 'Core Set 2021',
      mode: 'draft',
      status: 'in_progress',
      pool: [],
      deck: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      draftState: 'picking',
      currentPackIndex: 2,
      currentPickIndex: 13,
      packs: [],
      timerSeconds: 45,
      lastHoveredCardId: null,
      aiNeighbor: undefined,
      currentPackHolder: 'user',
    };
    
    expect(isDraftComplete(session)).toBe(true);
  });
});
