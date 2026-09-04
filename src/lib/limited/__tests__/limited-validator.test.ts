/**
 * Limited Validator Tests
 *
 * Tests for LBld-01 through LBld-06 requirements:
 * - LBld-01: Pool-only deck building validation
 * - LBld-02: Limited filter restricting to pool
 * - LBld-03: 40-card minimum
 * - LBld-04: 4-copy limit
 * - LBld-05: Pool-derived sideboard per CR 100.5 / CR 904.3 (issue #1561)
 * - LBld-06: Save/load deck for session
 */

import {
  validateLimitedDeck,
  canAddCardToDeck,
  isPoolCard,
  getSessionSideboard,
  LIMITED_RULES,
} from "../limited-validator";
import type { PoolCard, LimitedDeckCard, LimitedSession } from "../types";
import type { MinimalCard } from "@/lib/card-database";

// Mock minimal card for testing
const createMockCard = (id: string, name: string): MinimalCard => ({
  id,
  name,
  set: "M21",
  rarity: "common",
  type_line: "Creature",
  mana_cost: "",
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

describe("LBld-01: Pool-only deck building", () => {
  it("should verify card is in pool", () => {
    const pool: PoolCard[] = [
      createMockPoolCard("card-1", "Giant Growth"),
      createMockPoolCard("card-2", "Lightning Bolt"),
    ];

    expect(isPoolCard("card-1", pool)).toBe(true);
    expect(isPoolCard("card-2", pool)).toBe(true);
  });

  it("should reject card not in pool", () => {
    const pool: PoolCard[] = [createMockPoolCard("card-1", "Giant Growth")];

    expect(isPoolCard("card-999", pool)).toBe(false);
  });

  it("should handle empty pool", () => {
    expect(isPoolCard("card-1", [])).toBe(false);
  });
});

// ============================================================================
// LBld-02: Limited filter restricting to pool
// ============================================================================

describe("LBld-02: Limited filter mode", () => {
  it("should check if card can be added in limited mode", () => {
    const pool: PoolCard[] = [createMockPoolCard("card-1", "Giant Growth")];

    const deck: LimitedDeckCard[] = [];

    // Should be able to add
    expect(canAddCardToDeck(pool[0], deck)).toBe(true);
  });

  it("should restrict to pool cards only", () => {
    const pool: PoolCard[] = [createMockPoolCard("card-1", "Giant Growth")];
    const nonPoolCard = createMockPoolCard("card-999", "Not In Pool");

    expect(isPoolCard("card-999", pool)).toBe(false);
  });
});

// ============================================================================
// LBld-03: 40-card minimum validation
// ============================================================================

describe("LBld-03: 40-card minimum", () => {
  it("should pass valid deck with exactly 40 cards", () => {
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

  it("should pass deck with more than 40 cards", () => {
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

  it("should fail deck with 39 cards", () => {
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
    expect(result.errors.some((e: string) => e.includes("40"))).toBe(true);
  });

  it("should fail empty deck", () => {
    const result = validateLimitedDeck([]);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("40"))).toBe(true);
  });

  it("should count card quantities correctly", () => {
    // 8 cards: 4 of Giant Growth + 4 of Forest = 8 total
    // Add more cards to reach 40 minimum
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 4,
        addedAt: new Date().toISOString(),
      },
      {
        card: createMockCard("card-2", "Forest"),
        count: 4,
        addedAt: new Date().toISOString(),
      },
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

describe("LBld-04: 4-copy limit", () => {
  it("should pass deck with exactly 4 copies of a card (with 40 cards total)", () => {
    // 4 copies of one card + 36 other unique cards
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 4,
        addedAt: new Date().toISOString(),
      },
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

  it("should pass deck with fewer than 4 copies (with 40 cards total)", () => {
    // 3 copies of one card + 37 other unique cards
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 3,
        addedAt: new Date().toISOString(),
      },
      ...Array.from({ length: 37 }, (_, i) => ({
        card: createMockCard(`card-${i + 2}`, `Card ${i + 2}`),
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
  });

  it("should fail deck with 5 copies of a card", () => {
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 5,
        addedAt: new Date().toISOString(),
      },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some(
        (e: string) => e.includes("4 copies") || e.includes("maximum"),
      ),
    ).toBe(true);
  });

  it("should fail deck exceeding 4 copies across multiple entries", () => {
    // Simulate deck with 2 copies added twice (total 5)
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 2,
        addedAt: new Date().toISOString(),
      },
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 3,
        addedAt: new Date().toISOString(),
      },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(false);
  });

  it("should allow canAddCardToDeck when below limit", () => {
    const poolCard = createMockPoolCard("card-1", "Giant Growth");
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 3,
        addedAt: new Date().toISOString(),
      },
    ];

    expect(canAddCardToDeck(poolCard, deck)).toBe(true);
  });

  it("should prevent canAddCardToDeck when at limit", () => {
    const poolCard = createMockPoolCard("card-1", "Giant Growth");
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 4,
        addedAt: new Date().toISOString(),
      },
    ];

    expect(canAddCardToDeck(poolCard, deck)).toBe(false);
  });
});

// ============================================================================
// LBld-05: Pool-derived sideboard (issue #1561, CR 100.5 / CR 904.3)
// ============================================================================

describe("LBld-05: Pool-derived sideboard per CR 100.5 / CR 904.3", () => {
  it("should declare limited rules as sideboard-enabled with unbounded size", () => {
    expect(LIMITED_RULES.usesSideboard).toBe(true);
    // CR 100.5: the Limited sideboard is the entire pool minus main deck,
    // so there is no fixed upper bound. The validator encodes this as
    // POSITIVE_INFINITY rather than omitting the key — the type
    // (FormatRules.sideboardSize: number) is shared with constructed
    // formats that do have a hard cap.
    expect(LIMITED_RULES.sideboardSize).toBe(Number.POSITIVE_INFINITY);
  });

  it("should have 40-card minimum", () => {
    expect(LIMITED_RULES.minCards).toBe(40);
  });

  it("should have 4-copy max", () => {
    expect(LIMITED_RULES.maxCopies).toBe(4);
  });

  it("should expose unused pool cards as the sideboard", () => {
    // Acceptance #1: 45-card pool + 40-card main deck → sideboard = 5
    // unused pool cards, no validation error.
    const pool: PoolCard[] = Array.from({ length: 45 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = pool.slice(0, 40).map((poolCard) => ({
      card: poolCard,
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.totalCards).toBe(40);
    expect(result.sideboardCards).toBeDefined();
    expect(result.sideboardCards).toHaveLength(5);
    const sideboardIds = (result.sideboardCards ?? []).map((c) => c.id);
    expect(sideboardIds).toEqual([
      "card-40",
      "card-41",
      "card-42",
      "card-43",
      "card-44",
    ]);
  });

  it("should produce an empty sideboard when the deck consumes the whole pool", () => {
    // Acceptance #c (boundary): deck == pool → sideboard empty,
    // validation still passes (no error from a 0-length sideboard).
    const pool: PoolCard[] = Array.from({ length: 40 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = pool.map((poolCard) => ({
      card: poolCard,
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(true);
    expect(result.sideboardCards).toEqual([]);
  });

  it("should accept a sideboard of any size ≥ 0", () => {
    // Acceptance #c (large pool): a 200-card pool with a 40-card main
    // deck leaves 160 sideboard cards — well above any constructed
    // sideboard cap. CR 100.5 permits this; the validator must not
    // complain about sideboard length.
    const pool: PoolCard[] = Array.from({ length: 200 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = pool.slice(0, 40).map((poolCard) => ({
      card: poolCard,
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(true);
    expect(result.sideboardCards).toHaveLength(160);
  });

  it("should reject a deck containing a card NOT in the session pool (LBld-01 regression)", () => {
    // Acceptance #2: regression guard for the LBld-01 pool-only rule.
    // The pre-#1561 validator didn't surface this error itself — callers
    // had to use isPoolCard() manually. After #1561 the validator emits
    // a descriptive error naming the offending card.
    const pool: PoolCard[] = Array.from({ length: 40 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = [
      ...pool.map((poolCard) => ({
        card: poolCard as MinimalCard,
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];
    // Replace the last entry with a card that is not in the pool.
    deck[deck.length - 1] = {
      card: createMockCard("rogue", "Rogue Card"),
      count: 1,
      addedAt: new Date().toISOString(),
    };

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some(
        (e: string) => e.includes("Rogue Card") && e.includes("pool"),
      ),
    ).toBe(true);
  });

  it("should reject a deck that claims more copies than the pool supplies", () => {
    // A pool with 2 copies of card-A cannot host a deck with 3 copies of
    // card-A — CR 100.5 does not let players exceed pool copy counts.
    const pool: PoolCard[] = [
      createMockPoolCard("card-1", "Card 1"),
      createMockPoolCard("card-1", "Card 1"),
      ...Array.from({ length: 38 }, (_, i) =>
        createMockPoolCard(`card-${i + 2}`, `Card ${i + 2}`),
      ),
    ];
    const deck: LimitedDeckCard[] = [
      // 3 copies of card-1 — pool only has 2.
      {
        card: createMockCard("card-1", "Card 1"),
        count: 3,
        addedAt: new Date().toISOString(),
      },
      ...Array.from({ length: 37 }, (_, i) => ({
        card: createMockCard(`card-${i + 2}`, `Card ${i + 2}`),
        count: 1,
        addedAt: new Date().toISOString(),
      })),
    ];

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some(
        (e: string) => e.includes("Card 1") && e.includes("pool"),
      ),
    ).toBe(true);
  });

  it("should enforce the 40-card floor even when the sideboard is populated", () => {
    // Acceptance #3 of the user's plan ("rejects a deck > min size even
    // with sideboard" — interpreted as "rejects a deck that fails the
    // min-size check even when the sideboard is full"): the LBld-03
    // floor applies to the main deck regardless of sideboard size.
    const pool: PoolCard[] = Array.from({ length: 45 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = pool.slice(0, 39).map((poolCard) => ({
      card: poolCard,
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const result = validateLimitedDeck(deck, pool);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("40"))).toBe(true);
    // Sideboard is still surfaced — pool has 6 unused cards.
    expect(result.sideboardCards).toHaveLength(6);
  });

  it("should not populate sideboardCards when no pool is supplied", () => {
    // Backward-compat: existing call sites that omit `pool` continue
    // to receive the pre-#1561 shape. `sideboardCards` is `undefined`
    // rather than `[]` so consumers can distinguish "caller didn't
    // supply a pool" from "pool is exhausted by the main deck".
    const deck: LimitedDeckCard[] = Array.from({ length: 40 }, (_, i) => ({
      card: createMockCard(`card-${i}`, `Card ${i}`),
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const result = validateLimitedDeck(deck);

    expect(result.isValid).toBe(true);
    expect(result.sideboardCards).toBeUndefined();
  });
});

describe("getSessionSideboard (CR 100.5 round-trip)", () => {
  it("should round-trip through a persisted session", () => {
    // Acceptance #5: a persisted Limited session, when reloaded, must
    // surface both the main deck and the sideboard verbatim. Because
    // `getSessionSideboard` is a pure derivation of session.pool and
    // session.deck (the two IndexedDB-persisted fields), reloading the
    // session and re-deriving must give the same sideboard list.
    const pool: PoolCard[] = Array.from({ length: 45 }, (_, i) =>
      createMockPoolCard(`card-${i}`, `Card ${i}`),
    );
    const deck: LimitedDeckCard[] = pool.slice(0, 40).map((poolCard) => ({
      card: poolCard,
      count: 1,
      addedAt: new Date().toISOString(),
    }));

    const session: LimitedSession = {
      id: "session-id",
      setCode: "M21",
      setName: "Core Set 2021",
      mode: "sealed",
      status: "completed",
      pool,
      deck,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sideboard = getSessionSideboard(session);

    expect(sideboard).toHaveLength(5);
    expect(sideboard.map((c) => c.id)).toEqual([
      "card-40",
      "card-41",
      "card-42",
      "card-43",
      "card-44",
    ]);

    // Reload round-trip: copy the session (simulating IndexedDB
    // JSON.parse → JSON.stringify) and re-derive the sideboard. The
    // derived list must be identical.
    const reloaded: LimitedSession = JSON.parse(JSON.stringify(session));
    const sideboardAfterReload = getSessionSideboard(reloaded);
    expect(sideboardAfterReload).toEqual(sideboard);
  });

  it("should treat an empty deck as 'whole pool is sideboard'", () => {
    const pool: PoolCard[] = [
      createMockPoolCard("card-1", "Card 1"),
      createMockPoolCard("card-2", "Card 2"),
    ];
    const session: LimitedSession = {
      id: "session-id",
      setCode: "M21",
      setName: "Core Set 2021",
      mode: "sealed",
      status: "in_progress",
      pool,
      deck: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(getSessionSideboard(session)).toEqual(pool);
  });

  it("should subtract copies one-by-one when the same card appears multiple times in the pool", () => {
    // Pool has 3 physical copies of card-A; deck registers 2 of them.
    // Sideboard must contain the 1 unused copy, not all 3 and not 0.
    const pool: PoolCard[] = [
      createMockPoolCard("card-A", "Card A"),
      createMockPoolCard("card-A", "Card A"),
      createMockPoolCard("card-A", "Card A"),
      createMockPoolCard("card-B", "Card B"),
    ];
    const session: LimitedSession = {
      id: "session-id",
      setCode: "M21",
      setName: "Core Set 2021",
      mode: "sealed",
      status: "in_progress",
      pool,
      deck: [
        {
          card: createMockCard("card-A", "Card A"),
          count: 2,
          addedAt: new Date().toISOString(),
        },
        {
          card: createMockCard("card-B", "Card B"),
          count: 1,
          addedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sideboard = getSessionSideboard(session);
    expect(sideboard).toHaveLength(1);
    expect(sideboard[0].id).toBe("card-A");
  });
});

// ============================================================================
// LBld-06: Save/load deck for session
// ============================================================================

describe("LBld-06: Session deck persistence", () => {
  it("should validate deck for session storage", () => {
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

  it("should provide type breakdown in validation result", () => {
    const deck: LimitedDeckCard[] = [
      {
        card: createMockCard("card-1", "Giant Growth"),
        count: 1,
        addedAt: new Date().toISOString(),
      },
    ];

    const result = validateLimitedDeck(deck);

    expect(result.typeBreakdown).toBeDefined();
    expect(typeof result.typeBreakdown.creatures).toBe("number");
  });
});

// ============================================================================
// Integration: Full limited deck workflow
// ============================================================================

describe("Limited deck building workflow", () => {
  it("should support complete deck building workflow", () => {
    // Create pool
    const pool: PoolCard[] = [
      createMockPoolCard("card-1", "Giant Growth"),
      createMockPoolCard("card-2", "Forest"),
      createMockPoolCard("card-3", "Lightning Bolt"),
      createMockPoolCard("card-4", "Mountain"),
      createMockPoolCard("card-5", "Serra Angel"),
    ];

    // Verify all cards in pool
    expect(isPoolCard("card-1", pool)).toBe(true);
    expect(isPoolCard("card-5", pool)).toBe(true);

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
