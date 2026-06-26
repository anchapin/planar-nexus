/**
 * Comprehensive unit tests for Combat System
 * Issue #323: Add comprehensive unit tests for game engine modules
 * Issue #817: First Strike and Double Strike combat implementation (CR 702.7, CR 702.4)
 *
 * Tests combat edge cases including:
 * - Attacker/blocker declaration validation
 * - Damage assignment and trample
 * - First strike and double strike
 * - Deathtouch and lifelink interactions
 * - Flying, reach, and other evasion
 * - Multi-blocker scenarios
 */

import {
  canAttack,
  canBlock,
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
  getAvailableAttackers,
  getAvailableBlockers,
} from "../combat";
import type { CombatActionResult } from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import { Phase, CardInstanceId } from "../types";
import { layerSystem, createPowerToughnessModifyEffect } from "../layer-system";
import { checkStateBasedActions } from "../state-based-actions";
import { shouldHaveFirstStrikeStep } from "../turn-phases";
import type { ScryfallCard } from "@/app/actions";

// Helper function to create a mock creature card
function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  isLegendary: boolean = false,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `${isLegendary ? "Legendary " : ""}Creature — Test`,
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

// Helper to set up a game with creatures on the battlefield
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
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  // Add creatures to Alice's battlefield
  for (const creature of player1Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
    );
    const creatureInstance = createCardInstance(creatureData, aliceId, aliceId);
    // Clear summoning sickness for creatures that should be able to attack
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  // Add creatures to Bob's battlefield
  for (const creature of player2Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
    );
    const creatureInstance = createCardInstance(creatureData, bobId, bobId);
    // Clear summoning sickness
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  return { state, aliceId, bobId };
}

describe("Combat System - Attacker Declaration", () => {
  describe("canAttack", () => {
    it("should allow untapped creature without summoning sickness to attack", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it("should prevent tapped creature from attacking", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      // Tap the creature
      const creature = state.cards.get(creatureId)!;
      creature.isTapped = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain("tapped");
    });

    it("should allow tapped creature with vigilance to attack", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        {
          name: "Vigilant Creature",
          power: 2,
          toughness: 2,
          keywords: ["Vigilance"],
        },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      // Tap the creature (it has vigilance, so it should still be able to attack)
      const creature = state.cards.get(creatureId)!;
      creature.isTapped = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it("should prevent creature with summoning sickness from attacking", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      // Give the creature summoning sickness
      const creature = state.cards.get(creatureId)!;
      creature.hasSummoningSickness = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain("Summoning sickness");
    });

    it("should allow creature with haste to attack despite summoning sickness", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Hasty Creature", power: 2, toughness: 2, keywords: ["Haste"] },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      // Give the creature summoning sickness
      const creature = state.cards.get(creatureId)!;
      creature.hasSummoningSickness = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it("should prevent non-creature from attacking", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Create a non-creature permanent (land)
      const landData = {
        id: "mock-land",
        name: "Forest",
        type_line: "Land — Forest",
        keywords: [],
        oracle_text: "",
        mana_cost: "",
        cmc: 0,
        colors: [],
        legalities: { standard: "legal", commander: "legal" },
        color_identity: [],
        card_faces: undefined,
        layout: "normal",
      } as ScryfallCard;
      const land = createCardInstance(landData, aliceId, aliceId);
      state.cards.set(land.id, land);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, land.id],
      });

      const result = canAttack(state, land.id, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain("Only creatures can attack");
    });

    it("should require a defender to be specified", () => {
      const { state, aliceId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = canAttack(state, creatureId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain("No defender specified");
    });
  });

  describe("declareAttackers", () => {
    it("should tap attacking creatures without vigilance", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId },
      ]);

      expect(result.success).toBe(true);
      const attacker = result.state.cards.get(creatureId);
      expect(attacker?.isTapped).toBe(true);
    });

    it("should not tap attacking creatures with vigilance", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        {
          name: "Vigilant Creature",
          power: 2,
          toughness: 2,
          keywords: ["Vigilance"],
        },
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId },
      ]);

      expect(result.success).toBe(true);
      const attacker = result.state.cards.get(creatureId);
      expect(attacker?.isTapped).toBe(false);
    });

    it("should fail if not in combat phase", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ]);

      // Set phase to main phase (not combat)
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId },
      ]);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should handle multiple attackers", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Creature 1", power: 2, toughness: 2 },
        { name: "Creature 2", power: 3, toughness: 3 },
        { name: "Creature 3", power: 1, toughness: 1 },
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureIds = battlefield.cardIds;

      const result = declareAttackers(state, [
        { cardId: creatureIds[0], defenderId: bobId },
        { cardId: creatureIds[1], defenderId: bobId },
        { cardId: creatureIds[2], defenderId: bobId },
      ]);

      expect(result.success).toBe(true);
      expect(result.state.combat.attackers).toHaveLength(3);
    });
  });
});

describe("Combat System - Blocker Declaration", () => {
  describe("canBlock", () => {
    it("should allow untapped creature to block", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });

    it("should prevent tapped creature from blocking", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Tap the blocker
      const blocker = state.cards.get(blockerId)!;
      blocker.isTapped = true;

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain("tapped");
    });

    it("should prevent non-flying, non-reach creature from blocking flying", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Flying Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Flying"],
          },
        ],
        [{ name: "Ground Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain("flying");
    });

    it("should allow flying creature to block flying", () => {
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

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });

    it("should allow reach creature to block flying", () => {
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
            name: "Reach Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Reach"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });
  });

  describe("declareBlockers", () => {
    it("should assign blockers to attackers", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      // Set up combat phase with attackers
      state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // First declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      // Then declare blockers
      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);

      const result = declareBlockers(stateWithAttackers, blockerAssignments);
      expect(result.success).toBe(true);
      expect(result.state.combat.blockers.has(attackerId)).toBe(true);
    });

    it("should handle multiple blockers for one attacker", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Big Attacker", power: 5, toughness: 5 }],
        [
          { name: "Blocker 1", power: 2, toughness: 2 },
          { name: "Blocker 2", power: 2, toughness: 2 },
          { name: "Blocker 3", power: 2, toughness: 2 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);

      const result = declareBlockers(stateWithAttackers, blockerAssignments);
      expect(result.success).toBe(true);
      expect(result.state.combat.blockers.get(attackerId)).toHaveLength(3);
    });
  });
});

describe("Combat System - Damage Resolution", () => {
  describe("resolveCombatDamage", () => {
    it("should deal damage to defending player from unblocked attacker", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 3, toughness: 3 }],
        [],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;

      // Resolve combat
      const result = resolveCombatDamage(stateWithAttackers);
      expect(result.success).toBe(true);

      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17
    });

    it("should deal damage between attacker and blocker", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 3, toughness: 3 }],
        [{ name: "Blocker", power: 3, toughness: 3 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both creatures should have lethal damage and be in graveyard
      // Attacker (3/3) deals 3 damage to Blocker (3/3) - lethal
      // Blocker (3/3) deals 3 damage to Attacker (3/3) - lethal
      const aliceGraveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;

      expect(aliceGraveyard.cardIds).toContain(attackerId);
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it("should handle trample damage correctly", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Blocker takes 2 lethal damage, 3 tramples over
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17 (trample damage)
    });

    // Issue #789: Additional trample tests per CR 702.19b
    it("should handle trample - 5/5 blocked by 2/2 gives 3 excess (CR 702.19b)", () => {
      // CR 702.19b: excess = attackerPower - damageToBlockers = 5 - 2 = 3
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Verify blocker dies
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      // Player takes 3 trample damage (5 - 2 = 3)
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17
    });

    it("should handle trample - 3/3 blocked by 3/3 gives 0 excess", () => {
      // When blocker toughness >= attacker power, all damage absorbed by blocker
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 3, toughness: 3, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 3, toughness: 3 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both creatures die from combat
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      // No trample damage - player takes 0
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(20);
    });

    it("should handle trample - 4/4 blocked by 1/1 gives 3 excess", () => {
      // 4/4 assigns 1 lethal to 1/1, remaining 3 tramples through
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 4, toughness: 4, keywords: ["Trample"] }],
        [{ name: "Blocker", power: 1, toughness: 1 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Blocker dies from 1 lethal damage
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      // 3 damage tramples through (4 - 1 = 3)
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17
    });

    it("should handle deathtouch + trample - 5/5 blocked by 2/2 and 3/3", () => {
      // CR 702.2b: Deathtouch makes any damage lethal (1 per blocker)
      // 5/5 assigns 1 to each blocker (lethal via deathtouch), 3 excess tramples through
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Deathtouch Trampler",
            power: 5,
            toughness: 5,
            keywords: ["Trample", "Deathtouch"],
          },
        ],
        [
          { name: "Blocker1", power: 2, toughness: 3 },
          { name: "Blocker2", power: 2, toughness: 2 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both blockers die (1 damage each is lethal via deathtouch)
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).toContain(blockerIds[1]);

      // 5 - 1 - 1 = 3 trample damage
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17
    });

    it("should handle deathtouch correctly", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Deathtouch Attacker",
            power: 1,
            toughness: 1,
            keywords: ["Deathtouch"],
          },
        ],
        [{ name: "Big Blocker", power: 10, toughness: 10 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Big blocker should die from 1 deathtouch damage
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it("should handle lifelink correctly", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Lifelink Attacker",
            power: 3,
            toughness: 3,
            keywords: ["Lifelink"],
          },
        ],
        [],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Damage Alice first to have life to gain
      const alice = state.players.get(aliceId)!;
      state.players.set(aliceId, { ...alice, life: 15 });

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;

      // Resolve combat
      const result = resolveCombatDamage(stateWithAttackers);
      expect(result.success).toBe(true);

      // Alice should gain 3 life from lifelink
      const updatedAlice = result.state.players.get(aliceId)!;
      expect(updatedAlice.life).toBe(18); // 15 + 3 = 18
    });

    it("should handle first strike correctly", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "First Strike Attacker",
            power: 2,
            toughness: 2,
            keywords: ["First Strike"],
          },
        ],
        [{ name: "Regular Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        stateWithAttackers,
        blockerAssignments,
      );

      // First combat damage step (first strike) - first striker deals damage
      const stateFirstStrike = {
        ...blockResult.state,
        turn: {
          ...blockResult.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
        },
      };
      const resultFirstStrike = resolveCombatDamage(stateFirstStrike);
      expect(resultFirstStrike.success).toBe(true);

      // In first strike step, attacker deals damage to blocker
      // After SBA, blocker should be dead (went to graveyard)
      const bobGraveyardAfterFirstStrike = resultFirstStrike.state.zones.get(
        `${bobId}-graveyard`,
      )!;
      const aliceBattlefieldAfterFirstStrike =
        resultFirstStrike.state.zones.get(`${aliceId}-battlefield`)!;

      // Blocker should be dead (destroyed by first strike damage)
      expect(bobGraveyardAfterFirstStrike.cardIds).toContain(blockerId);
      // Attacker should survive
      expect(aliceBattlefieldAfterFirstStrike.cardIds).toContain(attackerId);

      // Second combat damage step (regular) - attacker deals no additional damage
      // (already dealt damage in first strike, blocker is dead)
      const stateRegularDamage = {
        ...resultFirstStrike.state,
        turn: {
          ...resultFirstStrike.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE,
        },
      };
      const result = resolveCombatDamage(stateRegularDamage);
      expect(result.success).toBe(true);

      // Attacker should still survive (blocker couldn't deal damage back in first strike step)
      const aliceBattlefieldAfter = result.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      expect(aliceBattlefieldAfter.cardIds).toContain(attackerId);
    });

    it("should handle double strike correctly", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Double Strike Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
        [],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      const stateWithAttackers = attackResult.state;

      // First combat damage step - double striker deals first strike damage
      const stateFirstStrike = {
        ...stateWithAttackers,
        turn: {
          ...stateWithAttackers.turn,
          currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
        },
      };
      const resultFirstStrike = resolveCombatDamage(stateFirstStrike);
      expect(resultFirstStrike.success).toBe(true);

      // Double striker should have dealt 2 damage in first strike step
      const bobAfterFirstStrike = resultFirstStrike.state.players.get(bobId)!;
      expect(bobAfterFirstStrike.life).toBe(18); // 20 - 2 = 18

      // Second combat damage step - double striker deals regular damage
      const stateRegularDamage = {
        ...resultFirstStrike.state,
        turn: {
          ...resultFirstStrike.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE,
        },
      };
      const result = resolveCombatDamage(stateRegularDamage);
      expect(result.success).toBe(true);

      // Double strike deals damage twice: 2 + 2 = 4
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(16); // 20 - 4 = 16
    });

    // Issue #978: Trample with multiple blockers per CR 702.19b
    // An attacker with trample must assign lethal damage to each blocker in
    // the chosen order before any excess can trample to the defending player.
    it("should assign lethal to each of two equal blockers with no trample - 6/6 vs two 3/3s (#978)", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 6, toughness: 6, keywords: ["Trample"] }],
        [
          { name: "Blocker1", power: 1, toughness: 3 },
          { name: "Blocker2", power: 1, toughness: 3 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both blockers receive lethal (3 each), no excess tramples
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).toContain(blockerIds[1]);

      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(20); // 6 - 3 - 3 = 0 trample
    });

    it("should trample excess after lethal to two blockers - 6/6 vs two 2/2s (#978)", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 6, toughness: 6, keywords: ["Trample"] }],
        [
          { name: "Blocker1", power: 1, toughness: 2 },
          { name: "Blocker2", power: 1, toughness: 2 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // 6 - 2 - 2 = 2 trample
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(18); // 20 - 2 = 18

      // Both blockers still die from lethal assignment
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).toContain(blockerIds[1]);
    });

    it("should assign lethal in order across three blockers - 7/7 vs three 2/2s (#978)", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 7, toughness: 7, keywords: ["Trample"] }],
        [
          { name: "Blocker1", power: 1, toughness: 2 },
          { name: "Blocker2", power: 1, toughness: 2 },
          { name: "Blocker3", power: 1, toughness: 2 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // 7 - 2 - 2 - 2 = 1 trample
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(19); // 20 - 1 = 19
    });

    it("should trample nothing when blockers absorb all damage (#978)", () => {
      // 5/5 blocked by 4/4 then 4/4: assign 4 to first, 1 to second, 0 excess
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
        [
          { name: "Blocker1", power: 1, toughness: 4 },
          { name: "Blocker2", power: 1, toughness: 4 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // No excess tramples: all 5 power absorbed by blockers
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(20);

      // First blocker (4 toughness) dies from 4 assigned; second survives (1 < 4)
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).not.toContain(blockerIds[1]);
    });

    it("should not trample when lethal cannot be assigned to all blockers (#978)", () => {
      // 4/4 blocked by 3/3 then 3/3: 3 to first (lethal), 1 to second (non-lethal)
      // CR 702.19b: cannot trample until ALL blockers have lethal assigned
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 4, toughness: 4, keywords: ["Trample"] }],
        [
          { name: "Blocker1", power: 1, toughness: 3 },
          { name: "Blocker2", power: 1, toughness: 3 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // No trample: blocker 2 was not assigned lethal damage
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(20);

      // First blocker dies (3 = lethal), second survives (1 < 3)
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).not.toContain(blockerIds[1]);
    });

    it("should ignore blocker's deathtouch when assigning attacker damage (#978)", () => {
      // CR 702.19c + CR 702.2b: a blocker's own deathtouch does not change the
      // lethal damage the attacker must assign to it. Previously the engine
      // over-assigned damage beyond the attacker's remaining power when a
      // blocker had deathtouch and toughness > assigned damage.
      // 4/4 trampler blocked by 0/5 deathtouch: assign 4 (not 5!), no trample.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Trampler", power: 4, toughness: 4, keywords: ["Trample"] }],
        [
          { name: "Deathtouch Wall", power: 0, toughness: 5, keywords: ["Deathtouch"] },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Attacker dealt at most 4 damage; blocker (5 toughness) survives
      const bobBattlefieldAfter = result.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(bobBattlefieldAfter.cardIds).toContain(blockerId);

      // No trample because lethal (5) was not assigned
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(20);
    });

    it("should handle deathtouch + trample across multiple blockers (#978)", () => {
      // CR 702.2b + CR 702.19b: deathtouch attacker assigns 1 (lethal) per
      // blocker, remainder tramples. 6/6 deathtouch trampler vs 2/2 + 3/3:
      // 1 + 1 = 2 to blockers, 4 trample.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Deathtouch Trampler",
            power: 6,
            toughness: 6,
            keywords: ["Deathtouch", "Trample"],
          },
        ],
        [
          { name: "Blocker1", power: 1, toughness: 2 },
          { name: "Blocker2", power: 1, toughness: 3 },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both blockers die from 1 deathtouch damage each
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
      expect(bobGraveyard.cardIds).toContain(blockerIds[1]);

      // 6 - 1 - 1 = 4 trample
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(16); // 20 - 4 = 16
    });
  });
});

describe("Combat System - Edge Cases", () => {
  it("should handle attacker with 0 power", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Zero Power", power: 0, toughness: 3 }],
      [],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    const stateWithAttackers = attackResult.state;

    // Resolve combat
    const result = resolveCombatDamage(stateWithAttackers);
    expect(result.success).toBe(true);

    // No damage should be dealt
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(20);
  });

  it("should handle multiple blockers with trample", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Big Trampler",
          power: 10,
          toughness: 10,
          keywords: ["Trample"],
        },
      ],
      [
        { name: "Blocker 1", power: 2, toughness: 3 },
        { name: "Blocker 2", power: 2, toughness: 3 },
      ],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    const stateWithAttackers = attackResult.state;
    stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerAssignments = new Map();
    blockerAssignments.set(attackerId, blockerIds);
    const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

    // Resolve combat
    const result = resolveCombatDamage(blockResult.state);
    expect(result.success).toBe(true);

    // 10 power - 3 (first blocker) - 3 (second blocker) = 4 trample
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(16); // 20 - 4 = 16
  });

  it("should handle no attackers declared", () => {
    const { state } = setupGameWithCreatures([], []);

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

    // Empty attacker array is allowed - it means no attack is declared
    const result = declareAttackers(state, []);
    expect(result.success).toBe(true);
    expect(result.state.combat.attackers).toHaveLength(0);
  });

  it("should handle no blockers declared", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    const stateWithAttackers = attackResult.state;
    stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    // Declare no blockers
    const blockerAssignments = new Map();
    const result = declareBlockers(stateWithAttackers, blockerAssignments);

    // Should succeed with no blockers
    expect(result.success).toBe(true);
  });
});

describe("Combat System - Utility Functions", () => {
  describe("getAvailableAttackers", () => {
    it("should return all creatures that can attack", () => {
      const { state, aliceId } = setupGameWithCreatures(
        [
          { name: "Can Attack", power: 2, toughness: 2 },
          { name: "Tapped", power: 2, toughness: 2 },
          { name: "Has Haste", power: 2, toughness: 2, keywords: ["Haste"] },
        ],
        [],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureIds = aliceBattlefield.cardIds;

      // Tap the second creature
      const tappedCreature = state.cards.get(creatureIds[1])!;
      tappedCreature.isTapped = true;

      // Give the third creature summoning sickness (but it has haste)
      const hastyCreature = state.cards.get(creatureIds[2])!;
      hastyCreature.hasSummoningSickness = true;

      const available = getAvailableAttackers(state, aliceId);

      // Should include first creature and hasty creature
      expect(available).toContain(creatureIds[0]);
      expect(available).toContain(creatureIds[2]);
      expect(available).not.toContain(creatureIds[1]);
    });
  });

  describe("getAvailableBlockers", () => {
    it("should return all creatures that can block", () => {
      const { state, bobId } = setupGameWithCreatures(
        [],
        [
          { name: "Can Block", power: 2, toughness: 2 },
          { name: "Tapped", power: 2, toughness: 2 },
        ],
      );

      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const creatureIds = bobBattlefield.cardIds;

      // Tap the second creature
      const tappedCreature = state.cards.get(creatureIds[1])!;
      tappedCreature.isTapped = true;

      const available = getAvailableBlockers(state, bobId);

      expect(available).toContain(creatureIds[0]);
      expect(available).not.toContain(creatureIds[1]);
    });
  });
});

describe("Combat System - Deathtouch with Multiple Blockers (#980)", () => {
  // CR 702.2b: Any nonzero amount of damage from a source with deathtouch is
  // considered lethal. Combined with CR 510.1c (an attacker must assign lethal
  // damage to each blocker in assignment order before assigning damage
  // elsewhere), a deathtouch attacker need only assign 1 damage per blocker —
  // regardless of that blocker's toughness — before trampling or stopping. The
  // total damage assigned is still bounded by the attacker's power; deathtouch
  // changes the per-blocker lethal threshold, not the damage total.

  // Helper: run both combat damage steps from a post-declare-blockers state.
  function runBothDamageSteps(
    stateAfterBlockers: import("../types").GameState,
  ): { firstStrike: CombatActionResult; regular: CombatActionResult } {
    const stateFirstStrike = {
      ...stateAfterBlockers,
      turn: {
        ...stateAfterBlockers.turn,
        currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
      },
    };
    const firstStrike = resolveCombatDamage(stateFirstStrike);
    expect(firstStrike.success).toBe(true);
    const stateRegular = {
      ...firstStrike.state,
      turn: {
        ...firstStrike.state.turn,
        currentPhase: Phase.COMBAT_DAMAGE,
      },
    };
    const regular = resolveCombatDamage(stateRegular);
    expect(regular.success).toBe(true);
    return { firstStrike, regular };
  }

  it("deathtouch attacker assigns 1 damage to each of 3 blockers in order (#980)", () => {
    // 3/3 deathtouch vs three 5/5 blockers: 1 to each (lethal via deathtouch),
    // 0 to the player (no trample). All three blockers die despite 5 toughness.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Deathtouch Attacker",
          power: 3,
          toughness: 3,
          keywords: ["Deathtouch"],
        },
      ],
      [
        { name: "Blocker1", power: 1, toughness: 5 },
        { name: "Blocker2", power: 1, toughness: 5 },
        { name: "Blocker3", power: 1, toughness: 5 },
      ],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blockResult = declareBlockers(
      attackResult.state,
      new Map([[attackerId, blockerIds]]),
    );

    const result = resolveCombatDamage(blockResult.state);
    expect(result.success).toBe(true);

    // All three blockers die: 1 deathtouch damage is lethal regardless of
    // their 5 toughness (CR 702.2b).
    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[1]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[2]);

    // No trample keyword: no damage reaches the player.
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(20);
  });

  it("deathtouch attacker with trample assigns 1 to each blocker and remainder to player (#980)", () => {
    // 5/5 deathtouch trampler vs three 1/1 blockers: 1 to each (lethal via
    // deathtouch), 2 excess tramples to the defending player.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Deathtouch Trampler",
          power: 5,
          toughness: 5,
          keywords: ["Deathtouch", "Trample"],
        },
      ],
      [
        { name: "Blocker1", power: 1, toughness: 1 },
        { name: "Blocker2", power: 1, toughness: 1 },
        { name: "Blocker3", power: 1, toughness: 1 },
      ],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blockResult = declareBlockers(
      attackResult.state,
      new Map([[attackerId, blockerIds]]),
    );

    const result = resolveCombatDamage(blockResult.state);
    expect(result.success).toBe(true);

    // All three blockers die from 1 deathtouch damage each.
    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[1]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[2]);

    // 5 - 1 - 1 - 1 = 2 trample damage to the player.
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(18); // 20 - 2 = 18
  });

  it("deathtouch multi-blocker assignment conserves total damage to attacker power (#980)", () => {
    // The issue's example proposed a 1/1 deathtouch blocked by two 3/3s. Under
    // the CR, total assigned damage can never exceed the attacker's power, so a
    // 1/1 can assign 1 to ONLY the first blocker in order. The second blocker
    // receives no assignment and survives. Deathtouch lowers the lethal
    // threshold per blocker; it does not create additional damage.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Tiny Deathtouch",
          power: 1,
          toughness: 1,
          keywords: ["Deathtouch"],
        },
      ],
      [
        { name: "Blocker1", power: 3, toughness: 3 },
        { name: "Blocker2", power: 3, toughness: 3 },
      ],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blockResult = declareBlockers(
      attackResult.state,
      new Map([[attackerId, blockerIds]]),
    );

    const result = resolveCombatDamage(blockResult.state);
    expect(result.success).toBe(true);

    // First blocker dies from the single point of deathtouch damage; the
    // second blocker is unassigned (power exhausted) and survives.
    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
    const bobBfAfter = result.state.zones.get(`${bobId}-battlefield`)!;
    expect(bobBfAfter.cardIds).toContain(blockerIds[1]);

    // No trample: 0 to player.
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(20);
  });

  it("non-deathtouch attacker assigns toughness (not 1) per blocker, unlike deathtouch (#980)", () => {
    // Contrast: a 4/4 NON-deathtouch vs two 3/3s assigns 3 to the first
    // (lethal) and only 1 to the second (non-lethal, survives). A 4/4
    // DEATHTOUCH vs the same two 3/3s assigns 1 to each — both lethal via
    // deathtouch — confirming deathtouch changes the assignment, not just SBA.
    const setupCombat = (attackerKeywords: string[]) => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Attacker",
            power: 4,
            toughness: 4,
            keywords: attackerKeywords,
          },
        ],
        [
          { name: "Blocker1", power: 1, toughness: 3 },
          { name: "Blocker2", power: 1, toughness: 3 },
        ],
      );
      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, blockerIds]]),
      );
      return {
        result: resolveCombatDamage(blockResult.state),
        bobId,
        blockerIds,
      };
    };

    // Non-deathtouch: first blocker dies (3 = toughness = lethal), the second
    // survives (only 1 assigned, which is non-lethal without deathtouch).
    const nonDt = setupCombat([]);
    expect(nonDt.result.success).toBe(true);
    const nonDtGraveyard = nonDt.result.state.zones.get(
      `${nonDt.bobId}-graveyard`,
    )!;
    expect(nonDtGraveyard.cardIds).toContain(nonDt.blockerIds[0]);
    expect(nonDtGraveyard.cardIds).not.toContain(nonDt.blockerIds[1]);

    // Deathtouch: both blockers die (1 each is lethal via deathtouch).
    const dt = setupCombat(["Deathtouch"]);
    expect(dt.result.success).toBe(true);
    const dtGraveyard = dt.result.state.zones.get(`${dt.bobId}-graveyard`)!;
    expect(dtGraveyard.cardIds).toContain(dt.blockerIds[0]);
    expect(dtGraveyard.cardIds).toContain(dt.blockerIds[1]);
  });

  it("deathtouch first-strike attacker kills all blockers in the first-strike step before they deal damage (#980/#969)", () => {
    // 3/3 first-strike deathtouch vs three 2/2 regular blockers. In the
    // first-strike step the attacker assigns 1 to each blocker (lethal via
    // deathtouch); all blockers die and therefore never deal their combat
    // damage back in the regular step. The attacker survives having taken 0
    // damage (CR 510.1c: a creature no longer on the battlefield cannot deal
    // combat damage).
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "FS Deathtouch",
          power: 3,
          toughness: 3,
          keywords: ["First Strike", "Deathtouch"],
        },
      ],
      [
        { name: "Blocker1", power: 2, toughness: 2 },
        { name: "Blocker2", power: 2, toughness: 2 },
        { name: "Blocker3", power: 2, toughness: 2 },
      ],
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blockResult = declareBlockers(
      attackResult.state,
      new Map([[attackerId, blockerIds]]),
    );

    const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

    // All three blockers die in the first-strike step from 1 deathtouch damage
    // each, despite the attacker only having 3 power.
    const bobGraveyard = firstStrike.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerIds[0]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[1]);
    expect(bobGraveyard.cardIds).toContain(blockerIds[2]);

    // Attacker survives the whole combat having taken no damage, because the
    // blockers were dead before the regular damage step could process them.
    const aliceBfAfter = regular.state.zones.get(`${aliceId}-battlefield`)!;
    expect(aliceBfAfter.cardIds).toContain(attackerId);
    const attackerAfter = regular.state.cards.get(attackerId)!;
    expect(attackerAfter.damage).toBe(0);
  });
});

describe("Combat System - Deathtouch and Indestructible (#669)", () => {
  describe("resolveCombatDamage", () => {
    it("should assign only 1 damage from a deathtouch attacker per blocker (trample optimization)", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Deathtouch Trampler",
            power: 5,
            toughness: 3,
            keywords: ["Deathtouch", "Trample"],
          },
        ],
        [{ name: "Big Blocker", power: 2, toughness: 6 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      const updatedBob = result.state.players.get(bobId)!;
      expect(updatedBob.life).toBeLessThan(20);
    });

    it("should not destroy an indestructible blocker via combat damage", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Big Attacker", power: 10, toughness: 10 }],
        [
          {
            name: "Indestructible Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Indestructible"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      const bobBattlefieldAfter = result.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(bobBattlefieldAfter.cardIds).toContain(blockerId);

      const updatedBob = result.state.players.get(bobId)!;
      expect(updatedBob.life).toBe(20);
    });

    it("should handle deathtouch vs indestructible stalemate — indestructible blocker survives, deathtouch attacker dies", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Deathtouch Attacker",
            power: 1,
            toughness: 1,
            keywords: ["Deathtouch"],
          },
        ],
        [
          {
            name: "Indestructible Blocker",
            power: 5,
            toughness: 5,
            keywords: ["Indestructible"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      // Indestructible blocker survives (deathtouch damage doesn't destroy it)
      const bobBattlefieldAfter = result.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(bobBattlefieldAfter.cardIds).toContain(blockerId);

      // Deathtouch attacker is NOT indestructible, so it dies from the blocker's 5 damage
      const aliceGraveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      expect(aliceGraveyard.cardIds).toContain(attackerId);

      // No damage leaks through to the defending player
      const updatedBob = result.state.players.get(bobId)!;
      expect(updatedBob.life).toBe(20);
    });

    it("should handle true stalemate: indestructible deathtouch attacker vs indestructible blocker", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Indestructible Deathtouch",
            power: 3,
            toughness: 3,
            keywords: ["Indestructible", "Deathtouch"],
          },
        ],
        [
          {
            name: "Indestructible Wall",
            power: 0,
            toughness: 8,
            keywords: ["Indestructible"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      // Neither creature can be destroyed by damage
      const aliceBattlefieldAfter = result.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      expect(aliceBattlefieldAfter.cardIds).toContain(attackerId);

      const bobBattlefieldAfter = result.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(bobBattlefieldAfter.cardIds).toContain(blockerId);

      const updatedBob = result.state.players.get(bobId)!;
      expect(updatedBob.life).toBe(20);
    });

    it("should not destroy an indestructible attacker via combat damage", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "Indestructible Attacker",
            power: 5,
            toughness: 3,
            keywords: ["Indestructible"],
          },
        ],
        [{ name: "Strong Blocker", power: 10, toughness: 10 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      const aliceBattlefieldAfter = result.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      expect(aliceBattlefieldAfter.cardIds).toContain(attackerId);
    });

    it("should allow deathtouch blocker to kill attacker regardless of toughness", () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Big Attacker", power: 8, toughness: 8 }],
        [
          {
            name: "Tiny Deathtouch",
            power: 1,
            toughness: 1,
            keywords: ["Deathtouch"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );
      const result = resolveCombatDamage(blockResult.state);

      expect(result.success).toBe(true);

      const aliceGraveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      expect(aliceGraveyard.cardIds).toContain(attackerId);

      const bobBattlefieldAfter = result.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(bobBattlefieldAfter.cardIds).not.toContain(blockerId);
    });
  });

  describe("Layer System Integration", () => {
    beforeEach(() => {
      // Clear layer system to ensure clean state between tests
      layerSystem.clear();
    });

    afterEach(() => {
      // Clean up after tests
      layerSystem.clear();
    });

    it("should apply layer 7e P/T modifiers to combat damage", () => {
      // Create a 2/2 creature with +1/+1 counter and Giant Growth (+3/+3)
      // Expected combat damage: 2 + 1 + 3 = 6, not 7
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Test Creature", power: 2, toughness: 2 },
      ]);

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = aliceBattlefield.cardIds[0];

      // Add +1/+1 counter (Layer 7c)
      const creature = state.cards.get(creatureId)!;
      creature.counters = [{ type: "+1/+1", count: 1 }];

      // Add +2/+2 enchantment effect (Layer 7e)
      const modifyEffect = createPowerToughnessModifyEffect(
        creatureId,
        aliceId,
        2,
        2,
        "+2/+2 enchantment",
      );
      layerSystem.registerEffect(modifyEffect);

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId },
      ]);

      // Verify damageToDeal uses layer-resolved power
      const attacker = attackResult.state.combat.attackers[0];
      // 2 (base) + 1 (counter) + 2 (modifier) = 5
      expect(attacker.damageToDeal).toBe(5);
    });

    it("should apply layer 7c counters before layer 7e modifiers in combat", () => {
      // CR 613.8: Layer 7c (counters) applies before 7e (modifiers)
      // Creature with base 2/2, +1/+1 counter, and +2/+2 enchantment
      // Should be: 2 + 1 + 2 = 5
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: "Test Creature", power: 2, toughness: 2 },
      ]);

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = aliceBattlefield.cardIds[0];

      const creature = state.cards.get(creatureId)!;
      creature.counters = [{ type: "+1/+1", count: 1 }];

      const modifyEffect = createPowerToughnessModifyEffect(
        creatureId,
        aliceId,
        2,
        2,
        "+2/+2",
      );
      layerSystem.registerEffect(modifyEffect);

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId },
      ]);

      // Layer 7c counters apply first, then 7e modifiers
      // Base 2 + 1 (7c counter) + 2 (7e modifier) = 5
      expect(attackResult.state.combat.attackers[0].damageToDeal).toBe(5);
    });

    it("should use layer-resolved P/T for blocker damage", () => {
      // Test that blockers also use layer-resolved P/T
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 3, toughness: 3 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Add +2/+2 to blocker (Layer 7e)
      const blocker = state.cards.get(blockerId)!;
      const modifyEffect = createPowerToughnessModifyEffect(
        blockerId,
        bobId,
        2,
        2,
        "+2/+2",
      );
      layerSystem.registerEffect(modifyEffect);

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(
        attackResult.state,
        blockerAssignments,
      );

      // Blocker should deal 4 damage (2 base + 2 from layer 7e)
      const blockers = blockResult.state.combat.blockers.get(attackerId)!;
      expect(blockers[0].damageToDeal).toBe(4);
    });
  });

  describe("Planeswalker combat damage (CR 306.7, Issue #858)", () => {
    function createMockPlaneswalker(
      name: string,
      loyalty: number,
    ): ScryfallCard {
      return {
        id: `mock-pw-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        name,
        type_line: `Planeswalker — ${name.split(" ")[0]}`,
        loyalty: loyalty.toString(),
        keywords: [],
        oracle_text: "",
        mana_cost: "{3}",
        cmc: 4,
        colors: ["U"],
        color_identity: ["U"],
        legalities: { standard: "legal", commander: "legal" },
        card_faces: undefined,
        layout: "normal",
      } as ScryfallCard;
    }

    function setupGameWithPlaneswalker(
      player1Creatures: Array<{
        name: string;
        power: number;
        toughness: number;
        keywords?: string[];
      }> = [],
      player2Planeswalker: {
        name: string;
        loyalty: number;
      } | null = null,
    ) {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Add creatures to Alice's battlefield
      for (const creature of player1Creatures) {
        const creatureData = createMockCreature(
          creature.name,
          creature.power,
          creature.toughness,
          creature.keywords,
        );
        const creatureInstance = createCardInstance(
          creatureData,
          aliceId,
          aliceId,
        );
        creatureInstance.hasSummoningSickness = false;
        state.cards.set(creatureInstance.id, creatureInstance);

        const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
        state.zones.set(`${aliceId}-battlefield`, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, creatureInstance.id],
        });
      }

      // Add planeswalker to Bob's battlefield
      let planeswalkerId: CardInstanceId | null = null;
      if (player2Planeswalker) {
        const pwData = createMockPlaneswalker(
          player2Planeswalker.name,
          player2Planeswalker.loyalty,
        );
        const pwInstance = createCardInstance(pwData, bobId, bobId);
        // Initialize planeswalker loyalty counters
        const pwWithLoyalty = initializePlaneswalkerLoyalty(pwInstance);
        state.cards.set(pwWithLoyalty.id, pwWithLoyalty);

        const battlefield = state.zones.get(`${bobId}-battlefield`)!;
        state.zones.set(`${bobId}-battlefield`, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, pwWithLoyalty.id],
        });
        planeswalkerId = pwWithLoyalty.id;
      }

      return { state, aliceId, bobId, planeswalkerId };
    }

    it("should reduce planeswalker loyalty by combat damage (CR 119.3c)", () => {
      const { state, aliceId, bobId, planeswalkerId } =
        setupGameWithPlaneswalker(
          [{ name: "Attacker", power: 3, toughness: 3 }],
          { name: "Jace", loyalty: 5 },
        );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Declare attacker targeting the planeswalker
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        {
          cardId: attackerId,
          defenderId: planeswalkerId!,
        },
      ]);
      expect(attackResult.success).toBe(true);

      // Check isAttackingPlaneswalker was set correctly
      const attacker = attackResult.state.combat.attackers.find(
        (a) => a.cardId === attackerId,
      );
      expect(attacker?.isAttackingPlaneswalker).toBe(true);

      // Resolve combat damage
      const resolveResult = resolveCombatDamage(attackResult.state);
      expect(resolveResult.success).toBe(true);

      // Check planeswalker loyalty reduced by 3
      const planeswalker = resolveResult.state.cards.get(planeswalkerId!);
      const loyaltyCounter = planeswalker?.counters?.find(
        (c) => c.type === "loyalty",
      );
      expect(loyaltyCounter?.count).toBe(2); // 5 - 3 = 2
    });

    it("should exile planeswalker with 0 loyalty via SBA (CR 704.5i)", () => {
      const { state, aliceId, bobId, planeswalkerId } =
        setupGameWithPlaneswalker(
          [{ name: "Attacker", power: 5, toughness: 5 }],
          { name: "Chandra", loyalty: 3 },
        );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Declare attacker targeting the planeswalker with 5 damage
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        {
          cardId: attackerId,
          defenderId: planeswalkerId!,
        },
      ]);

      // Verify the attacker is correctly set to attack the planeswalker
      const attacker = attackResult.state.combat.attackers.find(
        (a) => a.cardId === attackerId,
      );
      expect(attacker?.isAttackingPlaneswalker).toBe(true);

      // Resolve combat damage
      const resolveResult = resolveCombatDamage(attackResult.state);
      expect(resolveResult.success).toBe(true);

      // Check SBA - planeswalker should be exiled
      const sbaResult = checkStateBasedActions(resolveResult.state);

      const bobBattlefield = sbaResult.state.zones.get(`${bobId}-battlefield`);
      expect(bobBattlefield?.cardIds).not.toContain(planeswalkerId);

      const bobExile = sbaResult.state.zones.get(`${bobId}-exile`);
      expect(bobExile?.cardIds).toContain(planeswalkerId);
    });

    it("should handle multiple creatures attacking same planeswalker", () => {
      const { state, aliceId, bobId, planeswalkerId } =
        setupGameWithPlaneswalker(
          [
            { name: "Attacker1", power: 2, toughness: 2 },
            { name: "Attacker2", power: 3, toughness: 3 },
          ],
          { name: "Jace", loyalty: 7 },
        );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attacker1Id = aliceBattlefield.cardIds[0];
      const attacker2Id = aliceBattlefield.cardIds[1];

      // Declare both attackers targeting the planeswalker
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        {
          cardId: attacker1Id,
          defenderId: planeswalkerId!,
        },
        {
          cardId: attacker2Id,
          defenderId: planeswalkerId!,
        },
      ]);

      // Verify both attackers are correctly set to attack the planeswalker
      const attacker1 = attackResult.state.combat.attackers.find(
        (a) => a.cardId === attacker1Id,
      );
      const attacker2 = attackResult.state.combat.attackers.find(
        (a) => a.cardId === attacker2Id,
      );
      expect(attacker1?.isAttackingPlaneswalker).toBe(true);
      expect(attacker2?.isAttackingPlaneswalker).toBe(true);
      expect(attackResult.success).toBe(true);

      // Resolve combat damage (5 total: 2 + 3)
      const resolveResult = resolveCombatDamage(attackResult.state);
      expect(resolveResult.success).toBe(true);

      // Check planeswalker loyalty reduced by 5 (2 + 3)
      const planeswalker = resolveResult.state.cards.get(planeswalkerId!);
      const loyaltyCounter = planeswalker?.counters?.find(
        (c) => c.type === "loyalty",
      );
      expect(loyaltyCounter?.count).toBe(2); // 7 - 5 = 2
    });

    it("should not mark combat damage on creature when attacking planeswalker (CR 306.7)", () => {
      const { state, aliceId, bobId, planeswalkerId } =
        setupGameWithPlaneswalker(
          [{ name: "Attacker", power: 4, toughness: 2 }],
          { name: "Gideon", loyalty: 5 },
        );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Declare attacker targeting planeswalker
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        {
          cardId: attackerId,
          defenderId: planeswalkerId!,
        },
      ]);

      // Verify the attacker is correctly set to attack the planeswalker
      const attackerInCombat = attackResult.state.combat.attackers.find(
        (a) => a.cardId === attackerId,
      );
      expect(attackerInCombat?.isAttackingPlaneswalker).toBe(true);

      // Resolve combat damage
      const resolveResult = resolveCombatDamage(attackResult.state);
      expect(resolveResult.success).toBe(true);

      // Creature should have no damage marked on it
      // (CR 306.7: Damage marked on creature doesn't reduce planeswalker loyalty separately)
      const attacker = resolveResult.state.cards.get(attackerId);
      expect(attacker?.damage).toBe(0);
    });
  });

  // Issue #969: First Strike / Double Strike combat damage step gating (CR 702.7, CR 702.4)
  describe("First Strike / Double Strike damage step gating (#969)", () => {
    // Helper: run both combat damage steps starting from a post-declare-blockers state.
    function runBothDamageSteps(
      stateAfterBlockers: import("../types").GameState,
    ): { firstStrike: CombatActionResult; regular: CombatActionResult } {
      const stateFirstStrike = {
        ...stateAfterBlockers,
        turn: {
          ...stateAfterBlockers.turn,
          currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
        },
      };
      const firstStrike = resolveCombatDamage(stateFirstStrike);
      expect(firstStrike.success).toBe(true);
      const stateRegular = {
        ...firstStrike.state,
        turn: {
          ...firstStrike.state.turn,
          currentPhase: Phase.COMBAT_DAMAGE,
        },
      };
      const regular = resolveCombatDamage(stateRegular);
      expect(regular.success).toBe(true);
      return { firstStrike, regular };
    }

    it("first-strike attacker kills a regular blocker before the blocker deals any damage (#969)", () => {
      // 2/2 first strike vs 2/2 regular blocker. First striker kills the
      // blocker in the first-strike step; the blocker never deals its
      // damage back because it is dead before the regular damage step.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "FS Attacker",
            power: 2,
            toughness: 2,
            keywords: ["First Strike"],
          },
        ],
        [{ name: "Regular Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, [blockerId]]]),
      );

      const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

      // Blocker died in the first-strike step.
      const bobGraveyard = firstStrike.state.zones.get(
        `${bobId}-graveyard`,
      )!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      // Attacker survived the whole combat — the regular blocker never dealt
      // its 2 damage because it was already dead before the regular step.
      const aliceBfAfter = regular.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      expect(aliceBfAfter.cardIds).toContain(attackerId);
      const attackerAfter = regular.state.cards.get(attackerId)!;
      expect(attackerAfter.damage).toBe(0);
    });

    it("double-strike attacker deals damage in BOTH first-strike and regular steps (#969)", () => {
      // 2/2 double strike, unblocked, attacks player.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "DS Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
        [],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);

      const { firstStrike, regular } = runBothDamageSteps(attackResult.state);

      // 2 damage in the first-strike step.
      const bobAfterFirst = firstStrike.state.players.get(bobId)!;
      expect(bobAfterFirst.life).toBe(18);
      // +2 more damage in the regular step (4 total).
      const bobAfterRegular = regular.state.players.get(bobId)!;
      expect(bobAfterRegular.life).toBe(16);
    });

    it("a double-strike attacker killed in the first-strike step does NOT deal damage in the regular step (#969)", () => {
      // 2/2 double strike attacker blocked by a 3/3 first-strike blocker.
      // Step 1 (first strike): attacker deals 2 to blocker (not lethal); blocker
      // deals 3 to attacker → attacker dies. Step 2 (regular): the dead double-
      // strike attacker must NOT deal its second hit.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "DS Attacker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
        [
          {
            name: "FS Blocker",
            power: 3,
            toughness: 3,
            keywords: ["First Strike"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, [blockerId]]]),
      );

      const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

      // Attacker died in the first-strike step.
      const aliceGraveyard = firstStrike.state.zones.get(
        `${aliceId}-graveyard`,
      )!;
      expect(aliceGraveyard.cardIds).toContain(attackerId);
      // Blocker survived the first-strike step with exactly 2 damage marked.
      const blockerAfterFirst = firstStrike.state.cards.get(blockerId)!;
      expect(blockerAfterFirst.damage).toBe(2);

      // After the regular step, the blocker must still only have 2 damage —
      // the dead double-strike attacker did not deal its second hit.
      const blockerAfterRegular = regular.state.cards.get(blockerId)!;
      expect(blockerAfterRegular.damage).toBe(2);
      const bobBfAfter = regular.state.zones.get(`${bobId}-battlefield`)!;
      expect(bobBfAfter.cardIds).toContain(blockerId);
    });

    it("a double-strike blocker killed in the first-strike step does NOT deal damage in the regular step (#969)", () => {
      // 3/3 first-strike attacker blocked by a 2/2 double-strike blocker.
      // Step 1: attacker deals 3 to blocker (lethal, dies); blocker deals 2 to
      // attacker. Step 2: the dead double-strike blocker must NOT deal its
      // second hit. The attacker (first-strike-only) also does not act again,
      // so the attacker ends with exactly 2 marked damage.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [
          {
            name: "FS Attacker",
            power: 3,
            toughness: 3,
            keywords: ["First Strike"],
          },
        ],
        [
          {
            name: "DS Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, [blockerId]]]),
      );

      const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

      // Blocker died in the first-strike step.
      const bobGraveyard = firstStrike.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);

      // After the regular step, the attacker has only 2 damage (single hit
      // from the blocker in the first-strike step). If the dead double-strike
      // blocker incorrectly dealt its second hit, the attacker would have 4.
      const attackerAfterRegular = regular.state.cards.get(attackerId)!;
      expect(attackerAfterRegular.damage).toBe(2);
      const aliceBfAfter = regular.state.zones.get(`${aliceId}-battlefield`)!;
      expect(aliceBfAfter.cardIds).toContain(attackerId);
    });

    it("normal combat (no first/double strike) is unaffected: only one effective damage step (#969)", () => {
      // 2/2 attacker vs 2/2 blocker, no keywords. Both should die after a
      // single (regular) combat damage step. The first-strike step, if run,
      // must be a no-op (no participants).
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, [blockerId]]]),
      );

      const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

      // First-strike step is a no-op: nothing dies, no damage marked.
      const aliceBfAfterFs = firstStrike.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      const bobBfAfterFs = firstStrike.state.zones.get(
        `${bobId}-battlefield`,
      )!;
      expect(aliceBfAfterFs.cardIds).toContain(attackerId);
      expect(bobBfAfterFs.cardIds).toContain(blockerId);
      expect(firstStrike.state.cards.get(attackerId)!.damage).toBe(0);
      expect(firstStrike.state.cards.get(blockerId)!.damage).toBe(0);

      // Regular step: both deal damage simultaneously and both die.
      const aliceGraveyard = regular.state.zones.get(`${aliceId}-graveyard`)!;
      const bobGraveyard = regular.state.zones.get(`${bobId}-graveyard`)!;
      expect(aliceGraveyard.cardIds).toContain(attackerId);
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it("shouldHaveFirstStrikeStep returns false when no creature has first/double strike, true otherwise (#969)", () => {
      // No first/double strike anywhere.
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [{ name: "Blocker", power: 2, toughness: 2 }],
      );
      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId },
      ]);
      attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const blockResult = declareBlockers(
        attackResult.state,
        new Map([[attackerId, [blockerId]]]),
      );
      expect(shouldHaveFirstStrikeStep(blockResult.state)).toBe(false);

      // First-strike attacker present → true.
      const fsState = setupGameWithCreatures(
        [
          {
            name: "FS Attacker",
            power: 2,
            toughness: 2,
            keywords: ["First Strike"],
          },
        ],
        [],
      );
      const fsAttackerId = fsState.state.zones.get(
        `${fsState.aliceId}-battlefield`,
      )!.cardIds[0];
      fsState.state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const fsAtk = declareAttackers(fsState.state, [
        { cardId: fsAttackerId, defenderId: fsState.bobId },
      ]);
      expect(shouldHaveFirstStrikeStep(fsAtk.state)).toBe(true);

      // Double-strike blocker present → true.
      const dsState = setupGameWithCreatures(
        [{ name: "Attacker", power: 2, toughness: 2 }],
        [
          {
            name: "DS Blocker",
            power: 2,
            toughness: 2,
            keywords: ["Double Strike"],
          },
        ],
      );
      const dsAttackerId = dsState.state.zones.get(
        `${dsState.aliceId}-battlefield`,
      )!.cardIds[0];
      const dsBlockerId = dsState.state.zones.get(
        `${dsState.bobId}-battlefield`,
      )!.cardIds[0];
      dsState.state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const dsAtk = declareAttackers(dsState.state, [
        { cardId: dsAttackerId, defenderId: dsState.bobId },
      ]);
      dsAtk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      const dsBlk = declareBlockers(
        dsAtk.state,
        new Map([[dsAttackerId, [dsBlockerId]]]),
      );
      expect(shouldHaveFirstStrikeStep(dsBlk.state)).toBe(true);
    });
  });
});

// ============================================================
// Infect and Toxic keyword combat damage (Issue #972)
// CR 702.93 (Infect): damage to creatures is dealt as -1/-1 counters;
//   damage to players is dealt as poison counters (no life loss).
// CR 702.94 (Toxic): a creature with toxic N that deals combat damage
//   to a player causes that player to get N poison counters IN ADDITION
//   to the normal damage effects.
// ============================================================
describe("Combat System - Infect and Toxic (#972)", () => {
  function getMinusOneCounters(
    state: import("../types").GameState,
    cardId: CardInstanceId,
  ): number {
    return (
      state.cards.get(cardId)?.counters.find((c) => c.type === "-1/-1")
        ?.count ?? 0
    );
  }

  it("infect attacker deals -1/-1 counters (not marked damage) to a blocker (CR 702.93b)", () => {
    // 3/3 infect attacker vs 0/5 blocker: 3 infect damage → 3 -1/-1 counters.
    // Blocker effective toughness drops to 2, so it survives with counters and
    // NO damage marked on it.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Infect Attacker", power: 3, toughness: 3, keywords: ["Infect"] }],
      [{ name: "Blocker", power: 0, toughness: 5 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    // Blocker received 3 -1/-1 counters, NOT 3 marked damage.
    expect(getMinusOneCounters(result.state, blockerId)).toBe(3);
    const blockerCard = result.state.cards.get(blockerId)!;
    expect(blockerCard.damage).toBe(0);

    // Effective toughness 5 - 3 = 2 > 0, so the blocker survives.
    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).not.toContain(blockerId);
  });

  it("infect attacker destroys a blocker when -1/-1 counters reduce toughness to 0 (SBA 704.5g)", () => {
    // 2/2 infect attacker vs 0/2 blocker: 2 infect damage → 2 -1/-1 counters.
    // Effective toughness 2 - 2 = 0, so SBA destroys it.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Infect Attacker", power: 2, toughness: 2, keywords: ["Infect"] }],
      [{ name: "Blocker", power: 0, toughness: 2 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerId);
  });

  it("infect attacker unblocked deals poison counters to player (no life loss) (CR 702.93c)", () => {
    // 3/3 infect attacker unblocked → 3 poison counters, life unchanged.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Infect Attacker", power: 3, toughness: 3, keywords: ["Infect"] }],
      [],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);

    const result = resolveCombatDamage(atk.state);
    expect(result.success).toBe(true);

    const bob = result.state.players.get(bobId)!;
    expect(bob.poisonCounters).toBe(3);
    expect(bob.life).toBe(20); // no life loss with infect
  });

  it("toxic attacker unblocked deals normal damage plus toxic poison (CR 702.94)", () => {
    // 2/2 toxic 1 attacker unblocked → 2 life loss AND 1 poison counter.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Toxic Attacker", power: 2, toughness: 2, keywords: ["Toxic 1"] }],
      [],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);

    const result = resolveCombatDamage(atk.state);
    expect(result.success).toBe(true);

    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(18); // 20 - 2
    expect(bob.poisonCounters).toBe(1);
  });

  it("toxic N attacker unblocked adds N poison counters", () => {
    // 1/1 toxic 3 attacker unblocked → 1 life loss AND 3 poison counters.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Toxic Three", power: 1, toughness: 1, keywords: ["Toxic 3"] }],
      [],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);

    const result = resolveCombatDamage(atk.state);
    expect(result.success).toBe(true);

    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(19); // 20 - 1
    expect(bob.poisonCounters).toBe(3);
  });

  it("infect + deathtouch attacker destroys a blocker with a single point (CR 702.2b + 702.93b)", () => {
    // 1/1 infect + deathtouch attacker vs 0/5 blocker: 1 infect damage →
    // 1 -1/-1 counter, and because the source has deathtouch any nonzero
    // infect damage is lethal, so the blocker is destroyed.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Infect Deathtoucher",
          power: 1,
          toughness: 1,
          keywords: ["Infect", "Deathtouch"],
        },
      ],
      [{ name: "Blocker", power: 0, toughness: 5 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    // Blocker is destroyed (deathtouch lethality) despite only 1 damage.
    // Note: counters are cleared when a card moves to the graveyard
    // (moveCardToZone resets counters), so we assert destruction here;
    // the infect -1/-1 counter behaviour is verified in the surviving-
    // blocker test above.
    const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
    expect(bobGraveyard.cardIds).toContain(blockerId);
  });

  it("non-infect attacker marks normal damage and adds no -1/-1 counters", () => {
    // 3/3 regular attacker vs 0/5 blocker: 3 marked damage, no -1/-1 counters.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Vanilla Attacker", power: 3, toughness: 3 }],
      [{ name: "Blocker", power: 0, toughness: 5 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    const blockerCard = result.state.cards.get(blockerId)!;
    expect(blockerCard.damage).toBe(3);
    expect(getMinusOneCounters(result.state, blockerId)).toBe(0);
  });

  it("toxic attacker with trample adds toxic poison on excess damage to player", () => {
    // 5/5 toxic 1 trampler vs 0/1 blocker: 1 to blocker (lethal), 4 tramples
    // to player → 4 life loss AND 1 toxic poison counter.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Toxic Trampler",
          power: 5,
          toughness: 5,
          keywords: ["Toxic 1", "Trample"],
        },
      ],
      [{ name: "Blocker", power: 0, toughness: 1 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(16); // 20 - 4 trample
    expect(bob.poisonCounters).toBe(1);
  });

  it("infect blocker deals -1/-1 counters to the attacker (CR 702.93b)", () => {
    // 0/3 attacker (0 power) blocked by a 2/2 infect blocker: the blocker
    // deals 2 infect damage to the attacker → 2 -1/-1 counters on attacker.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Attacker", power: 0, toughness: 3 }],
      [{ name: "Infect Blocker", power: 2, toughness: 2, keywords: ["Infect"] }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const atk = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    atk.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blk = declareBlockers(
      atk.state,
      new Map([[attackerId, [blockerId]]]),
    );

    const result = resolveCombatDamage(blk.state);
    expect(result.success).toBe(true);

    // Attacker received 2 -1/-1 counters and no marked damage.
    expect(getMinusOneCounters(result.state, attackerId)).toBe(2);
    const attackerCard = result.state.cards.get(attackerId)!;
    expect(attackerCard.damage).toBe(0);
  });
});
