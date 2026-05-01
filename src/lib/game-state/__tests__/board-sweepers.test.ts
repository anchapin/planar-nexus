/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Board Sweeper Tests
 *
 * Tests for board sweeper spells that destroy all creatures.
 * Verifies correct targeting and destruction logic for Standard format.
 *
 * Issue #732: test(cards): Verify board sweepers destroy creatures correctly
 *
 * Reference: CR 608 - Handling Spells and Abilities
 */

import { destroyCard, hasIndestructible } from "../keyword-actions";
import {
  createInitialGameState,
  startGame,
  castSpell,
  resolveTopOfStack,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, CardInstanceId, PlayerId } from "../types";

function createMockCard(
  name: string,
  typeLine: string,
  oracleText: string = "",
  keywords: string[] = [],
  power?: string,
  toughness?: string,
  manaCost: string = "{1}",
  cmc: number = 1,
  colors: string[] = ["W"],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: typeLine,
    keywords,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
    power: power ?? "1",
    toughness: toughness ?? "1",
  } as ScryfallCard;
}

function createBoardSweeper(
  name: string,
  manaCost: string,
  cmc: number,
  oracleText: string,
  colors: string[] = ["W"],
): ScryfallCard {
  return createMockCard(
    name,
    "Sorcery",
    oracleText,
    [],
    undefined,
    undefined,
    manaCost,
    cmc,
    colors,
  );
}

describe("Board Sweepers", () => {
  let gameState: GameState;
  let player1Id: PlayerId;
  let player2Id: PlayerId;

  beforeEach(() => {
    gameState = createInitialGameState(["Player1", "Player2"], 20, false);
    gameState = startGame(gameState);
    const playerIds = Array.from(gameState.players.keys());
    player1Id = playerIds[0];
    player2Id = playerIds[1];
  });

  function addCreatureToBattlefield(
    state: GameState,
    name: string,
    power: number,
    toughness: number,
    controllerId: PlayerId,
    keywords: string[] = [],
  ): CardInstanceId {
    const cardData = createMockCard(
      name,
      "Creature — Test",
      "",
      keywords,
      power.toString(),
      toughness.toString(),
    );
    const card = createCardInstance(cardData, controllerId, controllerId);
    state.cards.set(card.instanceId, card as any);

    const battlefield = state.zones.get(`${controllerId}-battlefield`);
    if (battlefield) {
      battlefield.cardIds.push(card.instanceId);
    }
    return card.instanceId;
  }

  function getAllBattlefieldCreatures(state: GameState): CardInstanceId[] {
    const creatureIds: CardInstanceId[] = [];
    for (const [zoneKey, zone] of state.zones) {
      if (zoneKey.includes("battlefield")) {
        for (const cardId of zone.cardIds) {
          const card = state.cards.get(cardId);
          if (
            card &&
            card.cardData.type_line?.toLowerCase().includes("creature")
          ) {
            creatureIds.push(cardId);
          }
        }
      }
    }
    return creatureIds;
  }

  function addManaToPlayer(
    state: GameState,
    playerId: PlayerId,
    amount: number = 10,
  ): GameState {
    const player = state.players.get(playerId);
    if (!player) return state;

    const updatedPlayers = new Map(state.players);
    updatedPlayers.set(playerId, {
      ...player,
      manaPool: {
        generic: amount,
        colorless: amount,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
      },
    });

    return { ...state, players: updatedPlayers };
  }

  describe("destroyCard function", () => {
    it("should destroy a creature on the battlefield", () => {
      const creatureId = addCreatureToBattlefield(
        gameState,
        "Test Creature",
        2,
        2,
        player1Id,
      );
      const initialCreatures = getAllBattlefieldCreatures(gameState);
      expect(initialCreatures).toContain(creatureId);

      const result = destroyCard(gameState, creatureId);
      expect(result.success).toBe(true);

      const updatedCreatures = getAllBattlefieldCreatures(result.state);
      expect(updatedCreatures).not.toContain(creatureId);
    });

    it("should not destroy indestructible creatures by default", () => {
      const creatureId = addCreatureToBattlefield(
        gameState,
        "Guardian",
        2,
        2,
        player1Id,
        ["Indestructible"],
      );

      const result = destroyCard(gameState, creatureId);
      expect(result.success).toBe(false);
      expect(result.description).toContain("indestructible");

      const creatures = getAllBattlefieldCreatures(gameState);
      expect(creatures).toContain(creatureId);
    });

    it("should destroy indestructible creatures when ignoreIndestructible is true", () => {
      const creatureId = addCreatureToBattlefield(
        gameState,
        "Guardian",
        2,
        2,
        player1Id,
        ["Indestructible"],
      );

      const result = destroyCard(gameState, creatureId, true);
      expect(result.success).toBe(true);

      const creatures = getAllBattlefieldCreatures(result.state);
      expect(creatures).not.toContain(creatureId);
    });
  });

  describe("Board Sweeper Scenarios", () => {
    it("should destroy all creatures when Wrath of God resolves", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);

      addCreatureToBattlefield(gameState, "Grizzly Bears", 2, 2, player1Id);
      addCreatureToBattlefield(gameState, "Llanowar Elves", 1, 1, player1Id);
      addCreatureToBattlefield(gameState, "Mogg", 1, 1, player2Id);

      const initialP1Creatures = getAllBattlefieldCreatures(gameState).filter(
        (id) => {
          const card = gameState.cards.get(id);
          return card?.controllerId === player1Id;
        },
      );
      const initialP2Creatures = getAllBattlefieldCreatures(gameState).filter(
        (id) => {
          const card = gameState.cards.get(id);
          return card?.controllerId === player2Id;
        },
      );
      expect(initialP1Creatures.length).toBe(2);
      expect(initialP2Creatures.length).toBe(1);

      const wrathData = createBoardSweeper(
        "Wrath of God",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. They can't be regenerated.",
      );
      const wrathCard = createCardInstance(wrathData, player1Id, player1Id);
      gameState.cards.set(wrathCard.instanceId, wrathCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (hand) {
        hand.cardIds.push(wrathCard.instanceId);
      }

      const castResult = castSpell(
        gameState,
        player1Id,
        wrathCard.instanceId,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const stateWithStack = castResult.state;
      expect(stateWithStack.stack.length).toBe(1);

      const resolvedState = resolveTopOfStack(stateWithStack);

      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures.length).toBe(0);
    });

    it("should destroy all creatures when Supreme Verdict resolves", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);

      addCreatureToBattlefield(gameState, "Snapcaster Mage", 2, 1, player1Id);
      addCreatureToBattlefield(gameState, "Serra Angel", 4, 4, player2Id);

      const verdictData = createBoardSweeper(
        "Supreme Verdict",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. This spell can't be countered.",
      );
      const verdictCard = createCardInstance(verdictData, player1Id, player1Id);
      gameState.cards.set(verdictCard.instanceId, verdictCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (hand) {
        hand.cardIds.push(verdictCard.instanceId);
      }

      const castResult = castSpell(
        gameState,
        player1Id,
        verdictCard.instanceId,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const resolvedState = resolveTopOfStack(castResult.state);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures.length).toBe(0);
    });

    it("should destroy all creatures including indestructible (Wrath effect)", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);

      const normalCreature = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player1Id,
      );
      const indestructibleCreature = addCreatureToBattlefield(
        gameState,
        "Archangel",
        5,
        5,
        player2Id,
        ["Indestructible"],
      );

      const wrathData = createBoardSweeper(
        "Wrath of God",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. They can't be regenerated.",
      );
      const wrathCard = createCardInstance(wrathData, player1Id, player1Id);
      gameState.cards.set(wrathCard.instanceId, wrathCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (hand) {
        hand.cardIds.push(wrathCard.instanceId);
      }

      const castResult = castSpell(
        gameState,
        player1Id,
        wrathCard.instanceId,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const resolvedState = resolveTopOfStack(castResult.state);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);

      expect(finalCreatures.length).toBe(0);
    });

    it("should handle multiple creatures from multiple players", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = addManaToPlayer(gameState, player2Id, 10);

      for (let i = 0; i < 3; i++) {
        addCreatureToBattlefield(
          gameState,
          `P1 Creature ${i}`,
          2,
          2,
          player1Id,
        );
      }
      for (let i = 0; i < 4; i++) {
        addCreatureToBattlefield(
          gameState,
          `P2 Creature ${i}`,
          1,
          2,
          player2Id,
        );
      }

      const initialCreatures = getAllBattlefieldCreatures(gameState);
      expect(initialCreatures.length).toBe(7);

      const sunfallData = createBoardSweeper(
        "Sunfall",
        "{3}{W}{W}",
        5,
        "Destroy all creatures.",
      );
      const sunfallCard = createCardInstance(sunfallData, player1Id, player1Id);
      gameState.cards.set(sunfallCard.instanceId, sunfallCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (hand) {
        hand.cardIds.push(sunfallCard.instanceId);
      }

      const castResult = castSpell(
        gameState,
        player1Id,
        sunfallCard.instanceId,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const resolvedState = resolveTopOfStack(castResult.state);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures.length).toBe(0);
    });
  });

  describe("hasIndestructible helper", () => {
    it("should detect indestructible from keywords", () => {
      const cardData = createMockCard(
        "Test",
        "Creature",
        "",
        ["Indestructible"],
        "1",
        "1",
      );
      const card = createCardInstance(cardData, player1Id, player1Id);
      expect(hasIndestructible(card as any)).toBe(true);
    });

    it("should detect indestructible from oracle text", () => {
      const cardData = createMockCard(
        "Test",
        "Creature",
        "Indestructible",
        [],
        "1",
        "1",
      );
      const card = createCardInstance(cardData, player1Id, player1Id);
      expect(hasIndestructible(card as any)).toBe(true);
    });

    it("should return false for creatures without indestructible", () => {
      const cardData = createMockCard(
        "Test",
        "Creature",
        "Flying",
        [],
        "1",
        "1",
      );
      const card = createCardInstance(cardData, player1Id, player1Id);
      expect(hasIndestructible(card as any)).toBe(false);
    });
  });
});
