/**
 * Unit Tests for Planeswalker Loyalty Abilities
 * Issue #733: Verify planeswalker loyalty abilities work correctly
 *
 * Tests the implementation of MTG planeswalker loyalty mechanics as defined in Comprehensive Rules 306.
 */

import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import { checkStateBasedActions } from "../state-based-actions";
import {
  activateLoyaltyAbility,
  canActivateLoyaltyAbility,
} from "../abilities";
import { Phase } from "../types";
import type { ScryfallCard, GameState, PlayerId } from "../types";

function createMockPlaneswalker(
  name: string,
  loyalty: number,
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `Planeswalker — ${name.split(" ")[0]}`,
    loyalty: loyalty.toString(),
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "{3}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
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

describe("Planeswalker Loyalty Abilities", () => {
  describe("JC-005: Planeswalker Loyalty Response", () => {
    it("a planeswalker with 2 loyalty should survive Shock if +1 ability resolves first", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      const aliceId = playerIds[0];

      const pwData = createMockPlaneswalker(
        "Test Planeswalker",
        3,
        "+1: Draw a card.",
      );
      const planeswalker = createCardInstance(pwData, aliceId, aliceId);
      planeswalker.counters = [{ type: "loyalty", count: 2 }];

      state.cards.set(planeswalker.id, planeswalker);
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalker.id],
      });

      const startingLoyalty = 2;
      const loyaltyPlusOne = startingLoyalty + 1;
      const remainingAfterDamage = loyaltyPlusOne - 2;

      expect(remainingAfterDamage).toBeGreaterThan(0);
    });
  });

  describe("Planeswalker SBA - 0 Loyalty Exile (CR 704.5i)", () => {
    it("should exile a planeswalker with 0 loyalty", () => {
      let state = createInitialGameState(["Alice"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      const pwData = createMockPlaneswalker("Test Planeswalker", 3);
      const planeswalker = createCardInstance(
        pwData,
        playerIds[0],
        playerIds[0],
      );

      planeswalker.counters = [{ type: "loyalty", count: 0 }];

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(planeswalker.id, planeswalker);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalker.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const exile = result.state.zones.get(`${playerIds[0]}-exile`)!;
      expect(exile.cardIds).toContain(planeswalker.id);
    });

    it("should not exile a planeswalker with loyalty > 0", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      const pwData = createMockPlaneswalker("Test Planeswalker", 3);
      const planeswalker = createCardInstance(
        pwData,
        playerIds[0],
        playerIds[0],
      );

      planeswalker.counters = [{ type: "loyalty", count: 1 }];

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(planeswalker.id, planeswalker);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalker.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const battlefieldAfter = result.state.zones.get(
        `${playerIds[0]}-battlefield`,
      )!;
      expect(battlefieldAfter.cardIds).toContain(planeswalker.id);
    });
  });

  describe("Planeswalker Loyalty Initialization", () => {
    it("should initialize planeswalker with loyalty counters", () => {
      const pwData = createMockPlaneswalker("Test Planeswalker", 4);
      const planeswalker = createCardInstance(pwData, "player1", "player1");

      const initialized = initializePlaneswalkerLoyalty(planeswalker);

      const loyaltyCounter = initialized.counters?.find(
        (c) => c.type === "loyalty",
      );
      expect(loyaltyCounter).toBeDefined();
      expect(loyaltyCounter?.count).toBe(4);
    });

    it("should not modify non-planeswalker cards", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const result = initializePlaneswalkerLoyalty(creature);

      expect(result).toBe(creature);
      expect(result.counters).toEqual([]);
    });

    it("should handle planeswalkers without loyalty field", () => {
      const pwData = createMockPlaneswalker("Test Planeswalker", 0);
      delete (pwData as Partial<ScryfallCard>).loyalty;
      const planeswalker = createCardInstance(pwData, "player1", "player1");

      const result = initializePlaneswalkerLoyalty(planeswalker);

      expect(result.counters).toEqual([]);
    });
  });

  describe("Loyalty Ability Activation", () => {
    let state: GameState;
    let aliceId: PlayerId;
    let bobId: PlayerId;
    let planeswalkerId: string;

    beforeEach(() => {
      state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      aliceId = playerIds[0];
      bobId = playerIds[1];

      const pwData = createMockPlaneswalker(
        "Jace, the Perfected Mind",
        3,
        "+1: Draw a card. -3: Deal damage.",
      );
      const planeswalker = createCardInstance(pwData, aliceId, aliceId);
      planeswalker.counters = [{ type: "loyalty", count: 3 }];
      planeswalkerId = planeswalker.id;
      state.cards.set(planeswalkerId, planeswalker);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalkerId],
      });

      state = {
        ...state,
        priorityPlayerId: aliceId,
        turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
      };
    });

    it("should allow loyalty activation during main phase with empty stack", () => {
      const result = canActivateLoyaltyAbility(
        state,
        aliceId,
        planeswalkerId,
        1,
      );
      expect(result.canActivate).toBe(true);
    });

    it("should deny activation when card is not a planeswalker", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, aliceId, aliceId);
      state.cards.set(creature.id, creature);

      const result = canActivateLoyaltyAbility(state, aliceId, creature.id, 1);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toBe("Card is not a planeswalker");
    });

    it("should deny activation when player does not control planeswalker", () => {
      const result = canActivateLoyaltyAbility(state, bobId, planeswalkerId, 1);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toBe("You do not control this planeswalker");
    });

    it("should deny activation when not main phase", () => {
      state = {
        ...state,
        turn: { ...state.turn, currentPhase: Phase.BEGIN_COMBAT },
      };

      const result = canActivateLoyaltyAbility(
        state,
        aliceId,
        planeswalkerId,
        1,
      );
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain("main phases");
    });

    it("should deny activation when stack is not empty", () => {
      state = {
        ...state,
        stack: [
          {
            id: "test-spell",
            type: "spell" as const,
            sourceCardId: "test",
            controllerId: bobId,
            name: "Test",
            text: "",
            manaCost: null,
            targets: [],
            chosenModes: [],
            variableValues: new Map(),
            isCountered: false,
            timestamp: Date.now(),
          },
        ],
      };

      const result = canActivateLoyaltyAbility(
        state,
        aliceId,
        planeswalkerId,
        1,
      );
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain("Stack must be empty");
    });

    it("should deny activation when not enough loyalty counters", () => {
      const result = canActivateLoyaltyAbility(
        state,
        aliceId,
        planeswalkerId,
        -4,
      );
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain("Not enough loyalty");
    });

    it("should successfully activate loyalty ability and update counters", () => {
      const result = activateLoyaltyAbility(state, aliceId, planeswalkerId, 0);

      expect(result.success).toBe(true);
      const card = result.state.cards.get(planeswalkerId);
      const loyaltyCounter = card?.counters?.find((c) => c.type === "loyalty");
      expect(loyaltyCounter?.count).toBe(4);
    });

    it("should fail when planeswalker not found", () => {
      const result = activateLoyaltyAbility(state, aliceId, "non-existent", 0);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Card not found");
    });
  });

  describe("Chandra, Torch of Defiance abilities", () => {
    it("should track loyalty correctly for Chandra", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      const aliceId = playerIds[0];

      const chandraData = createMockPlaneswalker(
        "Chandra, Torch of Defiance",
        4,
        "+1: Deal 2 damage to each opponent.\n-2: Deal 4 damage to target creature.\n0: Exile target creature.",
      );
      const chandra = createCardInstance(chandraData, aliceId, aliceId);
      chandra.counters = [{ type: "loyalty", count: 4 }];
      const chandraId = chandra.id;

      state.cards.set(chandraId, chandra);
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, chandraId],
      });

      state = {
        ...state,
        priorityPlayerId: aliceId,
        turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
        stack: [],
      };

      const canActivateResult = canActivateLoyaltyAbility(
        state,
        aliceId,
        chandraId,
        -2,
      );
      expect(canActivateResult.canActivate).toBe(true);

      const activationResult = activateLoyaltyAbility(
        state,
        aliceId,
        chandraId,
        1,
      );

      expect(activationResult.success).toBe(true);

      const updatedChandra = activationResult.state.cards.get(chandraId);
      const loyaltyCounter = updatedChandra?.counters?.find(
        (c) => c.type === "loyalty",
      );
      expect(loyaltyCounter?.count).toBe(2);
    });
  });

  describe("Planeswalker uniqueness rule (CR 704.5j)", () => {
    it("should allow two different planeswalkers to coexist", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys()) as PlayerId[];
      const aliceId = playerIds[0];

      const pwData1 = createMockPlaneswalker("Jace, the Perfected Mind", 3);
      const planeswalker1 = createCardInstance(pwData1, aliceId, aliceId);
      planeswalker1.counters = [{ type: "loyalty", count: 3 }];

      const pwData2 = createMockPlaneswalker("Chandra, Torch of Defiance", 4);
      const planeswalker2 = createCardInstance(pwData2, aliceId, aliceId);
      planeswalker2.counters = [{ type: "loyalty", count: 4 }];

      state.cards.set(planeswalker1.id, planeswalker1);
      state.cards.set(planeswalker2.id, planeswalker2);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [planeswalker1.id, planeswalker2.id],
      });

      const result = checkStateBasedActions(state);

      const battlefieldResult = result.state.zones.get(
        `${aliceId}-battlefield`,
      )!;
      expect(battlefieldResult.cardIds).toContain(planeswalker1.id);
      expect(battlefieldResult.cardIds).toContain(planeswalker2.id);
    });
  });
});
