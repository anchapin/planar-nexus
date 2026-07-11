/**
 * Winston Draft Tests (issue #1444)
 *
 * End-to-end coverage of the Winston state machine:
 *  - Default pile sizes `(6, 4, 3)` are honored.
 *  - reveal → decide (pick / burn) → rotate cycle works.
 *  - Burning marks a pile `isBurned = true` and yields zero cards.
 *  - Taking a pile yields the revealed card *and every card underneath it*.
 *  - isWinstonComplete triggers after every pile is exhausted.
 *  - Persistence round-trip through saveWinstonSession / getWinstonSession.
 *  - At least one pick-burn decision is exercised in the full round (the
 *    issue acceptance criterion: "executes with at least one pick-burn
 *    decision").
 */

jest.mock('@/lib/card-database', () => ({
  initializeCardDatabase: jest.fn().mockResolvedValue(undefined),
  getAllCards: jest.fn().mockResolvedValue([]),
  MinimalCard: {},
}));

const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;

function mockCard(index: number) {
  const colour = COLOURS[index % COLOURS.length];
  return {
    id: `mock-card-${index}`,
    name: `Mock Card ${index}`,
    type_line: 'Creature — Human',
    mana_cost: `{${(index % 4) + 1}}`,
    cmc: (index % 4) + 1,
    colors: [colour],
    color_identity: [colour],
    set: 'M21',
    rarity: 'common',
    oracle_id: `oracle-${index}`,
    legalities: { standard: 'legal' },
  };
}

function packMockContents(globalOffset: number) {
  const commons = Array.from({ length: 10 }, (_, i) =>
    mockCard(globalOffset + i),
  );
  const uncommons = Array.from({ length: 3 }, (_, i) =>
    mockCard(globalOffset + 10 + i),
  );
  const rareOrMythic = mockCard(globalOffset + 13);
  return { commons, uncommons, rareOrMythic };
}

let packCallCount = 0;
jest.mock('../sealed-generator', () => ({
  generatePack: jest.fn(async () => {
    const offset = packCallCount * 100;
    packCallCount += 1;
    return packMockContents(offset);
  }),
}));

import 'fake-indexeddb/auto';
import {
  createWinstonSession,
  generateWinstonPiles,
  WINSTON_PILE_SIZES,
  revealWinstonPile,
  pickWinstonPile,
  burnWinstonPile,
  isWinstonComplete,
  livePileCount,
  currentSeat,
  applyPicksToPool,
  WinstonOperationError,
} from '../winston-draft';
import {
  saveWinstonSession,
  getWinstonSession,
} from '../pool-storage';

describe('Winston draft — issue #1444 acceptance criteria', () => {
  beforeEach(() => {
    packCallCount = 0;
  });

  it('uses the standard (6, 4, 3) pile sizes by default', () => {
    expect([...WINSTON_PILE_SIZES]).toEqual([6, 4, 3]);
  });

  describe('generateWinstonPiles', () => {
    it('produces three piles with sizes 6, 4, 3 and 13 total cards', async () => {
      const piles = await generateWinstonPiles('M21');
      expect(piles).toHaveLength(3);
      expect(piles[0].cards).toHaveLength(6);
      expect(piles[1].cards).toHaveLength(4);
      expect(piles[2].cards).toHaveLength(3);
      const total = piles.reduce((acc, p) => acc + p.cards.length, 0);
      expect(total).toBe(13);
    });

    it('honours a custom pile-sizes argument', async () => {
      const piles = await generateWinstonPiles('M21', [5, 5]);
      expect(piles).toHaveLength(2);
      expect(piles[0].cards).toHaveLength(5);
      expect(piles[1].cards).toHaveLength(5);
    });
  });

  describe('createWinstonSession', () => {
    it('initialises session in the intro state with three piles', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      expect(session.mode).toBe('winston');
      expect(session.winstonState).toBe('intro');
      expect(session.piles).toHaveLength(3);
      expect(session.currentSeatIndex).toBe(0);
      expect(livePileCount(session)).toBe(3);
      // One AI neighbor per non-user pile.
      expect(Object.keys(session.aiNeighbors ?? {})).toHaveLength(2);
    });
  });

  describe('revealWinstonPile', () => {
    it('transitions drawing → deciding and exposes the top card', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const before = session.piles[0].cards;
      const next = revealWinstonPile(session, 0);
      expect(next.winstonState).toBe('deciding');
      expect(next.piles[0].revealedCard).toEqual(before[before.length - 1]);
      expect(next.piles[0].awaitingSeat).toBe(0);
    });

    it('throws if the pile is already exhausted', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const revealed = revealWinstonPile(session, 0);
      const picked = pickWinstonPile(revealed, 0);
      expect(() => revealWinstonPile(picked, 0)).toThrow(WinstonOperationError);
    });
  });

  describe('pickWinstonPile (take the whole pile)', () => {
    it('awards the revealed card AND every card underneath it', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const pile = session.piles[0];
      const totalInPile = pile.cards.length;

      const revealed = revealWinstonPile(session, 0);
      const taken = pickWinstonPile(revealed, 0);

      expect(taken.piles[0].isExhausted).toBe(true);
      expect(taken.piles[0].isBurned).toBe(false);
      expect(taken.piles[0].cards).toHaveLength(0);
      expect(taken.picksBySeat[0]).toHaveLength(totalInPile);
    });
  });

  describe('burnWinstonPile (no cards awarded)', () => {
    it('marks the pile as burned with isExhausted = true', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const revealed = revealWinstonPile(session, 1);
      const burned = burnWinstonPile(revealed, 1);
      expect(burned.piles[1].isBurned).toBe(true);
      expect(burned.piles[1].isExhausted).toBe(true);
      expect(burned.picksBySeat[0]).toHaveLength(0);
      expect(burned.winstonState).toBe('drawing');
    });
  });

  describe('full round — issue #1444 integration', () => {
    it('executes reveal+pick across all piles without state corruption', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      // Take every pile without ever burning: 6 + 4 + 3 = 13 cards.
      // The user always plays as seat 0, so we override `seatIndex` on
      // every operation to simulate a single-user integration test.
      let s = session;
      for (let i = 0; i < session.piles.length; i++) {
        s = revealWinstonPile(s, i, 0);
        s = pickWinstonPile(s, i, 0);
      }
      expect(isWinstonComplete(s)).toBe(true);
      expect(s.winstonState).toBe('winston_complete');
      // Seat-0 picks equal the total pile size (6+4+3).
      expect(s.picksBySeat[0]).toHaveLength(13);
    });

    it('mixes pick and burn decisions and remains consistent', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      let s = revealWinstonPile(session, 0, 0);
      s = pickWinstonPile(s, 0, 0); // take 6
      s = revealWinstonPile(s, 1, 0);
      s = burnWinstonPile(s, 1, 0); // burn 4
      s = revealWinstonPile(s, 2, 0);
      s = pickWinstonPile(s, 2, 0); // take 3
      expect(s.winstonState).toBe('winston_complete');
      expect(s.piles[1].isBurned).toBe(true);
      expect(s.picksBySeat[0]).toHaveLength(9); // 6 + 3
    });

    it('passes the seat clockwise between decide cycles', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const s1 = revealWinstonPile(session, 0);
      const after1 = pickWinstonPile(s1, 0);
      expect(after1.currentSeatIndex).toBe(1);

      const s2 = revealWinstonPile(after1, 1);
      const after2 = pickWinstonPile(s2, 1);
      expect(after2.currentSeatIndex).toBe(2);

      const s3 = revealWinstonPile(after2, 2);
      const after3 = pickWinstonPile(s3, 2);
      // All piles exhausted → no further rotation.
      expect(after3.currentSeatIndex).toBe(2);
      expect(after3.winstonState).toBe('winston_complete');
    });
  });

  describe('persistence round-trip', () => {
    it('saveWinstonSession / getWinstonSession survives IndexedDB cycles', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const revealed = revealWinstonPile(session, 0);
      await saveWinstonSession(revealed);

      const reloaded = await getWinstonSession(session.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.mode).toBe('winston');
      expect(reloaded!.piles[0].revealedCard).not.toBeNull();
      expect(reloaded!.winstonState).toBe('deciding');
    });
  });

  describe('currentSeat / applyPicksToPool', () => {
    it('currentSeat reports the active seat', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      expect(currentSeat(session)).toBe(0);
    });

    it('applyPicksToPool mirrors seat-0 picks onto the limited-session pool', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      const revealed = revealWinstonPile(session, 0);
      const taken = pickWinstonPile(revealed, 0);
      const mirrored = applyPicksToPool(taken);
      expect(mirrored.pool.length).toBe(taken.picksBySeat[0].length);
      expect(mirrored.pool).toEqual(taken.picksBySeat[0]);
    });
  });

  describe('error handling', () => {
    it('rejects out-of-range pile indices', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      expect(() => revealWinstonPile(session, 99)).toThrow(WinstonOperationError);
      expect(() => revealWinstonPile(session, -1)).toThrow(WinstonOperationError);
    });

    it('rejects picks before reveal', async () => {
      const session = await createWinstonSession('M21', 'Core 2021');
      expect(() => pickWinstonPile(session, 0)).toThrow(WinstonOperationError);
      expect(() => burnWinstonPile(session, 0)).toThrow(WinstonOperationError);
    });
  });
});
