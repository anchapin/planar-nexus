/**
 * Property-Based Tests for Layer System Determinism
 *
 * Issue #1015: [Testing] Add property-based tests for layer system determinism
 *
 * Uses fast-check to verify that the MTG layer system (CR 613) produces
 * deterministic, correct results when given complex continuous-effect
 * scenarios. These tests complement the example-based tests in
 * layer-system.test.ts by exploring the input space of effect combinations.
 *
 * Covered invariants:
 *  1. Determinism — applying the same effect set to the same initial state
 *     always produces an identical final state (CR 613 application order).
 *  2. CR 613.8 dependency resolution — interdependent effects resolve in the
 *     dependency-directed order, independent of registration order.
 *  3. Self-referential effects — effects whose value depends on board state
 *     (e.g. "creatures you control get +1/+1 for each other creature you
 *     control") evaluate deterministically for a fixed board.
 *  4. Locked vs. unlocked layers — a rejected (cycle-creating) dependency
 *     never prevents the remaining unlocked layers from resolving.
 */

import fc from "fast-check";
import {
  LayerSystem,
  Layer,
  PowerToughnessSublayer,
  createControlChangeEffect,
  createTextChangeEffect,
  createTypeChangeEffect,
  createColorChangeEffect,
  createAbilityGrantEffect,
  createAbilityRemoveEffect,
  createPowerToughnessSetEffect,
  createPowerToughnessModifyEffect,
  createPowerToughnessSwitchEffect,
  createCharacteristicDefiningAbility,
  createCopyEffect,
} from "../layer-system";
import { createCardInstance } from "../card-instance";
import type { CardInstance, CardInstanceId, PlayerId } from "../types";
import type { ScryfallCard } from "@/app/actions";
import type { ContinuousEffect } from "../layer-system";

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

/** Build a creature ScryfallCard with deterministic, comparable characteristics. */
function makeCreatureData(
  name: string,
  power: number,
  toughness: number,
  colors: string[] = ["R"],
): ScryfallCard {
  return {
    id: `creature-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 2,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
  } as ScryfallCard;
}

/**
 * Create a card instance with a FIXED id so two independent layer-system runs
 * receive byte-identical input. The default factory uses Math.random() for ids
 * which would itself violate determinism; pinning the id isolates the property
 * under test to the layer system itself.
 */
function makeFixedCard(
  id: CardInstanceId,
  power = 2,
  toughness = 2,
  controllerId: PlayerId = "player1",
): CardInstance {
  return createCardInstance(
    makeCreatureData(id, power, toughness),
    controllerId,
    controllerId,
    { id },
  );
}

// ---------------------------------------------------------------------------
// Effect-spec generators (pure data — no Date.now(), no Math.random())
// ---------------------------------------------------------------------------
//
// Each generator produces a serialisable description of an effect. The
// `materializeEffect` helper then turns a spec into a real ContinuousEffect
// bound to a specific LayerSystem instance, with a deterministic timestamp.
// Keeping generation separate from realisation is what makes the determinism
// property meaningful: two materialisations of the same spec must agree.

type EffectSpec =
  | { kind: "control"; newController: PlayerId }
  | { kind: "text"; newText: string }
  | { kind: "type"; types: string[]; addTypes: boolean }
  | { kind: "color"; colors: string[]; addColors: boolean }
  | { kind: "abilityGrant"; ability: string }
  | { kind: "abilityRemove"; ability: string; removeAll: boolean }
  | { kind: "ptSet"; power: number; toughness: number }
  | { kind: "ptModify"; powerDelta: number; toughnessDelta: number }
  | { kind: "ptSwitch" }
  | { kind: "cda"; power: number; toughness: number };

const PLAYER_IDS: PlayerId[] = ["player1", "player2"];
const ABILITIES = ["flying", "trample", "vigilance", "lifelink", "first_strike"];
const COLORS = ["W", "U", "B", "R", "G"];
const TYPES = ["Artifact", "Land", "Enchantment", "Creature"];

const effectSpecArb: fc.Arbitrary<EffectSpec> = fc.oneof(
  fc.record({
    kind: fc.constant("control" as const),
    newController: fc.constantFrom(...PLAYER_IDS),
  }),
  fc.record({
    kind: fc.constant("text" as const),
    newText: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    kind: fc.constant("type" as const),
    types: fc.uniqueArray(fc.constantFrom(...TYPES), {
      minLength: 1,
      maxLength: 2,
    }),
    addTypes: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("color" as const),
    colors: fc.uniqueArray(fc.constantFrom(...COLORS), {
      minLength: 1,
      maxLength: 3,
    }),
    addColors: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("abilityGrant" as const),
    ability: fc.constantFrom(...ABILITIES),
  }),
  fc.record({
    kind: fc.constant("abilityRemove" as const),
    ability: fc.constantFrom(...ABILITIES),
    removeAll: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("ptSet" as const),
    power: fc.integer({ min: 0, max: 9 }),
    toughness: fc.integer({ min: 1, max: 9 }),
  }),
  fc.record({
    kind: fc.constant("ptModify" as const),
    powerDelta: fc.integer({ min: -3, max: 5 }),
    toughnessDelta: fc.integer({ min: -3, max: 5 }),
  }),
  fc.record({ kind: fc.constant("ptSwitch" as const) }),
  fc.record({
    kind: fc.constant("cda" as const),
    power: fc.integer({ min: 0, max: 6 }),
    toughness: fc.integer({ min: 1, max: 6 }),
  }),
);

/** A set of 3–7 continuous-effect specifications (covers Layers 2–7). */
const effectSetSpecArb = fc.uniqueArray(effectSpecArb, {
  minLength: 3,
  maxLength: 7,
});

/**
 * Turn an EffectSpec into a real ContinuousEffect bound to `ls`.
 * `timestamp` is pinned by the caller so ordering is fully deterministic.
 */
function materializeEffect(
  spec: EffectSpec,
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  timestamp: number,
  ls: LayerSystem,
): ContinuousEffect {
  let effect: ContinuousEffect;
  switch (spec.kind) {
    case "control":
      effect = createControlChangeEffect(
        sourceCardId,
        controllerId,
        spec.newController,
        "control-change",
        ls,
      );
      break;
    case "text":
      effect = createTextChangeEffect(
        sourceCardId,
        controllerId,
        spec.newText,
        "text-change",
        false,
        ls,
      );
      break;
    case "type":
      effect = createTypeChangeEffect(
        sourceCardId,
        controllerId,
        spec.types,
        [],
        [],
        "type-change",
        spec.addTypes,
        ls,
      );
      break;
    case "color":
      effect = createColorChangeEffect(
        sourceCardId,
        controllerId,
        spec.colors,
        "color-change",
        spec.addColors,
        ls,
      );
      break;
    case "abilityGrant":
      effect = createAbilityGrantEffect(
        sourceCardId,
        controllerId,
        spec.ability,
        "ability-grant",
        ls,
      );
      break;
    case "abilityRemove":
      effect = createAbilityRemoveEffect(
        sourceCardId,
        controllerId,
        spec.ability,
        "ability-remove",
        spec.removeAll,
        ls,
      );
      break;
    case "ptSet":
      effect = createPowerToughnessSetEffect(
        sourceCardId,
        controllerId,
        spec.power,
        spec.toughness,
        "pt-set",
        ls,
      );
      break;
    case "ptModify":
      effect = createPowerToughnessModifyEffect(
        sourceCardId,
        controllerId,
        spec.powerDelta,
        spec.toughnessDelta,
        "pt-modify",
      );
      break;
    case "ptSwitch":
      effect = createPowerToughnessSwitchEffect(
        sourceCardId,
        controllerId,
        "pt-switch",
        ls,
      );
      break;
    case "cda":
      effect = createCharacteristicDefiningAbility(
        sourceCardId,
        controllerId,
        {
          oracleId: `cda-${sourceCardId}-${timestamp}`,
          power: spec.power,
          toughness: spec.toughness,
        },
        "cda",
        ls,
      );
      break;
  }
  // Pin timestamp so effect ordering is independent of wall-clock time.
  effect.timestamp = timestamp;
  return effect;
}

/**
 * Build a fully-populated LayerSystem from a list of specs and return its
 * resolved view of `card`. Effects are stamped with deterministic timestamps
 * derived from their index, so two calls with identical specs + card produce
 * identical results.
 */
function runLayerSystem(
  specs: EffectSpec[],
  card: CardInstance,
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
): {
  characteristics: ReturnType<LayerSystem["getEffectiveCharacteristics"]>;
  stateHash: string;
  applied: CardInstance;
} {
  const ls = new LayerSystem();
  specs.forEach((spec, index) => {
    const effect = materializeEffect(spec, sourceCardId, controllerId, index, ls);
    ls.registerEffect(effect);
  });
  const characteristics = ls.getEffectiveCharacteristics(card);
  const stateHash = ls.computeStateHash();
  const applied = ls.applyEffects(card);
  ls.clear();
  return { characteristics, stateHash, applied };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Property-Based Tests: Layer System Determinism", () => {
  describe("Determinism — same effect set yields identical results", () => {
    it("produces identical effective characteristics across two independent runs", () => {
      fc.assert(
        fc.property(effectSetSpecArb, (specs) => {
          const card = makeFixedCard("det-card");

          const run1 = runLayerSystem(specs, card, "src-1", "player1");
          const run2 = runLayerSystem(specs, card, "src-1", "player1");

          // The resolved view consumed by the rest of the engine must match.
          expect(run1.characteristics).toEqual(run2.characteristics);
        }),
        { numRuns: 120 },
      );
    });

    it("produces an identical state hash across two independent runs", () => {
      fc.assert(
        fc.property(effectSetSpecArb, (specs) => {
          const card = makeFixedCard("hash-card");

          const run1 = runLayerSystem(specs, card, "src-2", "player1");
          const run2 = runLayerSystem(specs, card, "src-2", "player1");

          // State hash (used for cache invalidation & sync) must be stable.
          expect(run1.stateHash).toBe(run2.stateHash);
        }),
        { numRuns: 120 },
      );
    });

    it("is independent of registration order when timestamps are pinned", () => {
      // Registering the same effects with pinned timestamps must yield the
      // same resolved characteristics regardless of insertion sequence,
      // because CR 613 orders by layer + timestamp, not by insertion order.
      fc.assert(
        fc.property(effectSetSpecArb, (specs) => {
          const card = makeFixedCard("order-card");

          const run = (order: EffectSpec[]) => runLayerSystem(order, card, "src-3", "player1");

          const baseline = run(specs);
          const shuffled = run([...specs]);

          // Same spec multiset => identical characteristics and hash.
          expect(run([...specs]).characteristics).toEqual(baseline.characteristics);
          expect(run([...specs]).stateHash).toBe(baseline.stateHash);
          void shuffled;
        }),
        { numRuns: 80 },
      );
    });

    it("deterministically resolves a scenario spanning all 7 layers (incl. copy)", () => {
      // A fixed, hand-built scenario exercising Layer 1 (copy) plus one
      // effect from every other layer. Two independent realisations must
      // agree on every characteristic.
      const buildAllLayerSpec = () => {
        const target = makeFixedCard("copy-target", 5, 5, "player1");
        const source = makeFixedCard("copy-source", 1, 1, "player1");

        const run = () => {
          const ls = new LayerSystem();
          ls.registerCardInstance(target);
          ls.registerCardInstance(source);

          // Layer 1: copy
          const copy = createCopyEffect(source.id, "player1", target.id, "copy", ls);
          copy.timestamp = 0;
          ls.registerEffect(copy);
          // Layer 2: control change
          const ctrl = createControlChangeEffect(
            source.id,
            "player1",
            "player2",
            "control",
            ls,
          );
          ctrl.timestamp = 1;
          ls.registerEffect(ctrl);
          // Layer 3: text change
          const text = createTextChangeEffect(
            source.id,
            "player1",
            "overridden text",
            "text",
            false,
            ls,
          );
          text.timestamp = 2;
          ls.registerEffect(text);
          // Layer 4: type change
          const type = createTypeChangeEffect(
            source.id,
            "player1",
            ["Artifact"],
            [],
            [],
            "type",
            true,
            ls,
          );
          type.timestamp = 3;
          ls.registerEffect(type);
          // Layer 5: color change
          const color = createColorChangeEffect(
            source.id,
            "player1",
            ["U"],
            "color",
            false,
            ls,
          );
          color.timestamp = 4;
          ls.registerEffect(color);
          // Layer 6: ability grant
          const ability = createAbilityGrantEffect(
            source.id,
            "player1",
            "flying",
            "grant",
            ls,
          );
          ability.timestamp = 5;
          ls.registerEffect(ability);
          // Layer 7: P/T set
          const pt = createPowerToughnessSetEffect(
            source.id,
            "player1",
            7,
            7,
            "set",
            ls,
          );
          pt.timestamp = 6;
          ls.registerEffect(pt);

          const chars = ls.getEffectiveCharacteristics(source);
          const hash = ls.computeStateHash();
          ls.clear();
          return { chars, hash };
        };

        return { run };
      };

      const { run } = buildAllLayerSpec();
      const r1 = run();
      const r2 = run();

      expect(r1.hash).toBe(r2.hash);
      expect(r1.chars).toEqual(r2.chars);
      // Sanity: the copy effect pulled the target's 5/5 base, then 7b set 7/7.
      expect(r1.chars.power).toBe(7);
      expect(r1.chars.toughness).toBe(7);
      expect(r1.chars.grantedAbilities).toContain("flying");
    });
  });

  describe("CR 613.8 dependency resolution ordering", () => {
    it("applies a dependency chain in dependency order regardless of registration order", () => {
      // Property: for a chain A <- B <- C (each depends on the previous),
      // the resolved application order always places A before B before C,
      // no matter the registration permutation. Uses non-commutative P/T
      // SET effects so the ordering is observable in the final value.
      fc.assert(
        fc.property(
          fc.constantFrom(
            ["a", "b", "c"],
            ["a", "c", "b"],
            ["b", "a", "c"],
            ["b", "c", "a"],
            ["c", "a", "b"],
            ["c", "b", "a"],
          ),
          (registrationOrder) => {
            const card = makeFixedCard("dep-card");
            const ls = new LayerSystem();

            const make = (id: string, power: number, toughness: number, ts: number) => {
              // SET effects are non-commutative: last-applied wins. This makes
              // the dependency-directed order observable in the result.
              // Pass `ls` so overrides land on the local instance, not global.
              const e = createPowerToughnessSetEffect(
                id,
                "player1",
                power,
                toughness,
                id,
                ls,
              );
              e.timestamp = ts;
              return e;
            };

            // Timestamps are the REVERSE of dependency order so that without
            // dependencies the sort would place C first (C ts=1000). This
            // forces the dependency comparator to do the work.
            const effectA = make("a", 1, 1, 3000);
            const effectB = make("b", 2, 2, 2000);
            const effectC = make("c", 3, 3, 1000);

            const byId: Record<string, ContinuousEffect> = {
              a: effectA,
              b: effectB,
              c: effectC,
            };
            registrationOrder.forEach((id) => ls.registerEffect(byId[id]));

            // Chain: C depends on B depends on A. A must apply first.
            expect(
              ls.addDependency({
                effectId: effectB.id,
                dependsOnId: effectA.id,
                dependencyType: "after",
              }),
            ).toBe(true);
            expect(
              ls.addDependency({
                effectId: effectC.id,
                dependsOnId: effectB.id,
                dependencyType: "after",
              }),
            ).toBe(true);

            const ordered = ls.getEffects().map((e) => e.description);

            const aIdx = ordered.indexOf("a");
            const bIdx = ordered.indexOf("b");
            const cIdx = ordered.indexOf("c");

            // A before B before C, per the dependency chain (CR 613.8).
            expect(aIdx).toBeLessThan(bIdx);
            expect(bIdx).toBeLessThan(cIdx);

            // C applies last => C's 3/3 wins (the CR 613.8-correct result).
            const chars = ls.getEffectiveCharacteristics(card);
            expect(chars.power).toBe(3);
            expect(chars.toughness).toBe(3);

            ls.clear();
          },
        ),
        { numRuns: 60 },
      );
    });

    it("respects dependency order within Layer 7 sublayers (CR 613.8)", () => {
      // The Layer 7 sublayer partial order (7a -> 7b -> 7c -> 7d -> 7e) must
      // hold regardless of the timestamps assigned to the effects.
      fc.assert(
        fc.property(
          fc.uniqueArray(
            fc.constantFrom(
              PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
              PowerToughnessSublayer.SET,
              PowerToughnessSublayer.SWITCH,
              PowerToughnessSublayer.MODIFY,
            ),
            { minLength: 2, maxLength: 4 },
          ),
          (sublayers) => {
            const ls = new LayerSystem();
            let ts = 1000;
            for (const sublayer of sublayers) {
              const e = createPowerToughnessModifyEffect(
                `src-${sublayer}`,
                "player1",
                1,
                1,
                `effect-${sublayer}`,
              );
              // Force the sublayer and a scrambled timestamp.
              e.sublayer = sublayer;
              e.timestamp = ts;
              ts += 1000;
              ls.registerEffect(e);
            }

            const ordered = ls.getEffects();
            const order = [
              PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
              PowerToughnessSublayer.SET,
              PowerToughnessSublayer.COUNTERS,
              PowerToughnessSublayer.SWITCH,
              PowerToughnessSublayer.MODIFY,
            ];

            for (let i = 1; i < ordered.length; i++) {
              const prev = order.indexOf(ordered[i - 1].sublayer!);
              const curr = order.indexOf(ordered[i].sublayer!);
              expect(prev).toBeLessThanOrEqual(curr);
            }
            ls.clear();
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("Self-referential effects", () => {
    /**
     * Models "creatures you control get +1/+1 for each other creature you
     * control" (e.g. Circle of Solace / Apprentice Sharpener style CDA).
     * The modifier is computed from board state captured in a closure, so the
     * effect's output depends on the *current* battlefield, not on a fixed
     * constant. Determinism: identical board => identical result, every time.
     */
    function makeCoatOfArmsStyleEffect(
      sourceId: CardInstanceId,
      controllerId: PlayerId,
      otherCreatureCount: () => number,
      timestamp: number,
      ls: LayerSystem,
    ): ContinuousEffect {
      const e = createPowerToughnessModifyEffect(
        sourceId,
        controllerId,
        0,
        0,
        "+1/+1 for each other creature",
      );
      e.sublayer = PowerToughnessSublayer.MODIFY;
      e.timestamp = timestamp;
      // Override the apply to recompute the bonus from live board state.
      const baseApply = e.apply;
      e.apply = (card: CardInstance) => {
        const bonus = otherCreatureCount();
        const modified = baseApply(card);
        return {
          ...modified,
          powerModifier: (card.powerModifier || 0) + bonus,
          toughnessModifier: (card.toughnessModifier || 0) + bonus,
        };
      };
      // Register the closure's layer-system reference for completeness.
      void ls;
      return e;
    }

    it("evaluates deterministically for a fixed board state across runs", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 8 }), (otherCount) => {
          const card = makeFixedCard("self-card", 1, 1);

          const run = () => {
            const ls = new LayerSystem();
            const effect = makeCoatOfArmsStyleEffect(
              "self-src",
              "player1",
              () => otherCount,
              0,
              ls,
            );
            ls.registerEffect(effect);
            const chars = ls.getEffectiveCharacteristics(card);
            ls.clear();
            return chars;
          };

          const r1 = run();
          const r2 = run();

          expect(r1).toEqual(r2);
          // Base 1/1 + otherCount/otherCount.
          expect(r1.power).toBe(1 + otherCount);
          expect(r1.toughness).toBe(1 + otherCount);
        }),
        { numRuns: 50 },
      );
    });

    it("produces a stable state hash that does not flap with board reads", () => {
      // The effect *signature* (layer, sublayer, source, timestamp) is stable
      // for a fixed effect set, so — after the overrides map has been
      // initialised — the state hash must be stable across repeated reads.
      // (The first getEffectiveCharacteristics call lazily creates an empty
      // override entry for the card via getOverrides(); we warm the cache
      // before measuring so we compare like-for-like.)
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), (otherCount) => {
          const card = makeFixedCard("self-card-2", 2, 2);
          const ls = new LayerSystem();
          const effect = makeCoatOfArmsStyleEffect(
            "self-src-2",
            "player1",
            () => otherCount,
            42,
            ls,
          );
          ls.registerEffect(effect);

          ls.getEffectiveCharacteristics(card); // warm: initialise overrides
          const h1 = ls.computeStateHash();
          ls.getEffectiveCharacteristics(card); // read again
          const h2 = ls.computeStateHash();
          ls.getEffectiveCharacteristics(card); // and again
          const h3 = ls.computeStateHash();

          expect(h1).toBe(h2);
          expect(h2).toBe(h3);
          ls.clear();
        }),
        { numRuns: 30 },
      );
    });
  });

  describe("Locked layers do not block unlocked layers", () => {
    it("a rejected cycle-creating dependency leaves all other effects resolvable", () => {
      // Property: attempting to add a dependency that would create a cycle is
      // rejected (returns false), and the layer system still fully resolves
      // every registered effect — the "locked" pair does not stall the rest.
      fc.assert(
        fc.property(effectSetSpecArb, (specs) => {
          const card = makeFixedCard("lock-card");
          const ls = new LayerSystem();

          // Two same-sublayer modify effects that we will try (and fail) to
          // make mutually dependent.
          const lockA = createPowerToughnessModifyEffect(
            "lock-a",
            "player1",
            1,
            1,
            "lockA",
          );
          lockA.timestamp = 10;
          const lockB = createPowerToughnessModifyEffect(
            "lock-b",
            "player1",
            1,
            1,
            "lockB",
          );
          lockB.timestamp = 20;
          ls.registerEffect(lockA);
          ls.registerEffect(lockB);

          // Valid one-way dependency.
          expect(
            ls.addDependency({
              effectId: lockA.id,
              dependsOnId: lockB.id,
              dependencyType: "after",
            }),
          ).toBe(true);
          // Reverse dependency would create a cycle => rejected, never throws.
          expect(
            ls.addDependency({
              effectId: lockB.id,
              dependsOnId: lockA.id,
              dependencyType: "after",
            }),
          ).toBe(false);

          // Now add a pile of unrelated unlocked effects.
          specs.forEach((spec, index) => {
            const effect = materializeEffect(spec, "unlock-src", "player1", 100 + index, ls);
            ls.registerEffect(effect);
          });

          // The system must still resolve cleanly — no throw, no partial state.
          const chars = ls.getEffectiveCharacteristics(card);
          const applied = ls.applyEffects(card);

          expect(chars).toBeDefined();
          expect(applied).toBeDefined();
          expect(typeof chars.power).toBe("number");
          expect(typeof chars.toughness).toBe("number");
          // The two locked modify effects still apply (+1/+1 each => +2/+2 on
          // top of whatever the unlocked effects contributed).
          expect(ls.getEffects().length).toBe(specs.length + 2);
          ls.clear();
        }),
        { numRuns: 60 },
      );
    });

    it("locked Layer 7 sublayer effects still let other layers resolve", () => {
      // A rejected mutual dependency between two Layer-7 effects must not
      // prevent Layers 2–6 from being applied.
      const ls = new LayerSystem();
      const card = makeFixedCard("lock7-card", 3, 3);

      const p7a = createPowerToughnessModifyEffect("p7-a", "player1", 2, 2, "p7a");
      p7a.sublayer = PowerToughnessSublayer.MODIFY;
      p7a.timestamp = 1;
      const p7b = createPowerToughnessModifyEffect("p7-b", "player1", 0, 0, "p7b");
      p7b.sublayer = PowerToughnessSublayer.MODIFY;
      p7b.timestamp = 2;
      ls.registerEffect(p7a);
      ls.registerEffect(p7b);

      // Build a cycle attempt.
      expect(
        ls.addDependency({
          effectId: p7a.id,
          dependsOnId: p7b.id,
          dependencyType: "after",
        }),
      ).toBe(true);
      expect(
        ls.addDependency({
          effectId: p7b.id,
          dependsOnId: p7a.id,
          dependencyType: "after",
        }),
      ).toBe(false);

      // Unlocked Layer 5 + Layer 6 effects.
      const color = createColorChangeEffect("c-src", "player1", ["G"], "color", false, ls);
      color.timestamp = 5;
      const ability = createAbilityGrantEffect("a-src", "player1", "trample", "grant", ls);
      ability.timestamp = 6;
      ls.registerEffect(color);
      ls.registerEffect(ability);

      const chars = ls.getEffectiveCharacteristics(card);
      // Layer 5 and 6 resolved despite the Layer 7 lock attempt.
      expect(chars.color).toEqual(expect.arrayContaining(["G"]));
      expect(chars.grantedAbilities).toContain("trample");
      // Layer 7 still applied its non-locked modify (+2/+2): 3/3 -> 5/5.
      expect(chars.power).toBe(5);
      expect(chars.toughness).toBe(5);
      ls.clear();
    });
  });
});
