/**
 * Seed-deck e2e helper — issue #1856.
 *
 * Mirrors the `seedCardDatabase` pattern in `e2e/test-utils.ts`: an init
 * script is registered on the page so it runs before every navigation,
 * then we hand-roll the IndexedDB open + onupgradeneeded + onsuccess +
 * onerror path to populate the production `decks` store with a known
 * commander deck. The test can then assert unconditionally on deck-
 * dependent UI (deck selector, archetype, synergies, …) per issue
 * #1786's acceptance criterion #1.
 *
 * Production schema (see `src/lib/indexeddb-storage.ts` lines 537-551,
 * `DEFAULT_STORAGE_CONFIG` at line 1438):
 *   - DB:    "PlanarNexusStorage"  v3
 *   - store: "decks"  keyPath: "id"
 *   - idx:   "name", "format", "createdAt", "updatedAt" (non-unique)
 *
 * The localStorage fallback (`planar_nexus_decks`, JSON-encoded ARRAY
 * of StoredDeck rows) is seeded too — `deckStorage.getAllDecks()` in
 * `src/lib/deck-storage.ts` line 238 reads localStorage only when the
 * IndexedDB read throws. In practice the IndexedDB seed wins, but
 * seeding both keeps the helper resilient if a future schema bump
 * breaks one path.
 */
import { test as base, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const testDeck = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "fixtures/test-deck.json"),
    "utf8",
  ),
);

const DECK_DB_NAME = "PlanarNexusStorage";
const DECK_DB_VERSION = 3;
const DECK_STORE = "decks";
const DECK_LOCALSTORAGE_KEY = "planar_nexus_decks";
const FIXTURE_ID = "test-commander-deck-001";
const FIXTURE_NAME = "Test Commander Deck";
const FIXTURE_FORMAT = "commander";

function buildDeckRow(): unknown {
  const cardsById = new Map<string, Record<string, unknown>>(
    (testDeck as Array<Record<string, unknown>>).map((c) => [c.id, c]),
  );

  // Commander requires 100 cards. Mix the 10 fixtures from test-cards.json
  // to land at exactly 100: lands 40×2, four-ofs 4×5, singletons 1×3.
  const distribution: Array<[string, number]> = [
    ["sol-ring-id", 1],
    ["arcane-signet-id", 1],
    ["command-tower-id", 1],
    ["lightning-greaves-id", 1],
    ["lightning-bolt-id", 4],
    ["counterspell-id", 4],
    ["cultivate-id", 4],
    ["terror-id", 4],
    ["mountain-id", 40],
    ["island-id", 40],
  ];

  const storedCards = distribution.map(([cardId, count]) => {
    const card = cardsById.get(cardId);
    if (!card) {
      throw new Error(`test-deck.json missing card id: ${cardId}`);
    }
    return {
      card: {
        id: card.id,
        name: card.name,
        cmc: card.cmc,
        colors: card.colors,
        color_identity: card.color_identity,
        type_line: card.type_line,
        legalities: card.legalities,
      },
      count,
    };
  });

  const createdAt = "2026-09-16T00:00:00.000Z";
  const updatedAt = "2026-09-16T00:00:00.000Z";

  return {
    id: FIXTURE_ID,
    name: FIXTURE_NAME,
    format: FIXTURE_FORMAT,
    cards: storedCards,
    createdAt,
    updatedAt,
    metadata: {},
  };
}

/**
 * Register an init script that seeds the production `decks` IndexedDB
 * store (and the localStorage fallback) with a known commander deck.
 *
 * Must be called BEFORE `page.goto(...)` so the script is attached to
 * the initial navigation. Mirrors the `seedCardDatabase(page)` pattern
 * from `e2e/test-utils.ts` lines 12-58.
 */
export async function loadDeck(
  page: Page,
  fixtureId: "commander" = "commander",
): Promise<void> {
  if (fixtureId !== "commander") {
    throw new Error(
      `loadDeck: unknown fixtureId "${fixtureId}" — only "commander" is wired up.`,
    );
  }

  const deckRow = buildDeckRow();

  await page.addInitScript(
    (config) => {
      const { dbName, version, storeName, localStorageKey, deck } = config;

      const open = indexedDB.open(dbName, version);

      open.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
          store.createIndex("format", "format", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      open.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        store.put(deck);
        tx.oncomplete = () => {
          console.log(
            `IndexedDB seeded with deck "${deck.id}" (${deck.cards.length} rows)`,
          );
          (
            window as unknown as { __loadDeckSeeded?: boolean }
          ).__loadDeckSeeded = true;
        };
        tx.onerror = () => {
          console.error(
            "IndexedDB deck seed tx error:",
            (tx as IDBTransaction).error,
          );
          (
            window as unknown as { __loadDeckSeedError?: string }
          ).__loadDeckSeedError =
            (tx as IDBTransaction).error?.message ?? "unknown";
        };
      };

      open.onerror = (event) => {
        console.error(
          "IndexedDB deck seed open error:",
          (event.target as IDBOpenDBRequest).error,
        );
        (
          window as unknown as { __loadDeckSeedError?: string }
        ).__loadDeckSeedError =
          (event.target as IDBOpenDBRequest).error?.message ?? "unknown";
      };

      // localStorage fallback (see deck-storage.ts line 238). In practice
      // the IndexedDB read wins; this is defensive in case the schema
      // bumps in a way that breaks the open path during a test.
      try {
        const existing = localStorage.getItem(localStorageKey);
        let decks: unknown[] = [];
        if (existing) {
          try {
            const parsed = JSON.parse(existing);
            if (Array.isArray(parsed)) {
              decks = parsed.filter(
                (row) =>
                  row &&
                  typeof row === "object" &&
                  (row as { id?: unknown }).id !== deck.id,
              );
            }
          } catch {
            // ignore — overwrite
          }
        }
        decks.push(deck);
        localStorage.setItem(localStorageKey, JSON.stringify(decks));
      } catch (e) {
        console.error("localStorage deck seed error:", e);
      }
    },
    {
      dbName: DECK_DB_NAME,
      version: DECK_DB_VERSION,
      storeName: DECK_STORE,
      localStorageKey: DECK_LOCALSTORAGE_KEY,
      deck: deckRow,
    },
  );
}

/**
 * Wait for the `loadDeck` init script to finish writing to IndexedDB.
 * Throws if the seed errors so the test fails fast with a real cause
 * rather than a downstream "deck not loaded" failure.
 */
export async function waitForDeckSeed(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __loadDeckSeeded?: boolean }).__loadDeckSeeded ===
        true ||
      (window as unknown as { __loadDeckSeedError?: string })
        .__loadDeckSeedError !== undefined,
    { timeout: 15000 },
  );

  const error = await page.evaluate(
    () =>
      (window as unknown as { __loadDeckSeedError?: string })
        .__loadDeckSeedError,
  );
  if (error) {
    throw new Error(`IndexedDB deck seeding failed: ${error}`);
  }

  const cardCount = await page.evaluate(
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
      dbName: DECK_DB_NAME,
      version: DECK_DB_VERSION,
      storeName: DECK_STORE,
    },
  );

  if (cardCount === 0) {
    throw new Error(`IndexedDB seeded but deck count is ${cardCount}`);
  }
  console.log(`Deck seed verified: ${cardCount} deck row(s) found`);
}

export const test = base.extend({});

export { expect };
