/**
 * Property-Based Tests for Replacement & Prevention Effects (CR 614-616)
 *
 * Uses fast-check to verify that the replacement effect pipeline is
 * deterministic and that prevention/regeneration shields are consumed
 * exactly once. Addresses issue #1018.
 *
 * Acceptance criteria covered:
 *  - Regeneration (prevention) shield is consumed exactly once per event
 *  - Damage is always reduced by prevention effects before being applied
 *  - Identical replacement scenarios produce identical final states (100+ runs)
 *  - Prevention effects are isolated per target
 *  - Scenarios with 2-4 simultaneous replacement effects are generated
 */

import fc from "fast-check";
import {
  ReplacementEffectManager,
  type ReplacementAbility,
  type ReplacementEvent,
  type APNAPOrder,
} from "../replacement-effects";

// ---------------------------------------------------------------------------
// Deterministic state hashing
// ---------------------------------------------------------------------------

/**
 * Produce a stable string fingerprint of a resolved event so that two
 * resolutions can be compared across manager instances / repeated runs.
 * Only the semantically meaningful fields are included (the `timestamp`
 * field is intentionally excluded because it is event-creation metadata,
 * not part of the replacement outcome).
 */
function hashEvent(event: ReplacementEvent): string {
  const damageTypes = (event.damageTypes ?? []).slice().sort().join(",");
  const parts = [
    `type=${event.type}`,
    `amount=${event.amount}`,
    event.sourceId !== undefined ? `src=${event.sourceId}` : "",
    event.targetId !== undefined ? `tgt=${event.targetId}` : "",
    event.isCombatDamage ? "combat=1" : "combat=0",
    event.hasLifelink ? "lifelink=1" : "lifelink=0",
    event.hasDeathtouch ? "deathtouch=1" : "deathtouch=0",
    `dt=[${damageTypes}]`,
  ];
  return parts.filter(Boolean).join("|");
}

// ---------------------------------------------------------------------------
// Effect-spec model + fast-check generators
// ---------------------------------------------------------------------------

type EffectSpec =
  | { kind: "double" }
  | { kind: "halve" }
  | { kind: "add"; n: number }
  | { kind: "prevent"; n: number };

/**
 * Generator for a single replacement/prevention effect spec. All operations
 * preserve non-negative integer amounts so chains compose deterministically
 * without floating-point drift.
 */
const effectSpecArb: fc.Arbitrary<EffectSpec> = fc.oneof(
  fc.constant<EffectSpec>({ kind: "double" }),
  fc.constant<EffectSpec>({ kind: "halve" }),
  fc.integer({ min: 1, max: 5 }).map<EffectSpec>((n) => ({ kind: "add", n })),
  fc.integer({ min: 1, max: 5 }).map<EffectSpec>((n) => ({ kind: "prevent", n })),
);

/** Generator for scenarios with 2-4 simultaneous replacement effects (CR 616). */
const effectListArb: fc.Arbitrary<EffectSpec[]> = fc.array(effectSpecArb, {
  minLength: 2,
  maxLength: 4,
});

/** Base damage event generator (positive amounts only). */
const baseDamageArb = fc.integer({ min: 1, max: 20 });

const targetIdArb = fc.constantFrom("player1", "player2", "creature1");

// ---------------------------------------------------------------------------
// Effect builder — deterministic timestamps/layers (no Date.now())
// ---------------------------------------------------------------------------

/**
 * Turn an EffectSpec into a concrete ReplacementAbility with a deterministic
 * timestamp and layer so that two identically-built managers resolve a chain
 * in exactly the same order.
 */
function buildEffect(
  spec: EffectSpec,
  index: number,
): ReplacementAbility {
  const timestamp = 100 * (index + 1);
  const sourceCardId = `card-${index}`;
  const controllerId = "player1";
  const canApplyDamage = (e: ReplacementEvent) => e.type === "damage";

  switch (spec.kind) {
    case "double":
      return {
        id: `eff-${index}-double`,
        sourceCardId,
        controllerId,
        effectType: "damage_replacement",
        description: `effect ${index}: double`,
        layer: 5,
        timestamp,
        isInstead: true,
        canApply: canApplyDamage,
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "doubled",
          instead: true,
        }),
      };
    case "halve":
      return {
        id: `eff-${index}-halve`,
        sourceCardId,
        controllerId,
        effectType: "damage_replacement",
        description: `effect ${index}: halve`,
        layer: 5,
        timestamp,
        isInstead: true,
        canApply: canApplyDamage,
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: Math.floor(e.amount / 2) },
          description: "halved",
          instead: true,
        }),
      };
    case "add":
      return {
        id: `eff-${index}-add-${spec.n}`,
        sourceCardId,
        controllerId,
        effectType: "damage_replacement",
        description: `effect ${index}: add ${spec.n}`,
        layer: 5,
        timestamp,
        isInstead: true,
        canApply: canApplyDamage,
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount + spec.n },
          description: `added ${spec.n}`,
          instead: true,
        }),
      };
    case "prevent":
      // damage_prevention effects use layer 1 so they apply before
      // damage_replacement effects (CR 614.6 ordering within the chain).
      return {
        id: `eff-${index}-prevent-${spec.n}`,
        sourceCardId,
        controllerId,
        effectType: "damage_prevention",
        description: `effect ${index}: prevent ${spec.n}`,
        layer: 1,
        timestamp,
        canApply: canApplyDamage,
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: Math.max(0, e.amount - spec.n) },
          description: `prevented ${spec.n}`,
        }),
      };
  }
}

/** Build a fresh manager seeded with the given effect specs. */
function buildManager(specs: EffectSpec[]): ReplacementEffectManager {
  const rem = new ReplacementEffectManager();
  specs.forEach((spec, index) => rem.registerEffect(buildEffect(spec, index)));
  return rem;
}

function makeDamageEvent(amount: number, targetId: string): ReplacementEvent {
  return {
    type: "damage",
    amount,
    timestamp: 1_000,
    targetId,
  };
}

/** Sum the remaining shield amounts for a target. */
function shieldsTotal(rem: ReplacementEffectManager, targetId: string): number {
  return rem
    .getPreventionShields(targetId)
    .reduce((sum, s) => sum + s.amount, 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Property-based: Replacement effect determinism (issue #1018)", () => {
  describe("Identical scenarios produce identical final states", () => {
    it("two fresh managers resolve the same 2-4 effect chain identically", () => {
      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
            targetId: targetIdArb,
          }),
          ({ specs, baseDamage, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);

            const resultA = buildManager(specs).processEvent(event);
            const resultB = buildManager(specs).processEvent(event);

            // State-hash comparison across two independent resolutions.
            expect(hashEvent(resultA)).toBe(hashEvent(resultB));
            expect(resultA.amount).toBe(resultB.amount);
            expect(resultA.type).toBe(resultB.type);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("repeated resolution of an identical scenario is stable across 100+ runs", () => {
      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
            targetId: targetIdArb,
          }),
          ({ specs, baseDamage, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);

            // Resolve the same scenario 5 times on fresh managers and
            // require every state-hash to match.
            const hashes = new Set<string>();
            for (let i = 0; i < 5; i++) {
              const result = buildManager(specs).processEvent(event);
              hashes.add(hashEvent(result));
            }
            expect(hashes.size).toBe(1);
          },
        ),
        { numRuns: 25 }, // 25 scenarios * 5 resolutions = 125 resolutions
      );
    });

    it("APNAP-ordered multiplayer resolution is deterministic", () => {
      const apnapOrder: APNAPOrder = {
        activePlayerId: "player1",
        playerOrder: ["player1", "player2"],
      };

      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
          }),
          ({ specs, baseDamage }) => {
            const event = makeDamageEvent(baseDamage, "player2");

            const a = buildManager(specs).processEvent(event, apnapOrder);
            const b = buildManager(specs).processEvent(event, apnapOrder);

            expect(hashEvent(a)).toBe(hashEvent(b));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("each replacement effect in the chain is applied at most once", () => {
      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
            targetId: targetIdArb,
          }),
          ({ specs, baseDamage, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);

            // Apply the chain once deterministically by hand. Each effect
            // applies exactly once in layer/timestamp order (matches the
            // manager's `appliedEffectIds` de-duplication).
            const ordered = specs
              .map((spec, index) => ({ spec, layer: spec.kind === "prevent" ? 1 : 5, ts: 100 * (index + 1) }))
              .sort((x, y) => (x.layer !== y.layer ? x.layer - y.layer : x.ts - y.ts));

            let expected = baseDamage;
            for (const { spec } of ordered) {
              switch (spec.kind) {
                case "double": expected = expected * 2; break;
                case "halve": expected = Math.floor(expected / 2); break;
                case "add": expected = expected + spec.n; break;
                case "prevent": expected = Math.max(0, expected - spec.n); break;
              }
            }

            const result = buildManager(specs).processEvent(event);
            expect(result.amount).toBe(Math.max(0, expected));
            expect(Number.isFinite(result.amount)).toBe(true);
            expect(result.amount).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Regeneration / prevention shield consumed exactly once", () => {
    it("a shield prevents min(damage, shield) and never more, in a single event", () => {
      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
            shieldAmount: fc.integer({ min: 1, max: 20 }),
            targetId: targetIdArb,
          }),
          ({ specs, baseDamage, shieldAmount, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);

            // Oracle: resolve the chain with NO shield to learn the
            // post-replacement damage, then compute the expected shield
            // consumption by hand.
            const replacedDamage = buildManager(specs).processEvent(event)
              .amount;

            const rem = buildManager(specs);
            rem.addPreventionShield(targetId, {
              sourceId: "shield-src",
              amount: shieldAmount,
              controllerId: "player1",
            });

            const result = rem.processEvent(event);
            const remaining = shieldsTotal(rem, targetId);
            const prevented = shieldAmount - remaining;

            // The shield is consumed at most once: never more than the
            // damage actually dealt nor more than the shield had.
            expect(prevented).toBe(Math.min(replacedDamage, shieldAmount));
            expect(prevented).toBeLessThanOrEqual(replacedDamage);
            expect(prevented).toBeLessThanOrEqual(shieldAmount);

            // The shield pool never goes negative.
            expect(remaining).toBeGreaterThanOrEqual(0);

            // Final damage is the post-replacement damage minus what the
            // shield prevented.
            expect(result.amount).toBe(replacedDamage - prevented);
            expect(result.amount).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("re-processing the same event on a fresh identical manager consumes the same amount", () => {
      fc.assert(
        fc.property(
          fc.record({
            baseDamage: baseDamageArb,
            shieldAmount: fc.integer({ min: 1, max: 20 }),
            targetId: targetIdArb,
          }),
          ({ baseDamage, shieldAmount, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);

            const runOnce = (): number => {
              const rem = new ReplacementEffectManager();
              rem.addPreventionShield(targetId, {
                sourceId: "shield-src",
                amount: shieldAmount,
                controllerId: "player1",
              });
              const before = shieldsTotal(rem, targetId);
              rem.processEvent(event);
              const after = shieldsTotal(rem, targetId);
              return before - after;
            };

            // Consumed amount is identical across independent resolutions —
            // the shield is never double-applied within one event.
            const consumedA = runOnce();
            const consumedB = runOnce();
            const consumedC = runOnce();
            expect(consumedA).toBe(consumedB);
            expect(consumedB).toBe(consumedC);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Damage prevention always applies before damage is dealt", () => {
    it("final damage is reduced by the shield before being applied (oracle model)", () => {
      fc.assert(
        fc.property(
          fc.record({
            specs: effectListArb,
            baseDamage: baseDamageArb,
            shieldAmount: fc.integer({ min: 1, max: 20 }),
            targetId: targetIdArb,
          }),
          ({ specs, baseDamage, shieldAmount, targetId }) => {
            const event = makeDamageEvent(baseDamage, targetId);
            const replacedDamage = buildManager(specs).processEvent(event)
              .amount;

            const rem = buildManager(specs);
            rem.addPreventionShield(targetId, {
              sourceId: "shield-src",
              amount: shieldAmount,
              controllerId: "player1",
            });
            const result = rem.processEvent(event);

            // Prevention is applied after replacement, before damage lands:
            //   final = max(0, replacedDamage - shieldAmount)
            expect(result.amount).toBe(
              Math.max(0, replacedDamage - shieldAmount),
            );
            expect(result.amount).toBeLessThanOrEqual(replacedDamage);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("when the shield fully absorbs the damage, zero damage is dealt", () => {
      fc.assert(
        fc.property(
          fc.record({
            baseDamage: baseDamageArb,
            shieldAmount: fc.integer({ min: 20, max: 100 }),
            targetId: targetIdArb,
          }),
          ({ baseDamage, shieldAmount, targetId }) => {
            // No replacement effects, so replacedDamage === baseDamage and a
            // large shield must reduce the dealt damage to exactly 0.
            const event = makeDamageEvent(baseDamage, targetId);
            const rem = new ReplacementEffectManager();
            rem.addPreventionShield(targetId, {
              sourceId: "shield-src",
              amount: shieldAmount,
              controllerId: "player1",
            });
            const result = rem.processEvent(event);
            expect(result.amount).toBe(0);
            expect(shieldsTotal(rem, targetId)).toBe(shieldAmount - baseDamage);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Prevention effects with multiple targets", () => {
    it("a shield on one target is not consumed when another target is hit", () => {
      const targets = ["player1", "player2", "creature1"] as const;

      fc.assert(
        fc.property(
          fc.record({
            damage: baseDamageArb,
            shieldA: fc.integer({ min: 1, max: 20 }),
            shieldB: fc.integer({ min: 1, max: 20 }),
            shieldC: fc.integer({ min: 1, max: 20 }),
            hitIndex: fc.nat({ max: targets.length - 1 }),
          }),
          ({ damage, shieldA, shieldB, shieldC, hitIndex }) => {
            const amounts = [shieldA, shieldB, shieldC];
            const hitTarget = targets[hitIndex];

            const rem = new ReplacementEffectManager();
            targets.forEach((t, i) => {
              rem.addPreventionShield(t, {
                sourceId: `shield-${t}`,
                amount: amounts[i],
                controllerId: "player1",
              });
            });

            // Snapshot before.
            const before = targets.map((t) => shieldsTotal(rem, t));
            rem.processEvent(makeDamageEvent(damage, hitTarget));
            const after = targets.map((t) => shieldsTotal(rem, t));

            // Only the hit target's shield may change.
            targets.forEach((t, i) => {
              if (t === hitTarget) {
                const expectedPrevented = Math.min(damage, amounts[i]);
                expect(before[i] - after[i]).toBe(expectedPrevented);
              } else {
                // Untouched targets keep their full shield.
                expect(after[i]).toBe(before[i]);
              }
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it("damaging each target independently consumes only that target's shield", () => {
      const targets = ["player1", "player2", "creature1"] as const;

      fc.assert(
        fc.property(
          fc.record({
            damage: baseDamageArb,
            shieldA: fc.integer({ min: 1, max: 20 }),
            shieldB: fc.integer({ min: 1, max: 20 }),
            shieldC: fc.integer({ min: 1, max: 20 }),
          }),
          ({ damage, shieldA, shieldB, shieldC }) => {
            const amounts = [shieldA, shieldB, shieldC];

            const rem = new ReplacementEffectManager();
            targets.forEach((t, i) => {
              rem.addPreventionShield(t, {
                sourceId: `shield-${t}`,
                amount: amounts[i],
                controllerId: "player1",
              });
            });

            // Hit each target once, independently, with fresh shields each
            // time would defeat isolation — instead hit them all on the same
            // manager and confirm each shield is consumed against its own
            // target's damage only.
            targets.forEach((t, i) => {
              const before = shieldsTotal(rem, t);
              rem.processEvent(makeDamageEvent(damage, t));
              const after = shieldsTotal(rem, t);
              expect(before - after).toBe(Math.min(damage, before));
            });

            // After hitting every target once, all shields reflect exactly
            // the per-target consumption (no cross-target leakage).
            targets.forEach((t, i) => {
              const consumed = Math.min(damage, amounts[i]);
              expect(shieldsTotal(rem, t)).toBe(amounts[i] - consumed);
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
