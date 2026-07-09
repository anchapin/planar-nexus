/**
 * Comprehensive tests for Replacement and Prevention Effects
 * Tests APNAP ordering, "as though" effects, and complex scenarios
 */

import {
  ReplacementEffectManager,
  ReplacementAbility,
  ReplacementEvent,
  APNAPOrder,
  createPreventionShield,
  createDamageReplacementEffect,
  createLifeGainReplacementEffect,
  createLifeLossReplacementEffect,
  createDrawReplacementEffect,
  createDestroyReplacementEffect,
  createAsThoughEffect,
} from "../replacement-effects";
import type { GameState, PlayerId } from "../types";

// Module-level rem variable shared across all describe blocks
let rem: ReplacementEffectManager;

describe("ReplacementEffectManager - APNAP Ordering", () => {
  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("should apply effects in APNAP order", () => {
    // Player1 is active player, Player2 is non-active
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2"],
    };

    // Both players have effects that double damage
    const p1Effect: ReplacementAbility = {
      id: "p1-double",
      sourceCardId: "p1-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "P1 doubles damage",
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "P1 doubled",
        instead: true,
      }),
    };

    const p2Effect: ReplacementAbility = {
      id: "p2-double",
      sourceCardId: "p2-card",
      controllerId: "player2",
      effectType: "damage_replacement",
      description: "P2 doubles damage",
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "P2 doubled",
        instead: true,
      }),
    };

    rem.registerEffect(p1Effect);
    rem.registerEffect(p2Effect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 3,
      timestamp: Date.now(),
      targetId: "player2", // Affected player is P2
    };

    // P2's effect should apply first (affected player chooses)
    // Then P1's effect applies
    // 3 * 2 (P2) = 6, then 6 * 2 (P1) = 12
    const processed = rem.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(12);
  });

  test("should prioritize self-replacement effects", () => {
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2"],
    };

    // Self-replacement effect (e.g., "If this creature would deal damage...")
    const selfEffect: ReplacementAbility = {
      id: "self-replace",
      sourceCardId: "self-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Self replacement",
      layer: 5,
      timestamp: 300,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.sourceId === "self-card",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount + 5 },
        description: "Self added 5",
        instead: true,
      }),
    };

    // Regular effect
    const regularEffect: ReplacementAbility = {
      id: "regular",
      sourceCardId: "regular-card",
      controllerId: "player2",
      effectType: "damage_replacement",
      description: "Regular replacement",
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "Regular doubled",
        instead: true,
      }),
    };

    rem.registerEffect(selfEffect);
    rem.registerEffect(regularEffect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 3,
      timestamp: Date.now(),
      sourceId: "self-card",
      targetId: "player2",
    };

    // Self-replacement applies first: 3 + 5 = 8
    // Then regular: 8 * 2 = 16
    const processed = rem.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(16);
  });

  test("should handle layer ordering within same controller", () => {
    // Lower layer applies first
    const layer1Effect: ReplacementAbility = {
      id: "layer1",
      sourceCardId: "card1",
      controllerId: "player1",
      effectType: "damage_prevention",
      description: "Layer 1",
      layer: 1,
      timestamp: 100,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: "Prevented 2",
      }),
    };

    const layer5Effect: ReplacementAbility = {
      id: "layer5",
      sourceCardId: "card2",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Layer 5",
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "Doubled",
        instead: true,
      }),
    };

    rem.registerEffect(layer1Effect);
    rem.registerEffect(layer5Effect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // Layer 1 applies first: 5 - 2 = 3
    // Layer 5 applies second: 3 * 2 = 6
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(6);
  });
});

describe("ReplacementEffectManager - As Though Effects", () => {
  let rem: ReplacementEffectManager;

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("should register and check as though effects", () => {
    const mockGameState = { players: new Map() } as GameState;

    const flashEffect = createAsThoughEffect(
      "veiled-source",
      "player1",
      "cast_flash",
      "You may cast spells as though they had flash",
    );

    rem.registerAsThoughEffect(flashEffect);

    expect(
      rem.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(true);
    expect(
      rem.checkAsThoughEffect("player2", "cast_flash", mockGameState),
    ).toBe(false);
    expect(
      rem.checkAsThoughEffect("player1", "attack_haste", mockGameState),
    ).toBe(false);
  });

  test("should handle conditional as though effects", () => {
    const mockGameState = { players: new Map() } as GameState;

    // Effect that only applies when player has 10+ life
    const conditionalEffect = createAsThoughEffect(
      "conditional-source",
      "player1",
      "attack_haste",
      "Creatures can attack as though they had haste if you have 10+ life",
      (_state, _playerId) => {
        // Simplified condition check
        return true;
      },
    );

    rem.registerAsThoughEffect(conditionalEffect);

    expect(
      rem.checkAsThoughEffect("player1", "attack_haste", mockGameState),
    ).toBe(true);
  });

  test("should get all as though effects for a player", () => {
    const mockGameState = { players: new Map() } as GameState;

    rem.registerAsThoughEffect(
      createAsThoughEffect("source1", "player1", "cast_flash", "Flash effect"),
    );
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "source2",
        "player1",
        "attack_haste",
        "Haste effect",
      ),
    );
    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "source3",
        "player2",
        "block_flying",
        "Flying block effect",
      ),
    );

    const p1Effects = rem.getAsThoughEffects("player1", mockGameState);
    expect(p1Effects).toHaveLength(2);
    expect(p1Effects.map((e) => e.asThoughType)).toContain("cast_flash");
    expect(p1Effects.map((e) => e.asThoughType)).toContain("attack_haste");

    const p2Effects = rem.getAsThoughEffects("player2", mockGameState);
    expect(p2Effects).toHaveLength(1);
    expect(p2Effects[0].asThoughType).toBe("block_flying");
  });

  test("should remove as though effects when source leaves battlefield", () => {
    const mockGameState = { players: new Map() } as GameState;

    rem.registerAsThoughEffect(
      createAsThoughEffect(
        "temporary-source",
        "player1",
        "cast_flash",
        "Temporary flash",
      ),
    );

    expect(
      rem.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(true);

    rem.removeEffectsFromSource("temporary-source");

    expect(
      rem.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(false);
  });
});

describe("ReplacementEffectManager - Complex Scenarios", () => {
  let rem: ReplacementEffectManager;

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("should handle Furnace of Rath + prevention shield interaction", () => {
    // Furnace of Rath: If damage would be dealt, deal twice that much instead
    const furnaceEffect = createDamageReplacementEffect(
      "furnace",
      "player1",
      "Furnace of Rath doubles damage",
      (amount) => amount * 2,
      5,
    );

    rem.registerEffect(furnaceEffect);

    // Target has prevention shield
    rem.addPreventionShield("player2", {
      sourceId: "fog",
      amount: 3,
      controllerId: "player2",
    });

    const event: ReplacementEvent = {
      type: "damage",
      amount: 2,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // Furnace doubles: 2 * 2 = 4
    // Prevention shield prevents 3: 4 - 3 = 1
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(1);

    // Shield should be depleted
    const shields = rem.getPreventionShields("player2");
    expect(shields).toHaveLength(0);
  });

  test("should handle Alhammarret's Archive life gain doubling", () => {
    const archiveEffect = createLifeGainReplacementEffect(
      "archive",
      "player1",
      "Alhammarret's Archive doubles life gain",
      (amount) => amount * 2,
      (targetId) => targetId === "player1",
    );

    rem.registerEffect(archiveEffect);

    const event: ReplacementEvent = {
      type: "life_gain",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player1",
    };

    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(10);

    // Should not apply to other players
    const otherEvent: ReplacementEvent = {
      type: "life_gain",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };

    const otherProcessed = rem.processEvent(otherEvent);
    expect(otherProcessed.amount).toBe(5);
  });

  test("should handle multiple prevention shields depleting correctly", () => {
    rem.addPreventionShield("player1", {
      sourceId: "shield1",
      amount: 2,
      controllerId: "player1",
    });
    rem.addPreventionShield("player1", {
      sourceId: "shield2",
      amount: 3,
      controllerId: "player1",
    });

    // First damage: 4 damage, should use both shields (2 + 2 from second)
    const event1: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "player1",
    };

    const processed1 = rem.processEvent(event1);
    expect(processed1.amount).toBe(0);

    // Second shield should have 1 remaining
    const shields = rem.getPreventionShields("player1");
    expect(shields).toHaveLength(1);
    expect(shields[0].amount).toBe(1);

    // Second damage: 2 damage, should use remaining 1 from shield2
    const event2: ReplacementEvent = {
      type: "damage",
      amount: 2,
      timestamp: Date.now() + 1000,
      targetId: "player1",
    };

    const processed2 = rem.processEvent(event2);
    expect(processed2.amount).toBe(1);

    // All shields should be depleted
    expect(rem.getPreventionShields("player1")).toHaveLength(0);
  });

  test("should handle draw replacement effects", () => {
    const drawEffect = createDrawReplacementEffect(
      "nefarox",
      "player1",
      "Nefarox draw replacement",
      (amount) => amount + 1, // Draw one additional card
    );

    rem.registerEffect(drawEffect);

    const event: ReplacementEvent = {
      type: "draw_card",
      amount: 1,
      timestamp: Date.now(),
      targetId: "player1",
    };

    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(2);
  });

  test("should handle destroy replacement (regeneration)", () => {
    const regenEffect = createDestroyReplacementEffect(
      "regeneration-shield",
      "player1",
      "Regeneration shield",
      (event) => ({
        ...event,
        type: "tap", // Instead of dying, creature taps
        amount: 0,
      }),
      (targetId) => targetId === "creature1",
    );

    rem.registerEffect(regenEffect);

    const event: ReplacementEvent = {
      type: "destroy",
      amount: 0,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const processed = rem.processEvent(event);
    expect(processed.type).toBe("tap");
    expect(processed.amount).toBe(0);
  });

  test("should handle life loss replacement", () => {
    const lossEffect = createLifeLossReplacementEffect(
      "loss-reducer",
      "player1",
      "Half life loss",
      (amount) => Math.ceil(amount / 2),
      (targetId) => targetId === "player1",
    );

    rem.registerEffect(lossEffect);

    const event: ReplacementEvent = {
      type: "life_loss",
      amount: 7,
      timestamp: Date.now(),
      targetId: "player1",
    };

    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(4); // ceil(7/2) = 4
  });
});

describe("ReplacementEffectManager - APNAP Order Creation", () => {
  let rem: ReplacementEffectManager;

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("should create correct APNAP order", () => {
    const allPlayers = ["player1", "player2", "player3", "player4"];

    // Player2 is active
    const order = rem.createAPNAPOrder("player2", allPlayers);

    expect(order.activePlayerId).toBe("player2");
    expect(order.playerOrder).toEqual([
      "player2",
      "player3",
      "player4",
      "player1",
    ]);
  });

  test("should handle single player", () => {
    const order = rem.createAPNAPOrder("player1", ["player1"]);
    expect(order.playerOrder).toEqual(["player1"]);
  });

  test("should handle unknown active player", () => {
    const allPlayers = ["player1", "player2"];
    const order = rem.createAPNAPOrder("unknown", allPlayers);
    expect(order.playerOrder).toEqual(allPlayers);
  });

  test("should apply multiplayer APNAP ordering with 4 players", () => {
    // 4-player game: P1(active) -> P2 -> P3 -> P4
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2", "player3", "player4"],
    };

    // Each player has an effect that doubles damage
    const effects: ReplacementAbility[] = [
      {
        id: "p1-double",
        sourceCardId: "p1-card",
        controllerId: "player1",
        effectType: "damage_replacement",
        description: "P1 doubles damage",
        layer: 5,
        timestamp: 100,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P1 doubled",
          instead: true,
        }),
      },
      {
        id: "p2-double",
        sourceCardId: "p2-card",
        controllerId: "player2",
        effectType: "damage_replacement",
        description: "P2 doubles damage",
        layer: 5,
        timestamp: 200,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P2 doubled",
          instead: true,
        }),
      },
      {
        id: "p3-double",
        sourceCardId: "p3-card",
        controllerId: "player3",
        effectType: "damage_replacement",
        description: "P3 doubles damage",
        layer: 5,
        timestamp: 300,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P3 doubled",
          instead: true,
        }),
      },
      {
        id: "p4-double",
        sourceCardId: "p4-card",
        controllerId: "player4",
        effectType: "damage_replacement",
        description: "P4 doubles damage",
        layer: 5,
        timestamp: 400,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P4 doubled",
          instead: true,
        }),
      },
    ];

    effects.forEach((e) => rem.registerEffect(e));

    const event: ReplacementEvent = {
      type: "damage",
      amount: 2,
      timestamp: Date.now(),
      targetId: "player3",
    };

    // APNAP order: P1 -> P2 -> P3 -> P4
    // P1 doubles: 2 * 2 = 4
    // P2 doubles: 4 * 2 = 8
    // P3 doubles: 8 * 2 = 16
    // P4 doubles: 16 * 2 = 32
    const processed = rem.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(32);
  });

  test("should apply APNAP ordering with different active player", () => {
    // Same 4 players, but P3 is active
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player3",
      playerOrder: ["player3", "player4", "player1", "player2"],
    };

    // Each player has an effect that doubles damage
    const effects: ReplacementAbility[] = [
      {
        id: "p1-double",
        sourceCardId: "p1-card",
        controllerId: "player1",
        effectType: "damage_replacement",
        description: "P1 doubles damage",
        layer: 5,
        timestamp: 100,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P1 doubled",
          instead: true,
        }),
      },
      {
        id: "p2-double",
        sourceCardId: "p2-card",
        controllerId: "player2",
        effectType: "damage_replacement",
        description: "P2 doubles damage",
        layer: 5,
        timestamp: 200,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P2 doubled",
          instead: true,
        }),
      },
      {
        id: "p3-double",
        sourceCardId: "p3-card",
        controllerId: "player3",
        effectType: "damage_replacement",
        description: "P3 doubles damage",
        layer: 5,
        timestamp: 300,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P3 doubled",
          instead: true,
        }),
      },
      {
        id: "p4-double",
        sourceCardId: "p4-card",
        controllerId: "player4",
        effectType: "damage_replacement",
        description: "P4 doubles damage",
        layer: 5,
        timestamp: 400,
        isInstead: true,
        canApply: (e) => e.type === "damage",
        apply: (e) => ({
          modified: true,
          modifiedEvent: { ...e, amount: e.amount * 2 },
          description: "P4 doubled",
          instead: true,
        }),
      },
    ];

    effects.forEach((e) => rem.registerEffect(e));

    const event: ReplacementEvent = {
      type: "damage",
      amount: 1,
      timestamp: Date.now(),
      targetId: "player1",
    };

    // APNAP order: P3 -> P4 -> P1 -> P2
    // P3 doubles: 1 * 2 = 2
    // P4 doubles: 2 * 2 = 4
    // P1 doubles: 4 * 2 = 8
    // P2 doubles: 8 * 2 = 16
    const processed = rem.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(16);
  });
});

describe("ReplacementEffectManager - Factory Functions", () => {
  let rem: ReplacementEffectManager;

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("createPreventionShield should create both ability and shield", () => {
    const { ability, shield } = createPreventionShield(
      "source",
      "player1",
      "player2",
      5,
      "Prevent 5 damage",
      "until_end_of_turn",
      ["combat"],
    );

    expect(ability.id).toMatch(/prevent-source-\d+/);
    expect(ability.effectType).toBe("damage_prevention");
    expect(ability.layer).toBe(1);
    expect(ability.preventionAmount).toBe(5);

    expect(shield.sourceId).toBe("source");
    expect(shield.amount).toBe(5);
    expect(shield.damageTypes).toEqual(["combat"]);
    expect(shield.controllerId).toBe("player1");
    expect(shield.expiresAt).toBeDefined();
  });

  test("createDamageReplacementEffect should create correct effect", () => {
    const effect = createDamageReplacementEffect(
      "furnace",
      "player1",
      "Double damage",
      (amount) => amount * 2,
      5,
      true,
    );

    expect(effect.isSelfReplacement).toBe(true);
    expect(effect.isInstead).toBe(true);
    expect(effect.layer).toBe(5);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 3,
      timestamp: Date.now(),
    };

    const result = effect.apply(event);
    expect(result.modified).toBe(true);
    expect(result.modifiedEvent?.amount).toBe(6);
    expect(result.instead).toBe(true);
  });

  test("createAsThoughEffect should create correct effect", () => {
    const effect = createAsThoughEffect(
      "source",
      "player1",
      "cast_flash",
      "Flash effect",
      undefined,
      "permanent",
    );

    expect(effect.asThoughType).toBe("cast_flash");
    expect(effect.duration).toBe("permanent");
    expect(effect.condition).toBeUndefined();
  });
});

describe("ReplacementEffectManager - CR 614.4 Loop Detection", () => {
  let rem: ReplacementEffectManager;

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("should detect and break a two-effect infinite loop (CR 614.4)", () => {
    // Effect A: If creature would be destroyed, instead exile it
    // Effect B: If creature would be exiled, instead return it to battlefield
    // This creates an infinite loop

    const effectA: ReplacementAbility = {
      id: "exile-on-destroy",
      sourceCardId: "card-a",
      controllerId: "player1",
      effectType: "destroy_replacement",
      description: "Exile instead of destroy",
      layer: 3,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "destroy" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "exile" as const },
        description: "Exiled instead of destroyed",
        instead: true,
      }),
    };

    const effectB: ReplacementAbility = {
      id: "return-on-exile",
      sourceCardId: "card-b",
      controllerId: "player1",
      effectType: "exile_replacement",
      description: "Return to battlefield instead of exile",
      layer: 3,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "exile" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "destroy" as const }, // Returns to destroy loop
        description: "Returned to battlefield instead of staying exiled",
        instead: true,
      }),
    };

    rem.registerEffect(effectA);
    rem.registerEffect(effectB);

    const event: ReplacementEvent = {
      type: "destroy",
      amount: 0,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    // CR 614.4: If replacement effects form an infinite loop, no objects are affected
    // The event should be skipped (amount = 0 means no effect applies)
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(0); // Loop detected, event skipped
  });

  test("should NOT detect loop when effects do not create circular state changes", () => {
    // Effect A: Doubles damage (layer 5)
    // Effect B: Prevents 2 damage (layer 1 - applies first)
    // These should apply normally without looping

    const doubleEffect: ReplacementAbility = {
      id: "double-effect",
      sourceCardId: "double-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Double damage",
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "Doubled",
        instead: true,
      }),
    };

    const reduceEffect: ReplacementAbility = {
      id: "reduce-effect",
      sourceCardId: "reduce-card",
      controllerId: "player1",
      effectType: "damage_prevention",
      description: "Reduce by 2",
      layer: 1,
      timestamp: 200,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: "Reduced by 2",
      }),
    };

    rem.registerEffect(doubleEffect);
    rem.registerEffect(reduceEffect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // No loop: Layer 1 applies first: 5 - 2 = 3, then Layer 5: 3 * 2 = 6
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(6);
  });

  test("should detect loop with three-effect cycle", () => {
    // Effect A: destroy -> exile
    // Effect B: exile -> tap
    // Effect C: tap -> destroy (back to start)

    const effectA: ReplacementAbility = {
      id: "cycle-a",
      sourceCardId: "card-a",
      controllerId: "player1",
      effectType: "destroy_replacement",
      description: "A: destroy->exile",
      layer: 3,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "destroy" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "exile" as const },
        description: "A applied",
        instead: true,
      }),
    };

    const effectB: ReplacementAbility = {
      id: "cycle-b",
      sourceCardId: "card-b",
      controllerId: "player1",
      effectType: "exile_replacement",
      description: "B: exile->tap",
      layer: 3,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "exile" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "tap" as const },
        description: "B applied",
        instead: true,
      }),
    };

    const effectC: ReplacementAbility = {
      id: "cycle-c",
      sourceCardId: "card-c",
      controllerId: "player1",
      effectType: "exile_replacement",
      description: "C: tap->destroy",
      layer: 3,
      timestamp: 300,
      isInstead: true,
      canApply: (e) => e.type === "tap" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "destroy" as const },
        description: "C applied",
        instead: true,
      }),
    };

    rem.registerEffect(effectA);
    rem.registerEffect(effectB);
    rem.registerEffect(effectC);

    const event: ReplacementEvent = {
      type: "destroy",
      amount: 0,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    // Three-effect loop detected, CR 614.4 applies
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(0); // Loop detected, event skipped
  });

  test("should use maxIterations cap as safety limit for potential infinite loops", () => {
    // Create a chain of effects where each transforms back to a type that triggers the first
    // But we use low maxIterations to catch it
    const effectA: ReplacementAbility = {
      id: "safe-a",
      sourceCardId: "card-a",
      controllerId: "player1",
      effectType: "destroy_replacement",
      description: "A: destroy->exile",
      layer: 3,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "destroy" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "exile" as const },
        description: "A applied",
        instead: true,
      }),
    };

    const effectB: ReplacementAbility = {
      id: "safe-b",
      sourceCardId: "card-b",
      controllerId: "player1",
      effectType: "exile_replacement",
      description: "B: exile->destroy",
      layer: 3,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "exile" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "destroy" as const },
        description: "B applied",
        instead: true,
      }),
    };

    rem.registerEffect(effectA);
    rem.registerEffect(effectB);

    const event: ReplacementEvent = {
      type: "destroy",
      amount: 0,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    // Very low maxIterations to trigger safety cap
    const processed = rem.processEvent(event, undefined);
    expect(processed.amount).toBe(0); // Hit cap, loop broken
  });

  test("should not skip event when maxIterations is high enough for non-looping effects", () => {
    // Effect that doubles damage - this is safe and won't loop
    const safeEffect: ReplacementAbility = {
      id: "safe-effect",
      sourceCardId: "safe-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Safe double",
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "Doubled safely",
        instead: true,
      }),
    };

    rem.registerEffect(safeEffect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // High maxIterations should not cause false positive
    const processed = rem.processEvent(event, undefined);
    expect(processed.amount).toBe(10); // 5 * 2 = 10
  });

  test("should handle single effect that does not loop", () => {
    // A single effect that modifies but doesn't create a loop
    const singleEffect: ReplacementAbility = {
      id: "single-effect",
      sourceCardId: "single-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Add 3 damage",
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount + 3 },
        description: "Added 3",
        instead: true,
      }),
    };

    rem.registerEffect(singleEffect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // Single effect applies once: 5 + 3 = 8
    const processed = rem.processEvent(event);
    expect(processed.amount).toBe(8);
  });
});

describe("ReplacementEffectManager - Multiple Game Instances", () => {
  /**
   * Issue #886: CRITICAL - Global singleton ReplacementEffectManager causes
   * race conditions with multiple game instances
   *
   * This test verifies that multiple ReplacementEffectManager instances can
   * operate independently without interference.
   */
  let rem1: ReplacementEffectManager;
  let rem2: ReplacementEffectManager;
  let rem3: ReplacementEffectManager;

  beforeEach(() => {
    rem1 = new ReplacementEffectManager();
    rem2 = new ReplacementEffectManager();
    rem3 = new ReplacementEffectManager();
  });

  test("should isolate effects between game instances", () => {
    // Game 1 has a damage doubling effect (Furnace of Rath)
    const furnaceEffect = createDamageReplacementEffect(
      "furnace1",
      "player1",
      "Furnace of Rath doubles damage",
      (amount) => amount * 2,
      5,
    );
    rem1.registerEffect(furnaceEffect);

    // Game 2 has a damage halving effect
    const halveEffect = createDamageReplacementEffect(
      "halver2",
      "player1",
      "Halve damage",
      (amount) => amount / 2,
      5,
    );
    rem2.registerEffect(halveEffect);

    // Game 3 has no replacement effects

    const event: ReplacementEvent = {
      type: "damage",
      amount: 10,
      timestamp: Date.now(),
      targetId: "player2",
    };

    // Game 1 should double: 10 * 2 = 20
    const processed1 = rem1.processEvent(event);
    expect(processed1.amount).toBe(20);

    // Game 2 should halve: 10 / 2 = 5
    const processed2 = rem2.processEvent(event);
    expect(processed2.amount).toBe(5);

    // Game 3 should not modify: 10
    const processed3 = rem3.processEvent(event);
    expect(processed3.amount).toBe(10);
  });

  test("should isolate prevention shields between game instances", () => {
    // Game 1 has a prevention shield of 5
    rem1.addPreventionShield("player1", {
      sourceId: "fog1",
      amount: 5,
      controllerId: "player1",
    });

    // Game 2 has a prevention shield of 3
    rem2.addPreventionShield("player1", {
      sourceId: "fog2",
      amount: 3,
      controllerId: "player1",
    });

    // Game 3 has no shields

    const shields1 = rem1.getPreventionShields("player1");
    const shields2 = rem2.getPreventionShields("player1");
    const shields3 = rem3.getPreventionShields("player1");

    expect(shields1).toHaveLength(1);
    expect(shields1[0].amount).toBe(5);
    expect(shields1[0].sourceId).toBe("fog1");

    expect(shields2).toHaveLength(1);
    expect(shields2[0].amount).toBe(3);
    expect(shields2[0].sourceId).toBe("fog2");

    expect(shields3).toHaveLength(0);
  });

  test("should isolate as-though effects between game instances", () => {
    const mockGameState = { players: new Map() } as GameState;

    // Game 1 has cast_flash effect
    rem1.registerAsThoughEffect(
      createAsThoughEffect("source1", "player1", "cast_flash", "Flash effect"),
    );

    // Game 2 has attack_haste effect
    rem2.registerAsThoughEffect(
      createAsThoughEffect(
        "source2",
        "player1",
        "attack_haste",
        "Haste effect",
      ),
    );

    // Game 3 has no effects

    // Game 1: should have cast_flash but not attack_haste
    expect(
      rem1.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(true);
    expect(
      rem1.checkAsThoughEffect("player1", "attack_haste", mockGameState),
    ).toBe(false);

    // Game 2: should have attack_haste but not cast_flash
    expect(
      rem2.checkAsThoughEffect("player1", "attack_haste", mockGameState),
    ).toBe(true);
    expect(
      rem2.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(false);

    // Game 3: should have neither
    expect(
      rem3.checkAsThoughEffect("player1", "cast_flash", mockGameState),
    ).toBe(false);
    expect(
      rem3.checkAsThoughEffect("player1", "attack_haste", mockGameState),
    ).toBe(false);
  });

  test("should handle concurrent event processing without interference", () => {
    // This simulates multiple games processing events concurrently
    const effect1 = createDamageReplacementEffect(
      "doubler1",
      "player1",
      "Double damage",
      (amount) => amount * 2,
      5,
    );
    rem1.registerEffect(effect1);

    const effect2 = createDamageReplacementEffect(
      "tripler2",
      "player1",
      "Triple damage",
      (amount) => amount * 3,
      5,
    );
    rem2.registerEffect(effect2);

    // Process many events in each game
    for (let i = 0; i < 100; i++) {
      const event1: ReplacementEvent = {
        type: "damage",
        amount: 5,
        timestamp: Date.now() + i,
        targetId: "player2",
      };

      const event2: ReplacementEvent = {
        type: "damage",
        amount: 5,
        timestamp: Date.now() + i,
        targetId: "player2",
      };

      const result1 = rem1.processEvent(event1);
      const result2 = rem2.processEvent(event2);

      // Game 1 should always double: 5 * 2 = 10
      expect(result1.amount).toBe(10);

      // Game 2 should always triple: 5 * 3 = 15
      expect(result2.amount).toBe(15);
    }
  });

  test("should isolate effect removal between game instances", () => {
    // Game 1 registers two effects
    const effect1 = createDamageReplacementEffect(
      "card1",
      "player1",
      "Effect 1",
      (amount) => amount * 2,
      5,
    );
    rem1.registerEffect(effect1);

    const effect2 = createDamageReplacementEffect(
      "card2",
      "player1",
      "Effect 2",
      (amount) => amount + 1,
      5,
    );
    rem1.registerEffect(effect2);

    // Game 2 registers one effect
    const effect3 = createDamageReplacementEffect(
      "card3",
      "player1",
      "Effect 3",
      (amount) => amount * 4,
      5,
    );
    rem2.registerEffect(effect3);

    // Remove effect from card1 in game 1 only
    rem1.removeEffectsFromSource("card1");

    // Game 1 should only have effect2
    const event1: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };
    const result1 = rem1.processEvent(event1);
    expect(result1.amount).toBe(6); // 5 + 1

    // Game 2 should still have effect3
    const event2: ReplacementEvent = {
      type: "damage",
      amount: 5,
      timestamp: Date.now(),
      targetId: "player2",
    };
    const result2 = rem2.processEvent(event2);
    expect(result2.amount).toBe(20); // 5 * 4
  });
});

/**
 * Issue #1227 — CR 616.1: when two or more non-self replacement /
 * prevention effects could apply to the same event, the affected
 * player or the controller of the affected permanent chooses which
 * one applies. The previous `chooseBestEffect` silently auto-resolved
 * via APNAP + timestamp tiebreakers; the new API surfaces a
 * `WaitingChoice` and provides a deterministic AI heuristic.
 */
describe("ReplacementEffectManager - CR 616.1 Interactive Controller Choice", () => {
  let rem: ReplacementEffectManager;

  const buildCompetingDamageEffects = () => {
    const prevention: ReplacementAbility = {
      id: "prevent-2",
      sourceCardId: "ward-creature",
      controllerId: "player1",
      effectType: "damage_prevention",
      description: "If ~ would be dealt damage, prevent 2 of it",
      layer: 1,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: "Prevented 2",
        instead: true,
      }),
    };

    const redirect: ReplacementAbility = {
      id: "redirect-1",
      sourceCardId: "shield-creature",
      controllerId: "player2",
      effectType: "damage_replacement",
      description: "If ~ would be dealt damage, redirect it to player2",
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, targetId: "player2" as PlayerId },
        description: "Redirected",
        instead: true,
      }),
    };

    return { prevention, redirect };
  };

  beforeEach(() => {
    rem = new ReplacementEffectManager();
  });

  test("surfaces requiresChoice when two non-self replacement effects compete", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
      sourceId: "attacker",
    };

    const outcome = rem.processEventInteractive(event, undefined, {
      affectedPlayerId: "player1",
    });

    expect(outcome.requiresChoice).toBe(true);
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.appliedEffects).toEqual([]);
    expect(outcome.affectedPlayerId).toBe("player1");
    const ids = (outcome.candidates ?? []).map((c) => c.id).sort();
    expect(ids).toEqual(["prevent-2", "redirect-1"]);
  });

  test("does NOT surface a choice when only one non-self replacement effect applies", () => {
    const { prevention } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const outcome = rem.processEventInteractive(event, undefined, {
      affectedPlayerId: "player1",
    });

    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.appliedEffects).toHaveLength(1);
    expect(outcome.appliedEffects[0].id).toBe("prevent-2");
    expect(outcome.event.amount).toBe(2); // 4 - 2
  });

  test("does NOT surface a choice when self-replacement is the only competing effect", () => {
    const selfReplacement: ReplacementAbility = {
      id: "self-replace",
      sourceCardId: "self-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "If this creature would be dealt damage, double it",
      layer: 5,
      timestamp: 100,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: "Doubled by self",
        instead: true,
      }),
    };
    rem.registerEffect(selfReplacement);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 3,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const outcome = rem.processEventInteractive(event, undefined, {
      affectedPlayerId: "player1",
    });

    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.appliedEffects).toHaveLength(1);
    expect(outcome.event.amount).toBe(6);
  });

  test("self-replacement applies first even when non-self competition exists later", () => {
    const selfReplacement: ReplacementAbility = {
      id: "self-add",
      sourceCardId: "self-card",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "Self: +1",
      layer: 5,
      timestamp: 100,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount + 1 },
        description: "+1",
        instead: true,
      }),
    };
    const { prevention, redirect } = buildCompetingDamageEffects();
    rem.registerEffect(selfReplacement);
    rem.registerEffect(prevention);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const outcome = rem.processEventInteractive(event, undefined, {
      affectedPlayerId: "player1",
    });

    // Self applies first: 4 + 1 = 5. Then 2 non-self compete → choice.
    expect(outcome.requiresChoice).toBe(true);
    expect(outcome.appliedEffects.map((e) => e.id)).toEqual(["self-add"]);
    expect(outcome.candidates?.map((c) => c.id).sort()).toEqual([
      "prevent-2",
      "redirect-1",
    ]);
  });

  test("each competing candidate can be picked and applied individually", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    // Pick the prevention effect
    const pickedPrevention = rem.resolveReplacementChoice("prevent-2", {
      event,
      applied: [],
      affectedPlayerId: "player1",
    });
    expect(pickedPrevention.requiresChoice).toBe(false);
    expect(pickedPrevention.appliedEffects.map((e) => e.id)).toContain(
      "prevent-2",
    );
    expect(pickedPrevention.event.amount).toBe(2);

    // Pick the redirect effect on a fresh event
    const pickedRedirect = rem.resolveReplacementChoice("redirect-1", {
      event,
      applied: [],
      affectedPlayerId: "player1",
    });
    expect(pickedRedirect.requiresChoice).toBe(false);
    expect(pickedRedirect.appliedEffects.map((e) => e.id)).toContain(
      "redirect-1",
    );
    expect(pickedRedirect.event.targetId).toBe("player2");
    expect(pickedRedirect.event.amount).toBe(4);
  });

  test("resolveReplacementChoice continues the chain after picking one effect", () => {
    // Setup: one picked effect (prevention) + one follow-up effect (halve)
    // that the chain should apply automatically without re-prompting.
    // The CR 616.1 player choice is resolved, the picked effect applies,
    // and the next iteration runs the follow-up by itself because no
    // other candidates remain for that modified event.
    const prevention: ReplacementAbility = {
      id: "prevent-2",
      sourceCardId: "ward-creature",
      controllerId: "player1",
      effectType: "damage_prevention",
      description: "If ~ would be dealt damage, prevent 2 of it",
      layer: 1,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: "Prevented 2",
        instead: true,
      }),
    };

    const followupHalve: ReplacementAbility = {
      id: "halve-after",
      sourceCardId: "post-pick-card",
      controllerId: "player2",
      effectType: "damage_replacement",
      description: "After the choice, halve damage",
      layer: 3,
      timestamp: 300,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.ceil(e.amount / 2) },
        description: "Halved",
        instead: true,
      }),
    };

    // Single competitor (the redirect) lets us isolate the choice.
    const redirect: ReplacementAbility = {
      id: "redirect-only",
      sourceCardId: "shield-creature",
      controllerId: "player2",
      effectType: "damage_replacement",
      description: "redirect",
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) =>
        e.type === "damage" && e.targetId === "creature1" && e.amount === 4,
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, targetId: "player2" as PlayerId },
        description: "redirected",
        instead: true,
      }),
    };

    rem.registerEffect(prevention);
    rem.registerEffect(followupHalve);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const outcome = rem.resolveReplacementChoice("prevent-2", {
      event,
      applied: [],
      affectedPlayerId: "player1",
    });

    // Prevention reduces to 2; halve-after: ceil(2 / 2) = 1.
    // The redirect no longer applies (its canApply requires amount === 4).
    // The chain resumes without re-prompting.
    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.event.amount).toBe(1);
    expect(outcome.appliedEffects.map((e) => e.id)).toEqual([
      "prevent-2",
      "halve-after",
    ]);
  });

  test("resolveReplacementChoice records the picked effect exactly once and excludes unpicked peers", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    // Restrict redirect so post-pick the chain resolves automatically
    // (no second competing effect to re-prompt).
    const redirectScoped: ReplacementAbility = {
      ...redirect,
      canApply: (e) =>
        e.type === "damage" && e.targetId === "creature1" && e.amount === 4,
    };

    rem.registerEffect(prevention);
    rem.registerEffect(redirectScoped);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const outcome = rem.resolveReplacementChoice("prevent-2", {
      event,
      applied: [],
      affectedPlayerId: "player1",
    });

    // The picked effect (prevent-2) is applied exactly once.
    const pickedOccurrences = outcome.appliedEffects.filter(
      (e) => e.id === "prevent-2",
    ).length;
    expect(pickedOccurrences).toBe(1);
    // The unpicked competitor (redirect) does NOT appear in appliedEffects,
    // because the picked effect dominated the original event and the
    // scoped competitor can no longer apply to the modified event.
    const unpickedOccurrences = outcome.appliedEffects.filter(
      (e) => e.id === "redirect-1",
    ).length;
    expect(unpickedOccurrences).toBe(0);
    expect(outcome.event.amount).toBe(2);
  });

  test("resolveReplacementChoice throws when the picked id is not in the candidate set", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    expect(() =>
      rem.resolveReplacementChoice("not-a-real-id", {
        event,
        applied: [],
        affectedPlayerId: "player1",
      }),
    ).toThrow(/not-a-real-id/);
  });

  test("autoResolveReplacementChoice prefers the affected player's own effect (CR 616.1)", () => {
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2"],
    };
    const { prevention, redirect } = buildCompetingDamageEffects();
    // prevention is controlled by player1 (the affected player)
    // redirect  is controlled by player2

    const picked = rem.autoResolveReplacementChoice(
      [prevention, redirect],
      "player1",
      apnapOrder,
    );
    expect(picked).toBe("prevent-2");
  });

  test("autoResolveReplacementChoice falls back to APNAP when neither candidate is owned by the affected player", () => {
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2", "player3"],
    };
    const competingNonPlayer1: ReplacementAbility[] = [
      {
        id: "p3-effect",
        sourceCardId: "card3",
        controllerId: "player3",
        effectType: "damage_replacement",
        description: "p3",
        layer: 5,
        timestamp: 100,
        isInstead: true,
        canApply: () => true,
        apply: (e) => ({ modified: false, description: "noop" }),
      },
      {
        id: "p2-effect",
        sourceCardId: "card2",
        controllerId: "player2",
        effectType: "damage_replacement",
        description: "p2",
        layer: 5,
        timestamp: 100,
        isInstead: true,
        canApply: () => true,
        apply: (e) => ({ modified: false, description: "noop" }),
      },
    ];
    // Affected player is player2 — player2 owns one of them.
    const picked = rem.autoResolveReplacementChoice(
      competingNonPlayer1,
      "player2",
      apnapOrder,
    );
    expect(picked).toBe("p2-effect");
  });

  test("autoResolveReplacementChoice uses layer then timestamp tiebreaker", () => {
    const a: ReplacementAbility = {
      id: "layer-2-ts-200",
      sourceCardId: "card-a",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "a",
      layer: 2,
      timestamp: 200,
      isInstead: true,
      canApply: () => true,
      apply: (e) => ({ modified: false, description: "noop" }),
    };
    const b: ReplacementAbility = {
      id: "layer-1-ts-100",
      sourceCardId: "card-b",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "b",
      layer: 1,
      timestamp: 100,
      isInstead: true,
      canApply: () => true,
      apply: (e) => ({ modified: false, description: "noop" }),
    };
    const picked = rem.autoResolveReplacementChoice([a, b], "player3");
    expect(picked).toBe("layer-1-ts-100");
  });

  test("autoResolveReplacementChoice is deterministic across multiple invocations", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    const apnapOrder: APNAPOrder = {
      activePlayerId: "player1",
      playerOrder: ["player1", "player2"],
    };
    const first = rem.autoResolveReplacementChoice(
      [redirect, prevention],
      "player1",
      apnapOrder,
    );
    const second = rem.autoResolveReplacementChoice(
      [prevention, redirect],
      "player1",
      apnapOrder,
    );
    expect(first).toBe(second);
  });

  test("createReplacementWaitingChoice builds a WaitingChoice of type choose_replacement", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    const choice = rem.createReplacementWaitingChoice(
      [prevention, redirect],
      "player1",
      "Pick one:",
    );
    expect(choice.type).toBe("choose_replacement");
    expect(choice.playerId).toBe("player1");
    expect(choice.choices).toHaveLength(2);
    expect(choice.minChoices).toBe(1);
    expect(choice.maxChoices).toBe(1);
    expect(choice.prompt).toBe("Pick one:");
    const labels = choice.choices.map((c) => c.label).sort();
    expect(labels).toEqual(
      [
        "If ~ would be dealt damage, prevent 2 of it",
        "If ~ would be dealt damage, redirect it to player2",
      ].sort(),
    );
  });

  test("getCompetingReplacementEffects returns [] when fewer than 2 non-self effects apply", () => {
    const { prevention } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const competing = rem.getCompetingReplacementEffects(event);
    expect(competing).toEqual([]);
  });

  test("getCompetingReplacementEffects excludes self-replacements", () => {
    const selfReplace: ReplacementAbility = {
      id: "self-only",
      sourceCardId: "card-self",
      controllerId: "player1",
      effectType: "damage_replacement",
      description: "self only",
      layer: 5,
      timestamp: 100,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) => e.type === "damage" && e.targetId === "creature1",
      apply: (e) => ({ modified: false, description: "noop" }),
    };
    const { prevention } = buildCompetingDamageEffects();
    rem.registerEffect(selfReplace);
    rem.registerEffect(prevention);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const competing = rem.getCompetingReplacementEffects(event);
    // Only the one non-self effect — not enough to trigger a choice.
    expect(competing).toEqual([]);
  });

  test("end-to-end: AI uses autoResolve then resolveReplacementChoice with the same id", () => {
    const { prevention, redirect } = buildCompetingDamageEffects();
    rem.registerEffect(prevention);
    rem.registerEffect(redirect);

    const event: ReplacementEvent = {
      type: "damage",
      amount: 4,
      timestamp: Date.now(),
      targetId: "creature1",
    };

    const survey = rem.processEventInteractive(event, undefined, {
      affectedPlayerId: "player1",
    });
    expect(survey.requiresChoice).toBe(true);
    const candidates = survey.candidates ?? [];
    expect(candidates).toHaveLength(2);

    const pickedId = rem.autoResolveReplacementChoice(
      candidates,
      "player1",
    );
    const outcome = rem.resolveReplacementChoice(pickedId, {
      event,
      applied: [],
      affectedPlayerId: "player1",
    });

    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.appliedEffects.map((e) => e.id)).toContain(pickedId);
    expect(outcome.event.amount).toBeLessThanOrEqual(4);
  });
});

