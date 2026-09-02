/**
 * Seeded-replay integration tests (issue #1559)
 *
 * Proves the acceptance criteria end-to-end through the real generators
 * (card database + set validation mocked, everything else real):
 *
 *  1. Same seed → identical draft packs / sealed pool / Rochester communal
 *     pool / Winston piles (deterministic replay).
 *  2. Different seeds → different pools.
 *  3. No seed → behaves exactly like the pre-#1559 `Math.random`
 *     implementation (spy-stubbed Math.random still steers the output —
 *     proof of at-call-time delegation).
 *  4. `seed` is persisted on the session only when supplied.
 *  5. AI picks (`selectAiPick`) replay identically for a fixed rng seed.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  getAllCards,
  initializeCardDatabase,
  type MinimalCard,
} from "@/lib/card-database";
import { validateSetIsDraftable } from "../set-service";

// Mock the card database: a well-stocked synthetic set so every rarity
// pool has plenty of candidates (mirrors sealed-generator.test.ts).
jest.mock("@/lib/card-database", () => ({
  initializeCardDatabase: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
  getAllCards: jest.fn<() => Promise<MinimalCard[]>>(),
}));

// Bypass set-metadata validation (#1557); covered hermetically elsewhere.
jest.mock("../set-service", () => ({
  validateSetIsDraftable: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));

// Imports under test (after mocks — jest hoists mock calls anyway).
import { clearCardCache, generateSealedPool } from "../sealed-generator";
import {
  createDraftSession,
  PACKS_PER_DRAFT,
  CARDS_PER_PACK,
} from "../draft-generator";
import { createRochesterSession } from "../rochester-draft";
import { createWinstonSession } from "../winston-draft";
import { createRng } from "../rng";
import { selectAiPick } from "@/lib/ai-neighbor-logic";
import type {
  DraftPack,
  PoolCard,
  RochesterSession,
  WinstonSession,
  DraftSession,
  AiNeighbor,
} from "../types";

const mockGetAllCards = getAllCards as jest.MockedFunction<typeof getAllCards>;
const mockValidate = validateSetIsDraftable as jest.MockedFunction<
  typeof validateSetIsDraftable
>;

// ============================================================================
// Mock card database
// ============================================================================

function createMockCard(partial: Partial<MinimalCard>): MinimalCard {
  return {
    id: "mock-card",
    name: "Mock Card",
    set: "M21",
    collector_number: "0",
    cmc: 2,
    type_line: "Creature — Human",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "common",
    legalities: { standard: "legal" },
    ...partial,
  };
}

const mockCommons: MinimalCard[] = Array.from({ length: 50 }, (_, i) =>
  createMockCard({
    id: `common-${i}`,
    name: `Common ${i}`,
    rarity: "common",
    colors: ["W", "U", "B", "R", "G"].slice(0, (i % 5) + 1),
  }),
);
const mockUncommons: MinimalCard[] = Array.from({ length: 30 }, (_, i) =>
  createMockCard({
    id: `uncommon-${i}`,
    name: `Uncommon ${i}`,
    rarity: "uncommon",
  }),
);
const mockRares: MinimalCard[] = Array.from({ length: 15 }, (_, i) =>
  createMockCard({ id: `rare-${i}`, name: `Rare ${i}`, rarity: "rare" }),
);
const mockMythics: MinimalCard[] = Array.from({ length: 8 }, (_, i) =>
  createMockCard({ id: `mythic-${i}`, name: `Mythic ${i}`, rarity: "mythic" }),
);

const fullM21Db: MinimalCard[] = [
  ...mockCommons,
  ...mockUncommons,
  ...mockRares,
  ...mockMythics,
];

// ============================================================================
// Normalizers — strip wall-clock fields (addedAt) and generated UUIDs that
// are intentionally NOT part of the seeded RNG stream.
// ============================================================================

/** Pack identity minus RNG-independent volatile metadata (UUID ids, addedAt). */
const normalizePack = (p: DraftPack) => ({
  isOpened: p.isOpened,
  pickedCardIds: [...p.pickedCardIds],
  cards: p.cards.map((c) => ({
    id: c.id,
    name: c.name,
    rarity: c.rarity,
    packId: c.packId,
    packSlot: c.packSlot,
  })),
});

const normalizePacks = (packs: DraftPack[]) => packs.map(normalizePack);

/** Card identity sequence for flat pools (sealed / Rochester communal). */
const cardIds = (pool: PoolCard[]) => pool.map((c) => `${c.packSlot}:${c.id}`);

/** Pile identity sequence for Winston piles. */
const pileIds = (session: WinstonSession) =>
  session.piles.map((p) => p.cards.map((c) => c.id));

// ============================================================================
// Harness
// ============================================================================

beforeEach(() => {
  clearCardCache();
  mockGetAllCards.mockReset();
  mockGetAllCards.mockResolvedValue(fullM21Db);
  mockValidate.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// Draft
// ============================================================================

describe("draft: seeded replay (issue #1559)", () => {
  it("same seed → identical 3×14 packs across two sessions", async () => {
    const a = await createDraftSession("M21", "Core Set 2021", { seed: 42 });
    const b = await createDraftSession("M21", "Core Set 2021", { seed: 42 });

    expect(a.packs).toHaveLength(PACKS_PER_DRAFT);
    for (const s of [a, b]) {
      expect(s.packs.flatMap((p) => p.cards)).toHaveLength(
        PACKS_PER_DRAFT * CARDS_PER_PACK,
      );
    }

    // Deep-equal on the 42 dealt cards (minus wall-clock addedAt / pack UUIDs,
    // which are deliberately not RNG-derived).
    expect(normalizePacks(a.packs)).toEqual(normalizePacks(b.packs));
  });

  it("different seeds → different pods", async () => {
    const a = await createDraftSession("M21", "Core Set 2021", { seed: 42 });
    const b = await createDraftSession("M21", "Core Set 2021", { seed: 1337 });

    expect(normalizePacks(a.packs)).not.toEqual(normalizePacks(b.packs));
  });

  it("persists the seed on the session only when supplied", async () => {
    const seeded = await createDraftSession("M21", "Core Set 2021", {
      seed: 42,
    });
    expect(seeded.seed).toBe(42);

    const unseeded = await createDraftSession("M21", "Core Set 2021");
    expect("seed" in unseeded).toBe(false);
  });

  it("unseeded sessions still deal a full 42-card pod", async () => {
    const session = await createDraftSession("M21", "Core Set 2021");
    expect(session.packs).toHaveLength(3);
    expect(session.packs.every((p) => p.cards.length === 14)).toBe(true);
    expect(session.packs.every((p) => p.isOpened === false)).toBe(true);
  });
});

// ============================================================================
// Sealed
// ============================================================================

describe("sealed: seeded replay (issue #1559)", () => {
  it("same seed → identical 84-card pool", async () => {
    const a = await generateSealedPool("M21", { seed: 42 });
    const b = await generateSealedPool("M21", { seed: 42 });

    expect(a).toHaveLength(84);
    expect(cardIds(a)).toEqual(cardIds(b));
  });

  it("different seeds → different pools", async () => {
    const a = await generateSealedPool("M21", { seed: 42 });
    const b = await generateSealedPool("M21", { seed: 7 });

    expect(cardIds(a)).not.toEqual(cardIds(b));
  });

  it("unseeded generation follows a spy-stubbed Math.random stream (pre-#1559 delegation)", async () => {
    // A deterministic Math.random stub must steer unseeded generation,
    // proving the default Rng delegates at call time. The stub is stateful,
    // so re-arm it with the same seed before each generation — each call
    // then consumes an identical value sequence and must produce an
    // identical pool.
    const makeStub = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const spy = jest.spyOn(Math, "random").mockImplementation(makeStub(99));

    try {
      const a = await generateSealedPool("M21");
      spy.mockImplementation(makeStub(99));
      const b = await generateSealedPool("M21");
      expect(cardIds(a)).toEqual(cardIds(b));
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("createSealedSession persists the seed and generates the full pool", async () => {
    const { createSealedSession } = await import("../sealed-generator");
    const session = await createSealedSession("M21", "Core Set 2021", {
      seed: 42,
    });

    expect(session.seed).toBe(42);
    expect(session.pool).toHaveLength(84);

    const unseeded = await createSealedSession("M21", "Core Set 2021");
    expect("seed" in unseeded).toBe(false);
  });
});

// ============================================================================
// Rochester
// ============================================================================

describe("rochester: seeded replay (issue #1559)", () => {
  it("same seed → identical communal pool", async () => {
    const a = await createRochesterSession("M21", "Core Set 2021", {
      seed: 42,
      playerCount: 3,
    });
    const b = await createRochesterSession("M21", "Core Set 2021", {
      seed: 42,
      playerCount: 3,
    });

    expect(a.communalPool).toHaveLength(45); // 3 seats × 15 picks
    expect(cardIds(a.communalPool)).toEqual(cardIds(b.communalPool));
    expect(a.seed).toBe(42);
  });

  it("different seeds → different communal pools", async () => {
    const a: RochesterSession = await createRochesterSession("M21", "x", {
      seed: 42,
      playerCount: 3,
    });
    const b: RochesterSession = await createRochesterSession("M21", "x", {
      seed: 9,
      playerCount: 3,
    });
    expect(cardIds(a.communalPool)).not.toEqual(cardIds(b.communalPool));
  });

  it("unseeded sessions carry no seed field", async () => {
    const session = await createRochesterSession("M21", "x", {
      playerCount: 3,
    });
    expect("seed" in session).toBe(false);
  });
});

// ============================================================================
// Winston
// ============================================================================

describe("winston: seeded replay (issue #1559)", () => {
  it("same seed → identical piles", async () => {
    const a = await createWinstonSession("M21", "Core Set 2021", { seed: 42 });
    const b = await createWinstonSession("M21", "Core Set 2021", { seed: 42 });

    expect(a.piles.map((p) => p.cards.length)).toEqual([6, 4, 3]);
    expect(pileIds(a)).toEqual(pileIds(b));
    expect(a.seed).toBe(42);
  });

  it("different seeds → different piles", async () => {
    const a: WinstonSession = await createWinstonSession("M21", "x", {
      seed: 42,
    });
    const b: WinstonSession = await createWinstonSession("M21", "x", {
      seed: 5,
    });
    expect(pileIds(a)).not.toEqual(pileIds(b));
  });

  it("unseeded sessions carry no seed field", async () => {
    const session = await createWinstonSession("M21", "x");
    expect("seed" in session).toBe(false);
    expect(session.piles).toHaveLength(3);
  });
});

// ============================================================================
// AI picks
// ============================================================================

/** Build a synthetic face-up pack of distinct cards for picker tests. */
function makeTestPack(): DraftPack {
  const now = new Date().toISOString();
  const cards = ["W", "U", "B", "R", "G", "C"].map((color, i) => ({
    ...createMockCard({
      id: `pack-card-${i}`,
      name: `Pack Card ${i}`,
      rarity: i === 0 ? "mythic" : i < 3 ? "rare" : "common",
      colors: [color],
      type_line: i % 2 === 0 ? "Creature — Test" : "Instant — Test",
    }),
    packId: 0,
    packSlot: i,
    addedAt: now,
  })) as DraftPack["cards"];
  return { id: "test-pack", cards, isOpened: true, pickedCardIds: [] };
}

function makeNeighbor(difficulty: AiNeighbor["difficulty"]): AiNeighbor {
  return {
    enabled: true,
    difficulty,
    pickDelay: 0,
    state: {
      pool: [],
      isPicking: false,
      pickStartTime: null,
      lastPickReason: null,
      archetypeSignals: [],
    },
  };
}

describe("ai picks: seeded rng replay (issue #1559)", () => {
  it("easy tier: same rng seed → identical picks across replays", () => {
    const pack = makeTestPack();
    const pickA = selectAiPick(
      pack,
      makeNeighbor("easy"),
      "draft",
      [],
      createRng(11),
    );
    const pickB = selectAiPick(
      pack,
      makeNeighbor("easy"),
      "draft",
      [],
      createRng(11),
    );

    expect(pickA).not.toBeNull();
    expect(pickA?.id).toBe(pickB?.id);
  });

  it("expert tier: same rng seed → identical picks across replays", () => {
    const pack = makeTestPack();
    const pickA = selectAiPick(
      pack,
      makeNeighbor("expert"),
      "draft",
      [],
      createRng(123),
    );
    const pickB = selectAiPick(
      pack,
      makeNeighbor("expert"),
      "draft",
      [],
      createRng(123),
    );

    expect(pickA).not.toBeNull();
    expect(pickA?.id).toBe(pickB?.id);
  });

  it("draft session seed persists through storage round-trip shape (type-level smoke)", async () => {
    // The seed field is part of the persisted session object (Dexie stores
    // plain clones), so a replay caller reads session.seed directly.
    const session: DraftSession = await createDraftSession(
      "M21",
      "Core Set 2021",
      {
        seed: 4242,
      },
    );
    expect(JSON.parse(JSON.stringify(session)).seed).toBe(4242);
  });
});
