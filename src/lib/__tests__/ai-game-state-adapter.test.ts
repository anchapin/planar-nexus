/**
 * Unit tests for the engine → AI game-state adapter extracted from the
 * single-player game page (issue #1715).
 *
 * Builds a real engine state via the game-state barrel factories
 * (createInitialGameState → loadDeckForPlayer → startGame), then injects
 * battlefield/graveyard/mana-pool details the way the engine mutators do and
 * asserts the AI-facing mapping is unchanged from the page's inline version.
 */

import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  createCardInstance,
  type GameState,
  type PlayerId,
} from "@/lib/game-state";
import { createCreatureCard, createLandCard } from "@/lib/deck-generation";
import { convertToAIGameState } from "@/lib/ai-game-state-adapter";

function buildTenCardDeck() {
  const deck = [
    ...Array.from({ length: 9 }, (_, i) =>
      createCreatureCard(`Deck Filler ${i}`, "{1}{G}", 2, 2, ["G"], i),
    ),
    createLandCard("Forest", "G", 0),
  ];
  return deck;
}

describe("convertToAIGameState", () => {
  let state: GameState;
  let aliceId: PlayerId;
  let bobId: PlayerId;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"], 20, false);
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];
    state = loadDeckForPlayer(state, aliceId, buildTenCardDeck(), false);
    state = loadDeckForPlayer(state, bobId, buildTenCardDeck(), false);
    state = startGame(state);
  });

  it("maps both players with life, poison, and commander damage", () => {
    const aiState = convertToAIGameState(state, bobId);
    expect(Object.keys(aiState.players).sort()).toEqual(
      [aliceId, bobId].sort(),
    );

    const alice = aiState.players[aliceId];
    expect(alice.id).toBe(aliceId);
    expect(alice.life).toBe(20);
    expect(alice.poisonCounters).toBe(0);
    expect(alice.commanderDamage).toEqual({});
  });

  it("maps the mana pool letter keys from the engine color names", () => {
    const players = new Map(state.players);
    const alice = players.get(aliceId)!;
    players.set(aliceId, {
      ...alice,
      manaPool: {
        ...alice.manaPool,
        white: 1,
        blue: 2,
        black: 3,
        red: 4,
        green: 5,
        colorless: 6,
      },
    });
    const mutated: GameState = { ...state, players };

    const aiState = convertToAIGameState(mutated, aliceId);
    expect(aiState.players[aliceId].manaPool).toEqual({
      W: 1,
      U: 2,
      B: 3,
      R: 4,
      G: 5,
      C: 6,
    });
  });

  it("reflects opening-hand draw: 7-card hands, 3-card libraries", () => {
    const aiState = convertToAIGameState(state, aliceId);
    for (const playerId of [aliceId, bobId]) {
      const player = aiState.players[playerId];
      expect(player.hand).toHaveLength(7);
      expect(player.library).toBe(3);
    }

    // Hand entries mirror the engine hand zone ids and card data
    const handZone = state.zones.get(`${aliceId}-hand`)!;
    const alice = aiState.players[aliceId];
    const handIds = alice.hand.map((c) => c.cardInstanceId);
    expect(handIds).toEqual(handZone.cardIds);
    for (const entry of alice.hand) {
      const engineCard = state.cards.get(entry.cardInstanceId)!;
      expect(entry.name).toBe(engineCard.cardData.name);
      expect(entry.type).toBe(engineCard.cardData.type_line);
      expect(entry.manaValue).toBe(engineCard.cardData.cmc);
    }
  });

  it("maps battlefield permanents with parsed power/toughness and types", () => {
    const bearData = createCreatureCard(
      "Grizzly Bears",
      "{1}{G}",
      2,
      2,
      ["G"],
      7,
    );
    const mountainData = {
      ...createLandCard("Mountain", "R", 7),
      type_line: "Land — Mountain",
    };
    const bear = {
      ...createCardInstance(bearData, aliceId, aliceId),
      isTapped: true,
    };
    const mountain = createCardInstance(mountainData, aliceId, aliceId);

    const cards = new Map(state.cards);
    cards.set(bear.id, bear);
    cards.set(mountain.id, mountain);
    const battlefieldKey = `${aliceId}-battlefield`;
    const battlefield = state.zones.get(battlefieldKey)!;
    const zones = new Map(state.zones);
    zones.set(battlefieldKey, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, bear.id, mountain.id],
    });
    const mutated: GameState = { ...state, cards, zones };

    const aiState = convertToAIGameState(mutated, aliceId);
    const battlefieldPermanents = aiState.players[aliceId].battlefield;
    expect(battlefieldPermanents).toHaveLength(2);

    const bearPermanent = battlefieldPermanents.find(
      (p) => p.name === "Grizzly Bears",
    )!;
    expect(bearPermanent.id).toBe(bear.id);
    expect(bearPermanent.cardInstanceId).toBe(bear.id);
    expect(bearPermanent.type).toBe("creature");
    expect(bearPermanent.controller).toBe(aliceId);
    expect(bearPermanent.tapped).toBe(true);
    expect(bearPermanent.power).toBe(2);
    expect(bearPermanent.toughness).toBe(2);
    expect(bearPermanent.manaValue).toBe(2);

    const mountainPermanent = battlefieldPermanents.find(
      (p) => p.name === "Mountain",
    )!;
    expect(mountainPermanent.type).toBe("land");
    expect(mountainPermanent.tapped).toBe(false);
  });

  it("defaults permanent type to creature for unknown type lines", () => {
    const battleData = {
      ...createCreatureCard("Odd Battle", "{1}", 1, 1, ["W"], 9),
      type_line: "Battle",
    };
    const battle = createCardInstance(battleData, aliceId, aliceId);
    const cards = new Map(state.cards);
    cards.set(battle.id, battle);
    const battlefieldKey = `${aliceId}-battlefield`;
    const battlefield = state.zones.get(battlefieldKey)!;
    const zones = new Map(state.zones);
    zones.set(battlefieldKey, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, battle.id],
    });
    const mutated: GameState = { ...state, cards, zones };

    const aiState = convertToAIGameState(mutated, aliceId);
    const permanent = aiState.players[aliceId].battlefield.find(
      (p) => p.name === "Odd Battle",
    )!;
    expect(permanent.type).toBe("creature");
  });

  it("maps graveyard zone ids and leaves exile empty", () => {
    const dustData = createCreatureCard("Dust", "{B}", 1, 1, ["B"], 5);
    const dust = createCardInstance(dustData, aliceId, aliceId);
    const cards = new Map(state.cards);
    cards.set(dust.id, dust);
    const graveyardKey = `${aliceId}-graveyard`;
    const graveyard = state.zones.get(graveyardKey)!;
    const zones = new Map(state.zones);
    zones.set(graveyardKey, { ...graveyard, cardIds: [dust.id] });
    const mutated: GameState = { ...state, cards, zones };

    const aiState = convertToAIGameState(mutated, aliceId);
    expect(aiState.players[aliceId].graveyard).toEqual([dust.id]);
    expect(aiState.players[aliceId].exile).toEqual([]);
  });

  it("maps turn info: turn number, active player, phase, priority", () => {
    const aiState = convertToAIGameState(state, aliceId);
    expect(aiState.turnInfo.currentTurn).toBe(state.turn.turnNumber);
    expect(aiState.turnInfo.currentPlayer).toBe(state.turn.activePlayerId);
    expect(aiState.turnInfo.phase).toBe(state.turn.currentPhase);
    expect(aiState.turnInfo.priority).toBe(state.priorityPlayerId);
  });

  it("falls back to empty-string priority when no player holds priority", () => {
    const mutated: GameState = { ...state, priorityPlayerId: null };
    const aiState = convertToAIGameState(mutated, aliceId);
    expect(aiState.turnInfo.priority).toBe("");
  });

  it("maps the empty stack and fresh combat state", () => {
    const aiState = convertToAIGameState(state, aliceId);
    expect(aiState.stack).toEqual([]);
    // The adapter always emits a combat object (engine type marks it optional)
    expect(aiState.combat?.inCombatPhase).toBe(false);
    expect(aiState.combat?.attackers).toEqual([]);
    expect(aiState.combat?.blockers).toEqual({});
  });
});
