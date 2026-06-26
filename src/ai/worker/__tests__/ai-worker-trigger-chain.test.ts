/**
 * AI Worker — trigger-chain handler tests (#1080)
 *
 * Asserts the `evaluateTriggerChain` handler exposed by the AI Web Worker:
 *  - returns results IDENTICAL to the in-thread evaluator (parity / no
 *    behavior change), across ETB, cascade, copy-doubler and stress boards;
 *  - honors `maxDepth`;
 *  - returns an empty list (not an error) for boards with no triggers.
 *
 * The handler object is imported directly (Comlink.expose is a no-op side
 * effect under jsdom), which is exactly the code that runs inside the worker.
 */
import { describe, test, expect } from "@jest/globals";

import { aiWorker } from "../ai-worker";
import { evaluateTriggerChain } from "../../trigger-chain-evaluator";
import type {
  CascadeContext,
  BoardPermanent,
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

function makeStackItem(
  overrides: Partial<CascadeContext["stackItem"]> & {
    id: string;
    name: string;
  },
): CascadeContext["stackItem"] {
  return {
    cardId: overrides.id,
    controller: "player2",
    type: "spell",
    manaValue: 3,
    ...overrides,
  };
}

describe("AI Worker — evaluateTriggerChain handler (#1080)", () => {
  test("returns identical chains to the in-thread evaluator (ETB board)", async () => {
    const stackItem = makeStackItem({
      id: "s1",
      name: "Grizzly Bears",
      controller: "player1",
      manaValue: 2,
      colors: ["green"],
    });
    const battlefield: BoardPermanent[] = [
      makePermanent({
        id: "cloudblazer",
        name: "Cloudblazer",
        controller: "player1",
        oracleText: "When Cloudblazer enters the battlefield, draw two cards.",
      }),
      makePermanent({
        id: "purphoros",
        name: "Purphoros, God of the Forge",
        controller: "player1",
        type: "enchantment",
        oracleText:
          "Whenever a creature enters the battlefield under your control, Purphoros deals 2 damage to each opponent.",
      }),
    ];

    const expected = evaluateTriggerChain(stackItem, battlefield);
    const result = await aiWorker.evaluateTriggerChain({
      stackItem,
      battlefield,
    });

    // Deep equality — the worker path must not alter decisions.
    expect(result).toEqual(expected);
    expect(result.length).toBe(expected.length);
  });

  test("returns identical chains for a Cascade spell", async () => {
    const stackItem = makeStackItem({
      id: "cascade1",
      name: "Bloodbraid Cascade",
      controller: "player1",
      manaValue: 4,
      colors: ["red", "green"],
    });
    const battlefield: BoardPermanent[] = [
      makePermanent({
        id: "impact-tremors",
        name: "Impact Tremors",
        controller: "player1",
        type: "enchantment",
        oracleText:
          "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
      }),
    ];

    const expected = evaluateTriggerChain(stackItem, battlefield);
    const result = await aiWorker.evaluateTriggerChain({
      stackItem,
      battlefield,
    });

    expect(result).toEqual(expected);
    // Cascade keyword should produce at least one cascade chain on both paths.
    expect(
      result.some((c) =>
        c.steps.some((s) => s.ability.triggerType === "cascade"),
      ),
    ).toBe(true);
  });

  test("returns identical chains when a copy doubler is present", async () => {
    const stackItem = makeStackItem({
      id: "s2",
      name: "Solemn Simulacris",
      controller: "player1",
      manaValue: 4,
      colors: ["blue"],
    });
    const battlefield: BoardPermanent[] = [
      makePermanent({
        id: "panharmonicon",
        name: "Panharmonicon",
        controller: "player1",
        type: "artifact",
        oracleText:
          "If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
      }),
      makePermanent({
        id: "solemn",
        name: "Solemn Simulacrum",
        controller: "player1",
        oracleText:
          "When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card.",
      }),
    ];

    const expected = evaluateTriggerChain(stackItem, battlefield);
    const result = await aiWorker.evaluateTriggerChain({
      stackItem,
      battlefield,
    });

    expect(result).toEqual(expected);
  });

  test("honors maxDepth identically to the in-thread evaluator", async () => {
    const stackItem = makeStackItem({
      id: "s3",
      name: "Token Maker",
      controller: "player1",
      manaValue: 3,
      colors: ["white"],
    });
    const battlefield: BoardPermanent[] = [
      makePermanent({
        id: "pawn",
        name: "Pawn of Ulamog",
        controller: "player1",
        oracleText:
          "Whenever another nontoken creature you control dies, create a token.",
      }),
    ];

    for (const maxDepth of [1, 3, 5]) {
      const expected = evaluateTriggerChain(stackItem, battlefield, maxDepth);
      const result = await aiWorker.evaluateTriggerChain({
        stackItem,
        battlefield,
        maxDepth,
      });
      expect(result).toEqual(expected);
    }
  });

  test("returns an empty list (no error) for a board with no triggers", async () => {
    const stackItem = makeStackItem({
      id: "s4",
      name: "Grizzly Bears",
      manaValue: 2,
      colors: ["green"],
    });
    const battlefield: BoardPermanent[] = [];

    const expected = evaluateTriggerChain(stackItem, battlefield);
    const result = await aiWorker.evaluateTriggerChain({
      stackItem,
      battlefield,
    });

    expect(result).toEqual(expected);
    expect(result).toHaveLength(0);
  });

  test("STRESS FIXTURE: 200-permanent board stays identical between worker and main thread", async () => {
    // Documents the stress board used to validate offloading (#1080 parity).
    // Real 60fps measurement requires a browser; this test guarantees the
    // worker returns byte-for-byte the same decision set on a heavy board so
    // offloading is behavior-preserving. See PR body for the perf rationale.
    const stackItem = makeStackItem({
      id: "stress",
      name: "Bloodbraid Cascade",
      controller: "player1",
      manaValue: 5,
      colors: ["red", "green"],
    });
    const names = [
      "Cloudblazer",
      "Solemn Simulacrum",
      "Impact Tremors",
      "Panharmonicon",
      "Blood Artist",
      "Pawn of Ulamog",
    ];
    const battlefield: BoardPermanent[] = Array.from({ length: 200 }, (_, i) =>
      makePermanent({
        id: `perm_${i}`,
        name: names[i % names.length],
        controller: i % 2 === 0 ? "player1" : "player2",
        type: i % 3 === 0 ? "enchantment" : "creature",
        oracleText:
          "When this enters the battlefield, draw a card and create a token.",
      }),
    );

    const expected = evaluateTriggerChain(stackItem, battlefield);
    const result = await aiWorker.evaluateTriggerChain({
      stackItem,
      battlefield,
    });

    expect(result).toEqual(expected);
    expect(result.length).toBeGreaterThan(0);
  });
});
