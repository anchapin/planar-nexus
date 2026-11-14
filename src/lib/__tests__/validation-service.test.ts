/**
 * @fileoverview Tests for the single canonical ValidationService.
 *
 * Issue #2967 — `@/lib/validation-service` used to be a second, diverged
 * copy of the action-validation rules. It is now a re-export shim over
 * `@/lib/game-state/validation-service`, and the convenience statics
 * (`canPlayLand` / `canCastSpell` / `canPassPriority`) delegate to that
 * engine implementation instead of duplicating it.
 *
 * The expectations below therefore assert the canonical engine's `reason`
 * / `message` strings. Where the legacy copy diverged (different reason
 * wording, cmc-based mana check instead of the parsed mana cost, hand-only
 * casting), the assertions were adapted to the engine behaviour and the
 * divergence is documented in the test names/comments.
 */
import {
  type GameAction,
  type GameState,
  type Player,
  type CardInstance,
  Phase,
  ZoneType,
  type LinkedEffectRegistry,
  type StackObject,
} from "@/lib/game-state";
import { ValidationService } from "@/lib/validation-service";
import { ValidationService as EngineValidationService } from "@/lib/game-state/validation-service";
import { ScryfallCard } from "@/lib/card-database";
import { ReplacementEffectManager } from "@/lib/game-state";
import { LayerSystem } from "@/lib/game-state";

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
      isMonarch: false,
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
      chosenColor: null,
      chosenCreatureType: null,
      chosenCardName: null,
      // Wave 4.8 follow-up 26 lane 71 piece 3/N (#2614
      // follow-up): chosen-quality enter-choice field
      // default for type-completeness. The card here
      // doesn't carry `protectionFrom: "chosen"`, so
      // the field stays `null` and the static consult
      // ignores it.
      chosenProtectionFrom: null,
      isToken: false,
      tokenData: null,
      attackedLastTurn: false,
      mutatedCardIds: [],
      mutateBaseId: null,
      isMutated: false,
      highestCmcComponentId: null,
      isPrototype: false,
      prototypePower: null,
      prototypeToughness: null,
      prototypeManaCost: null,
      currentZoneKey: null,
    };

    gameState = {
      gameId: "game1",
      players: new Map([[playerId, player]]),
      cards: new Map([[cardId, card]]),
      zones: new Map([
        [
          `${playerId}-hand`,
          {
            type: ZoneType.HAND,
            playerId: playerId,
            cardIds: [cardId],
            isRevealed: false,
            visibleTo: [playerId],
          },
        ],
        [
          `${playerId}-battlefield`,
          {
            type: ZoneType.BATTLEFIELD,
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
      replacementEffectManager: new ReplacementEffectManager(),
      layerSystem: new LayerSystem(),
      linkedEffectRegistry: {
        effects: [],
        bySourceCard: new Map(),
      } as LinkedEffectRegistry,
    };
  });

  describe("canPlayLand", () => {
    it("should allow playing a land when all conditions are met", () => {
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(true);
    });

    // The legacy copy reported "It is not your turn." as the reason; the
    // canonical engine reports "Not your turn" with a UI message.
    it("should not allow playing a land when it is not the player's turn", () => {
      gameState.turn.activePlayerId = "player2";
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Not your turn");
      expect(result.message).toBe("You can only play lands during your turn.");
    });

    it("should not allow playing a land when the player does not have priority", () => {
      gameState.priorityPlayerId = "player2";
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Player does not have priority");
      expect(result.message).toBe("You do not have priority.");
    });

    it("should not allow playing a land outside of main phases", () => {
      gameState.turn.currentPhase = Phase.BEGIN_COMBAT;
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Wrong phase");
      expect(result.message).toBe(
        "Lands can only be played during a main phase.",
      );
    });

    it("should not allow playing a land when the stack is not empty", () => {
      gameState.stack.push({} as any);
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Stack not empty");
      expect(result.message).toBe(
        "You can only play a land when the stack is empty.",
      );
    });

    it("should not allow playing a land if already played the limit for the turn", () => {
      const player = gameState.players.get(playerId)!;
      player.landsPlayedThisTurn = 1;
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Land limit reached");
      expect(result.message).toBe("You have already played a land this turn.");
    });

    it("should not allow playing a land if card is not in hand", () => {
      gameState.zones.get(`${playerId}-hand`)!.cardIds = [];
      const result = ValidationService.canPlayLand(gameState, playerId, cardId);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Card not in hand");
      expect(result.message).toBe("Card is not in your hand.");
    });
  });

  describe("canCastSpell", () => {
    beforeEach(() => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Shock",
        type_line: "Instant",
        mana_cost: "{R}",
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

    // The legacy copy compared the pool total against `cmc`; the canonical
    // engine parses the printed mana cost, so a card with a colored pips
    // requires that specific color in the pool.
    it("should not allow casting a spell without enough mana", () => {
      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Not enough colored mana");
      expect(result.message).toBe(
        "Not enough colored mana to cast this spell.",
      );
    });

    it("should allow casting a sorcery-speed spell during main phase with empty stack", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData.type_line = "Sorcery";
      card.cardData.mana_cost = "{1}";
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
      card.cardData.mana_cost = "{1}";
      const player = gameState.players.get(playerId)!;
      player.manaPool.generic = 1;
      gameState.turn.currentPhase = Phase.BEGIN_COMBAT;

      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Wrong phase");
      expect(result.message).toBe(
        "You can only cast this during a main phase.",
      );
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
      expect(result.reason).toBe("Player does not have priority");
      expect(result.message).toBe("You do not have priority.");
    });
  });

  describe("undo action — issue #1901", () => {
    it("rejects { type: 'undo' } at the type level (no longer in GameAction union)", () => {
      // Type-level test: the `GameAction` union no longer includes the
      // `"undo"` literal, so constructing an undo action must fail
      // type-checking. The `@ts-expect-error` annotation is the assertion —
      // if "undo" ever re-enters the union, tsc will fail this test.
      const action: GameAction = {
        // @ts-expect-error — issue #1901: "undo" is no longer in GameAction.
        type: "undo",
        playerId,
      };
      // Sanity: the value still exists at runtime (type was stripped); the
      // important guarantee is the compile-time rejection above.
      expect(action.type).toBe("undo");
    });
  });

  // -------------------------------------------------------------------------
  // Issue #2967 — the legacy `src/lib/validation-service.ts` was a second,
  // diverged copy of the rules. The shim now re-exports the engine's
  // ValidationService, and the convenience statics delegate to it. These
  // tests pin the UI-path parity that the dedupe is supposed to deliver.
  // -------------------------------------------------------------------------
  describe("issue #2967 — single ValidationService / UI-path parity", () => {
    /** Put a card into a non-hand zone of the player. */
    function moveCardToZone(
      zone: ZoneType,
      key: string,
      targetCardId: string,
    ): void {
      gameState.zones.set(key, {
        type: zone,
        playerId,
        cardIds: [targetCardId],
        isRevealed: false,
        visibleTo: [],
      });
      const hand = gameState.zones.get(`${playerId}-hand`)!;
      hand.cardIds = hand.cardIds.filter((id) => id !== targetCardId);
    }

    it("the legacy import path resolves to the engine ValidationService", () => {
      expect(ValidationService).toBe(EngineValidationService);
    });

    it("canCastSpell matches validateAction for an ordinary in-hand cast", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Shock",
        type_line: "Instant",
        mana_cost: "{R}",
        cmc: 1,
        oracle_text: "Shock deals 2 damage to any target.",
      } as any;
      gameState.players.get(playerId)!.manaPool.red = 1;

      const viaHelper = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      const viaAction = EngineValidationService.validateAction(gameState, {
        type: "cast_spell",
        playerId,
        timestamp: Date.now(),
        data: { cardId },
      });
      expect(viaHelper).toEqual(viaAction);
      expect(viaHelper.isValid).toBe(true);
    });

    it("canPlayLand matches validateAction", () => {
      const viaHelper = ValidationService.canPlayLand(
        gameState,
        playerId,
        cardId,
      );
      const viaAction = EngineValidationService.validateAction(gameState, {
        type: "play_land",
        playerId,
        timestamp: Date.now(),
        data: { cardId },
      });
      expect(viaHelper).toEqual(viaAction);
      expect(viaHelper.isValid).toBe(true);
    });

    it("canPassPriority matches validateAction", () => {
      const viaHelper = ValidationService.canPassPriority(gameState, playerId);
      const viaAction = EngineValidationService.validateAction(gameState, {
        type: "pass_priority",
        playerId,
        timestamp: Date.now(),
        data: {},
      });
      expect(viaHelper).toEqual(viaAction);
      expect(viaHelper.isValid).toBe(true);
    });

    it("validates a flashback cast from the graveyard with alternativeCost", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Past in Flames",
        type_line: "Instant",
        mana_cost: "{1}",
        cmc: 1,
        oracle_text:
          "Flashback (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      } as any;
      moveCardToZone(
        ZoneType.GRAVEYARD,
        `${playerId}-graveyard`,
        cardId,
      );
      gameState.players.get(playerId)!.manaPool.generic = 1;

      // With the alternative cost declared, the graveyard cast is legal.
      const withFlashback = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
        { type: "flashback" },
      );
      expect(withFlashback.isValid).toBe(true);
      expect(
        EngineValidationService.validateAction(gameState, {
          type: "cast_spell",
          playerId,
          timestamp: Date.now(),
          data: { cardId, alternativeCost: { type: "flashback" } },
        }),
      ).toEqual(withFlashback);

      // Without it, the card is not in hand and the cast is rejected.
      const withoutFlashback = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(withoutFlashback.isValid).toBe(false);
      expect(withoutFlashback.reason).toBe("Card not in hand");
    });

    it("validates a foretold face-down card cast from exile", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Fabled Passage",
        type_line: "Instant",
        mana_cost: "{3}{W}",
        cmc: 4,
        oracle_text: "Foretell (You may cast this card from exile for its foretell cost.)",
      } as any;
      card.foretold = true;
      card.isFaceDown = true;
      moveCardToZone(ZoneType.EXILE, `${playerId}-exile`, cardId);

      const withForetell = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
        { type: "foretell" },
      );
      expect(withForetell.isValid).toBe(true);

      const withoutForetell = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(withoutForetell.isValid).toBe(false);
      expect(withoutForetell.reason).toBe("Card not in hand");
    });

    it("rejects a cast while a split-second spell is on the stack", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Counterspell",
        type_line: "Instant",
        mana_cost: "{1}{U}",
        cmc: 2,
        oracle_text: "Counter target spell.",
      } as any;
      gameState.players.get(playerId)!.manaPool.generic = 1;
      gameState.players.get(playerId)!.manaPool.blue = 1;

      const splitSecond: StackObject = {
        id: "ss-spell-on-stack",
        type: "spell",
        sourceCardId: null,
        controllerId: playerId,
        name: "Sudden Shock",
        text: "Split second",
        manaCost: "{1}{R}",
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
        splitSecond: true,
      };
      gameState.stack.push(splitSecond);

      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Split second active");
      expect(result.message).toBe(
        "A spell with split second is on the stack. You can't cast other spells.",
      );
    });

    it("rejects a cast when the pool total covers cmc but the colors are wrong", () => {
      const card = gameState.cards.get(cardId)!;
      card.cardData = {
        name: "Flame Rift",
        type_line: "Sorcery",
        mana_cost: "{R}{R}",
        cmc: 2,
        oracle_text: "Flame Rift deals 4 damage to each player.",
      } as any;
      const player = gameState.players.get(playerId)!;
      player.manaPool.green = 2;

      const result = ValidationService.canCastSpell(
        gameState,
        playerId,
        cardId,
      );
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Not enough colored mana");
    });
  });
});
