/**
 * Trigger-chain worker bridge tests (#1080)
 *
 * The bridge (`trigger-chain-worker-bridge.ts`) is the single seam between the
 * main thread and the AI Web Worker for trigger-chain evaluation. These tests
 * cover the three required scenarios:
 *
 *  1. Client invocation — when a worker client is available, the bridge
 *     forwards to it and returns the worker's result (no main-thread compute).
 *  2. Fallback (no worker) — when the client resolves to null (e.g. jsdom, or
 *     `Worker` is undefined), the bridge computes on the main thread with
 *     results IDENTICAL to the direct evaluator.
 *  3. Fallback (worker error) — when the client throws (or returns null), the
 *     bridge falls back to main-thread compute identically.
 *
 * Plus ordering preservation (chains stay sorted by totalValue) and that the
 * default resolver degrades gracefully to the fallback in jsdom.
 */
import { describe, test, expect, afterEach, jest } from "@jest/globals";

import {
  evaluateTriggerChainAsync,
  _setTriggerChainClientResolver,
  _resetTriggerChainClientResolver,
  type TriggerChainWorkerClient,
} from "../trigger-chain-worker-bridge";
import { evaluateTriggerChain } from "../../trigger-chain-evaluator";
import type {
  CascadeContext,
  BoardPermanent,
  TriggerChain,
} from "../../trigger-chain-evaluator";

function makePermanent(
  overrides: Partial<BoardPermanent> & {
    id: string;
    name: string;
    controller: string;
  },
): BoardPermanent {
  return {
    cardId: overrides.id,
    type: "creature",
    ...overrides,
  };
}

const stackItem: CascadeContext["stackItem"] = {
  id: "s1",
  cardId: "s1",
  name: "Bloodbraid Cascade",
  controller: "player1",
  type: "spell",
  manaValue: 4,
  colors: ["red", "green"],
};

const battlefield: BoardPermanent[] = [
  makePermanent({
    id: "cloudblazer",
    name: "Cloudblazer",
    controller: "player1",
    oracleText: "When Cloudblazer enters the battlefield, draw two cards.",
  }),
  makePermanent({
    id: "impact-tremors",
    name: "Impact Tremors",
    controller: "player1",
    type: "enchantment",
    oracleText:
      "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
  }),
];

const mainThreadResult: TriggerChain[] = evaluateTriggerChain(
  stackItem,
  battlefield,
);

describe("trigger-chain-worker-bridge (#1080)", () => {
  afterEach(() => {
    _resetTriggerChainClientResolver();
  });

  describe("client invocation (worker path)", () => {
    test("forwards to the worker client and returns its result", async () => {
      const evaluateMock = jest
        .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
        .mockResolvedValue(mainThreadResult.map((c) => ({ ...c })));
      const fakeClient: TriggerChainWorkerClient = {
        evaluateTriggerChain: evaluateMock,
      };
      _setTriggerChainClientResolver(async () => fakeClient);

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(mainThreadResult);
      expect(evaluateMock).toHaveBeenCalledTimes(1);
      expect(evaluateMock).toHaveBeenCalledWith(
        stackItem,
        battlefield,
        undefined,
      );
    });

    test("does not recompute on the main thread when the worker succeeds", async () => {
      // Return a sentinel from the worker. If the bridge used the worker
      // result verbatim, the sentinel must surface (proving main-thread
      // compute did NOT run and overwrite it).
      const sentinel: TriggerChain[] = [
        {
          originStackItem: "SENTINEL",
          steps: [],
          totalValue: 999,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "sentinel",
        },
      ];
      const fakeClient: TriggerChainWorkerClient = {
        evaluateTriggerChain: jest
          .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
          .mockResolvedValue(sentinel),
      };
      _setTriggerChainClientResolver(async () => fakeClient);

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(sentinel);
      expect(result).not.toEqual(mainThreadResult);
    });

    test("forwards maxDepth to the worker client", async () => {
      const evaluateMock = jest
        .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
        .mockResolvedValue(mainThreadResult);
      _setTriggerChainClientResolver(async () => ({
        evaluateTriggerChain: evaluateMock,
      }));

      await evaluateTriggerChainAsync(stackItem, battlefield, 2);

      expect(evaluateMock).toHaveBeenCalledWith(stackItem, battlefield, 2);
    });
  });

  describe("fallback (worker unavailable)", () => {
    test("falls back to main-thread compute when client resolves to null", async () => {
      _setTriggerChainClientResolver(async () => null);

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the client throws (worker error)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: TriggerChainWorkerClient = {
        evaluateTriggerChain: jest
          .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
          .mockRejectedValue(new Error("worker boom")),
      };
      _setTriggerChainClientResolver(async () => throwingClient);

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(mainThreadResult);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("falls back when the worker returns null (no proxy)", async () => {
      const nullClient: TriggerChainWorkerClient = {
        evaluateTriggerChain: jest
          .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
          .mockResolvedValue(null),
      };
      _setTriggerChainClientResolver(async () => nullClient);

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the resolver itself throws", async () => {
      _setTriggerChainClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(result).toEqual(mainThreadResult);
    });

    test("fallback warning is emitted at most once across calls", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: TriggerChainWorkerClient = {
        evaluateTriggerChain: jest
          .fn<TriggerChainWorkerClient["evaluateTriggerChain"]>()
          .mockRejectedValue(new Error("worker boom")),
      };
      _setTriggerChainClientResolver(async () => throwingClient);

      await evaluateTriggerChainAsync(stackItem, battlefield);
      await evaluateTriggerChainAsync(stackItem, battlefield);
      await evaluateTriggerChainAsync(stackItem, battlefield);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    test("degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly.
      _resetTriggerChainClientResolver();

      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      // jsdom provides no `Worker`, so the real client exposes no proxy and
      // the dynamic import path resolves to null → main-thread fallback.
      expect(result).toEqual(mainThreadResult);
    });
  });

  describe("ordering preservation", () => {
    test("chains remain sorted by totalValue descending after the round-trip", async () => {
      const result = await evaluateTriggerChainAsync(stackItem, battlefield);

      const values = result.map((c) => c.totalValue);
      const sorted = [...values].sort((a, b) => b - a);
      expect(values).toEqual(sorted);
    });

    test("maxDepth is honored on the fallback path", async () => {
      _setTriggerChainClientResolver(async () => null);

      const shallow = await evaluateTriggerChainAsync(
        stackItem,
        battlefield,
        1,
      );
      const expectedShallow = evaluateTriggerChain(stackItem, battlefield, 1);

      expect(shallow).toEqual(expectedShallow);
    });
  });
});
