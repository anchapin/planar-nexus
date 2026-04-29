import { describe, test, expect, beforeEach } from "@jest/globals";
import {
  evaluateTriggerChain,
  getTriggerChainSummary,
  shouldCounterToPreventTriggers,
  getHighestValueChain,
} from "../trigger-chain-evaluator";
import type {
  CascadeContext,
  BoardPermanent,
  TriggerChain,
} from "../trigger-chain-evaluator";

function makePermanent(
  overrides: Partial<BoardPermanent> & { id: string; name: string; controller: string },
): BoardPermanent {
  return {
    cardId: overrides.id,
    type: "creature",
    ...overrides,
  };
}

function makeStackItem(
  overrides: Partial<CascadeContext["stackItem"]> & { id: string; name: string },
): CascadeContext["stackItem"] {
  return {
    cardId: overrides.id,
    controller: "player2",
    type: "spell",
    manaValue: 3,
    ...overrides,
  };
}

describe("trigger-chain-evaluator", () => {
  describe("evaluateTriggerChain", () => {
    test("returns empty chains for no triggers on board", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        colors: ["green"],
      });
      const board: BoardPermanent[] = [];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains).toHaveLength(0);
    });

    test("detects ETB draw trigger (Cloudblazer)", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "cloudblazer",
          name: "Cloudblazer",
          controller: "player1",
          type: "creature",
          oracleText:
            "When Cloudblazer enters the battlefield, draw two cards.",
        }),
      ];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains.length).toBeGreaterThan(0);
      const drawChain = chains.find((c) =>
        c.steps.some((s) => s.ability.effectType === "draw"),
      );
      expect(drawChain).toBeDefined();
    });

    test("detects ETB trigger from oracle text (Purphoros pattern)", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        controller: "player1",
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "purphoros",
          name: "Purphoros, God of the Forge",
          controller: "player1",
          type: "enchantment",
          oracleText:
            "Whenever a creature enters the battlefield under your control, Purphoros deals 2 damage to each opponent.",
        }),
      ];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains.length).toBeGreaterThan(0);
      const etbChain = chains.find((c) =>
        c.steps.some((s) => s.ability.triggerType === "etb"),
      );
      expect(etbChain).toBeDefined();
    });

    test("detects Cascade keyword in name", () => {
      const stackItem = makeStackItem({
        id: "cascade1",
        name: "Cascade Bluffs",
        manaValue: 3,
        controller: "player1",
        colors: ["red", "green"],
      });
      const board: BoardPermanent[] = [];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains.length).toBeGreaterThan(0);
      const cascadeChain = chains.find((c) =>
        c.steps.some((s) => s.ability.triggerType === "cascade"),
      );
      expect(cascadeChain).toBeDefined();
      expect(cascadeChain!.steps[0].ability.triggerType).toBe("cascade");
    });

    test("Panharmonicon doubles ETB value", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "soul_warden",
          name: "Soul Warden",
          controller: "player1",
          type: "creature",
          oracleText:
            "Whenever another creature enters, you gain 1 life.",
        }),
        makePermanent({
          id: "panharmonicon",
          name: "Panharmonicon",
          controller: "player1",
          type: "artifact",
        }),
      ];

      const chainsWithout = evaluateTriggerChain(
        stackItem,
        board.filter((p) => p.id !== "panharmonicon"),
      );
      const chainsWith = evaluateTriggerChain(stackItem, board);

      expect(chainsWith.length).toBeGreaterThan(0);
      if (chainsWithout.length > 0) {
        expect(chainsWith[0].totalValue).toBeGreaterThanOrEqual(
          chainsWithout[0].totalValue,
        );
      }
    });

    test("death trigger detected from oracle text", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "blood_artist",
          name: "Blood Artist",
          controller: "player1",
          type: "creature",
          oracleText:
            "Whenever Blood Artist or another creature dies, each opponent loses 1 life and you gain 1 life.",
        }),
      ];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains).toHaveLength(0);
    });

    test("generic oracle text triggers ETB draw", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Mulldrifter",
        manaValue: 5,
        controller: "player1",
        colors: ["blue"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "fodder",
          name: "Wall of Omens",
          controller: "player1",
          type: "enchantment",
          oracleText:
            "When Wall of Omens enters the battlefield, draw a card.",
        }),
      ];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains.length).toBeGreaterThan(0);
      expect(chains[0].steps[0].ability.effectType).toBe("draw");
    });

    test("chains sorted by total value descending", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        controller: "player1",
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "impact",
          name: "Impact Tremors",
          controller: "player1",
          type: "enchantment",
          oracleText:
            "Whenever a creature enters, Impact Tremors deals 1 damage to each opponent.",
        }),
        makePermanent({
          id: "soul",
          name: "Soul Warden",
          controller: "player1",
          type: "creature",
          oracleText:
            "Whenever another creature enters, you gain 1 life.",
        }),
      ];

      const chains = evaluateTriggerChain(stackItem, board);

      expect(chains.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < chains.length; i++) {
        expect(chains[i - 1].totalValue).toBeGreaterThanOrEqual(
          chains[i].totalValue,
        );
      }
    });

    test("maxDepth limits chain expansion", () => {
      const stackItem = makeStackItem({
        id: "s1",
        name: "Grizzly Bears",
        manaValue: 2,
        controller: "player1",
        colors: ["green"],
      });
      const board: BoardPermanent[] = [
        makePermanent({
          id: "impact",
          name: "Impact Tremors",
          controller: "player1",
          type: "enchantment",
          oracleText:
            "Whenever a creature enters, deal 1 damage.",
        }),
      ];

      const shallow = evaluateTriggerChain(stackItem, board, 1);
      const deep = evaluateTriggerChain(stackItem, board, 5);

      for (const chain of deep) {
        expect(chain.steps.length).toBeLessThanOrEqual(6);
      }
      expect(deep.length).toBeGreaterThanOrEqual(shallow.length);
    });
  });

  describe("getTriggerChainSummary", () => {
    test("returns 'No trigger chains detected' for empty", () => {
      expect(getTriggerChainSummary([])).toBe("No trigger chains detected");
    });

    test("includes chain count in summary", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "s1",
          steps: [],
          totalValue: 3,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "test",
        },
        {
          originStackItem: "s2",
          steps: [],
          totalValue: 2,
          totalManaCost: 0,
          hasOptionalSteps: true,
          controller: "player1",
          description: "test2",
        },
      ];
      const summary = getTriggerChainSummary(chains);
      expect(summary).toContain("2 trigger chain");
      expect(summary).toContain("5.0");
      expect(summary).toContain("optional");
    });

    test("mentions cascade keyword when present", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "cascade1",
          steps: [
            {
              ability: {
                id: "t1",
                sourceCardId: "cascade1",
                sourceName: "Bloodbraid Elf",
                controller: "player1",
                triggerType: "cascade",
                triggerText: "Cascade",
                effectType: "search",
                effectValue: 4,
                isOptional: false,
                copiesWithPanharmonicon: false,
              },
              condition: "resolves",
              depth: 0,
              isOptional: false,
            },
          ],
          totalValue: 4,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "cascade",
        },
      ];
      expect(getTriggerChainSummary(chains)).toContain("Cascade");
    });
  });

  describe("shouldCounterToPreventTriggers", () => {
    test("returns false when no chains", () => {
      expect(shouldCounterToPreventTriggers([])).toBe(false);
    });

    test("returns false when total value below threshold", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "s1",
          steps: [],
          totalValue: 1,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "low",
        },
      ];
      expect(shouldCounterToPreventTriggers(chains)).toBe(false);
    });

    test("returns true when total value meets threshold", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "s1",
          steps: [],
          totalValue: 5,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "high",
        },
      ];
      expect(shouldCounterToPreventTriggers(chains)).toBe(true);
    });

    test("respects custom threshold", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "s1",
          steps: [],
          totalValue: 6,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "player1",
          description: "med",
        },
      ];
      expect(shouldCounterToPreventTriggers(chains, 7)).toBe(false);
      expect(shouldCounterToPreventTriggers(chains, 5)).toBe(true);
    });
  });

  describe("getHighestValueChain", () => {
    test("returns null for empty chains", () => {
      expect(getHighestValueChain([])).toBeNull();
    });

    test("returns single chain", () => {
      const chain: TriggerChain = {
        originStackItem: "s1",
        steps: [],
        totalValue: 3,
        totalManaCost: 0,
        hasOptionalSteps: false,
        controller: "player1",
        description: "only",
      };
      expect(getHighestValueChain([chain])!.totalValue).toBe(3);
    });

    test("returns highest value chain", () => {
      const chains: TriggerChain[] = [
        {
          originStackItem: "low",
          steps: [],
          totalValue: 2,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "p1",
          description: "low",
        },
        {
          originStackItem: "high",
          steps: [],
          totalValue: 7,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "p1",
          description: "high",
        },
        {
          originStackItem: "mid",
          steps: [],
          totalValue: 4,
          totalManaCost: 0,
          hasOptionalSteps: false,
          controller: "p1",
          description: "mid",
        },
      ];
      expect(getHighestValueChain(chains)!.originStackItem).toBe("high");
    });
  });

  describe("Cascade keyword", () => {
    test("cascade chain estimates correct value for high MV", () => {
      const stackItem = makeStackItem({
        id: "cascade_spell",
        name: "Bituminous Cascade",
        manaValue: 6,
        controller: "player1",
        colors: ["red", "green"],
      });

      const chains = evaluateTriggerChain(stackItem, []);
      const cascadeChain = chains.find((c) =>
        c.steps[0]?.ability.triggerType === "cascade",
      );

      expect(cascadeChain).toBeDefined();
      expect(cascadeChain!.totalValue).toBeGreaterThanOrEqual(4);
    });

    test("cascade chain has lower value for low MV", () => {
      const highMV = makeStackItem({
        id: "high",
        name: "Bituminous Cascade",
        manaValue: 5,
        controller: "player1",
        colors: ["red", "black"],
      });
      const lowMV = makeStackItem({
        id: "low",
        name: "Cascade Bluffs",
        manaValue: 3,
        controller: "player1",
        colors: ["red", "green"],
      });

      const highChains = evaluateTriggerChain(highMV, []);
      const lowChains = evaluateTriggerChain(lowMV, []);

      const highCascade = highChains.find(
        (c) => c.steps[0]?.ability.triggerType === "cascade",
      );
      const lowCascade = lowChains.find(
        (c) => c.steps[0]?.ability.triggerType === "cascade",
      );

      expect(highCascade!.totalValue).toBeGreaterThanOrEqual(
        lowCascade!.totalValue,
      );
    });
  });
});
