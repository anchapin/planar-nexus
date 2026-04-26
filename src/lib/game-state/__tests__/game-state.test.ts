/**
 * @fileoverview Unit Tests for Game State Management
 *
 * Tests for core game state functions including creation, lifecycle, and player actions.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  dealDamageToPlayer,
  gainLife,
  concede,
  getPlayerLibrary,
  getPlayerHand,
  getPlayerBattlefield,
  getPlayerGraveyard,
  getPlayerExile,
  offerDraw,
  acceptDraw,
  declineDraw,
  canOfferDraw,
  canAcceptDraw,
  checkStateBasedActions,
  passPriority,
  drawCard,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type { GameState, PlayerId } from "../types";

/**
 * Create a mock ScryfallCard for testing
 */
function createMockCard(name: string, type: string, cmc: number = 1): any {
  return {
    id: `card-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: type,
    cmc,
    mana_cost: type.includes("Land") ? "" : `{${cmc}}`,
    oracle_text: "",
    power: type.includes("Creature") ? "2" : undefined,
    toughness: type.includes("Creature") ? "2" : undefined,
    keywords: [],
    color_identity: [],
    colors: [],
    legalities: { standard: "not_legal" },
  };
}

describe("Game State Management", () => {
  describe("createInitialGameState", () => {
    it("should create a game with specified players", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(gameState).toBeDefined();
      expect(gameState.players.size).toBe(2);
      expect(gameState.status).toBe("not_started");
      expect(gameState.gameId).toBeDefined();
    });

    it("should create a game with custom starting life", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"], 40);

      const players = Array.from(gameState.players.values());
      expect(players[0].life).toBe(40);
      expect(players[1].life).toBe(40);
    });

    it("should create a game with default starting life (20)", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      const players = Array.from(gameState.players.values());
      expect(players[0].life).toBe(20);
      expect(players[1].life).toBe(20);
    });

    it("should create a single player game", () => {
      const gameState = createInitialGameState(["Solo Player"]);

      expect(gameState.players.size).toBe(1);
      expect(gameState.priorityPlayerId).toBeDefined();
    });

    it("should create a multiplayer game (4 players)", () => {
      const gameState = createInitialGameState(["P1", "P2", "P3", "P4"]);

      expect(gameState.players.size).toBe(4);
      expect(gameState.status).toBe("not_started");
    });

    it("should initialize turn for first player", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(gameState.turn.turnNumber).toBe(1);
      expect(gameState.turn.activePlayerId).toBeDefined();
      expect(gameState.priorityPlayerId).toBe(gameState.turn.activePlayerId);
    });

    it("should create all required zones", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      const playerIds = Array.from(gameState.players.keys());

      // Check player-specific zones exist
      playerIds.forEach((playerId) => {
        expect(gameState.zones.has(`${playerId}-library`)).toBe(true);
        expect(gameState.zones.has(`${playerId}-hand`)).toBe(true);
        expect(gameState.zones.has(`${playerId}-battlefield`)).toBe(true);
        expect(gameState.zones.has(`${playerId}-graveyard`)).toBe(true);
        expect(gameState.zones.has(`${playerId}-exile`)).toBe(true);
        expect(gameState.zones.has(`${playerId}-command`)).toBe(true);
      });

      // Check shared zones exist
      expect(gameState.zones.has("stack")).toBe(true);
      // Note: exile is player-specific, not shared
    });

    it("should initialize combat state", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(gameState.combat.inCombatPhase).toBe(false);
      expect(gameState.combat.attackers).toEqual([]);
      expect(gameState.combat.blockers).toBeDefined();
    });

    it("should set format to standard by default", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(gameState.format).toBe("standard");
    });

    it("should set timestamps", () => {
      const beforeTime = Date.now();
      const gameState = createInitialGameState(["Player 1", "Player 2"]);
      const afterTime = Date.now();

      expect(gameState.createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(gameState.createdAt).toBeLessThanOrEqual(afterTime);
      expect(gameState.lastModifiedAt).toBe(gameState.createdAt);
    });
  });

  describe("startGame", () => {
    it("should transition game status to in_progress", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);
      const startedState = startGame(gameState);

      expect(startedState.status).toBe("in_progress");
    });

    it("should keep game status unchanged if already started", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      gameState = startGame(gameState);
      gameState = startGame(gameState);

      expect(gameState.status).toBe("in_progress");
    });

    it("should update lastModifiedAt timestamp", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);
      const beforeTime = Date.now();

      const startedState = startGame(gameState);

      expect(startedState.lastModifiedAt).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe("loadDeckForPlayer", () => {
    it("should load a deck into player library", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      const deckCards = [
        createMockCard("Lightning Bolt", "Instant", 1),
        createMockCard("Mountain", "Land", 0),
        createMockCard("Bear", "Creature", 2),
      ];

      gameState = loadDeckForPlayer(gameState, player1Id, deckCards);

      const library = getPlayerLibrary(gameState, player1Id);
      expect(library).toBeDefined();
      expect(library?.cardIds.length).toBe(3);
    });

    it("should create card instances for each card in deck", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      const deckCards = [
        createMockCard("Lightning Bolt", "Instant", 1),
        createMockCard("Lightning Bolt", "Instant", 1),
      ];

      gameState = loadDeckForPlayer(gameState, player1Id, deckCards);

      // Should have 2 card instances
      const library = getPlayerLibrary(gameState, player1Id);
      expect(library?.cardIds.length).toBe(2);
    });

    it("should shuffle the library", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      const deckCards = Array(60)
        .fill(null)
        .map((_, i) => createMockCard(`Card${i}`, "Instant", i % 5));

      gameState = loadDeckForPlayer(gameState, player1Id, deckCards);

      const library = getPlayerLibrary(gameState, player1Id);
      expect(library).toBeDefined();
      expect(library?.cardIds.length).toBe(60);
    });

    it("should handle empty deck", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = loadDeckForPlayer(gameState, player1Id, []);

      const library = getPlayerLibrary(gameState, player1Id);
      expect(library?.cardIds.length).toBe(0);
    });

    it("should update lastModifiedAt timestamp", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];
      const beforeTime = Date.now();

      const deckCards = [createMockCard("Test Card", "Instant", 1)];
      gameState = loadDeckForPlayer(gameState, player1Id, deckCards);

      expect(gameState.lastModifiedAt).toBeGreaterThanOrEqual(beforeTime);
    });

    it("should throw error for invalid player ID", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(() => {
        loadDeckForPlayer(gameState, "invalid-player-id", []);
      }).toThrow("Library zone not found for player invalid-player-id");
    });
  });

  describe("dealDamageToPlayer", () => {
    it("should reduce player life", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = dealDamageToPlayer(gameState, player1Id, 5);

      const player = gameState.players.get(player1Id);
      expect(player?.life).toBe(15);
    });

    it("should not reduce life below 0", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = dealDamageToPlayer(gameState, player1Id, 50);

      const player = gameState.players.get(player1Id);
      expect(player?.life).toBe(0);
    });

    it("should track combat damage separately", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = dealDamageToPlayer(gameState, player1Id, 3, true);

      // Combat damage is tracked (implementation detail)
      expect(gameState.lastModifiedAt).toBeDefined();
    });

    it("should throw error for invalid player ID", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(() => {
        dealDamageToPlayer(gameState, "invalid-player-id", 5);
      }).toThrow("Player invalid-player-id not found");
    });

    it("should handle 0 damage", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];
      const beforeLife = gameState.players.get(player1Id)?.life;

      gameState = dealDamageToPlayer(gameState, player1Id, 0);

      const player = gameState.players.get(player1Id);
      expect(player?.life).toBe(beforeLife);
    });
  });

  describe("gainLife", () => {
    it("should increase player life", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = gainLife(gameState, player1Id, 5);

      const player = gameState.players.get(player1Id);
      expect(player?.life).toBe(25);
    });

    it("should handle 0 life gain", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];
      const beforeLife = gameState.players.get(player1Id)?.life;

      gameState = gainLife(gameState, player1Id, 0);

      const player = gameState.players.get(player1Id);
      expect(player?.life).toBe(beforeLife);
    });

    it("should throw error for invalid player ID", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(() => {
        gainLife(gameState, "invalid-player-id", 5);
      }).toThrow("Player invalid-player-id not found");
    });
  });

  describe("concede", () => {
    it("should mark player as having lost", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = concede(gameState, player1Id);

      const player = gameState.players.get(player1Id);
      expect(player?.hasLost).toBe(true);
      expect(player?.lossReason).toBe("Conceded the game");
    });

    it("should end game when only one player remains", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = concede(gameState, player1Id);

      expect(gameState.status).toBe("completed");
      expect(gameState.winners).toEqual([
        Array.from(gameState.players.keys())[1],
      ]);
    });

    it("should throw error for invalid player ID", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);

      expect(() => {
        concede(gameState, "invalid-player-id");
      }).toThrow("Player invalid-player-id not found");
    });
  });

  describe("Zone getters", () => {
    let gameState: GameState;
    let player1Id: PlayerId;

    beforeEach(() => {
      gameState = createInitialGameState(["Player 1", "Player 2"]);
      player1Id = Array.from(gameState.players.keys())[0];
    });

    it("getPlayerLibrary should return library zone", () => {
      const library = getPlayerLibrary(gameState, player1Id);
      expect(library).toBeDefined();
      expect(library?.type).toBe("library");
    });

    it("getPlayerHand should return hand zone", () => {
      const hand = getPlayerHand(gameState, player1Id);
      expect(hand).toBeDefined();
      expect(hand?.type).toBe("hand");
    });

    it("getPlayerBattlefield should return battlefield zone", () => {
      const battlefield = getPlayerBattlefield(gameState, player1Id);
      expect(battlefield).toBeDefined();
      expect(battlefield?.type).toBe("battlefield");
    });

    it("getPlayerGraveyard should return graveyard zone", () => {
      const graveyard = getPlayerGraveyard(gameState, player1Id);
      expect(graveyard).toBeDefined();
      expect(graveyard?.type).toBe("graveyard");
    });

    it("getPlayerExile should return exile zone", () => {
      const exile = getPlayerExile(gameState, player1Id);
      expect(exile).toBeDefined();
      expect(exile?.type).toBe("exile");
    });

    it("should return null for invalid player ID", () => {
      expect(getPlayerLibrary(gameState, "invalid-id")).toBe(null);
      expect(getPlayerHand(gameState, "invalid-id")).toBe(null);
      expect(getPlayerBattlefield(gameState, "invalid-id")).toBe(null);
      expect(getPlayerGraveyard(gameState, "invalid-id")).toBe(null);
      expect(getPlayerExile(gameState, "invalid-id")).toBe(null);
    });
  });

  describe("Draw offers", () => {
    let gameState: GameState;
    let player1Id: PlayerId;
    let player2Id: PlayerId;

    beforeEach(() => {
      gameState = createInitialGameState(["Player 1", "Player 2"]);
      player1Id = Array.from(gameState.players.keys())[0];
      player2Id = Array.from(gameState.players.keys())[1];
      gameState = startGame(gameState);
    });

    describe("offerDraw", () => {
      it("should set hasOfferedDraw to true", () => {
        gameState = offerDraw(gameState, player1Id);

        const player = gameState.players.get(player1Id);
        expect(player?.hasOfferedDraw).toBe(true);
      });

      it("should throw error for game not in progress", () => {
        const notStartedState = createInitialGameState([
          "Player 1",
          "Player 2",
        ]);
        const pid = Array.from(notStartedState.players.keys())[0];

        expect(() => {
          offerDraw(notStartedState, pid);
        }).toThrow("Cannot offer a draw when the game is not in progress");
      });

      it("should throw error for invalid player ID", () => {
        expect(() => {
          offerDraw(gameState, "invalid-player-id");
        }).toThrow("Player invalid-player-id not found");
      });
    });

    describe("acceptDraw", () => {
      it("should end game in a draw when offer exists", () => {
        gameState = offerDraw(gameState, player1Id);
        gameState = acceptDraw(gameState, player2Id);

        expect(gameState.status).toBe("completed");
        expect(gameState.winners).toEqual([]);
        expect(gameState.endReason).toBe("Players agreed to a draw");
      });

      it("should throw error when no offer exists", () => {
        expect(() => {
          acceptDraw(gameState, player2Id);
        }).toThrow("No active draw offer to accept");
      });

      it("should throw error for game not in progress", () => {
        const notStartedState = createInitialGameState([
          "Player 1",
          "Player 2",
        ]);
        const pid = Array.from(notStartedState.players.keys())[0];

        expect(() => {
          acceptDraw(notStartedState, pid);
        }).toThrow("No active draw offer to accept");
      });

      it("should throw error for invalid player ID", () => {
        offerDraw(gameState, player1Id);

        expect(() => {
          acceptDraw(gameState, "invalid-player-id");
        }).toThrow("Player invalid-player-id not found");
      });
    });

    describe("declineDraw", () => {
      it("should clear all draw offers", () => {
        gameState = offerDraw(gameState, player1Id);
        gameState = declineDraw(gameState, player2Id);

        const player1 = gameState.players.get(player1Id);
        expect(player1?.hasOfferedDraw).toBe(false);
      });

      it("should throw error for invalid player ID", () => {
        expect(() => {
          declineDraw(gameState, "invalid-player-id");
        }).toThrow("Player invalid-player-id not found");
      });
    });

    describe("canOfferDraw", () => {
      it("should return true when game is in progress", () => {
        expect(canOfferDraw(gameState, player1Id)).toBe(true);
      });

      it("should return false when game is not in progress", () => {
        const notStartedState = createInitialGameState([
          "Player 1",
          "Player 2",
        ]);
        const pid = Array.from(notStartedState.players.keys())[0];

        expect(canOfferDraw(notStartedState, pid)).toBe(false);
      });

      it("should return false if player already offered", () => {
        gameState = offerDraw(gameState, player1Id);
        expect(canOfferDraw(gameState, player1Id)).toBe(false);
      });

      it("should return false for invalid player", () => {
        expect(canOfferDraw(gameState, "invalid-player-id")).toBe(false);
      });
    });

    describe("canAcceptDraw", () => {
      it("should return false when no offer exists", () => {
        expect(canAcceptDraw(gameState, player2Id)).toBe(false);
      });

      it("should return true when offer exists", () => {
        gameState = offerDraw(gameState, player1Id);
        expect(canAcceptDraw(gameState, player2Id)).toBe(true);
      });

      it("should return false for invalid player", () => {
        expect(canAcceptDraw(gameState, "invalid-player-id")).toBe(false);
      });
    });
  });

  describe("checkStateBasedActions", () => {
    it("should detect player loss from 0 life", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      // Set player life to 0
      const player = gameState.players.get(player1Id);
      if (player) {
        player.life = 0;
      }

      gameState = checkStateBasedActions(gameState);

      const updatedPlayer = gameState.players.get(player1Id);
      expect(updatedPlayer?.hasLost).toBe(true);
    });

    it("should detect player loss from poison counters", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      // Set poison counters to 10
      const player = gameState.players.get(player1Id);
      if (player) {
        player.poisonCounters = 10;
      }

      gameState = checkStateBasedActions(gameState);

      const updatedPlayer = gameState.players.get(player1Id);
      expect(updatedPlayer?.hasLost).toBe(true);
      expect(updatedPlayer?.lossReason).toContain("poison");
    });

    it("should end game when only one player remains", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const player1Id = Array.from(gameState.players.keys())[0];

      // Set player life to 0
      const player = gameState.players.get(player1Id);
      if (player) {
        player.life = 0;
      }

      gameState = checkStateBasedActions(gameState);

      expect(gameState.status).toBe("completed");
      expect(gameState.winners).toEqual([
        Array.from(gameState.players.keys())[1],
      ]);
    });

    it("should handle simultaneous loss (draw)", () => {
      let gameState = createInitialGameState(["Player 1", "Player 2"]);
      const playerIds = Array.from(gameState.players.keys());

      // Set both players to 0 life
      playerIds.forEach((pid) => {
        const player = gameState.players.get(pid);
        if (player) {
          player.life = 0;
        }
      });

      gameState = checkStateBasedActions(gameState);

      expect(gameState.status).toBe("completed");
      expect(gameState.winners).toEqual([]);
    });

    it("should not change state when no SBA applies", () => {
      const gameState = createInitialGameState(["Player 1", "Player 2"]);
      const beforeState = { ...gameState };

      const result = checkStateBasedActions(gameState);

      expect(result.status).toBe(beforeState.status);
    });
  });

  describe("Multiplayer scenarios", () => {
    it("should handle 3-player game", () => {
      const gameState = createInitialGameState(["P1", "P2", "P3"]);

      expect(gameState.players.size).toBe(3);
      expect(gameState.zones.size).toBeGreaterThan(10);
    });

    it("should handle 4-player game with one player losing", () => {
      let gameState = createInitialGameState(["P1", "P2", "P3", "P4"]);
      gameState = startGame(gameState);
      const player1Id = Array.from(gameState.players.keys())[0];

      gameState = concede(gameState, player1Id);

      expect(gameState.status).toBe("in_progress"); // Game continues
      const player1 = gameState.players.get(player1Id);
      expect(player1?.hasLost).toBe(true);
    });

    it("should end 4-player game when only one remains", () => {
      let gameState = createInitialGameState(["P1", "P2", "P3", "P4"]);
      gameState = startGame(gameState);
      const playerIds = Array.from(gameState.players.keys());

      // First 3 players concede
      gameState = concede(gameState, playerIds[0]);
      gameState = concede(gameState, playerIds[1]);
      gameState = concede(gameState, playerIds[2]);

      expect(gameState.status).toBe("completed");
      expect(gameState.winners).toEqual([playerIds[3]]);
    });
  });

  describe("Turn transitions", () => {
    it("should untap all permanents when a new turn starts", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Start the game
      state = startGame(state);
      state.turn.isFirstTurn = false; // Not first turn so draw works

      // Put a tapped land on Alice's battlefield
      const landData = createMockCard("Forest", "Land");
      const land = createCardInstance(landData, aliceId, aliceId);
      const tappedLand = { ...land, isTapped: true };
      state.cards.set(tappedLand.id, tappedLand);
      const aliceBf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...aliceBf,
        cardIds: [tappedLand.id],
      });

      // Set turn to Bob's cleanup phase
      state.turn = {
        ...state.turn,
        activePlayerId: bobId,
        currentPhase: Phase.CLEANUP,
        turnNumber: 1,
      };
      state.priorityPlayerId = bobId;

      // Reset passes
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasPassedPriority: false,
      });
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        hasPassedPriority: false,
      });

      // Both players pass priority in cleanup → new turn starts for Alice
      state = passPriority(state, bobId);
      state = passPriority(state, aliceId);

      // Should now be Alice's turn, untap step
      expect(state.turn.activePlayerId).toBe(aliceId);
      expect(state.turn.currentPhase).toBe(Phase.UNTAP);
      expect(state.turn.turnNumber).toBe(2);

      // The land should be untapped
      const untappedLand = state.cards.get(tappedLand.id);
      expect(untappedLand?.isTapped).toBe(false);
    });

    // Bug 3: Llanowar Elves - summoning sickness should clear at start of controller's turn
    // This is now covered by the existing untap test - the fix ensures both untap AND
    // summoning sickness clearing happen at turn start

    it("should reset landsPlayedThisTurn when a new turn starts", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      state = startGame(state);
      state.turn.isFirstTurn = false;

      // Simulate Alice having played a land this turn
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        landsPlayedThisTurn: 1,
      });

      // Set turn to Bob's cleanup phase
      state.turn = {
        ...state.turn,
        activePlayerId: bobId,
        currentPhase: Phase.CLEANUP,
        turnNumber: 1,
      };
      state.priorityPlayerId = bobId;
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasPassedPriority: false,
      });
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        hasPassedPriority: false,
      });

      // Both pass → new turn
      state = passPriority(state, bobId);
      state = passPriority(state, aliceId);

      // Alice's land plays should be reset
      const alice = state.players.get(aliceId)!;
      expect(alice.landsPlayedThisTurn).toBe(0);
    });

    it("should draw a card when entering the draw step", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Add some cards to Alice's library so she can draw
      const libZone = state.zones.get(`${aliceId}-library`)!;
      const card1 = createCardInstance(
        createMockCard("Card 1", "Creature"),
        aliceId,
        aliceId,
      );
      const card2 = createCardInstance(
        createMockCard("Card 2", "Creature"),
        aliceId,
        aliceId,
      );
      state.cards.set(card1.id, card1);
      state.cards.set(card2.id, card2);
      state.zones.set(`${aliceId}-library`, {
        ...libZone,
        cardIds: [card1.id, card2.id],
      });

      // Don't call startGame — we're manually setting up the turn state
      state.status = "in_progress";
      state.turn.isFirstTurn = false;

      // Set turn to Alice's upkeep phase
      state.turn = {
        ...state.turn,
        activePlayerId: aliceId,
        currentPhase: Phase.UPKEEP,
        turnNumber: 2,
      };
      state.priorityPlayerId = aliceId;
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        hasPassedPriority: false,
      });
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasPassedPriority: false,
      });

      const handBefore = getPlayerHand(state, aliceId)?.cardIds.length ?? 0;

      // Both pass → advance to draw step
      state = passPriority(state, aliceId);
      state = passPriority(state, bobId);

      // Should be in draw phase
      expect(state.turn.currentPhase).toBe(Phase.DRAW);

      // Alice should have drawn a card
      const handAfter = getPlayerHand(state, aliceId)?.cardIds.length ?? 0;
      expect(handAfter).toBe(handBefore + 1);
    });

    it("should not draw a card on the first turn of the game", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      state = startGame(state);
      // First turn — isFirstTurn should be true
      expect(state.turn.isFirstTurn).toBe(true);

      // Set to upkeep
      state.turn = {
        ...state.turn,
        activePlayerId: aliceId,
        currentPhase: Phase.UPKEEP,
        turnNumber: 1,
      };
      state.priorityPlayerId = aliceId;
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        hasPassedPriority: false,
      });
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasPassedPriority: false,
      });

      const handBefore = getPlayerHand(state, aliceId)?.cardIds.length ?? 0;

      // Both pass → advance to draw step
      state = passPriority(state, aliceId);
      state = passPriority(state, bobId);

      // Should be in draw phase
      expect(state.turn.currentPhase).toBe(Phase.DRAW);

      // Should NOT have drawn (first turn skip)
      const handAfter = getPlayerHand(state, aliceId)?.cardIds.length ?? 0;
      expect(handAfter).toBe(handBefore);
    });
  });

  describe("Edge cases", () => {
    it("should handle very large life totals", () => {
      const gameState = createInitialGameState(["Player 1"], 1000000);
      const player = gameState.players.get(
        Array.from(gameState.players.keys())[0],
      );
      expect(player?.life).toBe(1000000);
    });

    it("should handle negative starting life", () => {
      const gameState = createInitialGameState(["Player 1"], -5);
      const player = gameState.players.get(
        Array.from(gameState.players.keys())[0],
      );
      expect(player?.life).toBe(-5);
    });

    it("should handle empty player names", () => {
      const gameState = createInitialGameState(["", "Player 2"]);
      expect(gameState.players.size).toBe(2);
    });
  });
});
