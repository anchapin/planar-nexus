/**
 * Ward Keyword System Tests — CR 702.21
 *
 * Issue #920: the ward keyword was an unimplemented stub; targeted spells and
 * abilities were never countered for non-payment. These tests cover the full
 * ward lifecycle: keyword/cost detection, trigger detection, payment, and the
 * resolution-time countering wired into resolveTopOfStack.
 *
 * NOTE: `evergreen-keywords.test.ts` is in the repo's jest
 * `testPathIgnorePatterns`, so this file is the one that actually runs in CI.
 */

import {
  hasWard,
  getWardCost,
  isProtectedByWard,
  getKeywordDescriptions,
  getAllKeywords,
} from "../evergreen-keywords";
import {
  parseWardCostString,
  getWardCostDescriptor,
  canPayWardCost,
  detectWardTriggers,
  applyWardResolution,
  payWardCost,
  declineWardPayment,
} from "../ward-system";
import { resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import type {
  CardInstance,
  CardInstanceId,
  PlayerId,
  StackEffect,
  StackObject,
  Target,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWardedCreature(
  name: string,
  oracleText: string,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: "3",
    toughness: "3",
    keywords,
    oracle_text: oracleText,
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createPlainCreature(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: "2",
    toughness: "2",
    keywords: [],
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

/**
 * Build a 2-player game where Bob controls a warded creature and Alice (who will
 * be the caster) has plenty of mana.
 */
function setupWardScenario(wardedCardData: ScryfallCard): {
  state: ReturnType<typeof startGame>;
  aliceId: PlayerId;
  bobId: PlayerId;
  wardedCreatureId: CardInstanceId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  // Bob controls the warded creature.
  const creature = createCardInstance(wardedCardData, bobId, bobId);
  state.cards.set(creature.id, creature);

  const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
  state.zones.set(`${bobId}-battlefield`, {
    ...bobBattlefield,
    cardIds: [...bobBattlefield.cardIds, creature.id],
  });

  // Alice has mana available to pay ward costs.
  state = addMana(state, aliceId, { blue: 6, generic: 6 });

  return { state, aliceId, bobId, wardedCreatureId: creature.id };
}

let stackCounter = 0;
function makeTargetingStackObject(
  controllerId: PlayerId,
  targets: Target[],
  effects: StackEffect[] = [],
  extra: Partial<StackObject> = {},
): StackObject {
  stackCounter += 1;
  return {
    id: `ward-spell-${stackCounter}`,
    type: "ability",
    sourceCardId: null,
    controllerId,
    name: "Targeting Ability",
    text: "",
    manaCost: null,
    targets,
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    effects,
    ...extra,
  };
}

function damageEffect(targetId: CardInstanceId, amount = 1): StackEffect {
  return {
    effectType: "damage",
    amount,
    targetId,
    isCombatDamage: false,
  };
}

function creatureDamage(
  state: ReturnType<typeof startGame>,
  cardId: CardInstanceId,
): number {
  return state.cards.get(cardId)?.damage ?? -1;
}

// ---------------------------------------------------------------------------
// Keyword detection & cost parsing
// ---------------------------------------------------------------------------

describe("Ward keyword detection", () => {
  const make = (oracle: string, keywords: string[] = []): CardInstance =>
    createCardInstance(
      createWardedCreature("Warded", oracle, keywords),
      "p1" as PlayerId,
      "p1" as PlayerId,
    );

  it("detects ward via keywords array", () => {
    expect(hasWard(make("Ward {2}", ["Ward"]))).toBe(true);
  });

  it("detects ward via oracle text only", () => {
    expect(hasWard(make("Ward {1}"))).toBe(true);
  });

  it("does not false-positive on words containing 'ward'", () => {
    const card = createCardInstance(
      createPlainCreature("Warden of the Depths"),
      "p1" as PlayerId,
      "p1" as PlayerId,
    );
    // Name/oracle without a standalone "ward" keyword should not count.
    expect(hasWard(card)).toBe(false);
  });

  it("parses mana ward cost", () => {
    expect(getWardCost(make("Ward {3}"))).toBe("{3}");
  });

  it("parses multi-symbol mana ward cost", () => {
    expect(getWardCost(make("Ward {1}{U}"))).toBe("{1}{U}");
  });

  it("parses life ward cost", () => {
    expect(getWardCost(make("Ward—Pay 3 life."))).toBe("3");
  });

  it("returns default ward cost for plain ward", () => {
    expect(getWardCost(make("Ward"))).toBe("{2}");
  });

  it("returns null ward cost for non-ward card", () => {
    expect(
      getWardCost(
        createCardInstance(
          createPlainCreature("X"),
          "p1" as PlayerId,
          "p1" as PlayerId,
        ),
      ),
    ).toBeNull();
  });

  it("includes ward in keyword descriptions", () => {
    expect(getKeywordDescriptions(make("Ward {2}"))).toContain("Ward {2}");
  });

  it("includes ward in all keywords", () => {
    expect(
      getAllKeywords(make("Ward {1}")).map((k) => k.toLowerCase()),
    ).toContain("ward");
  });
});

describe("Ward cost descriptor & affordability", () => {
  it("parses mana cost string", () => {
    const desc = parseWardCostString("{1}{U}");
    expect(desc?.kind).toBe("mana");
    expect(desc).toMatchObject({ kind: "mana", generic: 1, blue: 1 });
  });

  it("parses life cost string", () => {
    expect(parseWardCostString("3")).toMatchObject({ kind: "life", amount: 3 });
  });

  it("returns null for null input", () => {
    expect(parseWardCostString(null)).toBeNull();
  });

  it("getWardCostDescriptor returns null for non-ward card", () => {
    expect(
      getWardCostDescriptor(
        createCardInstance(
          createPlainCreature("X"),
          "p1" as PlayerId,
          "p1" as PlayerId,
        ),
      ),
    ).toBeNull();
  });

  it("canPayWardCost returns true when mana is available", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const aliceId = Array.from(state.players.keys())[0];
    state = addMana(state, aliceId, { blue: 2, generic: 3 });
    const player = state.players.get(aliceId)!;
    expect(
      canPayWardCost(player, {
        kind: "mana",
        generic: 3,
        white: 0,
        blue: 1,
        black: 0,
        red: 0,
        green: 0,
      }),
    ).toBe(true);
  });

  it("canPayWardCost returns false when colored mana is insufficient", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const aliceId = Array.from(state.players.keys())[0];
    state = addMana(state, aliceId, { generic: 5 });
    const player = state.players.get(aliceId)!;
    expect(
      canPayWardCost(player, {
        kind: "mana",
        generic: 1,
        white: 0,
        blue: 2,
        black: 0,
        red: 0,
        green: 0,
      }),
    ).toBe(false);
  });

  it("canPayWardCost respects life total", () => {
    let state = createInitialGameState(["Alice"], 5, false);
    state = startGame(state);
    const aliceId = Array.from(state.players.keys())[0];
    const player = state.players.get(aliceId)!;
    expect(canPayWardCost(player, { kind: "life", amount: 3 })).toBe(true);
    expect(canPayWardCost(player, { kind: "life", amount: 6 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isProtectedByWard
// ---------------------------------------------------------------------------

describe("isProtectedByWard", () => {
  it("protects against opponents only", () => {
    const card = createCardInstance(
      createWardedCreature("W", "Ward {2}"),
      "bob" as PlayerId,
      "bob" as PlayerId,
    );
    expect(isProtectedByWard(card, "alice" as PlayerId)).toBe(true);
    expect(isProtectedByWard(card, "bob" as PlayerId)).toBe(false);
  });

  it("does not protect non-ward cards", () => {
    const card = createCardInstance(
      createPlainCreature("Plain"),
      "bob" as PlayerId,
      "bob" as PlayerId,
    );
    expect(isProtectedByWard(card, "alice" as PlayerId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

describe("detectWardTriggers", () => {
  it("triggers when targeting an opponent's warded permanent", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    const triggers = detectWardTriggers(state, stackObject);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].targetCardId).toBe(wardedCreatureId);
    expect(triggers[0].cost).toMatchObject({ kind: "mana", generic: 2 });
  });

  it("does not trigger for the controller's own warded permanent", () => {
    const { state, bobId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    // Bob targeting his own warded creature.
    const stackObject = makeTargetingStackObject(bobId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    expect(detectWardTriggers(state, stackObject)).toHaveLength(0);
  });

  it("does not trigger for a non-warded target", () => {
    const { state, aliceId, bobId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    // Add a plain creature Bob controls and target it instead.
    const plain = createCardInstance(
      createPlainCreature("Plain"),
      bobId,
      bobId,
    );
    state.cards.set(plain.id, plain);
    const bf = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, plain.id],
    });

    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: plain.id, isValid: true },
    ]);
    expect(detectWardTriggers(state, stackObject)).toHaveLength(0);
  });

  it("ignores player targets", () => {
    const { state, aliceId, bobId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "player", targetId: bobId, isValid: true },
    ]);
    expect(detectWardTriggers(state, stackObject)).toHaveLength(0);
  });

  it("ignores non-targeted spells/abilities", () => {
    const { state, aliceId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, []);
    expect(detectWardTriggers(state, stackObject)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution countering (the core fix for #920)
// ---------------------------------------------------------------------------

describe("applyWardResolution", () => {
  it("counters when ward is unpaid", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    const result = applyWardResolution(state, stackObject);
    expect(result.countered).toBe(true);
    expect(result.unpaidTriggers).toHaveLength(1);
  });

  it("does not counter when ward is paid", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    stackObject.wardPaidTargetIds = [wardedCreatureId];
    expect(applyWardResolution(state, stackObject).countered).toBe(false);
  });

  it("does not counter when there are no ward triggers", () => {
    const { state, aliceId, bobId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const plain = createCardInstance(
      createPlainCreature("Plain"),
      bobId,
      bobId,
    );
    state.cards.set(plain.id, plain);
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: plain.id, isValid: true },
    ]);
    expect(applyWardResolution(state, stackObject).countered).toBe(false);
  });
});

describe("Ward resolution via resolveTopOfStack", () => {
  it("counters an unpaid targeting spell — spell has no effect", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    state.stack = [
      makeTargetingStackObject(
        aliceId,
        [{ type: "card", targetId: wardedCreatureId, isValid: true }],
        [damageEffect(wardedCreatureId, 1)],
      ),
    ];

    const result = resolveTopOfStack(state);

    // Spell removed from the stack (countered).
    expect(result.stack).toHaveLength(0);
    // Ward countered the spell, so the damage effect never applied.
    expect(creatureDamage(result, wardedCreatureId)).toBe(0);
  });

  it("resolves normally when the ward cost is paid", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(
      aliceId,
      [{ type: "card", targetId: wardedCreatureId, isValid: true }],
      [damageEffect(wardedCreatureId, 1)],
    );
    state.stack = [stackObject];

    // Alice pays the ward cost.
    const payResult = payWardCost(state, stackObject.id, wardedCreatureId);
    expect(payResult.success).toBe(true);

    const result = resolveTopOfStack(payResult.state);

    expect(result.stack).toHaveLength(0);
    // Spell resolved: the damage effect applied.
    expect(creatureDamage(result, wardedCreatureId)).toBe(1);
  });

  it("does not trigger ward for the controller's own spell on their own permanent", () => {
    const { state, bobId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    state.stack = [
      makeTargetingStackObject(
        bobId,
        [{ type: "card", targetId: wardedCreatureId, isValid: true }],
        [damageEffect(wardedCreatureId, 1)],
      ),
    ];

    const result = resolveTopOfStack(state);
    expect(result.stack).toHaveLength(0);
    // No ward for own spell: effect resolves normally.
    expect(creatureDamage(result, wardedCreatureId)).toBe(1);
  });

  it("ignores ward for non-targeted spells", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    // No targets, no ward trigger; resolution is unaffected.
    state.stack = [makeTargetingStackObject(aliceId, [], [])];

    const result = resolveTopOfStack(state);
    expect(result.stack).toHaveLength(0);
    expect(creatureDamage(result, wardedCreatureId)).toBe(0);
  });

  it("counters when the ward cost cannot be paid (insufficient mana)", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {8}"),
    );
    // Drain Alice's mana so she cannot pay {8}.
    const aliceIdLocal = aliceId;
    const player = state.players.get(aliceIdLocal)!;
    state.players.set(aliceIdLocal, {
      ...player,
      manaPool: { ...player.manaPool, blue: 0, generic: 0, colorless: 0 },
    });

    state.stack = [
      makeTargetingStackObject(
        aliceId,
        [{ type: "card", targetId: wardedCreatureId, isValid: true }],
        [damageEffect(wardedCreatureId, 1)],
      ),
    ];

    // Attempting to pay fails because she cannot afford it.
    const payResult = payWardCost(state, state.stack[0].id, wardedCreatureId);
    expect(payResult.success).toBe(false);

    const result = resolveTopOfStack(state);
    expect(result.stack).toHaveLength(0);
    expect(creatureDamage(result, wardedCreatureId)).toBe(0);
  });

  it("counters if ANY of multiple warded targets is unpaid", () => {
    const {
      state,
      aliceId,
      bobId,
      wardedCreatureId: firstWarded,
    } = setupWardScenario(createWardedCreature("Warded One", "Ward {2}"));
    // Second warded creature for Bob.
    const second = createCardInstance(
      createWardedCreature("Warded Two", "Ward {1}"),
      bobId,
      bobId,
    );
    state.cards.set(second.id, second);
    const bf = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, second.id],
    });

    const stackObject = makeTargetingStackObject(
      aliceId,
      [
        { type: "card", targetId: firstWarded, isValid: true },
        { type: "card", targetId: second.id, isValid: true },
      ],
      [damageEffect(firstWarded, 1)],
    );
    state.stack = [stackObject];

    // Pay for the first target only.
    const payResult = payWardCost(state, stackObject.id, firstWarded);
    expect(payResult.success).toBe(true);

    const result = resolveTopOfStack(payResult.state);
    // Second ward unpaid -> whole spell countered.
    expect(result.stack).toHaveLength(0);
    expect(creatureDamage(result, firstWarded)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// payWardCost / declineWardPayment
// ---------------------------------------------------------------------------

describe("payWardCost", () => {
  it("spends mana and records the payment", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    state.stack = [stackObject];

    const before = state.players.get(aliceId)!.manaPool;
    const result = payWardCost(state, stackObject.id, wardedCreatureId);

    expect(result.success).toBe(true);
    const paid = result.state.stack.find((s) => s.id === stackObject.id)!;
    expect(paid.wardPaidTargetIds).toContain(wardedCreatureId);
    // Mana was spent.
    const after = result.state.players.get(aliceId)!.manaPool;
    expect(after.generic + after.blue).toBeLessThan(
      before.generic + before.blue,
    );
  });

  it("fails when the player cannot afford the cost", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {50}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    state.stack = [stackObject];

    const result = payWardCost(state, stackObject.id, wardedCreatureId);
    expect(result.success).toBe(false);
  });

  it("spends life for a life-ward", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Life Warded", "Ward—Pay 3 life."),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    state.stack = [stackObject];

    const lifeBefore = state.players.get(aliceId)!.life;
    const result = payWardCost(state, stackObject.id, wardedCreatureId);
    expect(result.success).toBe(true);
    expect(result.state.players.get(aliceId)!.life).toBe(lifeBefore - 3);
  });

  it("declineWardPayment is a no-op that leaves the spell unpaid", () => {
    const { state, aliceId, wardedCreatureId } = setupWardScenario(
      createWardedCreature("Warded", "Ward {2}"),
    );
    const stackObject = makeTargetingStackObject(aliceId, [
      { type: "card", targetId: wardedCreatureId, isValid: true },
    ]);
    state.stack = [stackObject];

    const result = declineWardPayment(state, stackObject.id, wardedCreatureId);
    expect(result.success).toBe(true);
    expect(result.state.stack[0].wardPaidTargetIds ?? []).not.toContain(
      wardedCreatureId,
    );
  });
});
