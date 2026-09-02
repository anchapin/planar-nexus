/**
 * Tests for pool storage and session management
 *
 * Covers: SEAL-03, SEAL-04, SEAL-05, ISOL-01, ISOL-02, ISOL-03, LBld-06
 * (issue #1560 — real coverage replacing scaffolding)
 *
 * SEAL-03: Browse/filter sealed pool by color, type, CMC
 * SEAL-04: Sealed pool persists across page refresh
 * SEAL-05: Sealed pool can be saved and resumed
 * ISOL-01: Pool cards don't appear in collection (separate storage)
 * ISOL-02: Pool scoped to specific session
 * ISOL-03: Pool has session ID, cannot be merged
 * LBld-06: Save/load limited deck for session
 *
 * IndexedDB persistence runs against `fake-indexeddb` (wired globally in
 * jest.setup.js); pure filter tests run against in-memory fixtures.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { MinimalCard } from "@/lib/card-database";
import type {
  PoolCard,
  LimitedDeckCard,
  PoolFilters,
  DraftSession,
  RochesterSession,
  WinstonSession,
} from "../types";
import {
  createSession,
  getSession,
  getAllSessions,
  getSessionsByMode,
  deleteSession,
  deleteAllSessions,
  updatePool,
  addToPool,
  removeFromPool,
  updateDeck,
  addToDeck,
  removeFromDeck,
  saveDeck,
  clearDeck,
  filterPool,
  filterPoolByColor,
  filterPoolByType,
  filterPoolByCMC,
  updateSessionStatus,
  completeSession,
  abandonSession,
  getPoolRemaining,
  countPoolByRarity,
  countPoolByColor,
  saveDraftSession,
  getDraftSession,
  updateDraftSession,
  getAllDraftSessions,
  getDraftSessionsByStatus,
  getDraftSessionsByState,
  saveRochesterSession,
  getRochesterSession,
  getAllRochesterSessions,
  saveWinstonSession,
  getWinstonSession,
  getAllWinstonSessions,
  LimitedDatabase,
} from "../pool-storage";

// Mock crypto.randomUUID for environments where it is unavailable
// (same guard as draft-storage.test.ts).
if (typeof globalThis.crypto?.randomUUID !== "function") {
  let uuidCounter = 0;
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;
}

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

// Mock pool cards
const createMockPoolCard = (overrides: Partial<PoolCard> = {}): PoolCard => ({
  ...createMockCard(overrides),
  packId: 0,
  packSlot: 0,
  addedAt: new Date().toISOString(),
  ...overrides,
});

// Mock limited deck card
const createMockDeckCard = (
  overrides: Partial<LimitedDeckCard> & { card: PoolCard },
): LimitedDeckCard => ({
  count: 1,
  addedAt: new Date().toISOString(),
  ...overrides,
});

// Sample pool with various cards for filtering tests
const samplePool: PoolCard[] = [
  createMockPoolCard({
    id: "blue-creature-1",
    name: "Blue Creature 1",
    colors: ["U"],
    type_line: "Creature — Merfolk",
    cmc: 2,
  }),
  createMockPoolCard({
    id: "blue-creature-2",
    name: "Blue Creature 2",
    colors: ["U"],
    type_line: "Creature — Wizard",
    cmc: 3,
  }),
  createMockPoolCard({
    id: "blue-instant-1",
    name: "Blue Instant 1",
    colors: ["U"],
    type_line: "Instant",
    cmc: 1,
  }),
  createMockPoolCard({
    id: "red-creature-1",
    name: "Red Creature 1",
    colors: ["R"],
    type_line: "Creature — Goblin",
    cmc: 2,
  }),
  createMockPoolCard({
    id: "red-sorcery-1",
    name: "Red Sorcery 1",
    colors: ["R"],
    type_line: "Sorcery",
    cmc: 3,
  }),
  createMockPoolCard({
    id: "green-creature-1",
    name: "Green Creature 1",
    colors: ["G"],
    type_line: "Creature — Elf",
    cmc: 1,
  }),
  createMockPoolCard({
    id: "green-creature-2",
    name: "Green Creature 2",
    colors: ["G"],
    type_line: "Creature — Beast",
    cmc: 4,
  }),
  createMockPoolCard({
    id: "colorless-artifact-1",
    name: "Colorless Artifact 1",
    colors: [],
    type_line: "Artifact",
    cmc: 2,
  }),
  createMockPoolCard({
    id: "multi-color-1",
    name: "Jeskai Card",
    colors: ["W", "U", "R"],
    type_line: "Creature — Human",
    cmc: 3,
  }),
];

/** A 45-card pool (Rochester 3-seat size) for round-trip tests. */
const bigPool: PoolCard[] = Array.from({ length: 45 }, (_, i) =>
  createMockPoolCard({
    id: `pool-card-${i}`,
    name: `Pool Card ${i}`,
    cmc: i % 7,
    colors: [["W"], ["U"], ["B"], ["R"], ["G"], []][i % 6],
    packId: Math.floor(i / 15),
    packSlot: i % 15,
  }),
);

/** Session-creation helper. */
const createSealedSession = (name?: string) =>
  createSession({
    setCode: "M21",
    setName: "Core Set 2021",
    mode: "sealed",
    name,
  });

/** Deterministic draft-session fixture. */
const makeDraftSession = (id: string): DraftSession => ({
  id,
  setCode: "M21",
  setName: "Core Set 2021",
  mode: "draft",
  status: "in_progress",
  pool: bigPool,
  deck: [],
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  draftState: "picking",
  currentPackIndex: 1,
  currentPickIndex: 7,
  packs: [
    {
      id: `${id}-pack-0`,
      cards: bigPool.slice(0, 14),
      isOpened: true,
      pickedCardIds: [],
    },
  ],
  timerSeconds: 30,
  lastHoveredCardId: null,
  currentPackHolder: "user",
});

/** Deterministic Rochester-session fixture (issue #1444). */
const makeRochesterSession = (id: string): RochesterSession => ({
  id,
  setCode: "M21",
  setName: "Core Set 2021",
  mode: "rochester",
  status: "in_progress",
  pool: [],
  deck: [],
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  rochesterState: "picking",
  playerCount: 3,
  communalPool: bigPool.slice(0, 9),
  picksBySeat: { 0: bigPool.slice(0, 2), 1: [], 2: [] },
  currentSeatIndex: 1,
  picksTaken: 2,
});

/** Deterministic Winston-session fixture (issue #1444). */
const makeWinstonSession = (id: string): WinstonSession => ({
  id,
  setCode: "M21",
  setName: "Core Set 2021",
  mode: "winston",
  status: "in_progress",
  pool: [],
  deck: [],
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  winstonState: "deciding",
  pileSizes: [6, 4, 3],
  piles: [],
  currentSeatIndex: 0,
  picksBySeat: { 0: [], 1: [], 2: [] },
});

/** Wipes the sessions store before each test in a storage describe. */
const useCleanSessionsStore = () => {
  beforeEach(async () => {
    await deleteAllSessions();
  });
};

/** Small real-time delay so ISO `updatedAt` stamps are strictly ordered. */
const tick = (ms = 8) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Extract session ids from a session array (helper for readability). */
const sessionIds = <T extends { id: string }>(sessions: T[]): string[] =>
  sessions.map((s) => s.id);

const ids = (cards: PoolCard[]) => cards.map((c) => c.id);

describe("SEAL-03: Pool Filtering (Color, Type, CMC)", () => {
  it("should filter pool by color (exact match)", () => {
    // Exact ['U'] = mono-blue only: excludes colorless and the Jeskai card.
    expect(ids(filterPoolByColor(samplePool, "exact", ["U"]))).toEqual([
      "blue-creature-1",
      "blue-creature-2",
      "blue-instant-1",
    ]);
  });

  it("should filter pool by color (include match)", () => {
    // Include ['U', 'R'] = must contain both → only the Jeskai card.
    expect(ids(filterPoolByColor(samplePool, "include", ["U", "R"]))).toEqual([
      "multi-color-1",
    ]);
  });

  it("should filter pool by color (exclude match)", () => {
    // Exclude ['U'] = no blue at all: mono-red, mono-green, colorless remain.
    expect(ids(filterPoolByColor(samplePool, "exclude", ["U"]))).toEqual([
      "red-creature-1",
      "red-sorcery-1",
      "green-creature-1",
      "green-creature-2",
      "colorless-artifact-1",
    ]);
  });

  it("should filter pool by type (creature)", () => {
    expect(ids(filterPoolByType(samplePool, ["Creature"]))).toEqual([
      "blue-creature-1",
      "blue-creature-2",
      "red-creature-1",
      "green-creature-1",
      "green-creature-2",
      "multi-color-1",
    ]);
  });

  it("should filter pool by type (instant/sorcery use OR logic)", () => {
    expect(ids(filterPoolByType(samplePool, ["Instant", "Sorcery"]))).toEqual([
      "blue-instant-1",
      "red-sorcery-1",
    ]);
  });

  it("should filter pool by CMC (exact value)", () => {
    expect(ids(filterPoolByCMC(samplePool, "exact", 2))).toEqual([
      "blue-creature-1",
      "red-creature-1",
      "colorless-artifact-1",
    ]);
  });

  it("should filter pool by CMC (range, inclusive)", () => {
    expect(ids(filterPoolByCMC(samplePool, "range", undefined, 2, 3))).toEqual([
      "blue-creature-1",
      "blue-creature-2",
      "red-creature-1",
      "red-sorcery-1",
      "colorless-artifact-1",
      "multi-color-1",
    ]);
  });

  it("should combine multiple filters (AND logic)", () => {
    // Mono-blue AND an instant → exactly one card.
    const result = filterPool(samplePool, {
      color: { mode: "exact", colors: ["U"] },
      type: { types: ["Instant"] },
    });

    expect(ids(result)).toEqual(["blue-instant-1"]);
  });

  it("should handle empty filter results", () => {
    // No mono-white card exists in the sample pool.
    expect(filterPoolByColor(samplePool, "exact", ["W"])).toEqual([]);
  });

  it("should return the pool unchanged when no filters are given", () => {
    expect(filterPool(samplePool, {})).toBe(samplePool);
    expect(filterPool(samplePool, undefined as unknown as PoolFilters)).toBe(
      samplePool,
    );
  });

  it("should filter by search query against name and type line", () => {
    // 'goblin' appears only in a type line; 'blue' only in names.
    expect(ids(filterPool(samplePool, { searchQuery: "goblin" }))).toEqual([
      "red-creature-1",
    ]);
    expect(ids(filterPool(samplePool, { searchQuery: "blue" }))).toEqual([
      "blue-creature-1",
      "blue-creature-2",
      "blue-instant-1",
    ]);
  });

  it("should combine search query with structured filters (AND logic)", () => {
    const result = filterPool(samplePool, {
      searchQuery: "blue",
      cmc: { mode: "exact", value: 1 },
    });

    expect(ids(result)).toEqual(["blue-instant-1"]);
  });
});

describe("SEAL-04: Pool Persistence", () => {
  useCleanSessionsStore();

  it("should persist the session to IndexedDB on creation", async () => {
    const session = await createSealedSession("My Sealed Pool");

    const reloaded = await getSession(session.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(session.id);
    expect(reloaded!.setCode).toBe("M21");
    expect(reloaded!.mode).toBe("sealed");
    expect(reloaded!.status).toBe("in_progress");
    expect(reloaded!.name).toBe("My Sealed Pool");
  });

  it("should persist pool changes immediately with a fresh updatedAt", async () => {
    const session = await createSealedSession();
    await tick();

    await updatePool(session.id, samplePool);

    const reloaded = await getSession(session.id);
    expect(reloaded!.pool).toHaveLength(samplePool.length);
    expect(reloaded!.pool[0].id).toBe("blue-creature-1");
    expect(new Date(reloaded!.updatedAt).getTime()).toBeGreaterThan(
      new Date(session.updatedAt).getTime(),
    );
  });

  it("should restore the pool from IndexedDB on reload (page-refresh simulation)", async () => {
    const session = await createSealedSession();
    await updatePool(session.id, bigPool);

    // Fresh read simulates a page refresh — no in-memory state involved.
    const reloaded = await getSession(session.id);

    expect(JSON.stringify(reloaded!.pool)).toBe(JSON.stringify(bigPool));
  });

  it("should add and remove individual pool cards", async () => {
    const session = await createSealedSession();
    const card = createMockPoolCard({ id: "picked-up-later" });

    await addToPool(session.id, card);
    expect((await getSession(session.id))!.pool).toHaveLength(1);

    await removeFromPool(session.id, "picked-up-later");
    expect((await getSession(session.id))!.pool).toHaveLength(0);
  });

  it("should reject pool updates for a missing session with a descriptive error", async () => {
    await expect(updatePool("no-such-session", [])).rejects.toThrow(
      "Session not found: no-such-session",
    );
    await expect(addToPool("no-such-session", samplePool[0])).rejects.toThrow(
      "Session not found: no-such-session",
    );
    await expect(removeFromPool("no-such-session", "x")).rejects.toThrow(
      "Session not found: no-such-session",
    );
  });
});

describe("SEAL-05: Save/Resume Session", () => {
  useCleanSessionsStore();

  it("should save a session with all pool data and resume it by id", async () => {
    const session = await createSealedSession();
    await updatePool(session.id, bigPool);

    const resumed = await getSession(session.id);

    expect(resumed!.pool).toHaveLength(45);
    expect(ids(resumed!.pool)).toEqual(ids(bigPool));
  });

  it("should save a session with deck data", async () => {
    const session = await createSealedSession();
    const deck = [
      createMockDeckCard({ card: bigPool[0], count: 2 }),
      createMockDeckCard({ card: bigPool[1], count: 1 }),
    ];

    await updateDeck(session.id, deck);

    const reloaded = await getSession(session.id);
    expect(reloaded!.deck).toEqual(deck);
  });

  it("should list all saved sessions most-recent-first", async () => {
    const a = await createSealedSession("A");
    await tick();
    const b = await createSealedSession("B");
    await tick();
    // Touch A last so its updatedAt is newest despite being created first.
    await updatePool(a.id, samplePool);

    const all = await getAllSessions();

    expect(all.map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it("should delete a session", async () => {
    const session = await createSealedSession();

    await deleteSession(session.id);

    expect(await getSession(session.id)).toBeNull();
  });

  it("should update session metadata (status transitions persist)", async () => {
    const session = await createSealedSession();

    await updateSessionStatus(session.id, "abandoned");

    expect((await getSession(session.id))!.status).toBe("abandoned");
  });

  it("should mark a session completed and persist the flip", async () => {
    const session = await createSealedSession();
    expect((await getSession(session.id))!.status).toBe("in_progress");

    await completeSession(session.id);

    expect((await getSession(session.id))!.status).toBe("completed");
  });

  it("should mark a session abandoned", async () => {
    const session = await createSealedSession();

    await abandonSession(session.id);

    expect((await getSession(session.id))!.status).toBe("abandoned");
  });
});

describe("ISOL-01: Pool Isolation from Collection", () => {
  useCleanSessionsStore();

  it("should store pools in the dedicated PlanarNexusLimited DB (sessions table only, no decks store)", () => {
    const db = new LimitedDatabase();

    expect(db.name).toBe("PlanarNexusLimited");
    // The sessions table is the ONLY store: deck-builder queries against this
    // DB cannot surface pool cards because no decks/collection store exists.
    expect(db.tables.map((t) => t.name)).toEqual(["sessions"]);
  });

  it("should keep pool cards scoped to their session record", async () => {
    const session = await createSealedSession();
    await updatePool(session.id, samplePool);

    const all = await getAllSessions();

    // Pool data lives on the session row itself — there is no separate
    // card-collection row any deck query could pick up.
    expect(all).toHaveLength(1);
    expect(all[0].pool).toHaveLength(samplePool.length);
  });

  it("should clear all pool data when the session is deleted", async () => {
    const session = await createSealedSession();
    await updatePool(session.id, bigPool);

    await deleteSession(session.id);

    expect(await getSession(session.id)).toBeNull();
    expect(await getAllSessions()).toEqual([]);
  });
});

describe("ISOL-02: Session-Scoped Pool", () => {
  useCleanSessionsStore();

  it("should scope the pool to its session id", async () => {
    const a = await createSealedSession("A");
    const b = await createSealedSession("B");

    await updatePool(a.id, samplePool);

    expect((await getSession(a.id))!.pool).toHaveLength(9);
    expect((await getSession(b.id))!.pool).toHaveLength(0);
  });

  it("should only return pool cards for the requested session", async () => {
    const a = await createSealedSession("A");
    const b = await createSealedSession("B");
    await updatePool(a.id, samplePool);
    await updatePool(b.id, bigPool);

    expect(ids((await getSession(a.id))!.pool)).toEqual(ids(samplePool));
    expect(ids((await getSession(b.id))!.pool)).toEqual(ids(bigPool));
  });

  it("should not leak pool cards between sessions with overlapping card ids", async () => {
    const a = await createSealedSession("A");
    const b = await createSealedSession("B");

    // Both pools contain a card with the same id — a per-session copy.
    await updatePool(a.id, [
      createMockPoolCard({ id: "shared-card-1", name: "A copy" }),
      createMockPoolCard({ id: "shared-card-2", name: "A only" }),
    ]);
    await updatePool(b.id, [
      createMockPoolCard({ id: "shared-card-1", name: "B copy" }),
    ]);

    const reloadedA = await getSession(a.id);
    const reloadedB = await getSession(b.id);

    expect(ids(reloadedA!.pool)).toEqual(["shared-card-1", "shared-card-2"]);
    expect(reloadedA!.pool[0].name).toBe("A copy");
    expect(ids(reloadedB!.pool)).toEqual(["shared-card-1"]);
    expect(reloadedB!.pool[0].name).toBe("B copy");
  });
});

describe("ISOL-03: Unique Session ID", () => {
  useCleanSessionsStore();

  it("should generate a distinct UUID for each session", async () => {
    const a = await createSealedSession();
    const b = await createSealedSession();

    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(b.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("should use crypto.randomUUID() for id generation", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      "randomUUID",
    );

    try {
      // Shadow the native/borrowed implementation with a counting stub.
      let calls = 0;
      (globalThis.crypto as { randomUUID: () => string }).randomUUID = () => {
        calls++;
        return `00000000-0000-4000-8000-${String(calls).padStart(12, "0")}`;
      };

      const session = await createSealedSession();

      expect(calls).toBe(1);
      expect(session.id).toBe(
        `00000000-0000-4000-8000-${String(1).padStart(12, "0")}`,
      );
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
      } else {
        delete (globalThis.crypto as { randomUUID?: () => string }).randomUUID;
      }
    }
  });

  it("should reject a duplicate UUID instead of silently merging sessions", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      "randomUUID",
    );

    try {
      (globalThis.crypto as { randomUUID: () => string }).randomUUID = () =>
        "collision-00000000-0000-4000-8000-000000000001";

      await createSealedSession("first");
      // There is no retry loop: the IndexedDB primary-key constraint is the
      // guard, so a colliding insert fails loudly rather than overwriting.
      await expect(createSealedSession("second")).rejects.toThrow();
      expect(await getAllSessions()).toHaveLength(1);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
      } else {
        delete (globalThis.crypto as { randomUUID?: () => string }).randomUUID;
      }
    }
  });
});

describe("LBld-06: Save/Load Limited Deck", () => {
  useCleanSessionsStore();

  it("should save and load the deck within session scope", async () => {
    const session = await createSealedSession();
    const deck = [createMockDeckCard({ card: bigPool[3], count: 4 })];

    await saveDeck(session.id, deck);

    expect((await getSession(session.id))!.deck).toEqual(deck);
  });

  it("should not expose one session deck to another session", async () => {
    const a = await createSealedSession("A");
    const b = await createSealedSession("B");
    await saveDeck(a.id, [createMockDeckCard({ card: bigPool[0], count: 1 })]);

    expect((await getSession(a.id))!.deck).toHaveLength(1);
    expect((await getSession(b.id))!.deck).toHaveLength(0);
  });

  it("should add a new deck entry, then increment its count on re-add", async () => {
    const session = await createSealedSession();
    const card = bigPool[5];

    await addToDeck(session.id, createMockDeckCard({ card, count: 1 }));
    await addToDeck(session.id, createMockDeckCard({ card, count: 2 }));

    const deck = (await getSession(session.id))!.deck;
    expect(deck).toHaveLength(1);
    expect(deck[0].count).toBe(3);
  });

  it("should update the deck in session via updateDeck", async () => {
    const session = await createSealedSession();
    await addToDeck(session.id, createMockDeckCard({ card: bigPool[0] }));
    const replacement = [createMockDeckCard({ card: bigPool[1], count: 2 })];

    await updateDeck(session.id, replacement);

    expect((await getSession(session.id))!.deck).toEqual(replacement);
  });

  it("should decrement on remove and drop entries that reach zero count", async () => {
    const session = await createSealedSession();
    await addToDeck(
      session.id,
      createMockDeckCard({ card: bigPool[2], count: 2 }),
    );

    await removeFromDeck(session.id, bigPool[2].id); // default count 1 → 1 left
    let deck = (await getSession(session.id))!.deck;
    expect(deck).toHaveLength(1);
    expect(deck[0].count).toBe(1);

    await removeFromDeck(session.id, bigPool[2].id, 1); // → 0, entry dropped
    deck = (await getSession(session.id))!.deck;
    expect(deck).toEqual([]);
  });

  it("should clear the deck from the session", async () => {
    const session = await createSealedSession();
    await addToDeck(session.id, createMockDeckCard({ card: bigPool[7] }));

    await clearDeck(session.id);

    expect((await getSession(session.id))!.deck).toEqual([]);
  });

  it("should reject deck writes for a missing session with a descriptive error", async () => {
    await expect(updateDeck("no-such-session", [])).rejects.toThrow(
      "Session not found: no-such-session",
    );
  });

  it("should compute the remaining pool (pool minus decked cards)", () => {
    const session = {
      id: "session-x",
      setCode: "M21",
      setName: "Core Set 2021",
      mode: "sealed" as const,
      status: "in_progress" as const,
      pool: samplePool,
      deck: [
        createMockDeckCard({ card: samplePool[0], count: 2 }),
        createMockDeckCard({ card: samplePool[3], count: 1 }),
      ],
      createdAt: "2026-09-02T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    const remaining = getPoolRemaining(session);

    expect(ids(remaining)).not.toContain("blue-creature-1");
    expect(ids(remaining)).not.toContain("red-creature-1");
    expect(remaining).toHaveLength(samplePool.length - 2);
  });
});

describe("Pool statistics helpers", () => {
  it("should count the pool by color, including colorless and multicolor spreads", () => {
    // samplePool: 3 mono-U + 1 U in Jeskai; 1 R + 1 R in Jeskai; 2 G;
    // 1 colorless; 1 W in Jeskai.
    expect(countPoolByColor(samplePool)).toEqual({
      U: 4,
      R: 3,
      G: 2,
      W: 1,
      colorless: 1,
    });
  });

  it("should count the pool by rarity, bucketing unknown rarities", () => {
    const pool = [
      createMockPoolCard({ id: "c1", rarity: "common" }),
      createMockPoolCard({ id: "c2", rarity: "common" }),
      createMockPoolCard({ id: "r1", rarity: "rare" }),
      createMockPoolCard({ id: "u1", rarity: undefined }),
    ];

    expect(countPoolByRarity(pool)).toEqual({
      common: 2,
      rare: 1,
      unknown: 1,
    });
  });
});

describe("DRFT-10/DRFT-11: Draft session storage", () => {
  useCleanSessionsStore();

  it("should round-trip a 45-card draft pool byte-for-byte", async () => {
    const draft = makeDraftSession("draft-45");

    await saveDraftSession(draft);

    const restored = await getDraftSession("draft-45");
    expect(restored).not.toBeNull();
    expect(JSON.stringify(restored!.pool)).toBe(JSON.stringify(bigPool));
    expect(restored!.pool).toHaveLength(45);
    expect(restored!.draftState).toBe("picking");
    expect(restored!.currentPackIndex).toBe(1);
    expect(restored!.currentPickIndex).toBe(7);
    expect(restored!.packs[0].cards).toHaveLength(14);
  });

  it("should return null for a missing draft session", async () => {
    expect(await getDraftSession("never-saved")).toBeNull();
  });

  it("should return null when the stored session is not a draft", async () => {
    const sealed = await createSealedSession();

    expect(await getDraftSession(sealed.id)).toBeNull();
  });

  it("should not insert a row when updating an unsaved draft session", async () => {
    await updateDraftSession(makeDraftSession("ghost-draft"));

    expect(await getDraftSession("ghost-draft")).toBeNull();
  });

  it("should update an existing draft session in place", async () => {
    const draft = makeDraftSession("draft-update");
    draft.draftState = "intro";
    await saveDraftSession(draft);

    await updateDraftSession({ ...draft, draftState: "picking" });

    expect((await getDraftSession("draft-update"))!.draftState).toBe("picking");
  });

  it("should list all draft sessions (mode index query)", async () => {
    await saveDraftSession(makeDraftSession("draft-a"));
    await saveDraftSession(makeDraftSession("draft-b"));
    await createSealedSession(); // must not appear

    const drafts = await getAllDraftSessions();

    expect(sessionIds(drafts).sort()).toEqual(["draft-a", "draft-b"]);
    expect(drafts.every((d) => d.mode === "draft")).toBe(true);
  });

  it("should filter draft sessions by status", async () => {
    const active = makeDraftSession("draft-active");
    const done = {
      ...makeDraftSession("draft-done"),
      status: "completed" as const,
    };
    await saveDraftSession(active);
    await saveDraftSession(done);

    const inProgress = await getDraftSessionsByStatus("in_progress");
    const completed = await getDraftSessionsByStatus("completed");

    expect(sessionIds(inProgress)).toEqual(["draft-active"]);
    expect(sessionIds(completed)).toEqual(["draft-done"]);
  });

  it("should filter draft sessions by draft state", async () => {
    const intro = makeDraftSession("draft-intro");
    intro.draftState = "intro";
    await saveDraftSession(intro);
    await saveDraftSession(makeDraftSession("draft-picking-2"));

    const pickingSessions = await getDraftSessionsByState("picking");
    const introSessions = await getDraftSessionsByState("intro");

    expect(sessionIds(pickingSessions)).toEqual(["draft-picking-2"]);
    expect(sessionIds(introSessions)).toEqual(["draft-intro"]);
  });

  it("should list sessions by mode (rochester/winston/draft partitions)", async () => {
    await saveDraftSession(makeDraftSession("draft-mode"));
    await saveRochesterSession(makeRochesterSession("roch-mode"));
    await saveWinstonSession(makeWinstonSession("winston-mode"));

    expect(sessionIds(await getSessionsByMode("draft"))).toEqual([
      "draft-mode",
    ]);
    expect(sessionIds(await getSessionsByMode("rochester"))).toEqual([
      "roch-mode",
    ]);
    expect(sessionIds(await getSessionsByMode("winston"))).toEqual([
      "winston-mode",
    ]);
  });
});

describe("Rochester / Winston session storage (issue #1444)", () => {
  useCleanSessionsStore();

  it("should round-trip a Rochester session", async () => {
    const roch = makeRochesterSession("roch-1");

    await saveRochesterSession(roch);

    const restored = await getRochesterSession("roch-1");
    expect(restored).not.toBeNull();
    expect(restored!.mode).toBe("rochester");
    expect(restored!.rochesterState).toBe("picking");
    expect(restored!.playerCount).toBe(3);
    expect(restored!.communalPool).toHaveLength(9);
    expect(restored!.picksBySeat[0]).toHaveLength(2);
    expect(restored!.currentSeatIndex).toBe(1);
  });

  it("should return null from getRochesterSession for non-rochester rows", async () => {
    await saveDraftSession(makeDraftSession("not-roch"));

    expect(await getRochesterSession("not-roch")).toBeNull();
    expect(await getRochesterSession("missing")).toBeNull();
  });

  it("should list all Rochester sessions", async () => {
    await saveRochesterSession(makeRochesterSession("roch-a"));
    await saveRochesterSession(makeRochesterSession("roch-b"));
    await saveDraftSession(makeDraftSession("draft-x"));

    expect((await getAllRochesterSessions()).map((s) => s.id).sort()).toEqual([
      "roch-a",
      "roch-b",
    ]);
  });

  it("should round-trip a Winston session", async () => {
    const winston = makeWinstonSession("winston-1");

    await saveWinstonSession(winston);

    const restored = await getWinstonSession("winston-1");
    expect(restored).not.toBeNull();
    expect(restored!.mode).toBe("winston");
    expect(restored!.winstonState).toBe("deciding");
    expect(restored!.pileSizes).toEqual([6, 4, 3]);
  });

  it("should return null from getWinstonSession for non-winston rows", async () => {
    await saveRochesterSession(makeRochesterSession("not-winston"));

    expect(await getWinstonSession("not-winston")).toBeNull();
    expect(await getWinstonSession("missing")).toBeNull();
  });

  it("should list all Winston sessions", async () => {
    await saveWinstonSession(makeWinstonSession("winston-a"));
    await saveDraftSession(makeDraftSession("draft-y"));

    expect((await getAllWinstonSessions()).map((s) => s.id)).toEqual([
      "winston-a",
    ]);
  });
});
