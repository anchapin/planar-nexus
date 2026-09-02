/**
 * Tests for sealed pool generation
 *
 * Covers: SEAL-01, SEAL-02 (issue #1560 — real coverage replacing scaffolding)
 *
 * SEAL-01: Start new Sealed session with selected set
 * SEAL-02: Open 6 packs immediately, all cards revealed
 *
 * The card database and set-metadata validation are mocked so pool generation
 * is exercised hermetically: rarity distribution, pack structure, the
 * FALLBACK_CARD_NAMES path (issue #693 M21 regression), and the per-set cache.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import type { MinimalCard } from "@/lib/card-database";
import { getAllCards } from "@/lib/card-database";
import type { PoolCard } from "../types";
import {
  clearCardCache,
  generatePack,
  generateSealedPool,
  generateSealedPoolWithPacks,
  createSealedSession,
  generateDraftPack,
  CARDS_PER_PACK,
  COMMONS_PER_PACK,
  UNCOMMONS_PER_PACK,
  PACKS_PER_SEALED,
} from "../sealed-generator";
import { validateSetIsDraftable } from "../set-service";

// Mock the card database — resolved values are swapped per test.
jest.mock("@/lib/card-database", () => ({
  initializeCardDatabase: jest.fn(async () => undefined),
  getAllCards: jest.fn(async () => [] as MinimalCard[]),
}));

// Issue #1557: bypass set-metadata validation so pool-shape tests stay
// hermetic (no Scryfall lookup). Rejection behavior has dedicated coverage in
// set-service.test.ts / issue-1557-draftable-set-types.test.ts.
jest.mock("../set-service", () => ({
  validateSetIsDraftable: jest.fn(async () => undefined),
}));

const mockGetAllCards = getAllCards as jest.MockedFunction<typeof getAllCards>;
const mockValidate = validateSetIsDraftable as jest.MockedFunction<
  typeof validateSetIsDraftable
>;

// Mock minimal card for testing
const createMockCard = (overrides: Partial<MinimalCard> = {}): MinimalCard => ({
  id: "mock-card-1",
  name: "Test Card",
  set: "M21",
  collector_number: "1",
  cmc: 3,
  type_line: "Creature — Elf Warrior",
  colors: ["G"],
  color_identity: ["G"],
  rarity: "common",
  legalities: { standard: "legal" },
  ...overrides,
});

// Mock cards by rarity (M21)
const mockCommons: MinimalCard[] = Array.from({ length: 50 }, (_, i) =>
  createMockCard({
    id: `common-${i}`,
    name: `Common Card ${i + 1}`,
    rarity: "common",
    colors: i % 5 === 0 ? [] : ["W", "U", "B", "R", "G"].slice(0, (i % 3) + 1),
  }),
);

const mockUncommons: MinimalCard[] = Array.from({ length: 30 }, (_, i) =>
  createMockCard({
    id: `uncommon-${i}`,
    name: `Uncommon Card ${i + 1}`,
    rarity: "uncommon",
    colors: ["W", "U", "B", "R", "G"].slice(0, (i % 3) + 1),
  }),
);

const mockRares: MinimalCard[] = Array.from({ length: 15 }, (_, i) =>
  createMockCard({
    id: `rare-${i}`,
    name: `Rare Card ${i + 1}`,
    rarity: "rare",
    colors: ["W", "U", "B", "R", "G"].slice(0, (i % 4) + 1),
  }),
);

const mockMythics: MinimalCard[] = Array.from({ length: 8 }, (_, i) =>
  createMockCard({
    id: `mythic-${i}`,
    name: `Mythic Card ${i + 1}`,
    rarity: "mythic",
    colors: ["W", "U", "B", "R", "G"].slice(0, (i % 4) + 1),
  }),
);

/** A well-stocked M21 database: enough cards of every rarity. */
const fullM21Db: MinimalCard[] = [
  ...mockCommons,
  ...mockUncommons,
  ...mockRares,
  ...mockMythics,
];

/**
 * Deterministic seeded PRNG (mulberry32). Used to make the mythic-ratio
 * statistical assertion reproducible: a fixed seed always produces the
 * same Math.random() sequence, so the ±2σ check can never flake.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  clearCardCache();
  mockGetAllCards.mockReset();
  mockGetAllCards.mockResolvedValue(fullM21Db);
  mockValidate.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SEAL-01: Session Creation", () => {
  it("should create a sealed session with a UUID id", async () => {
    const session = await createSealedSession("M21", "Core Set 2021");

    expect(session.id).toMatch(UUID_V4_RE);
  });

  it("should associate the session with the selected set", async () => {
    const session = await createSealedSession("M21", "Core Set 2021");

    expect(session.setCode).toBe("M21");
    expect(session.setName).toBe("Core Set 2021");
    expect(session.mode).toBe("sealed");
    expect(session.status).toBe("in_progress");
    expect(session.deck).toEqual([]);
  });

  it("should validate the set is draftable before generating the pool", async () => {
    await createSealedSession("M21", "Core Set 2021");

    expect(mockValidate).toHaveBeenCalledWith("M21");
    expect(mockValidate).toHaveBeenCalledTimes(1);
  });

  it("should generate the full pool immediately on session creation", async () => {
    const session = await createSealedSession("M21", "Core Set 2021");

    // 6 packs × 14 cards, synchronously available on the session object.
    expect(session.pool).toHaveLength(PACKS_PER_SEALED * CARDS_PER_PACK);
    expect(session.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(session.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("SEAL-02: Pack Generation (6 packs × 14 cards = 84 total)", () => {
  it("should generate exactly 6 packs", async () => {
    const { packContents } = await generateSealedPoolWithPacks("M21");

    expect(packContents).toHaveLength(PACKS_PER_SEALED);
    expect(packContents).toHaveLength(6);
  });

  it("should generate 14 cards per pack (10 commons / 3 uncommons / 1 rare-or-mythic)", async () => {
    const { packContents } = await generateSealedPoolWithPacks("M21");

    for (const pack of packContents) {
      expect(pack.commons).toHaveLength(COMMONS_PER_PACK);
      expect(pack.uncommons).toHaveLength(UNCOMMONS_PER_PACK);
      expect(pack.commons.length + pack.uncommons.length + 1).toBe(
        CARDS_PER_PACK,
      );
      expect(pack.rareOrMythic).toBeDefined();
      expect(pack.rareOrMythic.rarity).toMatch(/^(rare|mythic)$/);
    }
  });

  it("should generate exactly 84 cards total (6 × 14)", async () => {
    const pool = await generateSealedPool("M21");

    expect(pool).toHaveLength(84);
  });

  it("should select commons and uncommons of the correct rarity", async () => {
    const { packContents } = await generateSealedPoolWithPacks("M21");

    for (const pack of packContents) {
      for (const card of pack.commons) expect(card.rarity).toBe("common");
      for (const card of pack.uncommons) expect(card.rarity).toBe("uncommon");
    }
  });

  it("should tag every pool card with its pack id and unique slot", async () => {
    const { pool, packContents } = await generateSealedPoolWithPacks("M21");

    expect(pool).toHaveLength(84);
    for (let packId = 0; packId < packContents.length; packId++) {
      const packCards = pool.filter((c) => c.packId === packId);
      expect(packCards).toHaveLength(CARDS_PER_PACK);

      // Slots 0..13, each used exactly once within the pack.
      const slots = packCards.map((c) => c.packSlot).sort((a, b) => a - b);
      expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    }
  });

  it("should reveal all cards immediately (full card data, no face-down markers)", async () => {
    const { pool } = await generateSealedPoolWithPacks("M21");

    for (const card of pool) {
      // Sealed pools are opened instantly: every entry carries the full card
      // data plus an open timestamp — there is no isOpened/face-down state.
      expect(card.name).toBeTruthy();
      expect(card.type_line).toBeTruthy();
      expect(typeof card.cmc).toBe("number");
      expect(card.colors).toBeDefined();
      expect(card.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("should have ~1:8 mythic ratio for the rare slot across 1000 seeded packs (±2σ)", async () => {
    // Fixed seed → deterministic Math.random sequence → non-flaky statistics.
    const randomSpy = jest
      .spyOn(Math, "random")
      .mockImplementation(mulberry32(20260902));

    const runs = 1000;
    let mythicCount = 0;
    try {
      for (let i = 0; i < runs; i++) {
        const pack = await generatePack("M21");
        if (pack.rareOrMythic.rarity === "mythic") mythicCount++;
      }
    } finally {
      randomSpy.mockRestore();
    }

    const expected = runs / 8; // 125
    const sd = Math.sqrt(runs * (1 / 8) * (7 / 8)); // ≈ 10.46
    expect(Math.abs(mythicCount - expected)).toBeLessThanOrEqual(2 * sd);
  });

  it("should handle sets without enough cards gracefully via FALLBACK_CARD_NAMES (issue #693 M21 regression)", async () => {
    // A sparse set: 4 commons, 2 uncommons, no rares, no mythics.
    const sparseSetDb: MinimalCard[] = [
      ...mockCommons.slice(0, 4),
      ...mockUncommons.slice(0, 2),
    ].map((card) => ({ ...card, set: "XYZ" }));
    mockGetAllCards.mockResolvedValue(sparseSetDb);

    // Force the non-mythic branch: 0.99 ≥ 1/8 → rare slot.
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.99);

    let pack;
    try {
      pack = await generatePack("XYZ");
    } finally {
      randomSpy.mockRestore();
    }

    // Commons padded from 4 real cards to 10 with fallback cards.
    expect(pack.commons).toHaveLength(COMMONS_PER_PACK);
    const fallbackCommons = pack.commons.filter((c) =>
      c.id.startsWith("fallback-XYZ-common-"),
    );
    expect(fallbackCommons).toHaveLength(6);
    for (const card of fallbackCommons) {
      expect(card.name).toMatch(/ \(XYZ\)$/);
      expect(card.rarity).toBe("common");
    }

    // Uncommons padded from 2 to 3.
    expect(pack.uncommons).toHaveLength(UNCOMMONS_PER_PACK);
    expect(
      pack.uncommons.filter((c) => c.id.startsWith("fallback-XYZ-uncommon-")),
    ).toHaveLength(1);

    // Rare pool was empty → single rare fallback card.
    expect(pack.rareOrMythic.rarity).toBe("rare");
    expect(pack.rareOrMythic.id).toBe("fallback-XYZ-rare-0");
    expect(pack.rareOrMythic.name).toBe("Baneslayer Angel");
  });

  it("should pad from the mythic fallback list when the mythic roll hits an empty mythic pool", async () => {
    mockGetAllCards.mockResolvedValue(
      mockCommons.slice(0, 20).map((card) => ({ ...card, set: "XYZ" })),
    );

    // Force the mythic branch: 0.01 < 1/8 → mythic slot, but the set has no
    // mythics (and no rares), so the mythic fallback list must be used.
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.01);

    let pack;
    try {
      pack = await generatePack("XYZ");
    } finally {
      randomSpy.mockRestore();
    }

    expect(pack.rareOrMythic.rarity).toBe("mythic");
    expect(pack.rareOrMythic.id).toBe("fallback-XYZ-mythic-0");
    expect(pack.rareOrMythic.name).toBe("Liliana, the Last Hope");
  });

  it("should cache the rarity distribution per set (card DB queried once per rarity)", async () => {
    await generatePack("M21");
    await generatePack("M21");

    // 4 lookups on the first pack (common/uncommon/rare/mythic), 0 on the
    // second — the per-set cache short-circuits repeat database reads.
    expect(mockGetAllCards).toHaveBeenCalledTimes(4);
  });

  it("should key the cache by set code (different set re-queries the DB)", async () => {
    await generatePack("M21");
    mockGetAllCards.mockResolvedValue(
      fullM21Db.map((card) => ({ ...card, set: "ZNR" })),
    );
    await generatePack("ZNR");

    expect(mockGetAllCards).toHaveBeenCalledTimes(8);
  });

  it("should generate a 14-card draft pack with pack id 0 via generateDraftPack", async () => {
    const draftPack: PoolCard[] = await generateDraftPack("M21");

    expect(draftPack).toHaveLength(CARDS_PER_PACK);
    expect(draftPack.every((c) => c.packId === 0)).toBe(true);
    expect(draftPack.map((c) => c.packSlot)).toEqual(
      expect.arrayContaining([0, 10, 13]),
    );
  });
});
