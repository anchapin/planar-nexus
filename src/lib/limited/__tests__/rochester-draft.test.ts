/**
 * Rochester Draft Tests (issue #1444)
 *
 * Validates the state machine end-to-end:
 *  - 3 / 4 / 5 player pools produce exactly 45 / 60 / 75 cards.
 *  - Pass rotation moves seat → seat+1 (clockwise) every pick.
 *  - Picking the last card transitions the session to `rochester_complete`.
 *  - Out-of-turn picks throw, picks of unknown card ids throw.
 *  - `normalizeLimitedMode` accepts all four limited-mode values.
 *  - Persistence round-trip: saveRochesterSession / getRochesterSession.
 */

// Mock the card database and sealed generator before importing the module.
jest.mock('@/lib/card-database', () => ({
  initializeCardDatabase: jest.fn().mockResolvedValue(undefined),
  getAllCards: jest.fn().mockResolvedValue([]),
  MinimalCard: {},
}));

// Deterministic mock cards: 14 distinct cards per `generatePack` call, all
// safe-colour so the AI picker has clean signals in tests.
const RARITY_PALETTE = ['common', 'common', 'common', 'uncommon', 'rare'] as const;
const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;

function mockCard(index: number, rarity: typeof RARITY_PALETTE[number]) {
  const colour = COLOURS[index % COLOURS.length];
  return {
    id: `mock-${rarity}-${index}`,
    name: `Mock ${rarity} ${index}`,
    type_line:
      rarity === 'common'
        ? 'Creature — Human'
        : rarity === 'uncommon'
          ? 'Creature — Knight'
          : 'Legendary Creature — Angel',
    mana_cost: `{${(index % 4) + 1}}`,
    cmc: (index % 4) + 1,
    colors: [colour],
    color_identity: [colour],
    set: 'M21',
    rarity,
    oracle_id: `oracle-${index}`,
    legalities: { standard: 'legal' },
    image_uris: undefined,
  };
}

function mockPackContents(globalOffset: number) {
  const commons = Array.from({ length: 10 }, (_, i) =>
    mockCard(globalOffset + i, 'common'),
  );
  const uncommons = Array.from({ length: 3 }, (_, i) =>
    mockCard(globalOffset + 10 + i, 'uncommon'),
  );
  const rareOrMythic = mockCard(globalOffset + 13, 'rare');
  return { commons, uncommons, rareOrMythic };
}

let packCallCount = 0;
jest.mock('../sealed-generator', () => ({
  generatePack: jest.fn(async () => {
    const offset = packCallCount * 100;
    packCallCount += 1;
    return mockPackContents(offset);
  }),
}));

import 'fake-indexeddb/auto';
import {
  createRochesterSession,
  generateRochesterPool,
  rochesterPoolSize,
  assertRochesterPlayerCount,
  pickFromRochesterPool,
  isRochesterComplete,
  currentSeat,
  getNextSeat,
  getTableRead,
  RochesterPickError,
} from '../rochester-draft';
import { normalizeLimitedMode } from '../types';
import { saveRochesterSession, getRochesterSession } from '../pool-storage';

describe('Rochester draft — issue #1444 acceptance criteria', () => {
  beforeEach(() => {
    packCallCount = 0;
  });

  describe('limited-mode migration', () => {
    it('normalizes the four valid modes', () => {
      expect(normalizeLimitedMode('sealed')).toBe('sealed');
      expect(normalizeLimitedMode('draft')).toBe('draft');
      expect(normalizeLimitedMode('rochester')).toBe('rochester');
      expect(normalizeLimitedMode('winston')).toBe('winston');
    });

    it('defaults unknown / legacy / null values to sealed', () => {
      expect(normalizeLimitedMode(undefined)).toBe('sealed');
      expect(normalizeLimitedMode(null)).toBe('sealed');
      expect(normalizeLimitedMode('some-garbage')).toBe('sealed');
    });
  });

  describe('rochesterPoolSize acceptance criteria', () => {
    it('returns 45 / 60 / 75 for 3 / 4 / 5 players', () => {
      expect(rochesterPoolSize(3)).toBe(45);
      expect(rochesterPoolSize(4)).toBe(60);
      expect(rochesterPoolSize(5)).toBe(75);
    });
  });

  describe('assertRochesterPlayerCount', () => {
    it('accepts 3, 4, 5', () => {
      expect(() => assertRochesterPlayerCount(3)).not.toThrow();
      expect(() => assertRochesterPlayerCount(4)).not.toThrow();
      expect(() => assertRochesterPlayerCount(5)).not.toThrow();
    });

    it('rejects 2 and 6', () => {
      expect(() => assertRochesterPlayerCount(2)).toThrow();
      expect(() => assertRochesterPlayerCount(6)).toThrow();
    });
  });

  describe('generateRochesterPool', () => {
    it('produces a 45-card pool for 3 players', async () => {
      const pool = await generateRochesterPool('M21', 3);
      expect(pool).toHaveLength(45);
      // All cards face-up: each card has stable metadata.
      expect(pool[0]).toMatchObject({ packId: -1, packSlot: 0 });
      expect(pool[44]).toMatchObject({ packId: -1, packSlot: 44 });
    });

    it('produces a 60-card pool for 4 players', async () => {
      const pool = await generateRochesterPool('M21', 4);
      expect(pool).toHaveLength(60);
    });

    it('produces a 75-card pool for 5 players', async () => {
      const pool = await generateRochesterPool('M21', 5);
      expect(pool).toHaveLength(75);
    });
  });

  describe('createRochesterSession', () => {
    it('initialises session with communal pool face-up and empty picks', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      expect(session.mode).toBe('rochester');
      expect(session.rochesterState).toBe('intro');
      expect(session.playerCount).toBe(3);
      expect(session.communalPool).toHaveLength(45);
      expect(session.picksBySeat[0]).toEqual([]);
      expect(session.picksBySeat[1]).toEqual([]);
      expect(session.picksBySeat[2]).toEqual([]);
      expect(session.currentSeatIndex).toBe(0);
      expect(session.picksTaken).toBe(0);
      expect(session.aiNeighbors?.[1]?.enabled).toBe(true);
      expect(session.aiNeighbors?.[2]?.enabled).toBe(true);
    });

    it('creates the right number of AI neighbors for 5 players', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 5,
      });
      expect(Object.keys(session.aiNeighbors ?? {})).toHaveLength(4);
    });
  });

  describe('pickFromRochesterPool state machine', () => {
    it('passes clockwise (seat 0 → 1 → 2 → 0) on sequential picks', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      const firstCard = session.communalPool[0];
      const secondCard = session.communalPool[1];
      const thirdCard = session.communalPool[2];

      let s = pickFromRochesterPool(session, 0, firstCard.id);
      expect(s.currentSeatIndex).toBe(1);
      expect(s.picksBySeat[0]).toHaveLength(1);
      expect(s.communalPool).toHaveLength(44);

      s = pickFromRochesterPool(s, 1, secondCard.id);
      expect(s.currentSeatIndex).toBe(2);

      s = pickFromRochesterPool(s, 2, thirdCard.id);
      expect(s.currentSeatIndex).toBe(0);
    });

    it('marks complete when the last card is picked', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });

      // Drain the entire 45-card pool in pass-rotation order.
      let s = session;
      for (let i = 0; i < session.communalPool.length; i++) {
        const seat = i % session.playerCount;
        const card = s.communalPool[0];
        s = pickFromRochesterPool(s, seat, card.id);
      }
      expect(s.communalPool).toHaveLength(0);
      expect(s.rochesterState).toBe('rochester_complete');
      expect(isRochesterComplete(s)).toBe(true);
      // Every seat has exactly 15 picks.
      expect(s.picksBySeat[0]).toHaveLength(15);
      expect(s.picksBySeat[1]).toHaveLength(15);
      expect(s.picksBySeat[2]).toHaveLength(15);
      expect(s.picksTaken).toBe(45);
    });

    it('throws when seat index is out of turn', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      const cardId = session.communalPool[0].id;
      expect(() => pickFromRochesterPool(session, 1, cardId)).toThrow(
        RochesterPickError,
      );
    });

    it('throws when card is not in the communal pool', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      expect(() =>
        pickFromRochesterPool(session, 0, 'not-a-real-card-id'),
      ).toThrow(RochesterPickError);
    });

    it('rejects further picks after the pool empties', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      let s = session;
      for (let i = 0; i < session.communalPool.length; i++) {
        const seat = i % session.playerCount;
        const card = s.communalPool[0];
        s = pickFromRochesterPool(s, seat, card.id);
      }
      expect(() =>
        pickFromRochesterPool(s, 0, 'whatever'),
      ).toThrow(RochesterPickError);
    });
  });

  describe('persistence round-trip', () => {
    it('saveRochesterSession / getRochesterSession survives IndexedDB cycles', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      const cardId = session.communalPool[0].id;
      const onePick = pickFromRochesterPool(session, 0, cardId);
      await saveRochesterSession(onePick);

      const reloaded = await getRochesterSession(session.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.mode).toBe('rochester');
      expect(reloaded!.picksBySeat[0]).toHaveLength(1);
      expect(reloaded!.communalPool).toHaveLength(44);
    });

    it('getRochesterSession returns null for an unknown id', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      expect(await getRochesterSession('does-not-exist')).toBeNull();
      expect(await getRochesterSession(session.id)).not.toBeNull();
      expect(session.id).toMatch(/^[0-9a-f-]+/i);
    });
  });

  describe('currentSeat / getNextSeat / getTableRead', () => {
    it('reports seat 0 first and rotates clockwise', () => {
      const session = {
        playerCount: 4,
        currentSeatIndex: 2,
      } as unknown as Parameters<typeof getNextSeat>[0];
      expect(currentSeat(session as never)).toBe(2);
      expect(getNextSeat(session as never)).toBe(3);
    });

    it('getTableRead flattens all picked cards across seats', async () => {
      const session = await createRochesterSession('M21', 'Core 2021', {
        playerCount: 3,
      });
      const cardA = session.communalPool[0].id;
      const cardB = session.communalPool[1].id;
      const cardC = session.communalPool[2].id;
      const s1 = pickFromRochesterPool(session, 0, cardA);
      const s2 = pickFromRochesterPool(s1, 1, cardB);
      const s3 = pickFromRochesterPool(s2, 2, cardC);

      const read = getTableRead(s3);
      expect(read).toHaveLength(3);
    });
  });
});
