/**
 * Seed draft-session e2e helper — issue #1859.
 *
 * Mirrors the `loadDeck` / `seedLimitedSession` pattern: an init script
 * is registered on the page so it runs before every navigation, then we
 * hand-roll the IndexedDB open + onupgradeneeded + onsuccess + onerror
 * path to populate the production `PlanarNexusLimited` Dexie database
 * with a known draft session.
 *
 * Production schema (see `src/lib/limited/pool-storage.ts`):
 *   - DB:    "PlanarNexusLimited"  v1
 *   - store: "sessions"  keyPath: "id"
 *
 * The DraftSession row mirrors the production `DraftSession` interface
 * in `src/lib/limited/types.ts`: id, setCode, setName, mode ("draft"),
 * status, pool, deck, createdAt, updatedAt, draftState ("intro" |
 * "picking" | "pack_complete" | "draft_complete"), currentPackIndex,
 * currentPickIndex, packs (DraftPack[]), timerSeconds,
 * lastHoveredCardId, currentPackHolder ("user" | "ai").
 *
 * Why the fixture matters (issue #1859):
 * DRFT-03 / DRFT-04 / DRFT-10 / DRFT-11 all rely on a draft session
 * with real packs. `loadDeck` seeds the `decks` store, not the draft
 * store, and `seedCardDatabase` puts 10 fixture cards into the card DB
 * — neither is enough to drive a 3 × 14 draft (42 cards minimum). The
 * production draft generator runs only against a full Scryfall-backed
 * card DB. Without a seeded draft session the tests degenerate to
 * "page body has > 50 chars" (the vacuous-assertion pattern #1786 was
 * meant to eliminate).
 *
 * Usage:
 *   import { seedDraftSession, DRAFT_SESSION_ID } from "./utils/seed-draft-session";
 *   test.beforeEach(async ({ page }) => {
 *     await seedDraftSession(page);                // default: intro state
 *     // or:
 *     await seedDraftSession(page, "picking", { pickedCount: 3 });
 *   });
 *
 * The seeded session id (`DRAFT_SESSION_ID`) is the same value the
 * helper writes, so callers can build URLs by importing the constant.
 */
import { test as base, expect, Page } from "@playwright/test";

/**
 * Stable session UUID the fixture writes. Production UUIDs come from
 * `crypto.randomUUID()`; the test fixture picks a fixed value so URLs
 * are deterministic across runs.
 */
export const DRAFT_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const LIMITED_DB_NAME = "PlanarNexusLimited";
// Dexie multiplies the version number by 10 internally — so a
// production `this.version(1)` actually opens IDB version 10
// (see node_modules/dexie/dist/dexie.js around line 5959:
// "blocked by other connection holding version ".concat(
//   ev.oldVersion / 10)). If we open the DB at IDB version 1
// (the natural number), Dexie's open(10) sees a version mismatch
// and races with our open, causing "blocked by other connection".
// Use the same Dexie-scaled version number here.
const LIMITED_DB_VERSION = 10;
const SESSIONS_STORE = "sessions";

const CARDS_PER_PACK = 14;
const PACKS_PER_DRAFT = 3;

/**
 * Synthetic 42-card draft pool used by the fixture. Drawn from the
 * same 10 production test-cards as the sealed fixture, distributed
 * across 3 packs of 14 cards each. Card names are deterministic so
 * the tests can assert on specific card names guaranteed to be in
 * the first pack.
 *
 * Coverage targets:
 *   - 42 cards total (3 × 14), exercises the draft-complete flow
 *   - colors span W, U, B, R, G + colorless
 *   - one copy per card type per pack (creature/instant/sorcery/...)
 */
function buildDraftPool() {
  const baseCards = [
    {
      id: "lightning-bolt-id",
      name: "Lightning Bolt",
      cmc: 1,
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      rarity: "common",
    },
    {
      id: "mountain-id",
      name: "Mountain",
      cmc: 0,
      type_line: "Basic Land — Mountain",
      colors: [],
      color_identity: ["R"],
      rarity: "common",
    },
    {
      id: "island-id",
      name: "Island",
      cmc: 0,
      type_line: "Basic Land — Island",
      colors: [],
      color_identity: ["U"],
      rarity: "common",
    },
    {
      id: "sol-ring-id",
      name: "Sol Ring",
      cmc: 1,
      type_line: "Artifact",
      colors: [],
      color_identity: [],
      rarity: "uncommon",
    },
    {
      id: "arcane-signet-id",
      name: "Arcane Signet",
      cmc: 2,
      type_line: "Artifact",
      colors: [],
      color_identity: [],
      rarity: "common",
    },
    {
      id: "command-tower-id",
      name: "Command Tower",
      cmc: 0,
      type_line: "Land",
      colors: [],
      color_identity: [],
      rarity: "uncommon",
    },
    {
      id: "counterspell-id",
      name: "Counterspell",
      cmc: 2,
      type_line: "Instant",
      colors: ["U"],
      color_identity: ["U"],
      rarity: "common",
    },
    {
      id: "lightning-greaves-id",
      name: "Lightning Greaves",
      cmc: 2,
      type_line: "Artifact — Equipment",
      colors: [],
      color_identity: [],
      rarity: "uncommon",
    },
    {
      id: "cultivate-id",
      name: "Cultivate",
      cmc: 3,
      type_line: "Sorcery",
      colors: ["G"],
      color_identity: ["G"],
      rarity: "common",
    },
    {
      id: "terror-id",
      name: "Terror",
      cmc: 2,
      type_line: "Instant",
      colors: ["B"],
      color_identity: ["B"],
      rarity: "common",
    },
  ] as const;

  // Synthetic image URLs so the draft-pick picker renders <img> elements
  // (vs the text-only fallback when image_uris is undefined). The
  // pixels don't matter — tests assert on the `alt` attribute via the
  // aria-label prefix `Pick ${card.name}`.
  const imageUriFor = (cardId: string) => ({
    small: `https://cards.example.test/${cardId}-small.jpg`,
    normal: `https://cards.example.test/${cardId}-normal.jpg`,
    large: `https://cards.example.test/${cardId}-large.jpg`,
    png: `https://cards.example.test/${cardId}.png`,
    art_crop: `https://cards.example.test/${cardId}-art.jpg`,
    border_crop: `https://cards.example.test/${cardId}-border.jpg`,
  });

  const cardsById = new Map(baseCards.map((c) => [c.id, c]));
  const now = "2026-09-17T00:00:00.000Z";

  // 14 cards per pack, with repetition so each pack has 14 distinct
  // physical slots even though many of them are repeats of the same
  // 10-card pool (mirrors a real draft pool of mostly-bulk cards).
  //
  // Each card instance gets a unique id by appending the pack + slot
  // index (e.g. `lightning-bolt-id-p0-s0`). The production pickCard
  // logic uses `pack.pickedCardIds.includes(card.id)` to disable
  // picked cards — without per-instance unique ids, two slots with
  // the same card name (Lightning Bolt ×2 in a pack) would both
  // become disabled after picking just one, which is not how real
  // draft pools behave.
  const distribution: Array<[string, number]> = [
    ["lightning-bolt-id", 2],
    ["mountain-id", 2],
    ["island-id", 2],
    ["sol-ring-id", 1],
    ["arcane-signet-id", 1],
    ["command-tower-id", 1],
    ["counterspell-id", 1],
    ["lightning-greaves-id", 1],
    ["cultivate-id", 1],
    ["terror-id", 2],
  ];
  // total = 14 cards × 3 packs.

  const flatPool: Array<ReturnType<typeof toPoolCard>> = [];
  const packs: Array<{
    id: string;
    cards: Array<ReturnType<typeof toPoolCard> & { pickedAt?: string }>;
    isOpened: boolean;
    pickedCardIds: string[];
  }> = [];

  function toPoolCard(
    cardId: string,
    packId: number,
    packSlot: number,
    instanceId: string,
  ) {
    const card = cardsById.get(cardId);
    if (!card) throw new Error(`seed-draft-session: missing card ${cardId}`);
    return {
      ...card,
      // Unique instance id (Scryfall ids are unique per printing; the
      // fixture's repetitions need disambiguation so the picker's
      // `pickedCardIds.includes(card.id)` matches just the one slot).
      id: instanceId,
      oracle_id: card.id,
      image_uris: imageUriFor(cardId),
      legalities: { commander: "legal", standard: "legal" },
      packId,
      packSlot,
      addedAt: now,
      isFoil: false,
    };
  }

  let packIndex = 0;
  for (packIndex = 0; packIndex < PACKS_PER_DRAFT; packIndex++) {
    const packCards: Array<
      ReturnType<typeof toPoolCard> & { pickedAt?: string }
    > = [];
    let slot = 0;
    for (const [cardId, count] of distribution) {
      for (let i = 0; i < count; i++) {
        const instanceId = `${cardId}-p${packIndex}-s${slot}`;
        const poolCard = toPoolCard(cardId, packIndex, slot, instanceId);
        flatPool.push(poolCard);
        packCards.push({
          ...poolCard,
          pickedAt: packIndex < 0 ? now : undefined, // never set on initial seed
        });
        slot++;
      }
    }
    packs.push({
      id: `pack-${packIndex}-${DRAFT_SESSION_ID}`,
      cards: packCards,
      isOpened: false,
      pickedCardIds: [],
    });
  }

  return { flatPool, packs };
}

export type SeedDraftMode = "intro" | "picking" | "complete";

export interface SeedDraftOptions {
  /**
   * How many cards the user has already picked from the first pack.
   * `0` keeps the pool empty and `packs[0].isOpened` false (matches
   * the "intro" mode); `> 0` simulates a resumed mid-pick session
   * with `packs[0].isOpened` true and that many cards already in the
   * pool (matches the "picking" mode).
   *
   * For "picking" mode the helper also marks the first N cards of
   * pack 0 as picked in `packs[0].pickedCardIds` and pushes the same
   * card objects into the `pool`. The DRFT-04 pick-counter test then
   * asserts that the badge reads "Pick {N+1} of 14".
   */
  pickedCount?: number;
}

/**
 * Register an init script that seeds the production `PlanarNexusLimited`
 * IndexedDB database with a known draft session.
 *
 * Must be called BEFORE `page.goto(...)` so the script is attached to
 * the initial navigation. Mirrors `loadDeck(page)` and
 * `seedLimitedSession(page)`.
 */
export async function seedDraftSession(
  page: Page,
  mode: SeedDraftMode = "intro",
  options: SeedDraftOptions = {},
): Promise<void> {
  const { pickedCount = 0 } = options;
  const { flatPool, packs } = buildDraftPool();

  const now = "2026-09-17T00:00:00.000Z";
  let draftState: "intro" | "picking" | "pack_complete" | "draft_complete";
  let currentPickIndex = 0;
  let currentPackIndex = 0;
  const userPool: typeof flatPool = [];

  if (mode === "intro") {
    draftState = "intro";
    currentPackIndex = 0;
    currentPickIndex = 0;
    packs[0].isOpened = false;
  } else if (mode === "complete") {
    // All 42 cards picked — drives the `/draft/complete` page so
    // the success view ("Draft Complete!" h1, build-deck button)
    // renders instead of the redirect back to `/draft`.
    draftState = "draft_complete";
    currentPackIndex = PACKS_PER_DRAFT;
    currentPickIndex = CARDS_PER_PACK;
    for (let packIndex = 0; packIndex < PACKS_PER_DRAFT; packIndex++) {
      const packCards = packs[packIndex].cards;
      for (let i = 0; i < packCards.length; i++) {
        const card = packCards[i];
        packs[packIndex].pickedCardIds.push(card.id);
        userPool.push({ ...card, pickedAt: now });
      }
      packs[packIndex].isOpened = true;
    }
  } else {
    // "picking": user has started pack 0 and may have picked N cards.
    draftState = "picking";
    currentPackIndex = 0;
    packs[0].isOpened = true;
    const take = Math.min(pickedCount, CARDS_PER_PACK);
    for (let i = 0; i < take; i++) {
      const card = packs[0].cards[i];
      packs[0].pickedCardIds.push(card.id);
      userPool.push({ ...card, pickedAt: now });
    }
    currentPickIndex = take;
    if (take >= CARDS_PER_PACK) {
      draftState = "pack_complete";
      currentPickIndex = 0;
      currentPackIndex = 1;
    }
  }

  const session = {
    id: DRAFT_SESSION_ID,
    setCode: "m21",
    setName: "Core Set 2021",
    mode: "draft" as const,
    status: (mode === "complete" ? "completed" : "in_progress") as
      "in_progress" | "completed",
    pool: userPool,
    deck: [],
    createdAt: now,
    updatedAt: now,
    draftState,
    currentPackIndex,
    currentPickIndex,
    packs,
    timerSeconds: 0,
    lastHoveredCardId: null,
    currentPackHolder: "user" as const,
    seed: 42,
    name: "Test Draft Session",
  };

  await page.addInitScript(
    (config) => {
      const { dbName, version, storeName, session } = config;

      const seedDb = indexedDB.open(dbName, version);
      seedDb.addEventListener("upgradeneeded", (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          // Mirrors `pool-storage.ts` LimitedDatabase stores clause.
          store.createIndex("setCode", "setCode", { unique: false });
          store.createIndex("mode", "mode", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      });
      seedDb.addEventListener("success", () => {
        const db = seedDb.result;
        try {
          const tx = db.transaction([storeName], "readwrite");
          const s = tx.objectStore(storeName);
          s.clear();
          s.put(session);
          tx.oncomplete = () => {
            console.log(
              `IndexedDB [limited-sessions] seeded with draft session "${session.id}" (${session.packs.length} packs, state=${session.draftState}, pool=${session.pool.length})`,
            );
            (
              window as unknown as { __draftSessionSeeded?: boolean }
            ).__draftSessionSeeded = true;
          };
        } catch (e) {
          console.error("seed [sessions] error:", e);
        }
        try {
          db.close();
        } catch {
          /* ignore */
        }
      });
      seedDb.addEventListener("error", (event) => {
        console.error(
          "seedDraftSession init: open error",
          (event.target as IDBOpenDBRequest).error,
        );
        (
          window as unknown as { __draftSessionSeedError?: string }
        ).__draftSessionSeedError =
          (event.target as IDBOpenDBRequest).error?.message ?? "unknown";
      });
    },
    {
      dbName: LIMITED_DB_NAME,
      version: LIMITED_DB_VERSION,
      storeName: SESSIONS_STORE,
      session,
    },
  );
}

/**
 * Wait for the `seedDraftSession` init script to finish writing to
 * IndexedDB. Throws if the seed errors so the test fails fast with a
 * real cause rather than a downstream "Session not found" failure.
 */
export async function waitForDraftSessionSeed(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __draftSessionSeeded?: boolean })
        .__draftSessionSeeded === true ||
      (window as unknown as { __draftSessionSeedError?: string })
        .__draftSessionSeedError !== undefined,
    { timeout: 15000 },
  );

  const error = await page.evaluate(
    () =>
      (window as unknown as { __draftSessionSeedError?: string })
        .__draftSessionSeedError,
  );
  if (error) {
    throw new Error(`IndexedDB draft-session seeding failed: ${error}`);
  }

  const sessionCount = await page.evaluate(
    async (config) => {
      return new Promise<number>((resolve, reject) => {
        const req = indexedDB.open(config.dbName, config.version);
        req.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            const tx = db.transaction([config.storeName], "readonly");
            const store = tx.objectStore(config.storeName);
            const countReq = store.count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(new Error("Count failed"));
          } catch (e) {
            reject(e);
          }
        };
        req.onerror = () => reject(new Error("DB open failed"));
      });
    },
    {
      dbName: LIMITED_DB_NAME,
      version: LIMITED_DB_VERSION,
      storeName: SESSIONS_STORE,
    },
  );

  if (sessionCount === 0) {
    throw new Error(
      `IndexedDB seeded but draft session count is ${sessionCount}`,
    );
  }
  console.log(`Draft session seed verified: ${sessionCount} row(s) found`);
}

export const test = base.extend({});

export { expect };
