/**
 * @fileoverview Tests for the saved-game serialize worker functions
 * (issue #1577).
 *
 * Exercised directly (no Worker realm) — the `Comlink.expose` guard in the
 * worker module is a no-op under Jest, so the exported
 * `savedGameSerializeWorker` surface can be called like any plain object.
 * This mirrors how `backup-checksum.worker.ts` functions are tested.
 */
import { describe, it, expect } from "@jest/globals";

import { savedGameSerializeWorker } from "../saved-game-serialize.worker";
import { serializeReplayOnMainThread } from "../saved-game-serialize-core";
import { mapReplacer } from "../game-state/state-serialization";
import type { Replay } from "../game-state/replay";

function makeReplay(): Replay {
  return {
    id: "replay-worker-001",
    metadata: {
      format: "commander",
      playerNames: ["Ada", "Bruno"],
      startingLife: 40,
      isCommander: false,
      gameStartDate: 1,
    },
    actions: [
      {
        sequenceNumber: 1,
        action: { type: "pass_priority", playerId: "p1" },
        resultingState: {
          players: new Map([["p1", { name: "Ada", life: 40 }]]),
        },
        description: "Ada passes priority",
        recordedAt: 2,
      },
    ],
    currentPosition: 1,
    totalActions: 1,
    createdAt: 1,
    lastModifiedAt: 2,
  } as unknown as Replay;
}

describe("saved-game-serialize.worker (issue #1577)", () => {
  describe("serializeReplay (object mode)", () => {
    it("encodes Maps with the mapReplacer envelope", async () => {
      const json = await savedGameSerializeWorker.serializeReplay(makeReplay());
      expect(json).toContain('"dataType":"Map"');
      expect(json).toContain('"players"');
    });

    it("is byte-identical to the pre-#1577 main-thread stringify", async () => {
      const replay = makeReplay();
      const workerJson = await savedGameSerializeWorker.serializeReplay(replay);
      expect(workerJson).toBe(JSON.stringify(replay, mapReplacer));
      expect(workerJson).toBe(serializeReplayOnMainThread(replay));
    });
  });

  describe("serializeReplayBytes (bytes mode)", () => {
    it("round-trips a whole ArrayBuffer byte-identically to the object path", async () => {
      const replay = makeReplay();
      const oracle = serializeReplayOnMainThread(replay);
      const buffer = new TextEncoder()
        .encode(oracle)
        .buffer.slice(0) as ArrayBuffer;

      const json = await savedGameSerializeWorker.serializeReplayBytes(buffer);
      expect(json).toBe(oracle);
    });

    it("accepts the [buffer, byteOffset, byteLength] sub-region form and respects the offset", async () => {
      const replay = makeReplay();
      const oracle = serializeReplayOnMainThread(replay);
      const payloadBytes = new TextEncoder().encode(oracle);

      // Pad the payload on both sides — the transfer-list tuple must slice
      // out exactly the replay region.
      const padding = new Uint8Array([0x21, 0x22, 0x23, 0x24]);
      const framed = new Uint8Array(
        padding.length + payloadBytes.length + padding.length,
      );
      framed.set(padding, 0);
      framed.set(payloadBytes, padding.length);
      framed.set(padding, padding.length + payloadBytes.length);

      const json = await savedGameSerializeWorker.serializeReplayBytes([
        framed.buffer.slice(0) as ArrayBuffer,
        padding.length,
        payloadBytes.length,
      ]);
      expect(json).toBe(oracle);
    });
  });

  describe("module load safety", () => {
    it("importing the worker module in Jest does not throw (Comlink expose guard is a no-op)", () => {
      // The module was already imported at the top of this file; requiring
      // it again exercises the guard branch explicitly.
      expect(() =>
        jest.requireActual("../saved-game-serialize.worker"),
      ).not.toThrow();
      expect(typeof savedGameSerializeWorker.serializeReplay).toBe("function");
      expect(typeof savedGameSerializeWorker.serializeReplayBytes).toBe(
        "function",
      );
    });
  });
});
