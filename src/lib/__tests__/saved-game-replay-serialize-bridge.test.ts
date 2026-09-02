/**
 * @fileoverview Tests for the saved-game replay serialization bridge
 * (issue #1577).
 *
 * Mirrors the coverage model used by `backup-checksum-bridge.test.ts`
 * (#1249), `synergy-worker-bridge.test.ts` (#1079) and
 * `trigger-chain-worker-bridge.test.ts` (#1080):
 *
 *  1. Worker path — when the client resolves to a stub that exposes a
 *     `serializeReplay` API, the bridge forwards the replay object to it
 *     and returns the worker's string. It must NOT recompute on the main
 *     thread when the worker succeeds (sentinel assertion).
 *  2. Fallback (no client) — when the resolver returns null, the bridge
 *     serializes on the main thread with byte-identical results to the
 *     pre-#1577 `JSON.stringify(replay, mapReplacer)` implementation.
 *  3. Fallback (worker error) — when the client's `serializeReplay` method
 *     throws, the bridge falls back to the main thread and emits a one-shot
 *     `console.warn`.
 *  4. Fallback (null API) — when the client resolves but exposes no
 *     serialize API, the bridge falls back (warned at most once).
 *  5. Default resolver (jsdom) — without a real `Worker` global, the
 *     default resolver degrades gracefully to the fallback.
 *  6. Transfer-list mechanics — bytes mode passes the payload `ArrayBuffer`
 *     on the Comlink transfer list (`transferables.length === 1`, zero-copy
 *     handoff) — issue #1577 transfer-list acceptance criterion.
 *  7. Byte parity — the worker path, the fallback path, and the pre-#1577
 *     oracle all produce identical `replayJson` bytes for the same fixture,
 *     and bytes mode round-trips to the same string as object mode.
 *
 * Plus the main-thread blocking budget acceptance criterion: with the worker
 * path taken, the synchronous main-thread cost of the bridge handoff for a
 * synthetic ~50 MB replay stays under 30 ms (measured with
 * `performance.mark` / `performance.measure`).
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";

import {
  serializeReplayJson,
  serializeReplayJsonFromBytes,
  serializeReplayOnMainThread,
  _setSavedGameSerializeClientResolver,
  _resetSavedGameSerializeClientResolver,
  type SavedGameSerializeClient,
} from "../saved-game-serialize-bridge";
import { replayJsonFromBytes } from "../saved-game-serialize-core";
import { mapReplacer } from "../game-state/state-serialization";
import type { Replay } from "../game-state/replay";

/**
 * Lightweight synthetic replay fixture. The bridge treats the payload as an
 * opaque graph (`unknown` at the worker boundary), so a structural cast
 * avoids pulling the whole game-state factory into this suite — the oracle
 * below is the pre-#1577 `JSON.stringify(replay, mapReplacer)` call itself.
 *
 * Includes a `Map` so the `mapReplacer` envelope
 * (`{"dataType":"Map","value":[...]}`) is exercised on every path.
 */
function makeReplay(): Replay {
  return {
    id: "replay-001",
    metadata: {
      format: "commander",
      playerNames: ["Ada", "Bruno"],
      startingLife: 40,
      isCommander: true,
      gameStartDate: 1_700_000_000_000,
      winners: ["Ada"],
    },
    actions: [
      {
        sequenceNumber: 1,
        action: { type: "pass_priority", playerId: "p1" },
        resultingState: {
          players: new Map([
            ["p1", { name: "Ada", life: 40 }],
            ["p2", { name: "Bruno", life: 38 }],
          ]),
        },
        description: "Ada passes priority",
        recordedAt: 1_700_000_000_001,
      },
    ],
    currentPosition: 1,
    totalActions: 1,
    createdAt: 1_700_000_000_000,
    lastModifiedAt: 1_700_000_000_001,
  } as unknown as Replay;
}

/**
 * Build a `SavedGameSerializeClient` test stub from api mocks. The bridge
 * only reads `getSerializeApi()`, so this shape is sufficient.
 */
function stubClient(
  api: Partial<{
    serializeReplay: jest.Mock;
    serializeReplayBytes: jest.Mock;
  }>,
): SavedGameSerializeClient {
  return {
    getSerializeApi: () => ({
      serializeReplay: api.serializeReplay as never,
      serializeReplayBytes: api.serializeReplayBytes as never,
    }),
  };
}

describe("saved-game-serialize-bridge (issue #1577)", () => {
  afterEach(() => {
    _resetSavedGameSerializeClientResolver();
  });

  describe("worker path (happy path)", () => {
    it("1. forwards the replay object to the client and returns its string", async () => {
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockResolvedValue("sentinel-from-worker");
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe("sentinel-from-worker");
      expect(serializeMock).toHaveBeenCalledTimes(1);
      // The replay object graph is handed to the worker API as-is — the
      // bridge must not stringify it on the main thread first.
      expect(serializeMock.mock.calls[0][0]).toBe(replay);
    });

    it("1b. does not fall back when the worker succeeds (sentinel check)", async () => {
      // Sentinel: if the bridge silently fell back to the main thread the
      // result would be the JSON.stringify oracle, NOT this string.
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockResolvedValue("sentinel-from-worker");
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe("sentinel-from-worker");
      expect(result).not.toBe(JSON.stringify(replay, mapReplacer));
    });

    it("passes null/undefined replays through as undefined without touching the worker", async () => {
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      expect(await serializeReplayJson(null)).toBeUndefined();
      expect(await serializeReplayJson(undefined)).toBeUndefined();
      expect(serializeMock).not.toHaveBeenCalled();
    });
  });

  describe("fallback (worker unavailable)", () => {
    it("2. falls back to main-thread stringify when the resolver returns null", async () => {
      _setSavedGameSerializeClientResolver(async () => null);

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe(JSON.stringify(replay, mapReplacer));
    });

    it("2b. falls back when the resolver itself throws", async () => {
      _setSavedGameSerializeClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe(JSON.stringify(replay, mapReplacer));
    });

    it("3. falls back when the worker's serializeReplay throws, warning once", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockRejectedValue(new Error("worker exploded"));
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe(JSON.stringify(replay, mapReplacer));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("4. falls back when the client resolves but exposes no serialize API", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const client: SavedGameSerializeClient = {
        getSerializeApi: () => null,
      };
      _setSavedGameSerializeClientResolver(async () => client);

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      expect(result).toBe(JSON.stringify(replay, mapReplacer));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("4b. fallback warning is emitted at most once across many calls", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockRejectedValue(new Error("worker boom"));
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      const replay = makeReplay();
      for (let i = 0; i < 5; i++) {
        await serializeReplayJson(replay);
      }

      // Only the FIRST call should warn; the rest silently fall back.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("2c. fallback result is byte-identical for repeated calls on the same payload", async () => {
      _setSavedGameSerializeClientResolver(async () => null);
      const replay = makeReplay();
      const r1 = await serializeReplayJson(replay);
      const r2 = await serializeReplayJson(replay);
      const r3 = await serializeReplayJson(replay);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    it("5. degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly. The default resolver
      // tries to construct the worker client; in jsdom there is no
      // `Worker` global so `getSerializeApi()` returns null.
      _resetSavedGameSerializeClientResolver();

      const replay = makeReplay();
      const result = await serializeReplayJson(replay);

      // Byte-identical to the pre-#1577 oracle — proving the fallback
      // produces the same string the synchronous code used to.
      expect(result).toBe(JSON.stringify(replay, mapReplacer));
    });
  });

  describe("transfer-list mechanics (bytes mode)", () => {
    it("6. transfers the ArrayBuffer zero-copy with transferables.length === 1", async () => {
      const bytesMock = jest.fn() as unknown as jest.Mock<any>;
      // Stub mirrors what the real Comlink proxy does in the worker: the
      // core helper produces the canonical string from the transferred
      // bytes.
      bytesMock.mockImplementation(async (payload: ArrayBuffer) =>
        replayJsonFromBytes(payload),
      );
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplayBytes: bytesMock }),
      );

      const replay = makeReplay();
      const encoder = new TextEncoder();
      const buffer = encoder
        .encode(JSON.stringify(replay, mapReplacer))
        .buffer.slice(0) as ArrayBuffer;

      const result = await serializeReplayJsonFromBytes(buffer);

      // The payload is handed off on the Comlink transfer list: exactly one
      // transferable, the buffer itself (zero-copy — no structured-clone
      // copy of the payload). Issue #1577 transfer-list criterion.
      expect(bytesMock).toHaveBeenCalledTimes(1);
      const [payload, transferList] = bytesMock.mock.calls[0] as [
        ArrayBuffer,
        ArrayBuffer[],
      ];
      expect(payload).toBe(buffer);
      expect(transferList).toHaveLength(1);
      expect(transferList[0]).toBe(buffer);

      // And the bytes-mode result equals the object-mode oracle.
      expect(result).toBe(JSON.stringify(replay, mapReplacer));
    });

    it("6b. bytes mode falls back to the main thread when the worker errors", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const bytesMock = jest.fn() as unknown as jest.Mock<any>;
      bytesMock.mockRejectedValue(new Error("worker bytes exploded"));
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplayBytes: bytesMock }),
      );

      const replay = makeReplay();
      const encoder = new TextEncoder();
      const buffer = encoder
        .encode(JSON.stringify(replay, mapReplacer))
        .buffer.slice(0) as ArrayBuffer;

      const result = await serializeReplayJsonFromBytes(buffer);

      expect(result).toBe(JSON.stringify(replay, mapReplacer));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe("byte parity (worker path ≡ fallback path ≡ pre-#1577 oracle)", () => {
    it("7. worker path result is byte-identical to the fallback and the oracle", async () => {
      const replay = makeReplay();
      const oracle = JSON.stringify(replay, mapReplacer);

      // Fallback path.
      _setSavedGameSerializeClientResolver(async () => null);
      const fallbackResult = await serializeReplayJson(replay);

      // Worker path: stub resolves with what the real worker computes (the
      // shared pure helper from saved-game-serialize-core — the same code
      // the worker module calls).
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockImplementation(async () =>
        serializeReplayOnMainThread(replay),
      );
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );
      const workerResult = await serializeReplayJson(replay);

      // Bytes mode round-trips to the same canonical string.
      const encoder = new TextEncoder();
      const buffer = encoder.encode(oracle).buffer.slice(0) as ArrayBuffer;
      const bytesResult = await serializeReplayJsonFromBytes(buffer);

      expect(fallbackResult).toBe(oracle);
      expect(workerResult).toBe(oracle);
      expect(bytesResult).toBe(oracle);
    });

    it("7b. parity holds for a replay with nested Maps (mapReplacer envelope)", async () => {
      const replay = makeReplay();
      const oracle = JSON.stringify(replay, mapReplacer);

      // The fixture contains a players Map; the envelope must survive both
      // paths identically.
      expect(oracle).toContain('"dataType":"Map"');

      _setSavedGameSerializeClientResolver(async () => null);
      expect(await serializeReplayJson(replay)).toBe(oracle);
    });
  });

  describe("main-thread blocking budget (acceptance criterion #1577)", () => {
    /**
     * jsdom does not implement the User Timing API (`performance.mark` /
     * `performance.measure` / `getEntriesByName`). Measure with whichever is
     * available: the real User Timing marks in browsers (what the #1577
     * end-to-end perf trace consumes), a `performance.now()` fallback under
     * jsdom. Both report the duration of the synchronous handoff window.
     */
    function measureSyncHandoff<T>(handoff: () => Promise<T>): {
      duration: number;
      promise: Promise<T>;
    } {
      const perf = performance as Performance & {
        mark?: (name: string) => void;
        measure?: (name: string, startMark: string, endMark: string) => void;
        getEntriesByName?: (name: string) => Array<{ duration: number }>;
        clearMarks?: () => void;
        clearMeasures?: () => void;
      };
      const canUseUserTiming =
        typeof perf.mark === "function" &&
        typeof perf.measure === "function" &&
        typeof perf.getEntriesByName === "function";

      if (canUseUserTiming) {
        perf.mark!("replay-serialize-start");
        const promise = handoff();
        perf.mark!("replay-serialize-handoff");
        perf.measure!(
          "replay-serialize-main-thread",
          "replay-serialize-start",
          "replay-serialize-handoff",
        );
        const entries = perf.getEntriesByName!("replay-serialize-main-thread");
        const duration = entries[entries.length - 1].duration;
        perf.clearMarks?.();
        perf.clearMeasures?.();
        return { duration, promise };
      }

      const start = perf.now();
      const promise = handoff();
      const duration = perf.now() - start;
      return { duration, promise };
    }

    it("keeps the bridge's synchronous main-thread cost under 30 ms for a ~50 MB replay on the worker path", async () => {
      // Stub worker whose serialization resolves asynchronously, like a
      // real Comlink round-trip. The stringify itself must NOT run on the
      // main thread — that is the entire point of #1577 — so the stub
      // returns a sentinel instead of serializing.
      const serializeMock = jest.fn() as unknown as jest.Mock<any>;
      serializeMock.mockImplementation(async () => "sentinel-from-worker-50mb");
      _setSavedGameSerializeClientResolver(async () =>
        stubClient({ serializeReplay: serializeMock }),
      );

      // Synthetic ~50 MB replay: 96 actions × ~512 KB description strings.
      // The actions reference ONE shared string (cheap to allocate), but
      // the serialized form — the thing the old code built on the main
      // thread — is ~50 MB of output.
      const chunk = "x".repeat(512 * 1024);
      const actions = Array.from({ length: 96 }, (_, i) => ({
        sequenceNumber: i,
        action: { type: "pass_priority", playerId: "p1" },
        resultingState: {},
        description: chunk,
        recordedAt: i,
      }));
      const bigReplay = {
        id: "replay-50mb",
        metadata: {},
        actions,
        currentPosition: 0,
        totalActions: actions.length,
        createdAt: 0,
        lastModifiedAt: 0,
      } as unknown as Replay;

      const { duration, promise } = measureSyncHandoff(() =>
        serializeReplayJson(bigReplay),
      );
      const result = await promise;

      // Worker path taken (sentinel), not the 50 MB main-thread fallback.
      expect(result).toBe("sentinel-from-worker-50mb");

      // Issue #1577 budget: < 30 ms of main-thread blocking during the save
      // path (vs the previous 200–500 ms synchronous stringify). In jsdom
      // this measures the bridge handoff with a stubbed worker via
      // performance.now() (no User Timing API); the real
      // performance.mark/measure numbers and the native structured-clone
      // cost of a live worker round-trip are covered by the end-to-end
      // perf trace, mirroring the pragmatic scope of the backup-checksum
      // (#1249) Jest budget test.
      expect(duration).toBeLessThan(30);
    }, 30000);
  });
});
