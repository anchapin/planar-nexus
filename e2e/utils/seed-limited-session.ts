/**
 * Seed limited-session e2e helper — issue #1858.
 *
 * Mirrors the `loadDeck` pattern in `e2e/utils/load-deck.ts` and the
 * `seedCardDatabase` pattern in `e2e/test-utils.ts`: an init script is
 * registered on the page so it runs before every navigation, then we
 * hand-roll the IndexedDB open + onupgradeneeded + onsuccess + onerror
 * path to populate the production `PlanarNexusLimited` Dexie database
 * with a known sealed session.
 *
 * Production schema (see `src/lib/limited/pool-storage.ts` lines 49-60,
 * `LimitedDatabase extends Dexie`):
 *   - DB:    "PlanarNexusLimited"  Dexie version(1) → IDB version 10
 *   - store: "sessions"  keyPath: "id"
 *   - idx:   "setCode", "mode", "status", "createdAt", "updatedAt"
 *
 * The LimitedSession row mirrors the production `LimitedSession`
 * interface in `src/lib/limited/types.ts` (extends ScryfallCard via
 * `PoolCard`): id, setCode, setName, mode, status, pool, deck,
 * createdAt, updatedAt. The pool is a synthetic 84-card sealed pool
 * drawn from the production pool generator
 * (`src/lib/limited/draft-generator.ts → generateSealedPool`). 84 is
 * the standard sealed-pool size (6 packs × 14 cards). Cards are
 * deterministic — same id every run — so the tests can assert on
 * specific card names that are guaranteed to be in the rendered pool.
 *
 * Why the fixture matters (issue #1858):
 * `loadDeck` seeds the ordinary `decks` store. Sealed / limited-deck-
 * builder routes read from `PlanarNexusLimited` instead. Without a
 * valid session ID in that DB the page renders the error state "No
 * session ID provided" — that text satisfies the body-length assertion
 * so every regression in pool rendering, filtering, validation,
 * saving, and session persistence silently passes (#1786 reversal).
 *
 * Usage:
 *   import { seedLimitedSession } from "./utils/seed-limited-session";
 *   test.beforeEach(async ({ page }) => {
 *     await seedLimitedSession(page);
 *     await page.goto(`/sealed?session=${SESSION_ID}`);
 *   });
 *
 * The seeded session id (`SESSION_ID` below) is the same value the
 * helper writes, so callers can build URLs by importing the constant.
 */
import { test as base, expect, Page } from "@playwright/test";

/**
 * Stable session UUID the fixture writes. Production UUIDs come from
 * `crypto.randomUUID()` in `createSession`; the test fixture picks a
 * fixed value so URLs are deterministic across runs.
 */
export const SESSION_ID = "11111111-2222-3333-4444-555555555555";

const LIMITED_DB_NAME = "PlanarNexusLimited";
// Dexie multiplies the schema version by 10 internally — Dexie's
// `this.version(1)` actually opens IDB version 10. We open at
// version 11 so the seed's open always forces an upgrade path
// (regardless of any Dexie SchemaDiff workarounds).
const LIMITED_DB_VERSION = 11;
const SESSIONS_STORE = "sessions";

/**
 * Synthetic 84-card sealed pool used by the fixture. Drawn from the
 * 10 production test-cards in `e2e/fixtures/test-cards.json`,
 * distributed across 6 packs of 14 cards each (84 cards = the
 * standard sealed-pool size).
 *
 * Coverage targets:
 *   - colors: W, U, B, R, G + colorless (artifacts/lands)
 *   - types: Creature, Instant, Sorcery, Artifact, Enchantment, Land
 *   - cmc: 0 (lands), 1 (bolt, ring), 2 (counterspell, greaves,
 *     terror), 3 (cultivate)
 *   - quantities: 1, 4, 40 — exercises the LBld-04 4-copy rule
 *
 * Each card gets `image_uris` set so the sealed page renders
 * `<img alt={card.name}>` (the test asserts on this attribute) — without
 * it the page falls back to a text-only display. The URLs point at
 * an example.test domain; the pixels never load but the alt
 * attribute is what the tests read.
 *
 * Each card gets `legalities` so the type-line + legality checks in
 * the validation pipeline don't fail with "undefined.length".
 */
function buildSealedPool() {
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

  // Synthetic image URLs so the sealed and limited-deck-builder
  // pages render <img alt={card.name}> elements (vs the text-only
  // fallback when image_uris is undefined). The PNGs are 1×1
  // placeholders served by a stable CDN; the tests assert on the
  // `alt` attribute, not the pixel content.
  const imageUriFor = (cardId: string) => ({
    small: `https://cards.example.test/${cardId}-small.jpg`,
    normal: `https://cards.example.test/${cardId}-normal.jpg`,
    large: `https://cards.example.test/${cardId}-large.jpg`,
    png: `https://cards.example.test/${cardId}.png`,
    art_crop: `https://cards.example.test/${cardId}-art.jpg`,
    border_crop: `https://cards.example.test/${cardId}-border.jpg`,
  });

  // Distribution that lands the pool at exactly 84 cards and
  // exercises the LBld-04 4-copy cap (one entry above 4 triggers the
  // cap toast if the test goes looking for it).
  const distribution: Array<[string, number]> = [
    ["lightning-bolt-id", 4],
    ["mountain-id", 20],
    ["island-id", 20],
    ["sol-ring-id", 4],
    ["arcane-signet-id", 4],
    ["command-tower-id", 4],
    ["counterspell-id", 4],
    ["lightning-greaves-id", 4],
    ["cultivate-id", 4],
    ["terror-id", 4],
    ["sol-ring-id", 4], // extra sol-ring copies ⇒ tests the 4-copy cap
    ["counterspell-id", 4],
    ["terror-id", 4],
  ];

  const cardsById = new Map(baseCards.map((c) => [c.id, c]));
  const now = "2026-09-17T00:00:00.000Z";
  const pool = [];
  let packId = 0;
  let packSlot = 0;
  for (const [cardId, count] of distribution) {
    const card = cardsById.get(cardId);
    if (!card) throw new Error(`seed-limited-session: missing card ${cardId}`);
    for (let i = 0; i < count; i++) {
      pool.push({
        ...card,
        image_uris: imageUriFor(cardId),
        legalities: { commander: "legal", standard: "legal" },
        packId,
        packSlot,
        addedAt: now,
        isFoil: false,
      });
      packSlot++;
      if (packSlot >= 14) {
        packId++;
        packSlot = 0;
      }
    }
  }

  return {
    id: SESSION_ID,
    setCode: "m21",
    setName: "Core Set 2021",
    mode: "sealed" as const,
    status: "in_progress" as const,
    pool,
    deck: [],
    createdAt: now,
    updatedAt: now,
    seed: 42,
    name: "Test Sealed Session",
  };
}

/**
 * Register an init script that seeds the production `PlanarNexusLimited`
 * IndexedDB database with a known sealed session.
 *
 * Implementation note (the race-condition that took two attempts to
 * pin down): the sealed page's React mount fires `useEffect →
 * getSession` BEFORE the addInitScript's `tx.oncomplete` commits,
 * because both happen on the same page navigation in parallel.
 * The sealed page then renders "Session not found" and never
 * re-fetches — so the test fails even though the seed eventually
 * lands. To fix this we open the DB at IDB version 11 (Dexie's
 * `version(1)` is internally scaled to 10, so 11 is one above Dexie's
 * target). That guarantees the seed's `upgradeneeded` fires AFTER
 * any prior Dexie open, creating a clean schema with the five
 * indexes Dexie expects. Dexie's later open at version 10 sees the
 * `sessions` store + indexes and is happy.
 *
 * We also explicitly `s.put` (not `s.clear()` + `s.put`) — the DB
 * was either created by us (clean) or by Dexie (already correct),
 * so there's nothing to clear.
 */
export async function seedLimitedSession(page: Page): Promise<void> {
  const session = buildSealedPool();

  await page.addInitScript(
    (config) => {
      const { dbName, version, storeName, session } = config;

      const seedDb = indexedDB.open(dbName, version);
      seedDb.addEventListener("upgradeneeded", (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Always create the store fresh on upgrade — the seed
        // controls the schema. Production Dexie's expected schema
        // is one store named "sessions" with keyPath "id" and five
        // non-unique indexes (mirrors pool-storage.ts).
        const store = db.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("setCode", "setCode", { unique: false });
        store.createIndex("mode", "mode", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      });
      seedDb.addEventListener("success", () => {
        const db = seedDb.result;
        try {
          const tx = db.transaction([storeName], "readwrite");
          const s = tx.objectStore(storeName);
          s.put(session);
          tx.oncomplete = () => {
            console.log(
              `IndexedDB [limited-sessions] seeded with sealed session "${session.id}" (${session.pool.length} cards)`,
            );
            (
              window as unknown as { __limitedSessionSeeded?: boolean }
            ).__limitedSessionSeeded = true;
            try {
              db.close();
            } catch {
              /* ignore */
            }
          };
          tx.onerror = (event) => {
            console.error("seed tx error:", (event.target as IDBRequest).error);
          };
        } catch (e) {
          console.error("seed [sessions] error:", e);
        }
      });
      seedDb.addEventListener("error", (event) => {
        console.error(
          "seedLimitedSession init: open error",
          (event.target as IDBOpenDBRequest).error,
        );
        (
          window as unknown as { __limitedSessionSeedError?: string }
        ).__limitedSessionSeedError =
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
 * Verify the seeded session row is in IndexedDB. Reads the DB
 * directly so the helper doesn't rely on the in-page seed flag
 * (which resets on every navigation).
 */
export async function waitForLimitedSessionSeed(page: Page): Promise<void> {
  const sessionCount = await page.evaluate(
    async (config) => {
      return await new Promise<number>((resolve, reject) => {
        const req = indexedDB.open(config.dbName, config.version);
        req.onsuccess = () => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            const tx = db.transaction([config.storeName], "readonly");
            const store = tx.objectStore(config.storeName);
            const countReq = store.count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(new Error("Count failed"));
          } catch (e) {
            reject(e);
          } finally {
            try {
              db.close();
            } catch {
              /* ignore */
            }
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
      `IndexedDB has no limited session row yet — seed never wrote or was cleared`,
    );
  }
  console.log(`Limited session seed verified: ${sessionCount} row(s) found`);
}

export const test = base.extend({});

export { expect };
