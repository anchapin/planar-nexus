import {
  type GameState,
  type Player,
  type CardInstance,
  Phase,
} from "@/lib/game-state/types";
import { ValidationService } from "@/lib/validation-service";
import { ScryfallCard } from "@/app/actions";

describe("ValidationService", () => {
  let gameState: GameState;
  let playerId: string;
  let cardId: string;

  beforeEach(() => {
    playerId = "player1";
    cardId = "card1";

    const player: Player = {
      id: playerId,
      name: "Player 1",
      life: 20,
      poisonCounters: 0,
      commanderDamage: new Map(),
      maxHandSize: 7,
      currentHandSizeModifier: 0,
      hasLost: false,
      lossReason: null,
      landsPlayedThisTurn: 0,
      maxLandsPerTurn: 1,
      manaPool: {
        colorless: 0,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        generic: 0,
      },
      isInCommandZone: false,
      experienceCounters: 0,
      commanderCastCount: 0,
      hasPassedPriority: false,
      hasActivatedManaAbility: false,
      additionalCombatPhase: false,
      additionalMainPhase: false,
      hasOfferedDraw: false,
      hasAcceptedDraw: false,
    };

    const card: CardInstance = {
      id: cardId,
      oracleId: "oracle1",
      cardData: {
        name: "Plains",
        type_line: "Basic Land — Plains",
        cmc: 0,
        oracle_text: "({T}: Add {W}.)",
      } as any as ScryfallCard,
      currentFaceIndex: 0,
      isFaceDown: false,
      controllerId: playerId,
      ownerId: playerId,
      isTapped: false,
      isFlipped: false,
      isTurnedFaceUp: false,
      isPhasedOut: false,
      hasSummoningSickness: false,
      counters: [],
      damage: 0,
      toughnessModifier: 0,
      powerModifier: 0,
      attachedToId: null,
      attachedCardIds: [],
      enteredBattlefieldTimestamp: 0,
      attachedTimestamp: null,
      chosenBasicLandType: null,
      isToken: false,
      tokenData: null,
    };

    gameState = {
      gameId: "game1",
      players: new Map([[playerId, player]]),
      cards: new Map([[cardId, card]]),
      zones: new Map([
        [
          `${playerId}-hand`,
          {
            type: "hand",
            playerId: playerId,
            cardIds: [cardId],
            isRevealed: false,
            visibleTo: [playerId],
          },
        ],
        [
          `${playerId}-battlefield`,
          {
            type: "battlefield",
            playerId: playerId,
            cardIds: [],
            isRevealed: true,
            visibleTo: [],
          },
        ],
      ]),
      stack: [],
      turn: {
        activePlayerId: playerId,
        currentPhase: Phase.PRECOMBAT_MAIN,
        turnNumber: 1,
        extraTurns: 0,
        isFirstTurn: true,
        startedAt: Date.now(),
      },
      combat: {
        inCombatPhase: false,
        attackers: [],
        blockers: new Map(),
        remainingCombatPhases: 0,
      },
      waitingChoice: null,
      priorityPlayerId: playerId,
      consecutivePasses: 0,
      status: "in_progress",
      winners: [],
      endReason: null,
      format: "standard",
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    };
  });

  describe("canPlayLand", () => {
    it("should allow playing a land when all conditions are met", () => {
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(true);
    });

    it("should not allow playing a land when it is not the player's turn", () => {
      gameState.turn.activePlayerId = "player2";
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("It is not your turn.");
    });

    it("should not allow playing a land when the player does not have priority", () => {
      gameState.priorityPlayerId = "player2";
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("You do not have priority.");
    });

    it("should not allow playing a land outside of main phases", () => {
      gameState.turn.currentPhase = Phase.BEGIN_COMBAT;
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe(
        "Lands can only be played during main phases.",
      );
    });

    it("should not allow playing a land when the stack is not empty", () => {
      gameState.stack.push({} as any);
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe(
        "You can only play a land when the stack is empty.",
      );
    });

    it("should not allow playing a land if already played the limit for the turn", () => {
      const player = gameState.players.get(playerId)!;
      player.landsPlayedThisTurn = 1;
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Already played a land this turn.");
    });

    it("should not allow playing a land if card is not in hand", () => {
      gameState.zones.get(`${playerId}-hand`)!.cardIds = [];
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Card not in hand.");
    });
  });

  describe("canCastSpell", () => {
    beforeEach(() => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Shock",
        type_line: "Instant",
        cmc: 1,
        oracle_text: "Shock deals 2 damage to any target.",
      } as any;
    });

    it("should allow casting an instant with enough mana", () => {
      const player = gameState.players.get(playerId)!;
      player.manaPool.red = 1;
      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(true);
    });

    it("should not allow casting a spell without enough mana", () => {
      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Not enough mana.");
    });

    it("should allow casting a sorcery-speed spell during main phase with empty stack", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData.type_line = "Sorcery";
      const player = gameState.players.get(playerId)!;
      player.manaPool.generic = 1;

      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(true);
    });

    it("should not allow casting a sorcery-speed spell during combat", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData.type_line = "Sorcery";
      const player = gameState.players.get(playerId)!;
      player.manaPool.generic = 1;
      gameState.turn.currentPhase = Phase.BEGIN_COMBAT;

      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Not a main phase.");
    });
  });

  describe("canPassPriority", () => {
    it("should allow passing priority when player has it", () => {
      const result = ValidationService.canPassPriority(gameState, playerId);
      expect(result.isValid).toBe(true);
    });

    it("should not allow passing priority when player does not have it", () => {
      gameState.priorityPlayerId = "player2";
      const result = ValidationService.canPassPriority(gameState, playerId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("You do not have priority.");
    });
  });
});
