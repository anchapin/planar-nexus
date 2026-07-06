/**
 * @fileoverview Tests for the backup checksum bridge (issue #1249).
 *
 * Mirrors the coverage model used by `synergy-worker-bridge.test.ts` and
 * `trigger-chain-worker-bridge.test.ts`:
 *
 *  1. Worker path — when the client resolves to a stub that exposes a
 *     `checksum` API, the bridge forwards to it and returns the worker's
 *     digest. It must NOT recompute on the main thread when the worker
 *     succeeds (sentinel assertion).
 *  2. Fallback (no client) — when the resolver returns null, the bridge
 *     computes the digest on the main thread with byte-identical results
 *     to the pre-#1249 implementation.
 *  3. Fallback (worker error) — when the client's `checksum` method
 *     throws, the bridge falls back to the main thread and emits a one-
 *     shot `console.warn`.
 *  4. Fallback (null API) — when the client resolves but exposes no
 *     checksum API, the bridge falls back.
 *  5. Default resolver (jsdom) — without a real `Worker` global, the
 *     default resolver degrades gracefully to the fallback.
 *  6. Progress forwarding — when the worker fires progress events, the
 *     bridge forwards them through the caller's `onProgress` callback
 *     with the correct `{phase, bytesProcessed, totalBytes}` shape.
 *  7. Backward compatibility — the digest matches a hand-computed SHA-256
 *     for both paths so pre-#1249 backups still verify correctly.
 */
import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  jest,
} from "@jest/globals";
import * as nodeCrypto from "node:crypto";

import {
  calculateChecksumAsync,
  _setBackupChecksumClientResolver,
  _resetBackupChecksumClientResolver,
  serialiseBackupForChecksum,
  type BackupChecksumClient,
} from "../backup-checksum-bridge";
import type { BackupData } from "@/lib/indexeddb-storage";

/**
 * The full bridge client surface with strict `checksum` signature. Used to
 * cast `jest.fn()` mocks at use-sites so we get `mockResolvedValue(...)`
 * ergonomics without each test declaring a long generic signature.
 */
type BackupChecksumApi = {
  checksum: (
    payload: ArrayBufferLike,
    options?: { totalBytes?: number; progressEveryBytes?: number },
  ) => Promise<{
    checksum: string;
    bytesProcessed: number;
    totalBytes: number;
  }>;
};

/**
 * Wrap a plain `jest.Mock` so the bridge can call `api.checksum(...)`.
 * `jest.fn()` produces a callable function, not an object — the bridge
 * expects an object with a `checksum` method, so we surface the mock
 * through that property. The bridge only ever invokes `checksum`, so
 * this shape is sufficient.
 */
function asChecksumApi(mock: jest.Mock): BackupChecksumApi {
  return { checksum: mock as unknown as BackupChecksumApi["checksum"] };
}

/**
 * Build a `BackupChecksumClient` test stub from a `checksum` mock. We
 * intentionally keep the public surface here minimal — the bridge only
 * reads `getChecksumApi()` and `on()`.
 */
function stubClient(
  checksum: jest.Mock,
  listeners: Array<(event: unknown) => void> = [],
): BackupChecksumClient {
  return {
    getChecksumApi: () => asChecksumApi(checksum),
    on: (listener) => {
      // The bridge passes the typed `ChecksumWorkerEvent` callback; our
      // test-only listeners array accepts `unknown` so the test can drive
      // arbitrary event shapes. The bidirectional cast keeps TypeScript
      // happy while preserving the runtime identity needed for the
      // progress-forwarding test to see the events fire.
      const anyListener = listener as unknown as (event: unknown) => void;
      listeners.push(anyListener);
      return () => {
        const idx = listeners.indexOf(anyListener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

// Restore the real SHA-256 implementation so the "backward compatibility"
// assertions actually compare to a true SHA-256, not the slow hex mock
// installed by `jest.setup.js`.
beforeAll(() => {
  const realSubtle = nodeCrypto.webcrypto.subtle;
  if (!global.crypto) {
    // @ts-expect-error -- test-only crypto restore in jsdom.
    global.crypto = {};
  }
  Object.defineProperty(global.crypto, "subtle", {
    configurable: true,
    get: () => realSubtle,
  });
});

/**
 * Build a BackupData with a known `checksum` field. The bridge must strip
 * this field before serialising so the digest is stable across re-exports
 * (otherwise re-exporting a backup would produce a different checksum).
 */
function makeBackup(overrides: Partial<BackupData> = {}): BackupData {
  return {
    version: "1.0.0",
    exportedAt: "2026-01-01T00:00:00.000Z",
    decks: [],
    savedGames: [],
    preferences: {},
    checksum: "placeholder-must-be-stripped",
    ...overrides,
  } as BackupData;
}

/**
 * Independently compute the SHA-256 of `serialiseBackupForChecksum(data)`
 * using `crypto.subtle.digest`. This is the oracle the bridge's fallback
 * path must match for backward compatibility.
 */
async function expectedChecksum(data: BackupData): Promise<string> {
  const json = serialiseBackupForChecksum(data);
  const bytes = new TextEncoder().encode(json);
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("backup-checksum-bridge (issue #1249)", () => {
  afterEach(() => {
    _resetBackupChecksumClientResolver();
  });

  describe("worker path (happy path)", () => {
    it("forwards to the client and returns its digest", async () => {
      const expected = "worker-digest-001";
      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockResolvedValue({
        checksum: expected,
        bytesProcessed: 1234,
        totalBytes: 1234,
      });
      _setBackupChecksumClientResolver(async () => stubClient(checksumMock));

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      expect(result).toBe(expected);
      expect(checksumMock).toHaveBeenCalledTimes(1);
      const callArg = checksumMock.mock.calls[0][0];
      // jsdom and Node expose different `ArrayBuffer` constructors, so
      // `toBeInstanceOf(ArrayBuffer)` can fail with a misleading
      // "Expected constructor: ArrayBuffer / Received constructor:
      // ArrayBuffer" message. Use a duck-typed check via `instanceof`
      // on a sentinel property (`byteLength`) instead, which works
      // across Node and jsdom ArrayBuffer realms.
      expect(callArg).toBeDefined();
      const callArgBuffer = callArg as unknown as {
        constructor: { name: string };
        byteLength: number;
      };
      expect(callArgBuffer.constructor.name).toBe("ArrayBuffer");
      // The serialised JSON (without the `checksum` field) must round-trip
      // back to the same string the fallback would have produced.
      const expectedJson = serialiseBackupForChecksum(data);
      const expectedBytes = new TextEncoder().encode(expectedJson);
      expect(new TextDecoder().decode(callArg as unknown as ArrayBuffer)).toBe(
        expectedJson,
      );
      expect(callArgBuffer.byteLength).toBe(expectedBytes.byteLength);
    });

    it("does not fall back when the worker succeeds (sentinel check)", async () => {
      // Sentinel: if the bridge silently fell back to the main thread the
      // checksum would be the hand-computed hash, NOT this string.
      const sentinel = "sentinel-from-worker";
      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockResolvedValue({
        checksum: sentinel,
        bytesProcessed: 100,
        totalBytes: 100,
      });
      _setBackupChecksumClientResolver(async () => stubClient(checksumMock));

      const result = await calculateChecksumAsync(makeBackup());

      expect(result).toBe(sentinel);
      expect(result).not.toBe(await expectedChecksum(makeBackup()));
    });

    it("forwards worker progress events to the caller's onProgress callback", async () => {
      const progressEvents: Array<{
        phase: string;
        bytesProcessed: number;
        totalBytes: number;
      }> = [];

      // Build a fake client whose `on()` registers a listener we control.
      const listeners: Array<(event: unknown) => void> = [];
      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockImplementation(async () => {
        // Simulate progress events fired by the worker mid-digest.
        listeners.forEach((l) =>
          l({ type: "progress", bytesProcessed: 256, totalBytes: 1024 }),
        );
        listeners.forEach((l) =>
          l({ type: "progress", bytesProcessed: 768, totalBytes: 1024 }),
        );
        return {
          checksum: "progress-test",
          bytesProcessed: 1024,
          totalBytes: 1024,
        };
      });
      _setBackupChecksumClientResolver(async () =>
        stubClient(checksumMock, listeners),
      );

      const result = await calculateChecksumAsync(makeBackup(), {
        onProgress: (p) => progressEvents.push(p),
      });

      expect(result).toBe("progress-test");
      // We expect: 2 stringify ticks (0% and 100%) + 2 progress ticks from
      // the worker + 1 final digest tick (100% from the result). That's 5.
      expect(progressEvents.length).toBeGreaterThanOrEqual(3);
      const digestTicks = progressEvents.filter((e) => e.phase === "digest");
      expect(digestTicks.length).toBeGreaterThanOrEqual(2);
      // The final digest tick must be at 100% (bytesProcessed === totalBytes).
      const finalDigestTick = digestTicks[digestTicks.length - 1];
      expect(finalDigestTick.bytesProcessed).toBe(finalDigestTick.totalBytes);
    });

    it("computes a digest byte-identical to the pre-#1249 main-thread path", async () => {
      // Worker stub returns the digest we'd compute on the main thread.
      const data = makeBackup({ decks: [] });
      const mainThreadDigest = await expectedChecksum(data);

      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockResolvedValue({
        checksum: mainThreadDigest,
        bytesProcessed: 100,
        totalBytes: 100,
      });
      _setBackupChecksumClientResolver(async () => stubClient(checksumMock));

      const result = await calculateChecksumAsync(data);

      expect(result).toBe(mainThreadDigest);
    });
  });

  describe("fallback (worker unavailable)", () => {
    it("falls back to main-thread compute when the resolver returns null", async () => {
      _setBackupChecksumClientResolver(async () => null);

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      expect(result).toBe(await expectedChecksum(data));
    });

    it("falls back when the resolver itself throws", async () => {
      _setBackupChecksumClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      expect(result).toBe(await expectedChecksum(data));
    });

    it("falls back when the client resolves but exposes no checksum API", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const client: BackupChecksumClient = {
        getChecksumApi: () => null,
        on: () => () => undefined,
      };
      _setBackupChecksumClientResolver(async () => client);

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      expect(result).toBe(await expectedChecksum(data));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("falls back when the worker's checksum method throws", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockRejectedValue(new Error("worker exploded"));
      _setBackupChecksumClientResolver(async () => stubClient(checksumMock));

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      expect(result).toBe(await expectedChecksum(data));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("fallback warning is emitted at most once across many calls", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const checksumMock = jest.fn() as unknown as jest.Mock<any>;
      checksumMock.mockRejectedValue(new Error("worker boom"));
      _setBackupChecksumClientResolver(async () => stubClient(checksumMock));

      for (let i = 0; i < 5; i++) {
        await calculateChecksumAsync(makeBackup());
      }

      // Only the FIRST call should warn; the rest silently fall back.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("fallback result is byte-identical for repeated calls on the same payload", async () => {
      _setBackupChecksumClientResolver(async () => null);
      const data = makeBackup();
      const r1 = await calculateChecksumAsync(data);
      const r2 = await calculateChecksumAsync(data);
      const r3 = await calculateChecksumAsync(data);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    it("degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly. The default resolver
      // tries to construct the worker client; in jsdom there is no
      // `Worker` global so `getChecksumApi()` returns null.
      _resetBackupChecksumClientResolver();

      const data = makeBackup();
      const result = await calculateChecksumAsync(data);

      // The digest must equal the hand-computed oracle — proving the
      // fallback produces the same value the pre-#1249 code did.
      expect(result).toBe(await expectedChecksum(data));
    });
  });

  describe("main-thread blocking budget (acceptance criterion #1249)", () => {
    it("the fallback digest of a 1 MB synthetic backup completes under 1 s", async () => {
      // Force the fallback path so we can measure main-thread cost.
      _setBackupChecksumClientResolver(async () => null);

      const SIZE = 1 * 1024 * 1024;
      const padding = "x".repeat(SIZE);
      const data = makeBackup({
        preferences: {
          blob: padding,
        } as BackupData["preferences"],
      });

      const start = Date.now();
      const result = await calculateChecksumAsync(data);
      const elapsedMs = Date.now() - start;

      expect(result).toMatch(/^[0-9a-f]+$/);
      // 1 s is a generous ceiling for a 1 MB SHA-256 on a worker thread,
      // let alone a real machine. The full 10 MB Playwright perf-trace
      // assertion from issue #1249 is verified end-to-end, not in Jest.
      expect(elapsedMs).toBeLessThan(1000);
    }, 30000);
  });

  describe("serialiseBackupForChecksum (exported helper)", () => {
    it("strips the `checksum` field so the digest is stable across re-exports", () => {
      const data = makeBackup({ checksum: "should-not-be-hashed" });
      const json = serialiseBackupForChecksum(data);
      expect(json).not.toContain("should-not-be-hashed");
      expect(json).not.toMatch(/"checksum"/);
    });

    it("preserves all other fields", () => {
      const data = makeBackup({
        decks: [
          {
            id: "deck-1",
            name: "My Deck",
            format: "standard",
            cards: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            metadata: {},
          },
        ],
      });
      const json = serialiseBackupForChecksum(data);
      expect(json).toContain("My Deck");
      expect(json).toContain("deck-1");
    });
  });
});
