/**
 * @fileoverview Issue #1726 — a failed card-database init must be RETRYABLE.
 *
 * `initializeCardDatabase()` used to cache the rejected promise for the
 * whole session: a transient open failure (browser restart mid-transaction,
 * privacy mode, corruption) permanently degraded every consumer to the
 * "database empty" presentation until reload. These tests lock in:
 *
 *   1. A rejected init clears the single-flight cache — the next call
 *      retries the open instead of returning the same rejection.
 *   2. `getDatabaseStatus()` reports the failure distinctly (non-null
 *      `error`, `loaded: false`) so UIs never confuse it with empty.
 *   3. Init failure → retry → success works without a module reload.
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 */

// Mock Orama to avoid ESM issues in Jest (mirrors card-database.test.ts).
jest.mock("@orama/orama", () => ({
  create: jest.fn().mockResolvedValue({}),
  insertMultiple: jest.fn().mockResolvedValue({}),
  remove: jest.fn().mockResolvedValue({}),
  search: jest.fn().mockResolvedValue({ count: 0, hits: [] }),
}));

jest.mock("@orama/plugin-data-persistence", () => ({
  persist: jest.fn().mockResolvedValue({ some: "data" }),
  restore: jest.fn().mockResolvedValue({}),
}));

describe("card database init retry (issue #1726)", () => {
  beforeEach(() => {
    // Module state (db/searchReady/initPromise/lastInitError) persists
    // across tests in a file — reset to keep each case independent.
    jest.resetModules();
    jest.restoreAllMocks();
  });

  // Re-require after every reset so each test exercises fresh state.
  // The require() is deliberate: it is the only way to pull a fresh
  // module instance out of jest's registry inside isolateModules.
  const fresh = () => {
    let mod: typeof import("../card-database");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh instance per test
      mod = require("../card-database");
    });
    return mod!;
  };

  it("rejects on transient open failure and reports it via getDatabaseStatus", async () => {
    const { initializeCardDatabase, getDatabaseStatus } = fresh();
    const openSpy = jest.spyOn(indexedDB, "open");
    openSpy.mockImplementationOnce(() => {
      throw new Error("simulated transient open failure");
    });

    await expect(initializeCardDatabase()).rejects.toThrow(
      "simulated transient open failure",
    );

    const status = await getDatabaseStatus();
    expect(status.loaded).toBe(false);
    expect(status.cardCount).toBe(0);
    expect(status.error).toBe("simulated transient open failure");
  });

  it("retries the open on the next call instead of caching the rejection", async () => {
    const { initializeCardDatabase, getDatabaseStatus } = fresh();
    // First call fails transiently...
    const openSpy = jest.spyOn(indexedDB, "open");
    openSpy.mockImplementationOnce(() => {
      throw new Error("transient");
    });
    await expect(initializeCardDatabase()).rejects.toThrow("transient");
    openSpy.mockRestore();

    // ...and the SECOND call must attempt a fresh open (fake-indexeddb
    // opens an empty DB successfully) — no reload, no module reset.
    await expect(initializeCardDatabase()).resolves.toBeUndefined();

    const status = await getDatabaseStatus();
    expect(status.loaded).toBe(true);
    expect(status.error).toBeNull();
  });

  it("concurrent callers during a failed attempt do not wedge the cache", async () => {
    const { initializeCardDatabase, getDatabaseStatus } = fresh();
    const openSpy = jest.spyOn(indexedDB, "open");
    openSpy.mockImplementation(() => {
      throw new Error("flaky");
    });

    // Two concurrent callers share one attempt...
    const [a, b] = await Promise.all([
      initializeCardDatabase().catch((e: Error) => e.message),
      initializeCardDatabase().catch((e: Error) => e.message),
    ]);
    expect(a).toBe("flaky");
    expect(b).toBe("flaky");

    // ...but the next call after recovery still retries.
    openSpy.mockRestore();
    await expect(initializeCardDatabase()).resolves.toBeUndefined();
    expect((await getDatabaseStatus()).loaded).toBe(true);
  });
});
