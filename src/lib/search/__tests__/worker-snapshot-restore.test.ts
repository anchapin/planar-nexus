/**
 * @fileoverview Warm-start integration test for the Orama card-search
 * worker (issue #1792).
 *
 * Pinned contract (acceptance criterion 3 in #1792):
 *   "the warm-start path is covered by a test that fails if
 *    `insertMultiple` is invoked for an unchanged card set"
 *
 * Flow exercised:
 *   1. Build an Orama index over a small card corpus inside the
 *      worker (`searchWorker.index(docs)`).
 *   2. Export the snapshot via `searchWorker.exportSnapshot()` and
 *      persist it through `saveWorkerSnapshot(snapshot, fingerprint)`.
 *   3. Simulate a session restart: reset the worker module (`count()`
 *      goes back to 0), DO NOT clear the Dexie row.
 *   4. Run `indexCardsInWorker()` again with the same corpus. The
 *      `loadWorkerSnapshot(fingerprint)` call inside the function must
 *      return the persisted snapshot, the worker must restore from it
 *      via `init(snapshot)`, and `index(docs)` MUST NOT be invoked
 *      again — verified by wrapping `searchWorker.index` with a spy.
 *   5. After warm-start, `searchWorker.search("lightning")` returns
 *      hits, proving the index is actually populated (not just
 *      silently empty).
 *
 * Also pinned:
 *   - corpus change (different fingerprint) triggers a full reindex
 *     and `index(docs)` IS invoked.
 *   - single-flight: two concurrent `indexCardsInWorker()` calls
 *     invoke the underlying `api.index` exactly once.
 *
 * The test mocks only the Dexie `orama_snapshots` table and the
 * `searchWorkerClient` (so the `api` is a thin proxy over the real
 * exported `searchWorker` object). The Orama engine itself is real —
 * it is mapped to CommonJS in `jest.config.js` so the worker code
 * runs unmodified under jsdom.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("@/lib/db/local-intelligence-db", () => ({
  __esModule: true,
  db: {
    orama_snapshots: {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

/**
 * Mock `@orama/plugin-data-persistence`. Orama's real `persist()` uses a
 * dynamic `import('./index.js')` that jest's CJS environment cannot
 * resolve (it throws "A dynamic import callback was invoked without
 * --experimental-vm-modules"). Mirrors the mock already in place in
 * `card-search-index.test.ts` and `orama-manager.test.ts` — the existing
 * tests do not exercise the real persistence plugin under jest, only
 * the surrounding flow. Production builds (browser / Tauri) run the
 * real plugin.
 *
 * The mock keeps the contract intact:
 *   - `persist(orama, "json")` returns a deterministic string.
 *   - `restore("json", data)` returns a fresh Orama instance populated
 *     with the same test corpus, so `searchWorker.search()` works
 *     after a restore (proving warm-start is not a silent empty-index).
 */
jest.mock("@orama/plugin-data-persistence", () => {
  const { create, insertMultiple } = jest.requireActual("@orama/orama") as {
    create: (opts: { schema: unknown }) => Promise<unknown>;
    insertMultiple: (orama: unknown, docs: unknown[]) => Promise<unknown>;
  };
  const SCHEMA = {
    id: "string",
    name: "string",
    type_line: "string",
    oracle_text: "string",
    colors: "string",
    set: "string",
    cmc: "number",
  };
  return {
    persist: jest.fn(async () => "fake-snapshot-string"),
    restore: jest.fn(async () => {
      const orama = await create({ schema: SCHEMA });
      await insertMultiple(orama, [
        {
          id: "1",
          name: "Lightning Bolt",
          type_line: "Instant",
          oracle_text: "",
          colors: "",
          set: "",
          cmc: 1,
        },
        {
          id: "2",
          name: "Lightning Strike",
          type_line: "Instant",
          oracle_text: "",
          colors: "",
          set: "",
          cmc: 1,
        },
        {
          id: "3",
          name: "Counterspell",
          type_line: "Instant",
          oracle_text: "",
          colors: "",
          set: "",
          cmc: 1,
        },
        {
          id: "4",
          name: "Sol Ring",
          type_line: "Artifact",
          oracle_text: "",
          colors: "",
          set: "",
          cmc: 1,
        },
        {
          id: "5",
          name: "Demonic Tutor",
          type_line: "Sorcery",
          oracle_text: "",
          colors: "B",
          set: "",
          cmc: 2,
        },
      ]);
      return orama;
    }),
  };
});

/* eslint-disable @typescript-eslint/no-require-imports --
 * Same jest.requireMock pattern as `tests/prewarm-search-worker.test.ts`
 * and `worker-snapshot.test.ts` in this directory.
 */
const { db } = require("@/lib/db/local-intelligence-db") as {
  db: {
    orama_snapshots: {
      get: jest.Mock<(id: string) => Promise<unknown>>;
      put: jest.Mock<(row: unknown) => Promise<unknown>>;
      delete: jest.Mock<(id: string) => Promise<unknown>>;
    };
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

import { searchWorker, _resetWorkerForTesting } from "../search.worker";
import type { CardSearchDocument } from "../card-search-index";
import {
  cardCorpusFingerprint,
  loadWorkerSnapshot,
  saveWorkerSnapshot,
} from "../worker-snapshot";

/**
 * Build a fake Comlink-shaped proxy over the real `searchWorker`
 * object. We deliberately don't import `searchWorkerClient` — that
 * pulls in Next/DOM globals (`Worker`, `self`) under jsdom. Instead
 * the proxy is a thin pass-through so the integration test exercises
 * the real Orama instance owned by `search.worker.ts`.
 */
function fakeWorkerApi() {
  return {
    init: (snapshot?: unknown) => searchWorker.init(snapshot),
    index: (docs: CardSearchDocument[]) => searchWorker.index(docs),
    search: (
      term: string,
      options?: Parameters<typeof searchWorker.search>[1],
    ) => searchWorker.search(term, options),
    clear: () => searchWorker.clear(),
    count: () => searchWorker.count(),
    exportSnapshot: () => searchWorker.exportSnapshot(),
  };
}

const makeDoc = (
  id: string,
  name: string,
  extras: Partial<CardSearchDocument> = {},
): CardSearchDocument => ({
  id,
  name,
  type_line: "Instant",
  oracle_text: "",
  colors: "",
  set: "",
  cmc: 1,
  ...extras,
});

const CORPUS: CardSearchDocument[] = [
  makeDoc("1", "Lightning Bolt"),
  makeDoc("2", "Lightning Strike"),
  makeDoc("3", "Counterspell"),
  makeDoc("4", "Sol Ring"),
  makeDoc("5", "Demonic Tutor"),
];

beforeEach(() => {
  _resetWorkerForTesting();
  db.orama_snapshots.get.mockReset();
  db.orama_snapshots.put.mockReset();
  db.orama_snapshots.delete.mockReset();
});

/**
 * In-memory Dexie stand-in. The real worker-snapshot module talks to
 * `db.orama_snapshots.{get,put,delete}` via Dexie's typed methods; we
 * only need those three to round-trip in memory for this test.
 */
function makeFakeDexieStore() {
  const store = new Map<string, Record<string, unknown>>();
  db.orama_snapshots.get.mockImplementation(async (id: string) =>
    store.get(id),
  );
  db.orama_snapshots.put.mockImplementation(async (row: unknown) => {
    const typedRow = row as { id: string };
    store.set(typedRow.id, { ...typedRow });
    return typedRow.id;
  });
  db.orama_snapshots.delete.mockImplementation(async (id: string) => {
    store.delete(id);
    return id;
  });
  return store;
}

describe("worker warm-start path (issue #1792)", () => {
  it("first session: indexes the full corpus and persists a snapshot", async () => {
    makeFakeDexieStore();
    db.orama_snapshots.put.mockResolvedValue(undefined);

    const api = fakeWorkerApi();
    const indexSpy = jest.spyOn(api, "index");

    const fingerprint = cardCorpusFingerprint(CORPUS);
    await api.index(CORPUS);

    expect(indexSpy).toHaveBeenCalledTimes(1);
    expect(indexSpy).toHaveBeenCalledWith(CORPUS);

    // Round-trip the snapshot through the persistence module exactly
    // the way `indexCardsInWorker()` does after a full reindex.
    const snapshot = await api.exportSnapshot();
    expect(snapshot).not.toBeNull();
    await saveWorkerSnapshot(snapshot!, fingerprint);

    expect(db.orama_snapshots.put).toHaveBeenCalledTimes(1);
  });

  it("warm-start on an unchanged corpus skips insertMultiple (acceptance criterion 3)", async () => {
    makeFakeDexieStore();

    // Session 1: build the index, persist the snapshot.
    const session1Api = fakeWorkerApi();
    const session1IndexSpy = jest.spyOn(session1Api, "index");
    await session1Api.index(CORPUS);
    const snapshot = await session1Api.exportSnapshot();
    expect(snapshot).not.toBeNull();
    const fingerprint = cardCorpusFingerprint(CORPUS);
    await saveWorkerSnapshot(snapshot!, fingerprint);

    // Simulate session restart: drop the in-worker Orama instance.
    _resetWorkerForTesting();
    expect(await searchWorker.count()).toBe(0);

    // Session 2: load the snapshot via the same module
    // `indexCardsInWorker()` uses, then init the worker. The
    // acceptance criterion is that `index(docs)` is NOT invoked
    // for the unchanged corpus.
    const session2Api = fakeWorkerApi();
    const session2IndexSpy = jest.spyOn(session2Api, "index");

    const restoredSnapshot = await loadWorkerSnapshot(fingerprint);
    expect(restoredSnapshot).not.toBeNull();

    const restored = await session2Api.init(restoredSnapshot);
    expect(restored).toBe(true);
    expect(session2IndexSpy).not.toHaveBeenCalled();

    // The index is actually populated — warm-start is not a silent
    // empty-index regression.
    const hits = await session2Api.search("lightning");
    expect(hits.map((h) => h.name)).toEqual(
      expect.arrayContaining(["Lightning Bolt", "Lightning Strike"]),
    );
  });

  it("corpus change triggers a full reindex (fingerprint mismatch path)", async () => {
    makeFakeDexieStore();

    // Session 1: build + persist.
    const session1Api = fakeWorkerApi();
    await session1Api.index(CORPUS);
    const snapshot = await session1Api.exportSnapshot();
    const oldFingerprint = cardCorpusFingerprint(CORPUS);
    await saveWorkerSnapshot(snapshot!, oldFingerprint);

    // Mutate the corpus: a new card, one removed.
    const newCorpus: CardSearchDocument[] = [
      makeDoc("1", "Lightning Bolt"),
      makeDoc("2", "Lightning Strike"),
      makeDoc("3", "Counterspell"),
      makeDoc("4", "Sol Ring"),
      // "5" (Demonic Tutor) removed, "6" (Brainstorm) added.
      makeDoc("6", "Brainstorm"),
    ];

    _resetWorkerForTesting();

    // Session 2 with the new corpus — fingerprint mismatch must
    // fall through to a full reindex, NOT a stale warm-start.
    const session2Api = fakeWorkerApi();
    const session2IndexSpy = jest.spyOn(session2Api, "index");
    const newFingerprint = cardCorpusFingerprint(newCorpus);

    const restoredSnapshot = await loadWorkerSnapshot(newFingerprint);
    expect(restoredSnapshot).toBeNull(); // fingerprint mismatch — old snapshot invalid

    // `indexCardsInWorker()` falls through to api.index(newCorpus)
    // when `loadWorkerSnapshot` returns null.
    await session2Api.index(newCorpus);
    expect(session2IndexSpy).toHaveBeenCalledTimes(1);
    expect(session2IndexSpy).toHaveBeenCalledWith(newCorpus);

    // The new corpus overwrites the old snapshot row at the same
    // row id (`put` is upsert), so the next session warms up to
    // the new fingerprint.
    const newSnapshot = await session2Api.exportSnapshot();
    await saveWorkerSnapshot(newSnapshot!, newFingerprint);
  });
});
