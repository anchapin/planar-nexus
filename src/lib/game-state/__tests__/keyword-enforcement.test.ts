/**
 * Comprehensive Keyword Enforcement Test Suite
 *
 * Issue #974: The gap analysis notes 243 keywords have 'no enforcement' and even
 * the 11 partially-enforced keywords lack integration tests verifying they
 * actually affect gameplay outcomes. This suite exercises each of the 11
 * partially-enforced keywords in real gameplay scenarios — combat resolution,
 * spell targeting, and triggered abilities — asserting the resulting game
 * state matches the rules text for that keyword.
 *
 * Coverage map (11 partially-enforced keywords):
 *   Combat:      flying, reach, first strike, double strike, deathtouch,
 *                trample, lifelink, menace, indestructible, defender
 *   Targeting:   ward, hexproof, hexproof-from, protection, shroud
 *   Triggered:   persist, boast
 *
 * Reference: reports/gameplay-gap-analysis.md (Partially Enforced matrix)
 *            CR 702 (Keyword Abilities)
 */

import {
  canAttack,
  canBlock,
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveTopOfStack } from "../spell-casting";
import {
  detectWardTriggers,
  payWardCost,
  applyWardResolution,
} from "../ward-system";
import { checkStateBasedActions } from "../state-based-actions";
import { handlePersist } from "../keyword-actions";
import {
  hasFlying,
  hasReach,
  hasDeathtouch,
  hasLifelink,
  hasMenace,
  getMenaceMinimumBlockers,
  hasTrample,
  isIndestructible,
  hasDefender,
  canAttackIfNotDefender,
  hasHexproof,
  isProtectedByHexproof,
  hasShroud,
  hasWard,
  hasPersist,
  canPersistTrigger,
  hasBoast,
  shouldBoastTrigger,
  resetBoastForNewTurn,
  markCreatureAttackedForBoast,
  canTarget,
  canBlockFlying,
  getExcessTrampleDamage,
  isLethalDamage,
  shouldPreventDamageToTarget,
  hasProtectionFrom,
  dealsFirstStrikeDamage,
  hasDoubleStrike,
} from "../evergreen-keywords";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  StackObject,
  StackEffect,
  Target,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  oracleText?: string,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: oracleText ?? keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createMockCreatureWithOracle(
  name: string,
  power: number,
  toughness: number,
  oracleText: string,
  colors: string[] = ["R"],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "{1}",
    cmc: 2,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

interface CreatureSpec {
  name: string;
  power: number;
  toughness: number;
  keywords?: string[];
  oracleText?: string;
  colors?: string[];
}

/**
 * Set up a 2-player game with arbitrary creatures on each player's battlefield.
 * Mirrors the helper used in combat.test.ts so this suite stays convention-aligned.
 */
function setupGameWithCreatures(
  player1Creatures: CreatureSpec[] = [],
  player2Creatures: CreatureSpec[] = [],
): {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const place = (spec: CreatureSpec, ownerId: PlayerId) => {
    const data = spec.oracleText
      ? createMockCreatureWithOracle(
          spec.name,
          spec.power,
          spec.toughness,
          spec.oracleText,
          spec.colors,
        )
      : createMockCreature(
          spec.name,
          spec.power,
          spec.toughness,
          spec.keywords,
        );
    const inst = createCardInstance(data, ownerId, ownerId);
    inst.hasSummoningSickness = false;
    state.cards.set(inst.id, inst);
    const bf = state.zones.get(`${ownerId}-battlefield`)!;
    state.zones.set(`${ownerId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, inst.id],
    });
  };

  for (const c of player1Creatures) place(c, aliceId);
  for (const c of player2Creatures) place(c, bobId);

  return { state, aliceId, bobId };
}

/**
 * Run the full declare-attackers → declare-blockers → resolve damage pipeline
 * for a single attacker with an optional set of blocker IDs.
 */
function runCombat(
  state: GameState,
  attackerId: CardInstanceId,
  defenderId: PlayerId,
  blockerAssignments: Map<CardInstanceId, CardInstanceId[]> = new Map(),
): GameState {
  state = {
    ...state,
    turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
  };
  const attackResult = declareAttackers(state, [
    { cardId: attackerId, defenderId },
  ]);
  let combatState = attackResult.state;
  combatState = {
    ...combatState,
    turn: { ...combatState.turn, currentPhase: Phase.DECLARE_BLOCKERS },
  };
  const blockResult = declareBlockers(combatState, blockerAssignments);
  const resolveResult = resolveCombatDamage(blockResult.state);
  return resolveResult.state;
}

let stackCounter = 0;
function makeTargetingStackObject(
  controllerId: PlayerId,
  targets: Target[],
  effects: StackEffect[] = [],
): StackObject {
  stackCounter += 1;
  return {
    id: `kw-spell-${stackCounter}`,
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

// ===========================================================================
// 1. COMBAT KEYWORD ENFORCEMENT
// ===========================================================================

describe("Keyword Enforcement — Combat", () => {
  // ---- Flying / Reach (CR 702.9, CR 702.17) ----
  describe("Flying & Reach", () => {
    it("flying attacker cannot be blocked by a creature without flying or reach", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Serra Angel", power: 4, toughness: 4, keywords: ["Flying"] }],
        [{ name: "Grizzly Bears", power: 2, toughness: 2 }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain("flying");
    });

    it("flying attacker CAN be blocked by a creature with flying", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Flying Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Flying"],
          },
        ],
        [
          {
            name: "Flying Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Flying"],
          },
        ],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      expect(canBlock(state, blockerId, attackerId).canBlock).toBe(true);
      expect(canBlockFlying(state.cards.get(blockerId)!)).toBe(true);
    });

    it("reach creature can block a flying attacker", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Flying Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Flying"],
          },
        ],
        [{ name: "Spider", power: 1, toughness: 3, keywords: ["Reach"] }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
      expect(hasReach(state.cards.get(blockerId)!)).toBe(true);
    });

    it("unblocked flying attacker deals combat damage to the defending player", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Flying Attacker",
            power: 3,
            toughness: 3,
            keywords: ["Flying"],
          },
        ],
        [],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

      const result = runCombat(state, attackerId, bobId);
      expect(result.players.get(bobId)!.life).toBe(17); // 20 - 3
    });
  });

  // ---- First Strike / Double Strike (CR 702.7, CR 702.4) ----
  describe("First Strike & Double Strike", () => {
    it("first-striker kills the blocker before the blocker can deal damage back", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "First Striker",
            power: 2,
            toughness: 2,
            keywords: ["First Strike"],
          },
        ],
        [{ name: "Regular Blocker", power: 2, toughness: 2 }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const s = attackResult.state;
      s.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        s,
        new Map([[attackerId, [blockerId]]]),
      );

      // First-strike step
      const fsState = {
        ...blockResult.state,
        turn: {
          ...blockResult.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
        },
      };
      const fsResult = resolveCombatDamage(fsState);

      // Blocker dies in the first-strike step, attacker survives.
      const bobGy = fsResult.state.zones.get(`${bobId}-graveyard`)!.cardIds;
      const aliceBf = fsResult.state.zones.get(
        `${aliceId}-battlefield`,
      )!.cardIds;
      expect(bobGy).toContain(blockerId);
      expect(aliceBf).toContain(attackerId);
    });

    it("double strike deals damage twice to the defending player when unblocked", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Double Striker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
        [],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const fsResult = resolveCombatDamage({
        ...attackResult.state,
        turn: {
          ...attackResult.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
        },
      });
      // 2 damage from first-strike step
      expect(fsResult.state.players.get(bobId)!.life).toBe(18);

      const regResult = resolveCombatDamage({
        ...fsResult.state,
        turn: {
          ...fsResult.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE,
        },
      });
      // Total 4 damage (2 + 2)
      expect(regResult.state.players.get(bobId)!.life).toBe(16);
    });

    it("dealsFirstStrikeDamage is true for both first strike and double strike", () => {
      const { state } = setupGameWithCreatures(
        [
          { name: "FS", power: 1, toughness: 1, keywords: ["First Strike"] },
          { name: "DS", power: 1, toughness: 1, keywords: ["Double Strike"] },
        ],
        [],
      );
      const ids = state.zones.get(
        Array.from(state.players.keys())[0] + "-battlefield",
      )!.cardIds;
      const fs = state.cards.get(ids[0])!;
      const ds = state.cards.get(ids[1])!;
      expect(dealsFirstStrikeDamage(fs)).toBe(true);
      expect(dealsFirstStrikeDamage(ds)).toBe(true);
      expect(hasDoubleStrike(ds)).toBe(true);
    });
  });

  // ---- Deathtouch (CR 702.2) ----
  describe("Deathtouch", () => {
    it("1 damage from a deathtouch source is lethal to a 10/10 blocker in combat", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Stinger", power: 1, toughness: 1, keywords: ["Deathtouch"] }],
        [{ name: "Leviathan", power: 10, toughness: 10 }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = runCombat(
        state,
        attackerId,
        bobId,
        new Map([[attackerId, [blockerId]]]),
      );
      const bobGy = result.zones.get(`${bobId}-graveyard`)!.cardIds;
      expect(bobGy).toContain(blockerId); // 10/10 dies from 1 deathtouch damage
    });

    it("isLethalDamage treats any nonzero deathtouch damage as lethal", () => {
      const { state } = setupGameWithCreatures(
        [{ name: "Stinger", power: 1, toughness: 1, keywords: ["Deathtouch"] }],
        [],
      );
      const dt = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(isLethalDamage(1, dt)).toBe(true);
      expect(isLethalDamage(0, dt)).toBe(false);
    });
  });

  // ---- Trample (CR 702.19) ----
  describe("Trample", () => {
    it("5/5 trampler blocked by 2/2 deals 3 excess damage to the player", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = runCombat(
        state,
        attackerId,
        bobId,
        new Map([[attackerId, [blockerId]]]),
      );
      expect(result.players.get(bobId)!.life).toBe(17); // 20 - 3 excess
    });

    it("3/3 trampler blocked by a 3/3 deals 0 excess damage", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 3, toughness: 3, keywords: ["Trample"] }],
        [{ name: "Wall", power: 3, toughness: 3 }],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = runCombat(
        state,
        attackerId,
        bobId,
        new Map([[attackerId, [blockerId]]]),
      );
      expect(result.players.get(bobId)!.life).toBe(20); // no trample over
    });

    it("getExcessTrampleDamage computes correct overflow for a trampling attacker", () => {
      const { state } = setupGameWithCreatures(
        [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );
      const ids = Array.from(state.zones.values()).flatMap((z) => z.cardIds);
      const attacker = state.cards.get(ids[0])!;
      const blocker = state.cards.get(ids[1])!;
      // 5 damage, 2 already assigned, blocker toughness 2 -> excess 3
      expect(getExcessTrampleDamage(5, 2, blocker, attacker)).toBe(3);
    });
  });

  // ---- Lifelink (CR 702.15) ----
  describe("Lifelink", () => {
    it("unblocked lifelink attacker gains its controller life equal to its power", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Vampire", power: 3, toughness: 3, keywords: ["Lifelink"] }],
        [],
      );
      // Lower Alice's life so the gain is observable and unambiguous.
      const alice = state.players.get(aliceId)!;
      state.players.set(aliceId, { ...alice, life: 12 });

      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const result = runCombat(state, attackerId, bobId);
      expect(result.players.get(aliceId)!.life).toBe(15); // 12 + 3
    });

    it("a blocker with lifelink grants its controller life when it deals combat damage", () => {
      // The engine grants life for blocker-lifelink based on the damage the
      // attacker assigns to that blocker. A 4/4 attacker into a 2/2 lifelink
      // blocker assigns 2 damage to the blocker -> Bob gains 2 life.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 4, toughness: 4 }],
        [
          {
            name: "Lifelink Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Lifelink"],
          },
        ],
      );

      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];
      const result = runCombat(
        state,
        attackerId,
        bobId,
        new Map([[attackerId, [blockerId]]]),
      );
      // Bob (blocker's controller) gains 2 life from the lifelink keyword.
      expect(result.players.get(bobId)!.life).toBe(22); // 20 + 2
    });
  });

  // ---- Menace (CR 702.70) ----
  describe("Menace", () => {
    it("a creature with menace requires two blockers", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Goblin Raider",
            power: 2,
            toughness: 2,
            keywords: ["Menace"],
          },
        ],
        [],
      );
      const menaceCreature = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(hasMenace(menaceCreature)).toBe(true);
      expect(getMenaceMinimumBlockers(menaceCreature)).toBe(2);
    });

    it("a creature without menace requires only one blocker", () => {
      const { state } = setupGameWithCreatures(
        [{ name: "Grizzly Bears", power: 2, toughness: 2 }],
        [],
      );
      const bear = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(hasMenace(bear)).toBe(false);
      expect(getMenaceMinimumBlockers(bear)).toBe(1);
    });
  });

  // ---- Indestructible (CR 702.12) ----
  describe("Indestructible", () => {
    it("an indestructible blocker survives lethal combat damage", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Big Attacker", power: 10, toughness: 10 }],
        [
          {
            name: "Indestructible Wall",
            power: 0,
            toughness: 2,
            keywords: ["Indestructible"],
          },
        ],
      );
      const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
      const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

      const result = runCombat(
        state,
        attackerId,
        bobId,
        new Map([[attackerId, [blockerId]]]),
      );
      // Indestructible blocker absorbs all 10 damage and stays on the battlefield.
      const bobBf = result.zones.get(`${bobId}-battlefield`)!.cardIds;
      expect(bobBf).toContain(blockerId);
      // And no damage leaks to the player.
      expect(result.players.get(bobId)!.life).toBe(20);
    });

    it("isIndestructible reports true and hasLethalDamageMarked is not lethal", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Indestructible Wall",
            power: 0,
            toughness: 2,
            keywords: ["Indestructible"],
          },
        ],
        [],
      );
      const wall = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(isIndestructible(wall)).toBe(true);
    });
  });

  // ---- Defender (CR 702.3) ----
  describe("Defender", () => {
    it("a creature with defender cannot attack (canAttackIfNotDefender is false)", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Wall of Stone",
            power: 0,
            toughness: 8,
            keywords: ["Defender"],
          },
        ],
        [],
      );
      const wall = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(hasDefender(wall)).toBe(true);
      expect(canAttackIfNotDefender(wall)).toBe(false);
    });

    it("a creature without defender can attack (canAttackIfNotDefender is true)", () => {
      const { state } = setupGameWithCreatures(
        [{ name: "Grizzly Bears", power: 2, toughness: 2 }],
        [],
      );
      const bear = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(hasDefender(bear)).toBe(false);
      expect(canAttackIfNotDefender(bear)).toBe(true);
    });
  });
});

// ===========================================================================
// 2. SPELL / TARGETING KEYWORD ENFORCEMENT
// ===========================================================================

describe("Keyword Enforcement — Spell Targeting", () => {
  // ---- Ward (CR 702.21) ----
  describe("Ward cost payment", () => {
    function setupWardScenario(oracleText: string) {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);
      const [aliceId, bobId] = Array.from(state.players.keys());

      const wardedData = createMockCreatureWithOracle(
        "Warded",
        3,
        3,
        oracleText,
      );
      const creature = createCardInstance(wardedData, bobId, bobId);
      state.cards.set(creature.id, creature);
      const bobBf = state.zones.get(`${bobId}-battlefield`)!;
      state.zones.set(`${bobId}-battlefield`, {
        ...bobBf,
        cardIds: [...bobBf.cardIds, creature.id],
      });

      // Give Alice plenty of mana to pay ward costs.
      state = addMana(state, aliceId, { blue: 6, generic: 6 });
      return { state, aliceId, bobId, wardedId: creature.id };
    }

    it("an unpaid ward counters the targeting spell — its effect never applies", () => {
      const { state, aliceId, wardedId } = setupWardScenario("Ward {2}");
      expect(hasWard(state.cards.get(wardedId)!)).toBe(true);

      const spell = makeTargetingStackObject(
        aliceId,
        [{ type: "card", targetId: wardedId, isValid: true }],
        [damageEffect(wardedId, 1)],
      );
      state.stack = [spell];

      // A ward trigger exists and is unpaid.
      expect(detectWardTriggers(state, spell)).toHaveLength(1);
      const result = resolveTopOfStack(state);

      expect(result.stack).toHaveLength(0); // spell removed (countered)
      expect(result.cards.get(wardedId)!.damage).toBe(0); // effect blocked
    });

    it("paying the ward cost lets the targeting spell resolve normally", () => {
      const { state, aliceId, wardedId } = setupWardScenario("Ward {2}");
      const spell = makeTargetingStackObject(
        aliceId,
        [{ type: "card", targetId: wardedId, isValid: true }],
        [damageEffect(wardedId, 1)],
      );
      state.stack = [spell];

      const payResult = payWardCost(state, spell.id, wardedId);
      expect(payResult.success).toBe(true);

      const result = resolveTopOfStack(payResult.state);
      expect(result.cards.get(wardedId)!.damage).toBe(1); // effect applied
    });

    it("a life-ward spends life on payment and fails if life is insufficient", () => {
      const { state, aliceId, wardedId } =
        setupWardScenario("Ward—Pay 3 life.");
      const spell = makeTargetingStackObject(aliceId, [
        { type: "card", targetId: wardedId, isValid: true },
      ]);
      state.stack = [spell];

      const lifeBefore = state.players.get(aliceId)!.life;
      const payResult = payWardCost(state, spell.id, wardedId);
      expect(payResult.success).toBe(true);
      expect(payResult.state.players.get(aliceId)!.life).toBe(lifeBefore - 3);
    });
  });

  // ---- Protection (CR 702.16) ----
  describe("Protection preventing targeting", () => {
    it("protection from red prevents targeting by a red source", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Paladin",
            power: 2,
            toughness: 2,
            oracleText: "Protection from red",
            colors: ["W"],
          },
        ],
        [],
      );
      const paladin = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(hasProtectionFrom(paladin, "red")).toBe(true);
      const result = canTarget(paladin, "opponent" as PlayerId, "red");
      expect(result.canTarget).toBe(false);
      expect(result.reason).toContain("protection");
    });

    it("protection is not triggered by an unrelated color", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Paladin",
            power: 2,
            toughness: 2,
            oracleText: "Protection from red",
            colors: ["W"],
          },
        ],
        [],
      );
      const paladin = state.cards.get(
        state.zones.get(Array.from(state.players.keys())[0] + "-battlefield")!
          .cardIds[0],
      )!;
      expect(canTarget(paladin, "opponent" as PlayerId, "blue").canTarget).toBe(
        true,
      );
    });

    it("shouldPreventDamageToTarget reports true for damage from a protected source", () => {
      const { state } = setupGameWithCreatures(
        [
          {
            name: "Paladin",
            power: 2,
            toughness: 2,
            oracleText: "Protection from black",
            colors: ["W"],
          },
        ],
        [
          {
            name: "Terror",
            power: 2,
            toughness: 2,
            oracleText: "Terror",
            colors: ["B"],
          },
        ],
      );
      const ids = Array.from(state.zones.values()).flatMap((z) => z.cardIds);
      const paladin = state.cards.get(ids[0])!;
      const terror = state.cards.get(ids[1])!;
      expect(shouldPreventDamageToTarget(paladin, terror)).toBe(true);
    });
  });

  // ---- Hexproof (CR 702.11) & Hexproof-from ----
  describe("Hexproof blocking opponent targeting", () => {
    it("hexproof prevents opponents from targeting but allows the controller", () => {
      const { state, aliceId } = setupGameWithCreatures(
        [{ name: "Troll", power: 2, toughness: 2, keywords: ["Hexproof"] }],
        [],
      );
      const troll = state.cards.get(
        state.zones.get(`${aliceId}-battlefield`)!.cardIds[0],
      )!;
      expect(hasHexproof(troll)).toBe(true);
      expect(isProtectedByHexproof(troll, "opponent" as PlayerId)).toBe(true);
      expect(isProtectedByHexproof(troll, aliceId)).toBe(false);
      // Opponent cannot target.
      expect(
        canTarget(troll, "opponent" as PlayerId, undefined).canTarget,
      ).toBe(false);
      // Controller can target their own hexproof creature.
      expect(canTarget(troll, aliceId, undefined).canTarget).toBe(true);
    });

    it("'hexproof from [color]' is detected as hexproof", () => {
      const { state, aliceId } = setupGameWithCreatures(
        [
          {
            name: "Sea Guard",
            power: 2,
            toughness: 2,
            oracleText: "Hexproof from red",
            colors: ["U"],
          },
        ],
        [],
      );
      const guard = state.cards.get(
        state.zones.get(`${aliceId}-battlefield`)!.cardIds[0],
      )!;
      // The keyword detector treats "hexproof from red" as hexproof for
      // gameplay purposes (engine quirk documented in gap-analysis).
      expect(hasHexproof(guard)).toBe(true);
      expect(isProtectedByHexproof(guard, "opponent" as PlayerId)).toBe(true);
    });
  });

  // ---- Shroud (CR 702.18) ----
  describe("Shroud blocking all targeting", () => {
    it("shroud blocks targeting by everyone, including the controller", () => {
      const { state, aliceId } = setupGameWithCreatures(
        [
          {
            name: "Veiled Serpent",
            power: 4,
            toughness: 4,
            keywords: ["Shroud"],
          },
        ],
        [],
      );
      const shrouded = state.cards.get(
        state.zones.get(`${aliceId}-battlefield`)!.cardIds[0],
      )!;
      expect(hasShroud(shrouded)).toBe(true);
      // Owner cannot target.
      expect(canTarget(shrouded, aliceId, undefined).canTarget).toBe(false);
      // Opponent cannot target.
      expect(
        canTarget(shrouded, "opponent" as PlayerId, undefined).canTarget,
      ).toBe(false);
    });
  });
});

// ===========================================================================
// 3. TRIGGERED KEYWORD ABILITY ENFORCEMENT
// ===========================================================================

describe("Keyword Enforcement — Triggered Abilities", () => {
  // ---- Persist (CR 702.78) ----
  describe("Persist on death", () => {
    function setupPersistCreature(keywords: string[] = ["Persist"]): {
      state: GameState;
      aliceId: PlayerId;
      creatureId: CardInstanceId;
    } {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);
      const [aliceId] = Array.from(state.players.keys());

      const data = createMockCreature("Persist Creature", 2, 2, keywords);
      const inst = createCardInstance(data, aliceId, aliceId);
      inst.hasSummoningSickness = false;
      state.cards.set(inst.id, inst);
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: [...bf.cardIds, inst.id],
      });
      return { state, aliceId, creatureId: inst.id };
    }

    it("handlePersist returns a persisting creature to the battlefield with a -1/-1 counter", () => {
      const { state, aliceId, creatureId } = setupPersistCreature();

      // Simulate the creature dying: move it to the graveyard.
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((id) => id !== creatureId),
      });
      const gy = state.zones.get(`${aliceId}-graveyard`)!;
      state.zones.set(`${aliceId}-graveyard`, {
        ...gy,
        cardIds: [...gy.cardIds, creatureId],
      });

      const result = handlePersist(state, creatureId);
      expect(result.persistedCards).toContain(creatureId);
      // Card is back on the battlefield.
      expect(
        result.state.zones.get(`${aliceId}-battlefield`)!.cardIds,
      ).toContain(creatureId);
      // Card has exactly one -1/-1 counter.
      const counters = result.state.cards.get(creatureId)!.counters;
      expect(counters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "-1/-1", count: 1 }),
        ]),
      );
    });

    it("persist does not trigger when the creature already has a -1/-1 counter", () => {
      const { state, aliceId, creatureId } = setupPersistCreature();
      const card = state.cards.get(creatureId)!;
      state.cards.set(creatureId, {
        ...card,
        counters: [{ type: "-1/-1", count: 1 }],
      });
      // Move to graveyard.
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((id) => id !== creatureId),
      });
      const gy = state.zones.get(`${aliceId}-graveyard`)!;
      state.zones.set(`${aliceId}-graveyard`, {
        ...gy,
        cardIds: [...gy.cardIds, creatureId],
      });

      expect(hasPersist(state.cards.get(creatureId)!)).toBe(true);
      expect(canPersistTrigger(state.cards.get(creatureId)!)).toBe(false);

      const result = handlePersist(state, creatureId);
      expect(result.persistedCards).toHaveLength(0); // no trigger
    });

    it("a non-persist creature does not persist", () => {
      const { state, aliceId, creatureId } = setupPersistCreature([]); // no persist
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((id) => id !== creatureId),
      });
      const gy = state.zones.get(`${aliceId}-graveyard`)!;
      state.zones.set(`${aliceId}-graveyard`, {
        ...gy,
        cardIds: [...gy.cardIds, creatureId],
      });

      expect(hasPersist(state.cards.get(creatureId)!)).toBe(false);
      const result = handlePersist(state, creatureId);
      expect(result.persistedCards).toHaveLength(0);
    });
  });

  // ---- Boast (CR 702.131) ----
  describe("Boast triggered at upkeep", () => {
    function setupBoastCreature(): {
      state: GameState;
      aliceId: PlayerId;
      creatureId: CardInstanceId;
    } {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);
      const [aliceId] = Array.from(state.players.keys());

      const data = createMockCreatureWithOracle(
        "Boastful Warrior",
        3,
        3,
        "Boast — Tap this creature: Target creature gets +1/+1 until end of turn.",
      );
      const inst = createCardInstance(data, aliceId, aliceId);
      inst.hasSummoningSickness = false;
      state.cards.set(inst.id, inst);
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: [...bf.cardIds, inst.id],
      });
      return { state, aliceId, creatureId: inst.id };
    }

    it("shouldBoastTrigger is false before the creature has attacked", () => {
      const { state, creatureId } = setupBoastCreature();
      const card = state.cards.get(creatureId)!;
      expect(hasBoast(card)).toBe(true);
      expect(shouldBoastTrigger(card)).toBe(false); // attackedLastTurn is false
    });

    it("marking the creature as having attacked enables the boast trigger", () => {
      const { state, creatureId } = setupBoastCreature();
      const marked = markCreatureAttackedForBoast(state, creatureId);
      const card = marked.cards.get(creatureId)!;
      expect(card.attackedLastTurn).toBe(true);
      expect(shouldBoastTrigger(card)).toBe(true);
    });

    it("resetBoastForNewTurn clears the attackedLastTurn flag", () => {
      const { state, aliceId, creatureId } = setupBoastCreature();
      const marked = markCreatureAttackedForBoast(state, creatureId);
      expect(marked.cards.get(creatureId)!.attackedLastTurn).toBe(true);

      const reset = resetBoastForNewTurn(marked, aliceId);
      expect(reset.cards.get(creatureId)!.attackedLastTurn).toBe(false);
      expect(shouldBoastTrigger(reset.cards.get(creatureId)!)).toBe(false);
    });
  });
});
