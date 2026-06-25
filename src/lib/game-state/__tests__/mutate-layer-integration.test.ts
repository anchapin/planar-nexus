/**
 * Integration Tests: Mutate × Layer System Interactions
 *
 * Verifies that the mutate mechanic (CR 702.140) interacts correctly with the
 * continuous-effects layer system (CR 613). These tests bridge the mutate module
 * (src/lib/game-state/mutate.ts) and the layer system
 * (src/lib/game-state/layer-system.ts), which the unit-test suites cover only in
 * isolation.
 *
 * Acceptance criteria (Issue #1011):
 *   1. Mutated creature with +1/+1 effect applies correctly with other PT
 *      modifiers in layers.
 *   2. Mutated creature correctly combines keywords from component cards.
 *   3. Mutate trigger fires correctly when merging onto an existing creature.
 *
 * Layer 7 sublayer order (CR 613.8):
 *   7a (CDA) → 7b (set P/T) → 7c (counters) → 7d (switch) → 7e (modify)
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fc from "fast-check";

import {
  LayerSystem,
  PowerToughnessSublayer,
  createMutateCopyEffect,
  createPowerToughnessSetEffect,
  createPowerToughnessModifyEffect,
  createPowerModifyEffect,
  createToughnessModifyEffect,
  createPowerToughnessSwitchEffect,
  createCharacteristicDefiningAbility,
  createAbilityGrantEffect,
  createAbilityRemoveEffect,
  getEffectivePower,
  getEffectiveToughness,
  getSublayerDependencies,
} from "../layer-system";
import {
  applyMutate,
  splitMutateStack,
  getMutatedCreatureText,
  getMutatedStack,
  getMutatedCreatureTopCard,
} from "../mutate";
import { createCardInstance } from "../card-instance";
import { createInitialGameState, startGame } from "../game-state";
import type { ScryfallCard } from "@/app/actions";
import type { GameState } from "../types";

// ---------------------------------------------------------------------------
// Card factories
// ---------------------------------------------------------------------------

let nameSeq = 0;

/** A creature with the Mutate keyword (CR 702.140). */
function createMutateCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  oracleText = "",
): ScryfallCard {
  nameSeq += 1;
  return {
    id: `mutate-${name.toLowerCase().replace(/\s+/g, "-")}-${nameSeq}`,
    name,
    type_line: "Creature — Elemental",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: ["Mutate", ...keywords],
    oracle_text: oracleText || `Mutate {2}{U}.`,
    mana_cost: "{2}{U}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

/** A plain target creature (no mutate). */
function createTargetCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  oracleText = "",
  cmc = 3,
): ScryfallCard {
  nameSeq += 1;
  return {
    id: `target-${name.toLowerCase().replace(/\s+/g, "-")}-${nameSeq}`,
    name,
    type_line: "Creature — Beast",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: oracleText,
    mana_cost: "{2}{G}",
    cmc,
    colors: ["G"],
    color_identity: ["G"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

/** Shorthand to make + register a card instance with a fresh layer system. */
function makeCreature(
  ls: LayerSystem,
  data: ScryfallCard,
  controller = "player1",
): ReturnType<typeof createCardInstance> {
  const card = createCardInstance(data, controller, controller);
  ls.registerCardInstance(card);
  return card;
}

/**
 * Set up a fully merged mutate stack inside a LayerSystem.
 * Returns the (mutate) card whose effective characteristics represent the
 * merged permanent, plus the target it merged onto.
 *
 * Both cards are marked `isMutated`, mirroring the post-`applyMutate` state
 * (mutate.ts sets this flag on the base creature and the merged component),
 * so the layer system's mutate-copy text-merge path (CR 702.140) is exercised.
 */
function setupMergedStack(
  ls: LayerSystem,
  mutateData: ScryfallCard,
  targetData: ScryfallCard,
): { mutate: ReturnType<typeof createCardInstance>; target: ReturnType<typeof createCardInstance> } {
  const target = makeCreature(ls, targetData);
  const mutate = makeCreature(ls, mutateData);

  // Reflect the merged state that applyMutate would produce (mutate.ts:117-126).
  target.isMutated = true;
  ls.unregisterCardInstance(target.id);
  ls.registerCardInstance(target);

  const effect = createMutateCopyEffect(
    mutate.id,
    "player1",
    target.id,
    "Mutate merge",
    ls,
  );
  ls.registerEffect(effect);
  // Prime the overrides so subsequent reads resolve the copy chain.
  ls.applyEffects(mutate);
  return { mutate, target };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Mutate × Layer System Integration (CR 702.140 × CR 613) — Issue #1011", () => {
  let layerSystem: LayerSystem;

  beforeEach(() => {
    layerSystem = new LayerSystem();
  });

  afterEach(() => {
    layerSystem.clear();
  });

  // =========================================================================
  // Criterion 1: PT modifications from mutate ordered with other layer effects
  // =========================================================================
  describe("Power/toughness modifications ordered with other layer effects", () => {
    it("uses the target's base P/T for the merged creature (CR 702.140)", () => {
      const { mutate, target } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      // The mutate card copies the target's copiable P/T.
      expect(chars.power).toBe(6);
      expect(chars.toughness).toBe(6);
      // Name comes from the (copied) target.
      expect(chars.name).toBe("Grizzly Bears");
      expect(target.id).toBeDefined();
    });

    it("Layer 7b set effect overrides the merged base P/T (CR 613.8b)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createPowerToughnessSetEffect("src-set", "player1", 1, 1, "Become 1/1", layerSystem),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.power).toBe(1);
      expect(chars.toughness).toBe(1);
    });

    it("Layer 7e modify effect stacks on top of the merged base P/T (CR 613.8e)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createPowerToughnessModifyEffect("src-buf", "player1", 2, 2, "+2/+2"),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.power).toBe(8);
      expect(chars.toughness).toBe(8);
    });

    it("multiple modify effects accumulate on the merged creature", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createPowerToughnessModifyEffect("src-a", "player1", 1, 1, "+1/+1"),
      );
      layerSystem.registerEffect(
        createPowerModifyEffect("src-b", "player1", 3, "+3 power"),
      );
      layerSystem.registerEffect(
        createToughnessModifyEffect("src-c", "player1", -2, "-2 toughness"),
      );

      // 6 base + 1 + 3 power = 10; 6 base + 1 - 2 toughness = 5
      expect(getEffectivePower(mutate, layerSystem)).toBe(10);
      expect(getEffectiveToughness(mutate, layerSystem)).toBe(5);
    });

    it("counters (Layer 7c) apply between set (7b) and modify (7e)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );
      // Represent the merged permanent carrying two +1/+1 counters.
      const withCounters = {
        ...mutate,
        counters: [
          { type: "+1/+1", count: 2 },
        ],
      };
      layerSystem.unregisterCardInstance(mutate.id);
      layerSystem.registerCardInstance(withCounters);

      layerSystem.registerEffect(
        createPowerToughnessSetEffect("src-set", "player1", 1, 1, "Set 1/1", layerSystem),
      );
      layerSystem.registerEffect(
        createPowerToughnessModifyEffect("src-buf", "player1", 3, 3, "+3/+3"),
      );

      // set(1) → +counters(2) → +modify(3) = 6/6
      const chars = layerSystem.getEffectiveCharacteristics(withCounters);
      expect(chars.power).toBe(6);
      expect(chars.toughness).toBe(6);
    });

    it("Layer 7d switch applies after counters but before modify (CR 613.8d)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        // Asymmetric base so a switch is observable.
        createTargetCreature("Lopsided Beast", 2, 6),
      );

      layerSystem.registerEffect(
        createPowerToughnessSwitchEffect("src-sw", "player1", "Switch P/T", layerSystem),
      );
      layerSystem.registerEffect(
        createPowerToughnessModifyEffect("src-buf", "player1", 1, 1, "+1/+1"),
      );

      // base 2/6 → switch 6/2 → modify +1/+1 = 7/3
      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.power).toBe(7);
      expect(chars.toughness).toBe(3);
    });

    it("Layer 7a CDA sets base before set/counters/modify (CR 613.8a-b)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createCharacteristicDefiningAbility(
          "src-cda",
          "player1",
          { oracleId: "cda-9-9", power: 9, toughness: 9 },
          "CDA 9/9",
          layerSystem,
        ),
      );
      // Layer 7b set overrides the CDA value.
      layerSystem.registerEffect(
        createPowerToughnessSetEffect("src-set", "player1", 2, 2, "Set 2/2", layerSystem),
      );
      layerSystem.registerEffect(
        createPowerToughnessModifyEffect("src-buf", "player1", 1, 1, "+1/+1"),
      );

      // CDA(9) is overridden by set(2), then modify(+1) = 3/3
      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.power).toBe(3);
      expect(chars.toughness).toBe(3);
    });
  });

  // =========================================================================
  // Criterion 2: Keywords / abilities combined on mutated creatures
  // =========================================================================
  describe("Keywords and abilities combined on mutated creatures", () => {
    it("merges the mutate card's oracle text with the target's text (CR 702.140)", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2, [], "Mutate ability text here."),
        createTargetCreature("Grizzly Bears", 6, 6, [], "Trample bears."),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      // The merged text should include both components.
      expect(chars.oracleText).toContain("Trample bears.");
      expect(chars.oracleText).toContain("Mutate ability text here.");
    });

    it("granted abilities (Layer 6) appear on the merged creature", () => {
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createAbilityGrantEffect("src-fly", "player1", "flying", "Grant flying", layerSystem),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.grantedAbilities).toContain("flying");
    });

    it("combines text from multiple components via mutate.ts CMC ordering", () => {
      // Use the mutate module's own text-combination logic.
      const state = createBlankStateWithCards();
      const lowCmc = createMutateCreature("Low Cmc", 1, 1, [], "Low text.");
      (lowCmc as ScryfallCard & { cmc: number }).cmc = 2;
      const highCmc = createTargetCreature("High Cmc", 5, 5, [], "High text.", 7);

      const lowCard = createCardInstance(lowCmc, "player1", "player1");
      const highCard = createCardInstance(highCmc, "player1", "player1");
      state.cards.set(lowCard.id, lowCard);
      state.cards.set(highCard.id, highCard);

      // Merge low onto high; highest-CMC component drives text priority.
      const merged = applyMutate(state, lowCard.id, highCard.id);
      const text = getMutatedCreatureText(merged.state, highCard.id);
      // Both components' text should be present, highest CMC first.
      expect(text).toContain("High text.");
      expect(text).toContain("Low text.");
      const highIdx = text.indexOf("High text.");
      const lowIdx = text.indexOf("Low text.");
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it("exposes the full mutate stack and top card (CR 702.140)", () => {
      const state = createBlankStateWithCards();
      const base = createTargetCreature("Base Beast", 3, 3, [], "", 3);
      const comp = createMutateCreature("Mutate Comp", 2, 2, [], "");

      const baseCard = createCardInstance(base, "player1", "player1");
      const compCard = createCardInstance(comp, "player1", "player1");
      state.cards.set(baseCard.id, baseCard);
      state.cards.set(compCard.id, compCard);

      const merged = applyMutate(state, compCard.id, baseCard.id);

      const stack = getMutatedStack(merged.state, baseCard.id);
      expect(stack).toHaveLength(2);
      expect(stack[0].id).toBe(baseCard.id);
      expect(stack[1].id).toBe(compCard.id);

      const top = getMutatedCreatureTopCard(merged.state, baseCard.id);
      expect(top?.id).toBe(compCard.id);
    });

    it("Layer 6 grant and remove effects both register on the merged creature", () => {
      // The layer system tracks granted and removed abilities as separate
      // override lists (CR 613.7); it does not net them together, which lets
      // later resolution decide precedence. Verify both apply to a merged
      // permanent.
      const { mutate } = setupMergedStack(
        layerSystem,
        createMutateCreature("Auspex", 2, 2),
        createTargetCreature("Grizzly Bears", 6, 6),
      );

      layerSystem.registerEffect(
        createAbilityGrantEffect("src-fly", "player1", "flying", "Grant flying", layerSystem),
      );
      layerSystem.registerEffect(
        createAbilityRemoveEffect("src-rm", "player1", "vigilance", "Lose vigilance", false, layerSystem),
      );

      const chars = layerSystem.getEffectiveCharacteristics(mutate);
      expect(chars.grantedAbilities).toContain("flying");
      expect(chars.removedAbilities).toContain("vigilance");
    });
  });

  // =========================================================================
  // Criterion 3: Mutate trigger / merge correctness
  // =========================================================================
  describe("Mutate merge correctness", () => {
    it("mutate onto a non-creature marks the result as non-creature", () => {
      const enchantData: ScryfallCard = {
        id: "mock-enchant-target",
        name: "Target Enchantment",
        type_line: "Enchantment",
        oracle_text: "Do a thing.",
        mana_cost: "{1}",
        cmc: 1,
        colors: [],
        color_identity: [],
        legalities: {},
      } as ScryfallCard;

      const target = makeCreature(layerSystem, enchantData);
      const mutate = makeCreature(layerSystem, createMutateCreature("Auspex", 3, 3));

      layerSystem.registerEffect(
        createMutateCopyEffect(mutate.id, "player1", target.id, "Mutate onto enchantment", layerSystem),
      );
      layerSystem.applyEffects(mutate);

      const overrides = layerSystem.getOverrides(mutate.id);
      expect(overrides.isMutateCopy).toBe(true);
      expect(overrides.mutateResultIsCreature).toBe(false);
    });

    it("applyMutate records the merge relationship and highest-CMC component", () => {
      const state = createBlankStateWithCards();
      const base = createTargetCreature("Base Beast", 2, 2, [], "", 3);
      const comp = createMutateCreature("Mutate Comp", 3, 3, [], "");

      const baseCard = createCardInstance(base, "player1", "player1");
      const compCard = createCardInstance(comp, "player1", "player1");
      state.cards.set(baseCard.id, baseCard);
      state.cards.set(compCard.id, compCard);

      const result = applyMutate(state, compCard.id, baseCard.id);
      expect(result.success).toBe(true);

      const mergedBase = result.state.cards.get(baseCard.id);
      // Trigger/merge: the component is recorded on the base and the merge flag set.
      expect(mergedBase?.mutatedCardIds).toContain(compCard.id);
      expect(mergedBase?.isMutated).toBe(true);
      // Higher-CMC component (comp, cmc 4) wins.
      expect(mergedBase?.highestCmcComponentId).toBe(compCard.id);
    });

    it("splitting a merge restores the component to an independent card", () => {
      const state = createBlankStateWithCards();
      const base = createTargetCreature("Base Beast", 2, 2);
      const comp = createMutateCreature("Mutate Comp", 3, 3);

      const baseCard = createCardInstance(base, "player1", "player1");
      const compCard = createCardInstance(comp, "player1", "player1");
      state.cards.set(baseCard.id, baseCard);
      state.cards.set(compCard.id, compCard);

      const merged = applyMutate(state, compCard.id, baseCard.id);
      const split = splitMutateStack(merged.state, baseCard.id);

      expect(split.state.cards.get(compCard.id)?.mutateBaseId).toBeNull();
      expect(split.state.cards.get(baseCard.id)?.mutatedCardIds).toEqual([]);
    });
  });

  // =========================================================================
  // Property-based: Layer 7 ordering invariant for mutated creatures
  // =========================================================================
  describe("Property-based layer ordering (fast-check)", () => {
    it("Layer 7 set (7b) always overrides base before modify (7e), regardless of registration order", () => {
      fc.assert(
        fc.property(
          fc.record({
            basePower: fc.integer({ min: 1, max: 10 }),
            baseToughness: fc.integer({ min: 1, max: 10 }),
            setPower: fc.integer({ min: 0, max: 10 }),
            setToughness: fc.integer({ min: 0, max: 10 }),
            modifyPower: fc.integer({ min: -5, max: 5 }),
            modifyToughness: fc.integer({ min: -5, max: 5 }),
            registerSetFirst: fc.boolean(),
          }),
          (p) => {
            const ls = new LayerSystem();
            try {
              const { mutate } = setupMergedStack(
                ls,
                createMutateCreature("M", 1, 1),
                createTargetCreature("T", p.basePower, p.baseToughness),
              );

              const setEffect = createPowerToughnessSetEffect(
                "src-set",
                "player1",
                p.setPower,
                p.setToughness,
                "Set",
                ls,
              );
              const modifyEffect = createPowerToughnessModifyEffect(
                "src-mod",
                "player1",
                p.modifyPower,
                p.modifyToughness,
                "Modify",
              );

              if (p.registerSetFirst) {
                ls.registerEffect(setEffect);
                ls.registerEffect(modifyEffect);
              } else {
                ls.registerEffect(modifyEffect);
                ls.registerEffect(setEffect);
              }

              const chars = ls.getEffectiveCharacteristics(mutate);
              // set overrides base; modify adds on top — order-independent.
              expect(chars.power).toBe(p.setPower + p.modifyPower);
              expect(chars.toughness).toBe(p.setToughness + p.modifyToughness);
            } finally {
              ls.clear();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("Layer 7 sublayer dependency graph is a strict total order 7a→7b→7c→7d→7e", () => {
      const order = [
        PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
        PowerToughnessSublayer.SET,
        PowerToughnessSublayer.COUNTERS,
        PowerToughnessSublayer.SWITCH,
        PowerToughnessSublayer.MODIFY,
      ];
      // Each earlier sublayer must depend on every later one (CR 613.8).
      for (let i = 0; i < order.length; i++) {
        const deps = getSublayerDependencies(order[i]);
        expect(deps).toEqual(order.slice(i + 1));
      }
    });

    it("arbitrary modify deltas accumulate identically regardless of registration order", () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: -4, max: 4 }), { minLength: 1, maxLength: 6 }),
          (deltas) => {
            const base = 6;
            const expected = base + deltas.reduce((a, b) => a + b, 0);

            const lsA = new LayerSystem();
            const lsB = new LayerSystem();
            try {
              const a = setupMergedStack(
                lsA,
                createMutateCreature("M", 1, 1),
                createTargetCreature("T", base, base),
              );
              const b = setupMergedStack(
                lsB,
                createMutateCreature("M", 1, 1),
                createTargetCreature("T", base, base),
              );

              deltas.forEach((d, i) => {
                lsA.registerEffect(
                  createPowerToughnessModifyEffect(`m-${i}`, "player1", d, d, "mod"),
                );
              });
              // Reverse registration order.
              [...deltas].reverse().forEach((d, i) => {
                lsB.registerEffect(
                  createPowerToughnessModifyEffect(`m-${i}`, "player1", d, d, "mod"),
                );
              });

              expect(getEffectivePower(a.mutate, lsA)).toBe(expected);
              expect(getEffectivePower(b.mutate, lsB)).toBe(expected);
            } finally {
              lsA.clear();
              lsB.clear();
            }
          },
        ),
        { numRuns: 80 },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Minimal GameState helper for mutate.ts-level tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal GameState so that the mutate module (which operates on
 * GameState.cards maps) can be exercised without spinning up a full game.
 */
function createBlankStateWithCards(): GameState {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  return state;
}
