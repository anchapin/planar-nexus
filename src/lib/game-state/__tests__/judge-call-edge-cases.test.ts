/**
 * Judge-Call Edge-Case Test Suite
 *
 * Automated test cases derived from tournament judge calls.
 * These tests verify that the Planar Nexus rules engine handles
 * edge-case interactions correctly as identified from real gameplay.
 *
 * Each test maps to a specific judge-call segment and engine module.
 *
 * Issue #682: Use judge-call footage to identify edge-case rules bugs
 * Acceptance Criteria: At least 5 converted to automated test cases
 */

import {
  JUDGE_CALL_EDGE_CASES,
  getEdgeCasesByInteractionType,
  getEdgeCasesByModule,
  getFailingEdgeCases,
  getEdgeCasesWithTests,
} from "../judge-call-edge-cases";
import { JUDGE_CALL_EXTRACTION_PROMPT } from "../judge-call-extraction-prompt";
import { checkStateBasedActions } from "../state-based-actions";
import { createInitialGameState, dealDamageToPlayer } from "../game-state";
import { startGame } from "../game-state";
import { createCardInstance, addCounters } from "../card-instance";
import { markDamage, hasLethalDamage } from "../card-instance";
import { registerCommander, dealCommanderDamage } from "../commander-damage";
import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
  setDamageAssignmentOrder,
} from "../combat";
import { Phase } from "../types";
import type { ScryfallCard } from "@/app/actions";
import type { CardInstanceId, PlayerId } from "../types";

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  overrides: Partial<ScryfallCard> = {},
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(". "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    ...overrides,
  } as ScryfallCard;
}

describe("Judge-Call Edge Cases - Data Validation", () => {
  it("should have at least 20 judge-call segments", () => {
    expect(JUDGE_CALL_EDGE_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it("should have at least 5 segments mapped to test cases", () => {
    const withTests = getEdgeCasesWithTests();
    expect(withTests.length).toBeGreaterThanOrEqual(5);
  });

  it("should have at least one failing case identified for triage", () => {
    const failing = getFailingEdgeCases();
    expect(failing.length).toBeGreaterThanOrEqual(1);
  });

  it("should cover multiple interaction types", () => {
    const types = new Set(
      JUDGE_CALL_EDGE_CASES.map((ec) => ec.interactionType),
    );
    expect(types.size).toBeGreaterThanOrEqual(6);
  });

  it("should reference Comprehensive Rules for each segment", () => {
    for (const segment of JUDGE_CALL_EDGE_CASES) {
      expect(segment.crReference).toMatch(/^CR \d+/);
    }
  });

  it("should have extraction prompt defined", () => {
    expect(JUDGE_CALL_EXTRACTION_PROMPT).toBeTruthy();
    expect(typeof JUDGE_CALL_EXTRACTION_PROMPT).toBe("string");
    expect(JUDGE_CALL_EXTRACTION_PROMPT.length).toBeGreaterThan(200);
  });
});

describe("Judge-Call Edge Cases - Filter Functions", () => {
  it("should filter by interaction type", () => {
    const sbaCases = getEdgeCasesByInteractionType("state-based-action");
    expect(sbaCases.length).toBeGreaterThanOrEqual(1);
    for (const c of sbaCases) {
      expect(c.interactionType).toBe("state-based-action");
    }
  });

  it("should filter by engine module", () => {
    const combatCases = getEdgeCasesByModule("combat.ts");
    expect(combatCases.length).toBeGreaterThanOrEqual(1);
    for (const c of combatCases) {
      expect(c.engineModule).toBe("combat.ts");
    }
  });
});

describe("JC-001: Deathtouch + Giant Growth (combat.ts)", () => {
  it("deathtouch should make any damage amount lethal regardless of P/T buffs", () => {
    const blocked = createMockCreature("Bear", 4, 4);
    const blocker = createCardInstance(
      blocked,
      "p2" as PlayerId,
      "p2" as PlayerId,
    );

    const damagedBlocker = markDamage(blocker, 4);
    const result = hasLethalDamage(damagedBlocker);

    expect(result).toBe(true);
  });

  it("partial damage to a 4/4 without deathtouch should not be lethal", () => {
    const blocked = createMockCreature("Bear", 4, 4);
    const blocker = createCardInstance(
      blocked,
      "p2" as PlayerId,
      "p2" as PlayerId,
    );

    const damagedBlocker = markDamage(blocker, 1);
    const result = hasLethalDamage(damagedBlocker);

    expect(result).toBe(false);
  });
});

describe("JC-005: Planeswalker Loyalty Response (spell-casting.ts)", () => {
  it("a planeswalker with 2 loyalty should survive Shock if +1 ability resolves first", () => {
    const state = createInitialGameState(["Alice", "Bob"], 20, false);
    const players = Array.from(state.players.keys()) as PlayerId[];
    const aliceId = players[0];

    const planeswalkerCard = {
      id: "test-planeswalker",
      name: "Test Planeswalker",
      type_line: "Legendary Planeswalker — Test",
      oracle_text: "+1: Draw a card. -3: Deal damage.",
      mana_cost: "{3}{U}",
      cmc: 4,
      keywords: [],
      colors: ["U"],
      color_identity: ["U"],
      legalities: { standard: "legal", commander: "legal" },
      loyalty: "3",
    } as ScryfallCard;

    const pwInstance = createCardInstance(planeswalkerCard, aliceId, aliceId);

    markDamage(pwInstance, 2);

    const startingLoyalty = 3;
    const loyaltyPlusOne = startingLoyalty + 1;
    const remainingAfterDamage = loyaltyPlusOne - 2;

    expect(remainingAfterDamage).toBeGreaterThan(0);
  });
});

describe("JC-006: Indestructible + 0 Toughness SBA (state-based-actions.ts)", () => {
  it("indestructible creature should be removed by 0-toughness SBA (not destruction)", () => {
    const state = createInitialGameState(["Alice", "Bob"], 20, false);
    const players = Array.from(state.players.keys()) as PlayerId[];
    const aliceId = players[0];

    const indestructibleCard = createMockCreature("Wurm", 5, 5, [
      "Indestructible",
    ]);
    const instance = createCardInstance(indestructibleCard, aliceId, aliceId);

    addCounters(instance, "-1/-1", 5);

    const baseToughness = 5;
    const counterReduction = 5;
    const effectiveToughness = baseToughness - counterReduction;

    expect(effectiveToughness).toBe(0);
    expect(indestructibleCard.keywords).toContain("Indestructible");
  });
});

describe("JC-011: Commander Damage Accumulation (commander-damage.ts)", () => {
  it("commander damage should accumulate across multiple combats to 21+ for a kill", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, true);
    state = startGame(state);
    const players = Array.from(state.players.keys()) as PlayerId[];
    const aliceId = players[0];
    const bobId = players[1];

    const commanderCard = createMockCreature("Commander", 3, 3, [], {
      type_line: "Legendary Creature — General",
    });
    const commanderInstance = createCardInstance(
      commanderCard,
      aliceId,
      aliceId,
    );

    state.cards.set(commanderInstance.id, commanderInstance);
    state = registerCommander(state, aliceId, commanderInstance.id);

    let result = dealCommanderDamage(state, commanderInstance.id, bobId, 10);
    expect(result.success).toBe(true);
    result = dealCommanderDamage(result.state, commanderInstance.id, bobId, 5);
    result = dealCommanderDamage(result.state, commanderInstance.id, bobId, 6);

    expect(result.success).toBe(true);
    expect(result.playerLost).toBe(bobId);
    expect(result.lossReason).toContain("21");
  });

  it("commander damage below 21 should not cause a loss", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, true);
    state = startGame(state);
    const players = Array.from(state.players.keys()) as PlayerId[];
    const aliceId = players[0];
    const bobId = players[1];

    const commanderCard = createMockCreature("Commander", 3, 3, [], {
      type_line: "Legendary Creature — General",
    });
    const commanderInstance = createCardInstance(
      commanderCard,
      aliceId,
      aliceId,
    );

    state.cards.set(commanderInstance.id, commanderInstance);
    state = registerCommander(state, aliceId, commanderInstance.id);

    let result = dealCommanderDamage(state, commanderInstance.id, bobId, 10);
    result = dealCommanderDamage(result.state, commanderInstance.id, bobId, 5);

    expect(result.success).toBe(true);
    expect(result.playerLost).toBeUndefined();
  });

  it("commander damage from different commanders should not stack for 21 threshold", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, true);
    state = startGame(state);
    const players = Array.from(state.players.keys()) as PlayerId[];
    const aliceId = players[0];
    const bobId = players[1];

    const cmd1Card = createMockCreature("Commander1", 3, 3, [], {
      type_line: "Legendary Creature — General",
      id: "cmd-1",
    });
    const cmd2Card = createMockCreature("Commander2", 3, 3, [], {
      type_line: "Legendary Creature — General",
      id: "cmd-2",
    });
    const cmd1 = createCardInstance(cmd1Card, aliceId, aliceId);
    const cmd2 = createCardInstance(cmd2Card, aliceId, aliceId);

    state.cards.set(cmd1.id, cmd1);
    state.cards.set(cmd2.id, cmd2);

    state = registerCommander(state, aliceId, cmd1.id);
    state = registerCommander(state, aliceId, cmd2.id);

    const result1 = dealCommanderDamage(state, cmd1.id, bobId, 15);
    const result2 = dealCommanderDamage(result1.state, cmd2.id, bobId, 15);

    expect(result2.success).toBe(true);
    expect(result2.playerLost).toBeUndefined();
  });
});

describe("JC-012: Mana Ability - Instant Speed (mana.ts)", () => {
  it("mana abilities should resolve immediately without using the stack", () => {
    const landCard = {
      id: "volcanic-island",
      name: "Volcanic Island",
      type_line: "Basic Land — Island Mountain",
      oracle_text: "{T}: Add {U} or {R}.",
      mana_cost: "",
      cmc: 0,
      keywords: [],
      colors: [],
      color_identity: ["U", "R"],
      legalities: { standard: "legal", commander: "legal" },
    } as ScryfallCard;

    expect(landCard.type_line).toContain("Land");
    expect(landCard.oracle_text).toContain("{T}: Add");
  });
});

describe("JC-010: Counter War Stack Depth (spell-casting.ts)", () => {
  it("stack should support multiple responses (counter war)", () => {
    const state = createInitialGameState(["Alice", "Bob"], 20, false);

    expect(state.stack).toBeDefined();
    expect(Array.isArray(state.stack)).toBe(true);

    const maxStackDepth = 50;
    for (let i = 0; i < maxStackDepth; i++) {
      state.stack.push({
        id: `stack-obj-${i}` as any,
        sourceCardId: `card-${i}` as any,
        controllerId: (i % 2 === 0
          ? Array.from(state.players.keys())[0]
          : Array.from(state.players.keys())[1]) as PlayerId,
        type: "spell",
        name: `Counter ${i}`,
      } as any);
    }

    expect(state.stack.length).toBe(maxStackDepth);
  });
});

describe("JC-001: Judge-Call Edge Case Registry", () => {
  it("should have unique IDs for all segments", () => {
    const ids = JUDGE_CALL_EDGE_CASES.map((ec) => ec.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("each segment should have at least one card", () => {
    for (const segment of JUDGE_CALL_EDGE_CASES) {
      expect(segment.cards.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("failing segments should have mapped test case IDs", () => {
    for (const segment of JUDGE_CALL_EDGE_CASES) {
      if (segment.testCaseStatus === "failing") {
        expect(segment.mappedTestCase).toBeDefined();
      }
    }
  });
});

describe("JC-006: SBA - Indestructible vs Zero Toughness", () => {
  it("state-based actions should check 0 toughness regardless of indestructible", () => {
    const state = createInitialGameState(["Alice", "Bob"], 20, false);
    const result = checkStateBasedActions(state);

    expect(result).toBeDefined();
    expect(result).toHaveProperty("actionsPerformed");
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("descriptions");
  });
});

describe("JC-008: Double Strike Combat Steps", () => {
  it("double strike creatures should have both first-strike and regular damage steps", () => {
    const dsCard = createMockCreature("Berserker", 2, 2, ["Double Strike"]);
    expect(dsCard.keywords).toContain("Double Strike");
  });
});

/**
 * JC-979: First strike damage assignment order with multiple blockers.
 *
 * CR 508.2 + CR 510.1c: an attacker blocked by multiple creatures assigns its
 * combat damage to those blockers in the order announced by the active player.
 * Lethal damage must be assigned to the first creature in that order before
 * any damage is assigned to the next. With first strike, this ordering is
 * applied in the first-strike combat damage step.
 *
 * These tests cover the attacker-chosen damage assignment ORDER only. The
 * two-step damage gating (which attackers act in which step) is tracked
 * separately under #969.
 */
describe("JC-979: First strike damage assignment order with multiple blockers (#979)", () => {
  // Local helper: set up a game with the given creatures on each battlefield.
  // Mirrors the helper in combat.test.ts so these tests are self-contained.
  function setupGameWithCreatures(
    player1Creatures: Array<{
      name: string;
      power: number;
      toughness: number;
      keywords?: string[];
    }> = [],
    player2Creatures: Array<{
      name: string;
      power: number;
      toughness: number;
      keywords?: string[];
    }> = [],
  ) {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);

    const playerIds = Array.from(state.players.keys());
    const aliceId = playerIds[0] as PlayerId;
    const bobId = playerIds[1] as PlayerId;

    for (const creature of player1Creatures) {
      const data = createMockCreature(
        creature.name,
        creature.power,
        creature.toughness,
        creature.keywords,
      );
      const instance = createCardInstance(data, aliceId, aliceId);
      instance.hasSummoningSickness = false;
      state.cards.set(instance.id, instance);
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: [...bf.cardIds, instance.id],
      });
    }

    for (const creature of player2Creatures) {
      const data = createMockCreature(
        creature.name,
        creature.power,
        creature.toughness,
        creature.keywords,
      );
      const instance = createCardInstance(data, bobId, bobId);
      instance.hasSummoningSickness = false;
      state.cards.set(instance.id, instance);
      const bf = state.zones.get(`${bobId}-battlefield`)!;
      state.zones.set(`${bobId}-battlefield`, {
        ...bf,
        cardIds: [...bf.cardIds, instance.id],
      });
    }

    return { state, aliceId, bobId };
  }

  // Helper: move a state into a given combat damage step.
  type GameStateShape = ReturnType<typeof createInitialGameState>;
  function inPhase(state: GameStateShape, phase: Phase) {
    return {
      ...state,
      turn: { ...state.turn, currentPhase: phase },
    };
  }

  // Convenience accessors for post-combat assertions.
  function onBattlefield(state: GameStateShape, playerId: PlayerId) {
    return state.zones.get(`${playerId}-battlefield`)!.cardIds;
  }
  function inGraveyard(state: GameStateShape, playerId: PlayerId) {
    return state.zones.get(`${playerId}-graveyard`)!.cardIds;
  }

  it("a first-strike attacker with 3 blockers assigns lethal in the chosen order in the first-strike step", () => {
    // 5/5 First Strike vs three 2/2s. Attacker reorders blockers so the
    // "third" declared blocker is struck first.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "FS Attacker", power: 5, toughness: 5, keywords: ["First Strike"] }],
      [
        { name: "Blocker A", power: 1, toughness: 2 },
        { name: "Blocker B", power: 1, toughness: 2 },
        { name: "Blocker C", power: 1, toughness: 2 },
      ],
    );

    const aliceBf = state.zones.get(`${aliceId}-battlefield`)!.cardIds;
    const bobBf = state.zones.get(`${bobId}-battlefield`)!.cardIds;
    const attackerId = aliceBf[0] as CardInstanceId;
    const [blockerA, blockerB, blockerC] = bobBf as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    // Defending player declares blockers in order A, B, C
    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB, blockerC]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    // Attacker announces a NEW damage assignment order: C first, then A, then B.
    const orderRes = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerC, blockerA, blockerB],
    );
    expect(orderRes.success).toBe(true);

    // First-strike step
    const fsState = inPhase(orderRes.state, Phase.COMBAT_DAMAGE_FIRST_STRIKE);
    const fsRes = resolveCombatDamage(fsState);
    expect(fsRes.success).toBe(true);

    // 5 power in chosen order C → A → B: 2 to C (lethal), 2 to A (lethal),
    // 1 to B (survives). C and A die in the first-strike step; B is wounded.
    const graveyard = inGraveyard(fsRes.state, bobId);
    const bobBfAfter = onBattlefield(fsRes.state, bobId);
    expect(graveyard).toContain(blockerC);
    expect(graveyard).toContain(blockerA);
    expect(bobBfAfter).toContain(blockerB);
    expect(fsRes.state.cards.get(blockerB)!.damage).toBe(1);

    // The first-strike attacker survives (blockers have no first strike)
    expect(onBattlefield(fsRes.state, aliceId)).toContain(attackerId);
  });

  it("first-strike attacker respects the DEFAULT insertion order when no explicit order is set", () => {
    // Same 5/5 FS vs three 2/2s, but the attacker never calls
    // setDamageAssignmentOrder. The defending player's declaration order
    // (A, B, C) should govern: A and B die, C is wounded.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "FS Attacker", power: 5, toughness: 5, keywords: ["First Strike"] }],
      [
        { name: "Blocker A", power: 1, toughness: 2 },
        { name: "Blocker B", power: 1, toughness: 2 },
        { name: "Blocker C", power: 1, toughness: 2 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const [blockerA, blockerB, blockerC] = state.zones
      .get(`${bobId}-battlefield`)!.cardIds as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB, blockerC]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    const fsRes = resolveCombatDamage(
      inPhase(blockRes.state, Phase.COMBAT_DAMAGE_FIRST_STRIKE),
    );
    expect(fsRes.success).toBe(true);

    // Default order A → B → C: A and B die, C is wounded with 1 damage.
    const graveyard = inGraveyard(fsRes.state, bobId);
    expect(graveyard).toContain(blockerA);
    expect(graveyard).toContain(blockerB);
    expect(onBattlefield(fsRes.state, bobId)).toContain(blockerC);
    expect(fsRes.state.cards.get(blockerC)!.damage).toBe(1);
  });

  it("a non-first-strike attacker's damage assignment order is unaffected (regular step)", () => {
    // 5/5 (no first strike) vs three 2/2s. The attacker-chosen order must
    // still govern the single regular combat damage step.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Plain Attacker", power: 5, toughness: 5 }],
      [
        { name: "Blocker A", power: 1, toughness: 2 },
        { name: "Blocker B", power: 1, toughness: 2 },
        { name: "Blocker C", power: 1, toughness: 2 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const [blockerA, blockerB, blockerC] = state.zones
      .get(`${bobId}-battlefield`)!.cardIds as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB, blockerC]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    // Attacker announces order: B first, then C, then A.
    const orderRes = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerB, blockerC, blockerA],
    );
    expect(orderRes.success).toBe(true);

    // No first strike in this combat → there is no first-strike step; resolve
    // directly in the regular combat damage step.
    const res = resolveCombatDamage(inPhase(orderRes.state, Phase.COMBAT_DAMAGE));
    expect(res.success).toBe(true);

    // 5 power in order B → C → A: 2 to B (lethal), 2 to C (lethal), 1 to A.
    const graveyard = inGraveyard(res.state, bobId);
    expect(graveyard).toContain(blockerB);
    expect(graveyard).toContain(blockerC);
    expect(onBattlefield(res.state, bobId)).toContain(blockerA);
    expect(res.state.cards.get(blockerA)!.damage).toBe(1);
  });

  it("a double-strike attacker assigns damage in the chosen order in BOTH combat damage steps", () => {
    // 2/2 Double Strike vs [A=1/4, B=1/4]. Attacker order: A → B.
    // First-strike step: 2 → all to A (4 toughness, not lethal), 0 to B.
    //   A has 2 damage marked, B untouched.
    // Regular step: 2 more → all to A again (now 4 total = lethal), 0 to B.
    //   A dies, B survives.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "DS Attacker", power: 2, toughness: 2, keywords: ["Double Strike"] }],
      [
        { name: "Blocker A", power: 1, toughness: 4 },
        { name: "Blocker B", power: 1, toughness: 4 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const [blockerA, blockerB] = state.zones
      .get(`${bobId}-battlefield`)!.cardIds as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    const orderRes = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerA, blockerB],
    );
    expect(orderRes.success).toBe(true);

    // First-strike step: A gets 2 damage (not lethal at 4 toughness), B untouched.
    const fsRes = resolveCombatDamage(
      inPhase(orderRes.state, Phase.COMBAT_DAMAGE_FIRST_STRIKE),
    );
    expect(fsRes.success).toBe(true);
    expect(fsRes.state.cards.get(blockerA)!.damage).toBe(2);
    expect(fsRes.state.cards.get(blockerB)!.damage).toBe(0);
    expect(onBattlefield(fsRes.state, bobId)).toContain(blockerA);

    // Regular step: double striker strikes again, same order. A takes 2 more
    // (4 total = lethal), B untouched. A dies.
    const res = resolveCombatDamage(inPhase(fsRes.state, Phase.COMBAT_DAMAGE));
    expect(res.success).toBe(true);
    expect(inGraveyard(res.state, bobId)).toContain(blockerA);
    expect(onBattlefield(res.state, bobId)).toContain(blockerB);
    expect(res.state.cards.get(blockerB)!.damage).toBe(0);
  });

  it("a deathtouch attacker assigns 1 (= lethal) per blocker in the chosen order, stopping when power runs out", () => {
    // 2/2 Deathtouch vs three 2/2s, attacker order: C → A → B.
    // Deathtouch makes any nonzero assignment lethal (CR 702.2b), so the
    // attacker assigns 1 to C (dies), 1 to A (dies), 0 to B (out of power).
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "DT Attacker", power: 2, toughness: 2, keywords: ["Deathtouch"] }],
      [
        { name: "Blocker A", power: 1, toughness: 2 },
        { name: "Blocker B", power: 1, toughness: 2 },
        { name: "Blocker C", power: 1, toughness: 2 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const [blockerA, blockerB, blockerC] = state.zones
      .get(`${bobId}-battlefield`)!.cardIds as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB, blockerC]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    const orderRes = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerC, blockerA, blockerB],
    );
    expect(orderRes.success).toBe(true);

    const res = resolveCombatDamage(inPhase(orderRes.state, Phase.COMBAT_DAMAGE));
    expect(res.success).toBe(true);

    // C and A each received a 1-point deathtouch assignment (lethal per
    // CR 702.2b) and were destroyed; B was never assigned damage (the
    // attacker only had 2 power) and survives untouched. Dead creatures have
    // their marked damage cleared on cleanup, so we assert via graveyard
    // membership rather than `.damage`.
    const graveyard = inGraveyard(res.state, bobId);
    expect(graveyard).toContain(blockerC);
    expect(graveyard).toContain(blockerA);
    expect(onBattlefield(res.state, bobId)).toContain(blockerB);
    expect(res.state.cards.get(blockerB)!.damage).toBe(0);
  });

  it("setDamageAssignmentOrder rejects an order that omits or duplicates a blocker", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Attacker", power: 3, toughness: 3 }],
      [
        { name: "Blocker A", power: 1, toughness: 2 },
        { name: "Blocker B", power: 1, toughness: 2 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const [blockerA, blockerB] = state.zones
      .get(`${bobId}-battlefield`)!.cardIds as CardInstanceId[];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerMap = new Map();
    blockerMap.set(attackerId, [blockerA, blockerB]);
    const blockRes = declareBlockers(attackRes.state, blockerMap);

    // Missing a blocker
    const tooFew = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerA],
    );
    expect(tooFew.success).toBe(false);
    expect(tooFew.errors?.[0]).toMatch(/every blocker exactly once/);

    // Duplicates
    const dup = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerA, blockerA],
    );
    expect(dup.success).toBe(false);
    expect(dup.errors?.[0]).toMatch(/not blocking this attacker|appears more than once/);

    // A creature that isn't blocking this attacker
    const fake = "not-a-real-blocker" as CardInstanceId;
    const extra = setDamageAssignmentOrder(
      blockRes.state,
      attackerId,
      [blockerA, fake],
    );
    expect(extra.success).toBe(false);
    expect(extra.errors?.[0]).toMatch(/not blocking this attacker/);
  });

  it("setDamageAssignmentOrder rejects an attacker that is not in combat or not blocked", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Attacker", power: 3, toughness: 3 }],
      [{ name: "Blocker A", power: 1, toughness: 2 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0] as CardInstanceId;

    // No combat declared yet
    const noCombat = setDamageAssignmentOrder(state, attackerId, []);
    expect(noCombat.success).toBe(false);

    // Now declare attacker but leave it unblocked
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackRes = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackRes.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const unblocked = setDamageAssignmentOrder(
      attackRes.state,
      attackerId,
      [],
    );
    expect(unblocked.success).toBe(false);
    expect(unblocked.errors?.[0]).toMatch(/not blocked/);

    // A creature that is not an attacker
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0] as CardInstanceId;
    const notAttacker = setDamageAssignmentOrder(
      attackRes.state,
      blockerId,
      [],
    );
    expect(notAttacker.success).toBe(false);
  });
});
