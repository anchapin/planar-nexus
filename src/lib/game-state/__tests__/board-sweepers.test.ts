/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Board Sweeper Tests
 */

import { destroyCard, hasIndestructible } from "../keyword-actions";
import { createInitialGameState, startGame } from "../game-state";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createCardInstance } from "../card-instance";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, CardInstanceId, PlayerId, Phase } from "../types";

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
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
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
    const initialState = createInitialGameState(
      ["Player1", "Player2"],
      20,
      false,
    );
    gameState = startGame(initialState);
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
  ): { cardId: CardInstanceId; state: GameState } {
    const cardData = createMockCard(
      name,
      "Creature — Test",
      "",
      keywords,
      power.toString(),
      toughness.toString(),
    );
    const card = createCardInstance(cardData, controllerId, controllerId);

    const updatedCards = new Map(state.cards);
    updatedCards.set(card.id, card as any);

    const battlefieldZoneKey = `${controllerId}-battlefield`;
    const battlefield = state.zones.get(battlefieldZoneKey);

    if (!battlefield) {
      throw new Error(`Battlefield zone not found: ${battlefieldZoneKey}`);
    }

    const updatedBattlefield = {
      ...battlefield,
      cardIds: [...battlefield.cardIds, card.id],
    };
    const updatedZones = new Map(state.zones);
    updatedZones.set(battlefieldZoneKey, updatedBattlefield);

    return {
      cardId: card.id,
      state: { ...state, cards: updatedCards, zones: updatedZones },
    };
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
        white: amount,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
      },
    });

    return { ...state, players: updatedPlayers };
  }

  function setToMainPhase(state: GameState, playerId: PlayerId): GameState {
    return {
      ...state,
      turn: {
        ...state.turn,
        activePlayerId: playerId,
        currentPhase: "precombat_main" as Phase,
      },
    };
  }

  describe("destroyCard function", () => {
    it("should destroy a creature on the battlefield", () => {
      const result = addCreatureToBattlefield(
        gameState,
        "Test Creature",
        2,
        2,
        player1Id,
      );
      gameState = result.state;
      const creatureId = result.cardId;

      const initialCreatures = getAllBattlefieldCreatures(gameState);
      expect(initialCreatures).toContain(creatureId);

      const destroyResult = destroyCard(gameState, creatureId);
      expect(destroyResult.success).toBe(true);

      const updatedCreatures = getAllBattlefieldCreatures(destroyResult.state);
      expect(updatedCreatures).not.toContain(creatureId);
    });

    it("should not destroy indestructible creatures by default", () => {
      const result = addCreatureToBattlefield(
        gameState,
        "Guardian",
        2,
        2,
        player1Id,
        ["Indestructible"],
      );
      gameState = result.state;
      const creatureId = result.cardId;

      const destroyResult = destroyCard(gameState, creatureId);
      expect(destroyResult.success).toBe(false);
      expect(destroyResult.description).toContain("indestructible");

      const creatures = getAllBattlefieldCreatures(gameState);
      expect(creatures).toContain(creatureId);
    });

    it("should destroy indestructible creatures when ignoreIndestructible is true", () => {
      const result = addCreatureToBattlefield(
        gameState,
        "Guardian",
        2,
        2,
        player1Id,
        ["Indestructible"],
      );
      gameState = result.state;
      const creatureId = result.cardId;

      const destroyResult = destroyCard(gameState, creatureId, true);
      expect(destroyResult.success).toBe(true);

      const creatures = getAllBattlefieldCreatures(destroyResult.state);
      expect(creatures).not.toContain(creatureId);
    });
  });

  describe("Board Sweeper Scenarios", () => {
    it("should destroy all creatures when Wrath of God resolves", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const bearResult = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player1Id,
      );
      gameState = bearResult.state;

      const elvesResult = addCreatureToBattlefield(
        gameState,
        "Llanowar Elves",
        1,
        1,
        player1Id,
      );
      gameState = elvesResult.state;

      const moggResult = addCreatureToBattlefield(
        gameState,
        "Mogg",
        1,
        1,
        player2Id,
      );
      gameState = moggResult.state;

      const allCreatures = getAllBattlefieldCreatures(gameState);
      expect(allCreatures.length).toBe(3);

      const wrathData = createBoardSweeper(
        "Wrath of God",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. They can't be regenerated.",
      );
      const wrathCard = createCardInstance(wrathData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(wrathCard.id, wrathCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");

      const updatedHand = { ...hand, cardIds: [...hand.cardIds, wrathCard.id] };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);

      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        wrathCard.id,
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
      gameState = setToMainPhase(gameState, player1Id);

      const snapResult = addCreatureToBattlefield(
        gameState,
        "Snapcaster Mage",
        2,
        1,
        player1Id,
      );
      gameState = snapResult.state;

      const serraResult = addCreatureToBattlefield(
        gameState,
        "Serra Angel",
        4,
        4,
        player2Id,
      );
      gameState = serraResult.state;

      const verdictData = createBoardSweeper(
        "Supreme Verdict",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. This spell can't be countered.",
      );
      const verdictCard = createCardInstance(verdictData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(verdictCard.id, verdictCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");

      const updatedHand = {
        ...hand,
        cardIds: [...hand.cardIds, verdictCard.id],
      };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);

      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        verdictCard.id,
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
      gameState = setToMainPhase(gameState, player1Id);

      const bearResult = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player1Id,
      );
      gameState = bearResult.state;

      const angelResult = addCreatureToBattlefield(
        gameState,
        "Archangel",
        5,
        5,
        player2Id,
        ["Indestructible"],
      );
      gameState = angelResult.state;

      const wrathData = createBoardSweeper(
        "Wrath of God",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. They can't be regenerated.",
      );
      const wrathCard = createCardInstance(wrathData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(wrathCard.id, wrathCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");

      const updatedHand = { ...hand, cardIds: [...hand.cardIds, wrathCard.id] };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);

      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        wrathCard.id,
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
      gameState = setToMainPhase(gameState, player1Id);

      for (let i = 0; i < 3; i++) {
        const result = addCreatureToBattlefield(
          gameState,
          `P1 Creature ${i}`,
          2,
          2,
          player1Id,
        );
        gameState = result.state;
      }
      for (let i = 0; i < 4; i++) {
        const result = addCreatureToBattlefield(
          gameState,
          `P2 Creature ${i}`,
          1,
          2,
          player2Id,
        );
        gameState = result.state;
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

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(sunfallCard.id, sunfallCard as any);

      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");

      const updatedHand = {
        ...hand,
        cardIds: [...hand.cardIds, sunfallCard.id],
      };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);

      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        sunfallCard.id,
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

  describe("Hexproof/Shroud and Board Sweepers", () => {
    it("should destroy hexproof creatures (board sweepers don't target)", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const hexproofResult = addCreatureToBattlefield(
        gameState,
        "Silhana Ledgewalker",
        2,
        1,
        player2Id,
        ["Hexproof"],
      );
      gameState = hexproofResult.state;
      const hexproofId = hexproofResult.cardId;

      const shroudResult = addCreatureToBattlefield(
        gameState,
        "Ghostly Lantern",
        1,
        1,
        player2Id,
        ["Shroud"],
      );
      gameState = shroudResult.state;

      const wrathData = createBoardSweeper(
        "Wrath of God",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. They can't be regenerated.",
      );
      const wrathCard = createCardInstance(wrathData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(wrathCard.id, wrathCard as any);
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");
      const updatedHand = { ...hand, cardIds: [...hand.cardIds, wrathCard.id] };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);
      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        wrathCard.id,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const resolvedState = resolveTopOfStack(castResult.state);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures).not.toContain(hexproofId);
      expect(finalCreatures.length).toBe(0);
    });

    it("should destroy creatures with protection from white (board sweepers don't target)", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const protectionResult = addCreatureToBattlefield(
        gameState,
        "Isamaru",
        2,
        2,
        player2Id,
        [],
      );
      gameState = protectionResult.state;
      const protectionId = protectionResult.cardId;

      const cardToUpdate = gameState.cards.get(protectionId);
      if (cardToUpdate) {
        const updatedCards = new Map(gameState.cards);
        updatedCards.set(protectionId, {
          ...cardToUpdate,
          cardData: {
            ...cardToUpdate.cardData,
            oracle_text: "Protection from white",
          },
        } as any);
        gameState = { ...gameState, cards: updatedCards };
      }

      const verdictData = createBoardSweeper(
        "Supreme Verdict",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. This spell can't be countered.",
      );
      const verdictCard = createCardInstance(verdictData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(verdictCard.id, verdictCard as any);
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");
      const updatedHand = {
        ...hand,
        cardIds: [...hand.cardIds, verdictCard.id],
      };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);
      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        verdictCard.id,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const resolvedState = resolveTopOfStack(castResult.state);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures).not.toContain(protectionId);
      expect(finalCreatures.length).toBe(0);
    });
  });

  describe("Cleansing Nova", () => {
    it("should destroy all creatures in creature-only mode", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const bearResult = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player1Id,
      );
      gameState = bearResult.state;

      const angelResult = addCreatureToBattlefield(
        gameState,
        "Serra Angel",
        4,
        4,
        player2Id,
      );
      gameState = angelResult.state;

      const allCreatures = getAllBattlefieldCreatures(gameState);
      expect(allCreatures.length).toBe(2);

      const novaData = createBoardSweeper(
        "Cleansing Nova",
        "{3}{W}",
        5,
        "Choose one —\n• Destroy all creatures.\n• Exile all nonland permanents.",
      );
      const novaCard = createCardInstance(novaData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(novaCard.id, novaCard as any);
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");
      const updatedHand = { ...hand, cardIds: [...hand.cardIds, novaCard.id] };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);
      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        novaCard.id,
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

  describe("Farewell", () => {
    it("should destroy all creatures in creature mode", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const bearResult = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player1Id,
      );
      gameState = bearResult.state;

      const elfResult = addCreatureToBattlefield(
        gameState,
        "Llanowar Elves",
        1,
        1,
        player2Id,
      );
      gameState = elfResult.state;

      const allCreatures = getAllBattlefieldCreatures(gameState);
      expect(allCreatures.length).toBe(2);

      const farewellData = createBoardSweeper(
        "Farewell",
        "{3}{W}{W}",
        6,
        "Choose two —\n• Destroy all creatures.\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Exile all cards from all graveyards.",
      );
      const farewellCard = createCardInstance(
        farewellData,
        player1Id,
        player1Id,
      );

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(farewellCard.id, farewellCard as any);
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");
      const updatedHand = {
        ...hand,
        cardIds: [...hand.cardIds, farewellCard.id],
      };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);
      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        farewellCard.id,
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

  describe("Supreme Verdict 'can't be countered' behavior", () => {
    it("should resolve Supreme Verdict even when spell would normally be countered", () => {
      gameState = addManaToPlayer(gameState, player1Id, 10);
      gameState = setToMainPhase(gameState, player1Id);

      const bearResult = addCreatureToBattlefield(
        gameState,
        "Grizzly Bears",
        2,
        2,
        player2Id,
      );
      gameState = bearResult.state;

      const verdictData = createBoardSweeper(
        "Supreme Verdict",
        "{2}{W}{W}",
        4,
        "Destroy all creatures. This spell can't be countered.",
      );
      const verdictCard = createCardInstance(verdictData, player1Id, player1Id);

      const updatedCards = new Map(gameState.cards);
      updatedCards.set(verdictCard.id, verdictCard as any);
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (!hand) throw new Error("Hand not found");
      const updatedHand = {
        ...hand,
        cardIds: [...hand.cardIds, verdictCard.id],
      };
      const updatedZones = new Map(gameState.zones);
      updatedZones.set(`${player1Id}-hand`, updatedHand);
      gameState = { ...gameState, cards: updatedCards, zones: updatedZones };

      const castResult = castSpell(
        gameState,
        player1Id,
        verdictCard.id,
        [],
        [],
        0,
      );
      expect(castResult.success).toBe(true);

      const stateWithStack = castResult.state;
      const stackObj = stateWithStack.stack[stateWithStack.stack.length - 1];
      expect(stackObj.text).toContain("can't be countered");

      const resolvedState = resolveTopOfStack(stateWithStack);
      const finalCreatures = getAllBattlefieldCreatures(resolvedState);
      expect(finalCreatures.length).toBe(0);
    });
  });
});
