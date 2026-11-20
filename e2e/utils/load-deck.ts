/**
 * Seed-deck e2e helper — issue #1856, hardened for #2485.
 *
 * Mirrors the `seedCardDatabase` pattern in `e2e/test-utils.ts`: an init
 * script is registered on the page so it runs before every navigation,
 * then we hand-roll the IndexedDB open + onupgradeneeded + onsuccess +
 * onerror path to populate the production `decks` store with a known
 * commander deck. The test can then assert unconditionally on deck-
 * dependent UI (deck selector, archetype, synergies, …) per issue
 * #1786's acceptance criterion #1.
 *
 * Production schema (see `DEFAULT_STORAGE_CONFIG` in
 * `src/lib/indexeddb-storage.ts` — DB "PlanarNexusStorage", currently
 * v4 with 13 stores):
 *   - store: "decks"  keyPath: "id"
 *   - idx:   "name", "format", "createdAt", "updatedAt" (non-unique)
 *
 * Issue #1937: the seed previously pinned the open at v3 — a stale
 * version — which forced every fresh context through a v3→v4 upgrade
 * race against the app's open and VersionError'd on every subsequent
 * navigation. The seed now opens WITHOUT a version: it never forces an
 * upgrade or an intermediate version, `upgradeneeded` only fires when
 * the database is brand new (creating just the `decks` store, which
 * the app's next open upgrades to the full schema), and re-navigations
 * are plain readwrite seeds against whatever version is on disk.
 *
 * Issue #2485 (cross-browser e2e flakes): the unversioned open above was
 * still wrong for the CI browsers. On a fresh context it CREATED the
 * database at version 1 with only the `decks` store — a torn schema —
 * so the app's own open had to run a v1→v4 upgrade. That upgrade is
 * `blocked` whenever the seed's connection is still open, and the app
 * answers `blocked` with `IndexedDBBlockedError` → "Failed to open
 * IndexedDB" / "IndexedDB not available, using localStorage" in the CI
 * web-server log (the exact symptom #2485 tracks). When the upgrade did
 * go through, the app's #1937 self-heal re-opened at v5, which closed
 * the app's v4 connection out from under in-flight callers →
 * "Can't start a transaction on a closed database". Both outcomes are
 * timing-dependent, hence the rotating firefox/webkit failures.
 *
 * The seed now:
 *   - opens at the APP's version and creates the APP's full store set
 *     (mirroring `DEFAULT_STORAGE_CONFIG`), so the app's open is a
 *     no-op: no upgrade, no `blocked`, no torn schema, no self-heal;
 *   - falls back to an unversioned open when the on-disk database is
 *     NEWER than the app's version (VersionError);
 *   - retries the whole open+seed when the connection is closed under
 *     it (`InvalidStateError` / "closed database") or the open fails
 *     transiently — the CI browsers abort connections more eagerly;
 *   - awaits the readwrite transaction's `complete` event BEFORE
 *     closing the connection and before flagging the seed as done, so a
 *     caller that waits for the seed never observes a half-written
 *     store.
 *
 * The localStorage fallback (`planar_nexus_decks`, JSON-encoded ARRAY
 * of StoredDeck rows) is seeded too — `deckStorage.getAllDecks()` in
 * `src/lib/deck-storage.ts` line 238 reads localStorage only when the
 * IndexedDB read throws. In practice the IndexedDB seed wins, but
 * seeding both keeps the helper resilient if a future schema bump
 * breaks one path.
 *
 * The `useLocalStorage("saved-decks", …)` hook used by
 * `<DeckSelector>` is covered via the `saved-decks` localStorage
 * key — the hook falls back to that when its IndexedDB read throws
 * (see `use-local-storage.ts` line 130). The IndexedDB `preferences`
 * store is seeded with the SAME value in the app's own wire format
 * (`{ id, _type: "array", items }`) so the deck shows up whether the
 * hook reads IndexedDB (the normal path) or falls back to localStorage
 * (the degraded path). Issue #1937 previously skipped the `preferences`
 * seed because the store was torn; with the full schema in place the
 * write is ordered before the app's read (IndexedDB serialises
 * overlapping-scope transactions in creation order), so the deck is
 * visible on the first paint instead of only after the fallback.
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
const DECK_STORE = "decks";
const SAVED_DECKS_LOCALSTORAGE_KEY = "saved-decks";
const DECK_LOCALSTORAGE_KEY = "planar_nexus_decks";
const FIXTURE_ID = "test-commander-deck-001";
const FIXTURE_NAME = "Test Commander Deck";
const FIXTURE_FORMAT = "commander";

/**
 * The app's `DEFAULT_STORAGE_CONFIG.version` — keep in sync with
 * `src/lib/indexeddb-storage.ts` (v4 since issue #1811).
 */
const DECK_DB_VERSION = 4;

/**
 * Mirror of `DEFAULT_STORAGE_CONFIG.stores` — the app's full store set.
 * The seed creates exactly these so the app's own open finds a complete
 * schema and never has to upgrade or self-heal (#2485).
 */
const DECK_DB_STORES = [
  "decks",
  "saved-games",
  "saved-games-meta",
  "saved-games-payloads",
  "preferences",
  "usage-tracking",
  "achievements",
  "game-history",
  "local-game-state",
  "local-game-codes",
  "search-preferences",
  "search-presets",
  "recent-searches",
];

/**
 * Mirror of the secondary indexes the app's upgrade handler creates per
 * store (all stores use `keyPath: "id"`; only the stores listed here get
 * secondary indexes).
 */
const DECK_DB_INDEXES: Record<string, string[]> = {
  decks: ["name", "format", "createdAt", "updatedAt"],
  "saved-games": ["name", "format", "status", "savedAt", "isAutoSave"],
  "saved-games-meta": ["name", "format", "status", "savedAt", "isAutoSave"],
  "usage-tracking": ["provider", "timestamp"],
  "game-history": ["date", "result", "mode"],
  "local-game-state": ["gameCode", "status", "updatedAt"],
  "search-presets": ["name", "updatedAt"],
  "recent-searches": ["lastUsedAt"],
};

/** How many times the seed retries a failed open+write cycle. */
const SEED_MAX_ATTEMPTS = 5;

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
      const {
        dbName,
        version,
        stores,
        indexes,
        storeName,
        preferencesStore,
        savedDecksKey,
        localStorageKey,
        deck,
        maxAttempts,
      } = config;

      // Seed localStorage fallback first — synchronous, race-free.
      // The `useLocalStorage` hook falls back to localStorage when its
      // IndexedDB read throws (use-local-storage.ts line 130); the
      // deck-builder's saved-decks sidebar reads `localStorage` directly
      // in some flows.
      try {
        localStorage.setItem(
          SAVED_DECKS_LOCALSTORAGE_KEY,
          JSON.stringify([deck]),
        );
      } catch (e) {
        console.error("localStorage [saved-decks] seed error:", e);
      }
      try {
        const existing = localStorage.getItem(DECK_LOCALSTORAGE_KEY);
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
        localStorage.setItem(DECK_LOCALSTORAGE_KEY, JSON.stringify(decks));
      } catch (e) {
        console.error("localStorage [planar_nexus_decks] seed error:", e);
      }

      type SeedWindow = Window & {
        __loadDeckSeeded?: boolean;
        __loadDeckSeedError?: string;
      };
      const seedWindow = window as SeedWindow;

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      /**
       * Open the database (optionally at a specific version), create the
       * app's store set when the upgrade handler runs, write the deck row
       * plus the `saved-decks` preference, and resolve only after the
       * write transaction has COMPLETED.
       *
       * `openVersion === null` opens whatever version is on disk (never
       * upgrades) — the fallback for a database that lives above the
       * app's version.
       */
      const openAndSeed = (openVersion: number | null): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const request =
            openVersion === null
              ? indexedDB.open(dbName)
              : indexedDB.open(dbName, openVersion);

          request.onupgradeneeded = () => {
            const db = request.result;
            for (const name of stores) {
              if (db.objectStoreNames.contains(name)) continue;
              const store = db.createObjectStore(name, { keyPath: "id" });
              for (const indexName of indexes[name] ?? []) {
                store.createIndex(indexName, indexName, { unique: false });
              }
            }
          };

          request.onblocked = () => {
            // Another connection holds an older version. The request stays
            // pending and succeeds as soon as that connection closes (the
            // app closes on `versionchange`), so keep waiting instead of
            // failing the seed.
            console.warn(
              "loadDeck init: open blocked by another connection — waiting",
            );
          };

          request.onerror = () => reject(request.error ?? new Error("open failed"));

          request.onsuccess = () => {
            const db = request.result;
            let tx: IDBTransaction;
            try {
              tx = db.transaction([storeName, preferencesStore], "readwrite");
            } catch (e) {
              // The connection was closed under us ("Can't start a
              // transaction on a closed database") — let the retry loop
              // re-open it.
              try {
                db.close();
              } catch {
                /* already closed */
              }
              reject(e);
              return;
            }
            const store = tx.objectStore(storeName);
            store.clear();
            store.put(deck);
            // The deck-builder reads its saved decks through
            // `useLocalStorage("saved-decks")`, which stores the array in
            // the `preferences` store as `{ id, _type: "array", items }`.
            // Seeding it keeps the seeded deck visible on the IndexedDB
            // path as well as on the localStorage fallback path.
            tx.objectStore(preferencesStore).put({
              id: savedDecksKey,
              _type: "array",
              items: [deck],
            });
            tx.oncomplete = () => {
              console.log(
                `IndexedDB [decks] seeded with deck "${deck.id}" (${deck.cards.length} cards)`,
              );
              try {
                db.close();
              } catch {
                /* already closed */
              }
              resolve();
            };
            tx.onerror = () => {
              try {
                db.close();
              } catch {
                /* already closed */
              }
              reject(tx.error ?? new Error("seed transaction failed"));
            };
            tx.onabort = () => {
              try {
                db.close();
              } catch {
                /* already closed */
              }
              reject(tx.error ?? new Error("seed transaction aborted"));
            };
          };
        });

      const runSeed = async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            await openAndSeed(version);
            seedWindow.__loadDeckSeeded = true;
            return;
          } catch (error) {
            lastError = error;
            const name = (error as { name?: string } | null)?.name;
            if (name === "VersionError") {
              // The on-disk database is NEWER than the app's version (an
              // earlier session self-healed past it). Open unversioned
              // instead — never force a downgrade.
              try {
                await openAndSeed(null);
                seedWindow.__loadDeckSeeded = true;
                return;
              } catch (fallbackError) {
                lastError = fallbackError;
              }
            }
            await sleep(100 * (attempt + 1));
          }
        }
        const message =
          lastError instanceof Error
            ? `${lastError.name}: ${lastError.message}`
            : String(lastError);
        console.error("loadDeck init: seed failed", lastError);
        seedWindow.__loadDeckSeedError = message;
      };

      void runSeed();
    },
    {
      dbName: DECK_DB_NAME,
      version: DECK_DB_VERSION,
      stores: DECK_DB_STORES,
      indexes: DECK_DB_INDEXES,
      storeName: DECK_STORE,
      preferencesStore: "preferences",
      savedDecksKey: SAVED_DECKS_LOCALSTORAGE_KEY,
      localStorageKey: DECK_LOCALSTORAGE_KEY,
      deck: deckRow,
      maxAttempts: SEED_MAX_ATTEMPTS,
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
        // Unversioned open — read whatever version is on disk (issue
        // #1937: pinning a stale version VersionError'd once the app
        // upgraded the DB past it). Retried once: the CI browsers abort
        // a connection that is closed mid-flight (#2485).
        const countRows = (db: IDBDatabase): Promise<number> =>
          new Promise<number>((res, rej) => {
            try {
              const tx = db.transaction([config.storeName], "readonly");
              const store = tx.objectStore(config.storeName);
              const countReq = store.count();
              countReq.onsuccess = () => res(countReq.result);
              countReq.onerror = () => rej(new Error("Count failed"));
            } catch (e) {
              rej(e);
            }
          });

        const open = (): Promise<IDBDatabase> =>
          new Promise<IDBDatabase>((res, rej) => {
            const req = indexedDB.open(config.dbName);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(new Error("DB open failed"));
          });

        open()
          .then((db) => {
            if (!db.objectStoreNames.contains(config.storeName)) {
              db.close();
              reject(
                new Error(
                  `store "${config.storeName}" missing — the seed did not create the app schema`,
                ),
              );
              return;
            }
            return countRows(db).then((count) => {
              db.close();
              resolve(count);
            });
          })
          .catch((firstError) => {
            // One retry: a connection closed under us (InvalidStateError /
            // "closed database") must not fail the seed verification.
            open()
              .then((db) => countRows(db).then((count) => {
                db.close();
                resolve(count);
              }))
              .catch(() => reject(firstError));
          });
      });
    },
    {
      dbName: DECK_DB_NAME,
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
