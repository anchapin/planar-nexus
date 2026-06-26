/**
 * Mutation-targeted tests for the Replacement & Prevention Effects system.
 *
 * These tests were added (issue #1097) to kill surviving Stryker mutants in
 * `replacement-effects.ts` — specifically the ordering, boundary, and
 * rules-correctness invariants that line coverage alone could not verify:
 *   - `usePreventionShield` shield-leftover accounting (CR 614.2 / 615)
 *   - `chooseBestEffect` APNAP + self-replacement + layer/timestamp ordering
 *     (CR 616)
 *   - `processEvent` damage-prevention application and CR 614.4 loop detection
 *   - `effectTypeMatches` event/effect mapping
 *   - `resetExpiredEffects` expiry filtering
 *   - factory default flags and `canApply` predicates
 *
 * Each test asserts the *observable rules-correct* behavior so that flipping
 * an operator or boundary causes a failure (mutant "killed").
 */

import {
  ReplacementEffectManager,
  ReplacementAbility,
  ReplacementEvent,
  APNAPOrder,
  PreventionShield,
  createPreventionShield,
  createDamageReplacementEffect,
  createDestroyReplacementEffect,
  createLifeGainReplacementEffect,
  createLifeLossReplacementEffect,
  createDrawReplacementEffect,
  createAsThoughEffect,
} from "../replacement-effects";
import type { GameState } from "../types";

let rem: ReplacementEffectManager;

const damageEvent = (
  amount: number,
  targetId = "player1",
): ReplacementEvent => ({
  type: "damage",
  amount,
  timestamp: 1,
  targetId,
});

/** Effect that adds `n` to the event amount. */
const addEffect = (
  id: string,
  controllerId: "player1" | "player2" = "player1",
  n: number,
  opts: Partial<
    Pick<
      ReplacementAbility,
      "layer" | "timestamp" | "isSelfReplacement" | "effectType"
    >
  > = {},
): ReplacementAbility => ({
  id,
  sourceCardId: `${id}-card`,
  controllerId,
  effectType: opts.effectType ?? "damage_replacement",
  description: `${id} adds ${n}`,
  layer: opts.layer ?? 5,
  timestamp: opts.timestamp ?? 100,
  isInstead: true,
  isSelfReplacement: opts.isSelfReplacement,
  canApply: (e) => e.type === "damage",
  apply: (e) => ({
    modified: true,
    modifiedEvent: { ...e, amount: e.amount + n },
    description: `${id} added`,
    instead: true,
  }),
});

/** Effect that multiplies the event amount by `m`. */
const mulEffect = (
  id: string,
  controllerId: "player1" | "player2" = "player1",
  m: number,
  opts: Partial<
    Pick<ReplacementAbility, "layer" | "timestamp" | "isSelfReplacement">
  > = {},
): ReplacementAbility => ({
  id,
  sourceCardId: `${id}-card`,
  controllerId,
  effectType: "damage_replacement",
  description: `${id} x${m}`,
  layer: opts.layer ?? 5,
  timestamp: opts.timestamp ?? 100,
  isInstead: true,
  isSelfReplacement: opts.isSelfReplacement,
  canApply: (e) => e.type === "damage",
  apply: (e) => ({
    modified: true,
    modifiedEvent: { ...e, amount: e.amount * m },
    description: `${id} multiplied`,
    instead: true,
  }),
});

const shield = (
  sourceId: string,
  amount: number,
  expiresAt?: number,
): PreventionShield => ({
  sourceId,
  amount,
  controllerId: "player1",
  expiresAt,
});

describe("usePreventionShield — shield accounting (CR 615)", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("preserves the leftover amount on a partially-used shield", () => {
    rem.addPreventionShield("player1", shield("s1", 10));
    const prevented = rem.usePreventionShield("player1", 4);
    expect(prevented).toBe(4);
    const remaining = rem.getPreventionShields("player1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].amount).toBe(6);
  });

  test("fully consumes a shield whose amount equals the prevented amount", () => {
    rem.addPreventionShield("player1", shield("s1", 5));
    expect(rem.usePreventionShield("player1", 5)).toBe(5);
    expect(rem.getPreventionShields("player1")).toHaveLength(0);
  });

  test("consumes multiple shields in insertion order, depleting earlier ones first", () => {
    rem.addPreventionShield("player1", shield("s1", 3));
    rem.addPreventionShield("player1", shield("s2", 5));
    expect(rem.usePreventionShield("player1", 4)).toBe(4);
    const left = rem.getPreventionShields("player1");
    expect(left).toHaveLength(1);
    expect(left[0].sourceId).toBe("s2");
    expect(left[0].amount).toBe(4);
  });

  test("returns 0 and changes nothing when no shield exists", () => {
    expect(rem.usePreventionShield("player1", 4)).toBe(0);
  });

  test("never prevents more than the available shield total", () => {
    rem.addPreventionShield("player1", shield("s1", 2));
    expect(rem.usePreventionShield("player1", 10)).toBe(2);
    expect(rem.getPreventionShields("player1")).toHaveLength(0);
  });
});

describe("chooseBestEffect — APNAP / self-replacement / layer / timestamp (CR 616)", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("applies a self-replacement effect before lower-layer non-self effects", () => {
    // Self effect has a WORSE (higher) layer but must still go first.
    rem.registerEffect(
      addEffect("self", "player1", 100, {
        layer: 10,
        timestamp: 100,
        isSelfReplacement: true,
      }),
    );
    rem.registerEffect(
      mulEffect("nonself", "player1", 2, { layer: 1, timestamp: 200 }),
    );
    // self-first: 3 +100 = 103, x2 = 206 ; layer-first would give 3 x2 = 6, +100 = 106
    expect(rem.processEvent(damageEvent(3)).amount).toBe(206);
  });

  test("orders by layer when neither effect is a self-replacement", () => {
    rem.registerEffect(
      addEffect("hi", "player1", 10, { layer: 2, timestamp: 100 }),
    );
    rem.registerEffect(
      mulEffect("lo", "player1", 2, { layer: 1, timestamp: 200 }),
    );
    // layer 1 first: 3 x2 = 6, +10 = 16 ; reverse would give 3 +10 = 13, x2 = 26
    expect(rem.processEvent(damageEvent(3)).amount).toBe(16);
  });

  test("uses timestamp as the final tie-breaker within the same layer", () => {
    rem.registerEffect(
      addEffect("late", "player1", 100, { layer: 5, timestamp: 200 }),
    );
    rem.registerEffect(
      mulEffect("early", "player1", 2, { layer: 5, timestamp: 100 }),
    );
    // earlier timestamp first: 3 x2 = 6, +100 = 106 ; reverse: 3 +100 = 103, x2 = 206
    expect(rem.processEvent(damageEvent(3)).amount).toBe(106);
  });

  test("APNAP order overrides timestamp when the affected object's controller is known", () => {
    const apnap: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2"],
    };
    // player1 has the LATER timestamp but must apply first under APNAP.
    rem.registerEffect(mulEffect("p1", "player1", 2, { timestamp: 200 }));
    rem.registerEffect(addEffect("p2", "player2", 10, { timestamp: 100 }));
    // APNAP player1 first: 3 x2 = 6, +10 = 16 ; timestamp-first: 3 +10 = 13, x2 = 26
    expect(rem.processEvent(damageEvent(3, "player2"), apnap).amount).toBe(16);
  });

  test("falls back to layer ordering when a controller is absent from the APNAP order", () => {
    const apnap: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1"],
    };
    rem.registerEffect(
      mulEffect("p2", "player2", 2, { layer: 1, timestamp: 200 }),
    );
    rem.registerEffect(
      addEffect("p1", "player1", 10, { layer: 2, timestamp: 100 }),
    );
    // player2 is not in playerOrder -> APNAP cannot rank it -> layer decides (layer 1 first)
    // 3 x2 = 6, +10 = 16
    expect(rem.processEvent(damageEvent(3, "player2"), apnap).amount).toBe(16);
  });
});

describe("processEvent — damage prevention and loop detection", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("applies prevention shields to damage after replacement effects (CR 614.6)", () => {
    rem.addPreventionShield("player1", shield("s1", 4));
    expect(rem.processEvent(damageEvent(10)).amount).toBe(6);
  });

  test("does NOT apply damage shields to non-damage events", () => {
    rem.addPreventionShield("player1", shield("s1", 4));
    const event: ReplacementEvent = {
      type: "life_gain",
      amount: 5,
      timestamp: 1,
      targetId: "player1",
    };
    expect(rem.processEvent(event).amount).toBe(5);
    expect(rem.getPreventionShields("player1")).toHaveLength(1);
  });

  test("skips zero-amount damage events for prevention", () => {
    rem.addPreventionShield("player1", shield("s1", 4));
    expect(rem.processEvent(damageEvent(0)).amount).toBe(0);
    // Shield untouched because there was nothing to prevent.
    expect(rem.getPreventionShields("player1")[0].amount).toBe(4);
  });

  test("detects a CR 614.4 replacement loop and zeroes the event amount", () => {
    // damage -> life_loss -> damage (cycle). Without loop detection the chain
    // would simply run out of unapplied effects and leave the amount intact.
    const damageToLifeLoss: ReplacementAbility = {
      id: "d2l",
      sourceCardId: "c1",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "damage becomes life loss",
      layer: 5,
      timestamp: 100,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "life_loss" },
        description: "to life loss",
      }),
    };
    const lifeLossToDamage: ReplacementAbility = {
      id: "l2d",
      sourceCardId: "c2",
      controllerId: "player1",
      effectType: "life_loss_replacement",
      description: "life loss becomes damage",
      layer: 5,
      timestamp: 200,
      canApply: (e) => e.type === "life_loss",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "damage" },
        description: "to damage",
      }),
    };
    rem.registerEffect(damageToLifeLoss);
    rem.registerEffect(lifeLossToDamage);
    expect(rem.processEvent(damageEvent(7)).amount).toBe(0);
  });

  test("honors a skipEvent result by zeroing the amount and stopping the chain", () => {
    const skipper: ReplacementAbility = {
      id: "skip",
      sourceCardId: "c1",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "skip damage",
      layer: 5,
      timestamp: 100,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e },
        description: "skipped",
        skipEvent: true,
      }),
    };
    rem.registerEffect(skipper);
    expect(rem.processEvent(damageEvent(9)).amount).toBe(0);
  });
});

describe("effectTypeMatches — event/effect mapping (CR 614.1)", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  // canApply is permissive so only the type mapping can gate the effect.
  const marker = (
    effectType: ReplacementAbility["effectType"],
  ): ReplacementAbility => ({
    id: `marker-${effectType}`,
    sourceCardId: "c1",
    controllerId: "player1",
    effectType,
    description: "marker",
    layer: 5,
    timestamp: 100,
    canApply: () => true,
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: 999 },
      description: "marked",
    }),
  });

  test("destroy_replacement applies to a destroy event", () => {
    rem.registerEffect(marker("destroy_replacement"));
    const event: ReplacementEvent = {
      type: "destroy",
      amount: 1,
      timestamp: 1,
    };
    expect(rem.processEvent(event).amount).toBe(999);
  });

  test("destroy_replacement applies to a move_to_graveyard event", () => {
    rem.registerEffect(marker("destroy_replacement"));
    const event: ReplacementEvent = {
      type: "move_to_graveyard",
      amount: 1,
      timestamp: 1,
    };
    expect(rem.processEvent(event).amount).toBe(999);
  });

  test("sacrifice_replacement applies to a sacrifice event", () => {
    rem.registerEffect(marker("sacrifice_replacement"));
    const event: ReplacementEvent = {
      type: "sacrifice",
      amount: 1,
      timestamp: 1,
    };
    expect(rem.processEvent(event).amount).toBe(999);
  });

  test("counters applies to an add_counter event", () => {
    rem.registerEffect(marker("counters"));
    const event: ReplacementEvent = {
      type: "add_counter",
      amount: 1,
      timestamp: 1,
    };
    expect(rem.processEvent(event).amount).toBe(999);
  });

  test("nothing applies to a tap event (empty mapping)", () => {
    rem.registerEffect(marker("damage_replacement"));
    rem.registerEffect(marker("destroy_replacement"));
    const event: ReplacementEvent = { type: "tap", amount: 1, timestamp: 1 };
    expect(rem.processEvent(event).amount).toBe(1);
  });
});

describe("resetExpiredEffects / createAPNAPOrder / reset", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("drops expired shields while keeping still-valid ones", () => {
    rem.addPreventionShield("player1", shield("expired", 5, 10));
    rem.addPreventionShield("player1", shield("valid", 5, 100));
    rem.resetExpiredEffects(20, 3);
    const left = rem.getPreventionShields("player1");
    expect(left).toHaveLength(1);
    expect(left[0].sourceId).toBe("valid");
  });

  test("treats a shield expiring exactly at the current time as expired", () => {
    rem.addPreventionShield("player1", shield("edge", 5, 50));
    rem.resetExpiredEffects(50, 3);
    expect(rem.getPreventionShields("player1")).toHaveLength(0);
  });

  test("removeEffectsFromSource only strips the named source (effects, as-though, shields)", () => {
    rem.registerEffect(addEffect("keep", "player1", 1));
    rem.registerAsThoughEffect(
      createAsThoughEffect("gone-card", "player1", "cast_flash", "flash"),
    );
    rem.registerAsThoughEffect(
      createAsThoughEffect("keep-card", "player1", "attack_haste", "haste"),
    );
    rem.addPreventionShield("player1", shield("gone-card", 3));
    rem.addPreventionShield("player1", shield("keep-card", 4));

    rem.removeEffectsFromSource("gone-card");

    // The kept damage effect is untouched -> still adds 1. (Routed to an
    // unshielded target so the leftover shield doesn't mask the effect.)
    expect(rem.processEvent(damageEvent(3, "player2")).amount).toBe(4);
    const state = {} as GameState;
    const ath = rem.getAsThoughEffects("player1", state);
    expect(ath).toHaveLength(1);
    expect(ath[0].sourceCardId).toBe("keep-card");
    const shields = rem.getPreventionShields("player1");
    expect(shields).toHaveLength(1);
    expect(shields[0].sourceId).toBe("keep-card");
  });

  test("removes until_end_of_turn as-though effects on reset", () => {
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "c1",
        "player1",
        "cast_flash",
        "flash",
        undefined,
        "until_end_of_turn",
      ),
    );
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "c2",
        "player1",
        "attack_haste",
        "haste",
        undefined,
        "permanent",
      ),
    );
    rem.resetExpiredEffects(999, 5);
    const state = {} as GameState;
    expect(rem.getAsThoughEffects("player1", state)).toHaveLength(1);
    expect(rem.getAsThoughEffects("player1", state)[0].asThoughType).toBe(
      "attack_haste",
    );
  });

  test("createAPNAPOrder starts at the active player and wraps around", () => {
    const order = rem.createAPNAPOrder("p2", ["p1", "p2", "p3", "p4"]);
    expect(order.playerOrder).toEqual(["p2", "p3", "p4", "p1"]);
  });

  test("createAPNAPOrder returns the input order when the active player is unknown", () => {
    const order = rem.createAPNAPOrder("pX", ["p1", "p2"]);
    expect(order.playerOrder).toEqual(["p1", "p2"]);
  });

  test("reset clears all registered state", () => {
    rem.addPreventionShield("player1", shield("s1", 5));
    rem.registerEffect(addEffect("a", "player1", 1));
    rem.registerAsThoughEffect(
      createAsThoughEffect("c1", "player1", "cast_flash", "flash"),
    );
    rem.reset();
    expect(rem.getPreventionShields("player1")).toHaveLength(0);
    expect(rem.processEvent(damageEvent(3)).amount).toBe(3);
  });
});

describe("as-though effects (CR 609)", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("checkAsThoughEffect matches controller, type and condition", () => {
    const state = { turn: 3 } as unknown as GameState;
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "c1",
        "player1",
        "cast_flash",
        "flash",
        (s) => (s as unknown as { turn: number }).turn > 2,
      ),
    );
    expect(rem.checkAsThoughEffect("player1", "cast_flash", state)).toBe(true);
    expect(rem.checkAsThoughEffect("player2", "cast_flash", state)).toBe(false);
    expect(rem.checkAsThoughEffect("player1", "attack_haste", state)).toBe(
      false,
    );
  });

  test("checkAsThoughEffect returns false when the condition is unmet", () => {
    const state = { turn: 1 } as unknown as GameState;
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "c1",
        "player1",
        "cast_flash",
        "flash",
        (s) => (s as unknown as { turn: number }).turn > 2,
      ),
    );
    expect(rem.checkAsThoughEffect("player1", "cast_flash", state)).toBe(false);
  });
});

describe("factory defaults & predicates", () => {
  test("createPreventionShield canApply matches target and damage-type filters", () => {
    const { ability, shield: sh } = createPreventionShield(
      "c1",
      "player1",
      "player2",
      3,
      "ward",
      "until_end_of_turn",
      ["combat"],
    );
    expect(sh.amount).toBe(3);
    expect(sh.expiresAt).toBeGreaterThan(0);
    expect(
      ability.canApply({
        type: "damage",
        amount: 1,
        timestamp: 1,
        targetId: "player2",
        damageTypes: ["combat"],
      }),
    ).toBe(true);
    // Wrong target -> cannot apply.
    expect(
      ability.canApply({
        type: "damage",
        amount: 1,
        timestamp: 1,
        targetId: "player3",
        damageTypes: ["combat"],
      }),
    ).toBe(false);
    // Non-matching damage type -> cannot apply.
    expect(
      ability.canApply({
        type: "damage",
        amount: 1,
        timestamp: 1,
        targetId: "player2",
        damageTypes: ["noncombat"],
      }),
    ).toBe(false);
    // Non-damage event -> cannot apply.
    expect(
      ability.canApply({
        type: "life_loss",
        amount: 1,
        timestamp: 1,
        targetId: "player2",
      }),
    ).toBe(false);
  });

  test("createPreventionShield apply reports not-modified and a permanent shield has no expiry", () => {
    const permanent = createPreventionShield(
      "c2",
      "player1",
      "player3",
      2,
      "perm",
      "permanent",
    );
    expect(permanent.shield.expiresAt).toBeUndefined();
    const res = permanent.ability.apply(damageEvent(2, "player3"));
    expect(res.modified).toBe(false);
    expect(res.description).toBe("Prevention shield will apply");
    // No damage-type filter + event has no damageTypes -> still applicable.
    expect(
      permanent.ability.canApply({
        type: "damage",
        amount: 1,
        timestamp: 1,
        targetId: "player3",
      }),
    ).toBe(true);
  });

  test("createDamageReplacementEffect marks the effect as 'instead' and threads isSelfReplacement", () => {
    const eff = createDamageReplacementEffect(
      "c1",
      "player1",
      "double",
      () => 4,
      5,
      true,
    );
    expect(eff.isInstead).toBe(true);
    expect(eff.isSelfReplacement).toBe(true);
    expect(eff.effectType).toBe("damage_replacement");
    expect(eff.apply(damageEvent(2)).modifiedEvent?.amount).toBe(4);
    expect(eff.id).toContain("dmg-replace-");
  });

  test("createDamageReplacementEffect defaults isSelfReplacement to false and only applies to damage", () => {
    const eff = createDamageReplacementEffect(
      "c1",
      "player1",
      "double",
      (n) => n * 2,
    );
    expect(eff.isSelfReplacement).toBeFalsy();
    expect(eff.canApply(damageEvent(2))).toBe(true);
    expect(eff.canApply({ type: "life_gain", amount: 2, timestamp: 1 })).toBe(
      false,
    );
  });

  test("life-gain / life-loss / draw factories gate on event type and mark results as 'instead'", () => {
    const gain = createLifeGainReplacementEffect(
      "c1",
      "player1",
      "double gain",
      (n) => n * 2,
    );
    expect(gain.isInstead).toBe(true);
    expect(gain.canApply({ type: "life_gain", amount: 2, timestamp: 1 })).toBe(
      true,
    );
    expect(gain.canApply({ type: "life_loss", amount: 2, timestamp: 1 })).toBe(
      false,
    );
    const gainRes = gain.apply({ type: "life_gain", amount: 2, timestamp: 1 });
    expect(gainRes.modified).toBe(true);
    expect(gainRes.modifiedEvent?.amount).toBe(4);

    const loss = createLifeLossReplacementEffect(
      "c2",
      "player1",
      "halve loss",
      (n) => Math.floor(n / 2),
    );
    expect(loss.isInstead).toBe(true);
    expect(loss.canApply({ type: "life_loss", amount: 4, timestamp: 1 })).toBe(
      true,
    );
    expect(loss.canApply({ type: "life_gain", amount: 4, timestamp: 1 })).toBe(
      false,
    );
    expect(
      loss.apply({ type: "life_loss", amount: 4, timestamp: 1 }).modifiedEvent
        ?.amount,
    ).toBe(2);

    const draw = createDrawReplacementEffect(
      "c3",
      "player1",
      "extra draw",
      (n) => n + 1,
    );
    expect(draw.isInstead).toBe(true);
    expect(draw.canApply({ type: "draw_card", amount: 1, timestamp: 1 })).toBe(
      true,
    );
    expect(draw.canApply({ type: "damage", amount: 1, timestamp: 1 })).toBe(
      false,
    );
    expect(
      draw.apply({ type: "draw_card", amount: 1, timestamp: 1 }).modifiedEvent
        ?.amount,
    ).toBe(2);
  });

  test("life-gain / life-loss factories honor a targetFilter predicate", () => {
    const gain = createLifeGainReplacementEffect(
      "c1",
      "player1",
      "filtered",
      (n) => n * 3,
      (t) => t === "player2",
    );
    expect(
      gain.canApply({
        type: "life_gain",
        amount: 2,
        timestamp: 1,
        targetId: "player2",
      }),
    ).toBe(true);
    expect(
      gain.canApply({
        type: "life_gain",
        amount: 2,
        timestamp: 1,
        targetId: "player3",
      }),
    ).toBe(false);
  });

  test("createDestroyReplacementEffect applies to destroy and move_to_graveyard", () => {
    const eff = createDestroyReplacementEffect(
      "c1",
      "player1",
      "regen",
      (e) => ({ ...e, amount: e.amount + 1 }),
    );
    expect(eff.layer).toBe(3);
    expect(eff.canApply({ type: "destroy", amount: 1, timestamp: 1 })).toBe(
      true,
    );
    expect(
      eff.canApply({ type: "move_to_graveyard", amount: 1, timestamp: 1 }),
    ).toBe(true);
    expect(eff.canApply({ type: "exile", amount: 1, timestamp: 1 })).toBe(
      false,
    );
    const res = eff.apply({ type: "destroy", amount: 2, timestamp: 1 });
    expect(res.modified).toBe(true);
    expect(res.modifiedEvent?.amount).toBe(3);
    // When the replacement returns null the effect reports not-modified.
    const nope = createDestroyReplacementEffect(
      "c2",
      "player1",
      "nope",
      () => null,
    ).apply({ type: "destroy", amount: 2, timestamp: 1 });
    expect(nope.modified).toBe(false);
  });
});
