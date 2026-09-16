/**
 * Seed-deck e2e helper — issue #1856.
 *
 * Mirrors the `seedCardDatabase` pattern in `e2e/test-utils.ts`: an init
 * script is registered on the page so it runs before every navigation,
 * then we hand-roll the IndexedDB open + onupgradeneeded + onsuccess +
 * onerror path to populate the production deck-related stores with a
 * known commander deck. The test can then assert unconditionally on
 * deck-dependent UI (deck selector, archetype, synergies, …) per issue
 * #1786's acceptance criterion #1.
 *
 * Production schema (see `src/lib/indexeddb-storage.ts` lines 537-551,
 * `DEFAULT_STORAGE_CONFIG` at line 1438):
 *   - DB:    "PlanarNexusStorage"  v3
 *   - store: "decks"  keyPath: "id"
 *   - idx:   "name", "format", "createdAt", "updatedAt" (non-unique)
 *   - store: "preferences"  keyPath: "id"  (no secondary indexes)
 *
 * Three storage locations are populated:
 *
 *   1. IndexedDB `decks` store — read by `deckStorage.getAllDecks()`
 *      for "Decks" views that go through the canonical storage manager.
 *
 *   2. IndexedDB `preferences` store (`id = "saved-decks"`) + the
 *      localStorage `saved-decks` fallback — read by the
 *      `useLocalStorage("saved-decks", …)` hook used by the in-page
 *      `<DeckSelector>` and other UI surfaces.
 *
 *   3. localStorage `planar_nexus_decks` — fallback path in
 *      `deckStorage.getAllDecks()` (line 238).
 *
 * Race-condition fix: every `indexedDB.open("PlanarNexusStorage", 3)`
 * call goes through a wrapper that holds the original `onsuccess`
 * callbacks until our seed writes have committed. Without this, the
 * page's React effect (`useLocalStorage`) can run its IndexedDB read
 * BEFORE our seed-write transaction commits, and the selector ends
 * up empty. The wrapper is installed once by the init script and
 * applies to every navigation.
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
const PREFERENCES_STORE = "preferences";
const SAVED_DECKS_LOCALSTORAGE_KEY = "saved-decks";
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
 * Register an init script that seeds the production deck-related
 * IndexedDB stores and localStorage fallbacks with a known commander
 * deck.
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
      const {
        dbName,
        version,
        decksStore,
        preferencesStore,
        savedDecksLocalStorageKey,
        deckStorageLocalStorageKey,
        deck,
      } = config;

      // localStorage seeds (synchronous — ready before any page script).
      try {
        localStorage.setItem(savedDecksLocalStorageKey, JSON.stringify([deck]));
      } catch (e) {
        console.error("localStorage [saved-decks] seed error:", e);
      }
      try {
        const existing = localStorage.getItem(deckStorageLocalStorageKey);
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
        localStorage.setItem(deckStorageLocalStorageKey, JSON.stringify(decks));
      } catch (e) {
        console.error("localStorage [planar_nexus_decks] seed error:", e);
      }

      // Race-condition-safe IndexedDB wrapper. Every
      // `indexedDB.open("PlanarNexusStorage", 3)` call goes through us.
      // We capture the page's `.onsuccess` handler and re-fire it
      // AFTER our seed writes have committed. This guarantees that
      // the page's React effect's `useLocalStorage` IndexedDB read
      // ALWAYS sees our seeded data.
      //
      // Why capture instead of stopImmediatePropagation: a capture-
      // phase `stopImmediatePropagation` listener can prevent the
      // page's later-attached handlers, but the page sets its
      // `request.onsuccess` BEFORE the success event fires (synchronously
      // after `indexedDB.open()` returns). At event-dispatch time, the
      // page's onsuccess is already on the request. We null it out
      // (so the target-phase handler doesn't run automatically), then
      // call it manually after the seed commits.
      const originalOpen = indexedDB.open.bind(indexedDB);
      const writeChain: { p: Promise<unknown> } = {
        p: Promise.resolve(),
      };

      function seedAndContinue(
        db: IDBDatabase,
        req: IDBOpenDBRequest,
      ): Promise<void> {
        // Chain onto the write mutex so seed writes serialize.
        const next = writeChain.p.then(
          () =>
            new Promise<void>((resolve) => {
              try {
                const tx = db.transaction(
                  [decksStore, preferencesStore],
                  "readwrite",
                );
                const ds = tx.objectStore(decksStore);
                ds.clear();
                ds.put(deck);
                const ps = tx.objectStore(preferencesStore);
                ps.put({
                  id: savedDecksLocalStorageKey,
                  _type: "array",
                  items: [deck],
                });
                tx.oncomplete = () => {
                  console.log(
                    `IndexedDB [decks+preferences] seeded with deck "${deck.id}" (${deck.cards.length} cards)`,
                  );
                  (
                    window as unknown as { __loadDeckSeeded?: boolean }
                  ).__loadDeckSeeded = true;
                  resolve();
                };
                tx.onerror = () => {
                  console.error(
                    "IndexedDB seed tx error:",
                    (tx as IDBTransaction).error,
                  );
                  (
                    window as unknown as { __loadDeckSeedError?: string }
                  ).__loadDeckSeedError =
                    (tx as IDBTransaction).error?.message ?? "unknown";
                  resolve();
                };
              } catch (e) {
                console.error("IndexedDB seed error:", e);
                (
                  window as unknown as { __loadDeckSeedError?: string }
                ).__loadDeckSeedError = (e as Error).message ?? "unknown";
                resolve();
              }
            }),
        );
        writeChain.p = next.catch(() => undefined);
        return next;
      }

      (indexedDB as unknown as { open: typeof indexedDB.open }).open =
        function (name: string, ver?: number): IDBOpenDBRequest {
          if (name !== dbName) {
            return originalOpen(name, ver);
          }
          const req = originalOpen(name, ver);

          // Wrap onupgradeneeded to add stores if missing.
          req.addEventListener(
            "upgradeneeded",
            (event) => {
              const db = (event.target as IDBOpenDBRequest).result;
              if (!db.objectStoreNames.contains(decksStore)) {
                const store = db.createObjectStore(decksStore, {
                  keyPath: "id",
                });
                store.createIndex("name", "name", { unique: false });
                store.createIndex("format", "format", { unique: false });
                store.createIndex("createdAt", "createdAt", { unique: false });
                store.createIndex("updatedAt", "updatedAt", { unique: false });
              }
              if (!db.objectStoreNames.contains(preferencesStore)) {
                db.createObjectStore(preferencesStore, { keyPath: "id" });
              }
            },
            true,
          );

          // Hijack success: capture page's onsuccess, null it, and
          // re-fire it AFTER our seed-write transaction commits.
          req.addEventListener(
            "success",
            (event) => {
              const r = event.target as IDBOpenDBRequest;
              const pageOnSuccess = r.onsuccess;
              r.onsuccess = null;
              const db = r.result;

              void seedAndContinue(db, r).then(() => {
                const newEvent = new Event("success") as Event;
                Object.defineProperty(newEvent, "target", { value: r });
                if (typeof pageOnSuccess === "function") {
                  try {
                    pageOnSuccess.call(r, newEvent);
                  } catch (e) {
                    console.error("deck seed: re-firing onsuccess failed:", e);
                  }
                }
              });
            },
            true,
          );

          return req;
        };
    },
    {
      dbName: DECK_DB_NAME,
      version: DECK_DB_VERSION,
      decksStore: DECK_STORE,
      preferencesStore: PREFERENCES_STORE,
      savedDecksLocalStorageKey: SAVED_DECKS_LOCALSTORAGE_KEY,
      deckStorageLocalStorageKey: DECK_LOCALSTORAGE_KEY,
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
