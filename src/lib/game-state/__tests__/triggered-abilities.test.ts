/**
 * Comprehensive tests for Triggered Abilities System
 * Issue #856: Implement Triggered Ability System
 *
 * Tests cover:
 * - All trigger event types (CR 603)
 * - Beginning/end of turn triggers
 * - Damage-dealt triggers
 * - Life-loss triggers
 * - Creature death triggers
 * - Spell cast triggers
 * - Multiple simultaneous triggers ordering
 */

import {
  detectTriggeredAbilities,
  checkTriggeredAbilities,
  hasTriggeredAbilities,
  getTriggeredAbilities,
  TriggerEvent,
} from "../abilities";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { ScryfallCard } from "@/app/actions";
import { Phase, ZoneType } from "../types";

// Helper function to create a mock card
function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `mock-${Math.random().toString(36).substr(2, 9)}`,
    name: overrides.name || "Test Card",
    type_line: overrides.type_line || "Creature — Human",
    oracle_text: overrides.oracle_text || "",
    mana_cost: overrides.mana_cost || "{1}{W}",
    cmc: 2,
    colors: overrides.colors || ["W"],
    color_identity: overrides.color_identity || ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

describe("Triggered Abilities System - detectTriggeredAbilities", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;

  function placeCardOnBattlefield(cardData: ScryfallCard, playerId: string) {
    const card = createCardInstance(cardData, playerId, playerId);
    card.hasSummoningSickness = false;
    const bf = state.zones.get(`${playerId}-battlefield`)!;
    state.zones.set(`${playerId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, card.id],
    });
    state.cards.set(card.id, card);
    return card.id;
  }

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];
    // Ensure it's Alice's turn as active player
    state.turn.activePlayerId = aliceId;
  });

  describe("ETB Triggers (entersBattlefield)", () => {
    it("should detect ETB trigger on entersBattlefield event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "etb-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("entersBattlefield");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should not fire ETB trigger for other events", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "etb-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "attacked");
      expect(result.length).toBe(0);
    });
  });

  describe("Beginning of Turn Triggers (CR 603.2)", () => {
    it("should detect upkeep trigger on beginningOfTurn event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "upkeep-trigger",
          oracle_text: "At the beginning of your upkeep, lose 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "beginningOfTurn");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("upkeep");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect upkeep trigger on phaseChange event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "upkeep-trigger",
          oracle_text: "At the beginning of your upkeep, scry 1.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "phaseChange");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("upkeep");
    });

    it("should detect phaseEnds trigger on beginningOfTurn event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "phase-ends-trigger",
          oracle_text: "At the beginning of the end step, draw a card.",
        }),
        aliceId,
      );
      // Phase ends can trigger at beginning of turn for end step
      const result = detectTriggeredAbilities(state, "beginningOfTurn");
      expect(result.length).toBe(0);
    });
  });

  describe("End of Turn Triggers (CR 603.4)", () => {
    it("should detect end of turn trigger on endOfTurn event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "eot-trigger",
          oracle_text: "At the beginning of the end step, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "endOfTurn");
      expect(result.length).toBe(0);
    });

    it("should detect turnEnds trigger on endOfTurn event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "turn-ends-trigger",
          oracle_text: "At the end of the turn, exile this creature.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "endOfTurn");
      expect(result.length).toBe(0);
    });

    it("should detect phaseEnds trigger on endOfTurn event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "phase-ends-trigger",
          oracle_text: "When the phase ends, gain 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "endOfTurn");
      expect(result.length).toBe(0);
    });
  });

  describe("Damage Dealt Triggers", () => {
    it("should detect damageDealt trigger on damageDealt event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "damage-trigger",
          name: "Fireball",
          oracle_text:
            "When Fireball deals damage to a player, that player loses 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "damageDealt");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("damageDealt");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect deals damage trigger", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "deals-damage-trigger",
          oracle_text:
            "Whenever this creature deals damage, you gain that much life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "damageDealt");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("damageDealt");
    });

    it("should not fire damageDealt trigger for other events", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "damage-trigger",
          oracle_text:
            "When Fireball deals damage to a player, that player loses 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(0);
    });
  });

  describe("Life Loss Triggers (CR 603.3)", () => {
    it("should detect lifeLost trigger on lifeLost event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "life-lost-trigger",
          oracle_text: "Whenever you lose life, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "lifeLost");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("lifeLost");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect loses life trigger", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "loses-life-trigger",
          oracle_text:
            "Whenever a player loses life, each opponent loses 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "lifeLost");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("lifeLost");
    });

    it("should detect life loss from any source", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "any-life-loss-trigger",
          oracle_text:
            "Whenever you lose life, create a 1/1 white Spirit token.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "lifeLost");
      expect(result.length).toBe(1);
    });
  });

  describe("Creature Death Triggers", () => {
    it("should detect creatureDies trigger on creatureDies event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "death-trigger",
          name: "Doomed Traveler",
          oracle_text:
            "When Doomed Traveler dies, create a 1/1 white Spirit creature token.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "creatureDies");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("dies");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect dies trigger on dies event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "dies-trigger",
          oracle_text:
            "When this creature dies, return target creature card from your graveyard to the battlefield.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "dies");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("dies");
    });

    it("should fire dies trigger for creatureDies event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "dies-creature-trigger",
          oracle_text: "Whenever a creature dies, each player loses 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "creatureDies");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("dies");
    });
  });

  describe("Spell Cast Triggers", () => {
    it("should detect spellCast trigger on spellCast event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "spell-cast-trigger",
          oracle_text: "Whenever you cast a spell, scry 1.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "spellCast");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("cast");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect cast trigger on cast event", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "cast-trigger",
          oracle_text: "When you cast this spell, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "cast");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("cast");
    });

    it("should detect a spell is cast trigger", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "spell-is-cast-trigger",
          oracle_text: "Whenever a spell is cast, counter target spell.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "spellCast");
      expect(result.length).toBe(1);
    });
  });

  describe("Trigger Ordering (CR 603.3)", () => {
    it("should order active player triggers first (CR 603.3a)", () => {
      // Alice is active player
      const bobCardId = placeCardOnBattlefield(
        createMockCard({
          id: "bob-etb",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        bobId,
      );
      const aliceCardId = placeCardOnBattlefield(
        createMockCard({
          id: "alice-etb",
          oracle_text:
            "When this creature enters the battlefield, gain 1 life.",
        }),
        aliceId,
      );

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(2);
      // Active player (Alice) should be first
      expect(result[0].sourceCardId).toBe(aliceCardId);
      expect(result[1].sourceCardId).toBe(bobCardId);
    });

    it("should order non-active players by turn order (CR 603.3a)", () => {
      // Add Carol
      state.players.set("carol", {
        id: "carol",
        name: "Carol",
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
      });
      state.zones.set("carol-battlefield", {
        type: ZoneType.BATTLEFIELD,
        playerId: "carol",
        cardIds: [],
        isRevealed: false,
        visibleTo: [],
      });
      state.zones.set("carol-library", {
        type: ZoneType.LIBRARY,
        playerId: "carol",
        cardIds: [],
        isRevealed: false,
        visibleTo: [],
      });
      state.zones.set("carol-hand", {
        type: ZoneType.HAND,
        playerId: "carol",
        cardIds: [],
        isRevealed: false,
        visibleTo: [],
      });
      state.zones.set("carol-graveyard", {
        type: ZoneType.GRAVEYARD,
        playerId: "carol",
        cardIds: [],
        isRevealed: false,
        visibleTo: [],
      });

      const carolCardId = placeCardOnBattlefield(
        createMockCard({
          id: "carol-etb",
          oracle_text: "When this creature enters the battlefield, scry 1.",
        }),
        "carol",
      );

      const bobCardId = placeCardOnBattlefield(
        createMockCard({
          id: "bob-etb",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        bobId,
      );

      // Turn order from Alice: Alice -> Bob -> Carol
      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(2);
      // Bob comes before Carol in APNAP order from Alice
      expect(result[0].sourceCardId).toBe(bobCardId);
      expect(result[1].sourceCardId).toBe(carolCardId);
    });

    it("should order same controller triggers by sourceCardTimestamp (CR 603.3b)", () => {
      // Place first card (earlier timestamp)
      const card1 = placeCardOnBattlefield(
        createMockCard({
          id: "first-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
      );

      // Place second card (later timestamp)
      const card2 = placeCardOnBattlefield(
        createMockCard({
          id: "second-trigger",
          oracle_text:
            "When this creature enters the battlefield, gain 1 life.",
        }),
        aliceId,
      );

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(2);
      // Earlier timestamp (first card) should be first for same controller
      expect(result[0].sourceCardId).toBe(card1);
      expect(result[1].sourceCardId).toBe(card2);
    });

    it("should include triggeringPlayerId for ordering verification", () => {
      const bobCardId = placeCardOnBattlefield(
        createMockCard({
          id: "bob-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        bobId,
      );

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(1);
      expect(result[0].triggeringPlayerId).toBe(bobId);
      expect(result[0].sourceCardId).toBe(bobCardId);
    });
  });

  describe("Multiple Simultaneous Triggers", () => {
    it("should detect multiple triggers of different types", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "etb-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
      );
      placeCardOnBattlefield(
        createMockCard({
          id: "attack-trigger",
          oracle_text: "Whenever you attack, create a 1/1 white Soldier token.",
        }),
        aliceId,
      );

      const etbResult = detectTriggeredAbilities(state, "entersBattlefield");
      expect(etbResult.length).toBe(1);
      expect(etbResult[0].triggerCondition).toBe("entersBattlefield");

      const attackResult = detectTriggeredAbilities(state, "attacked");
      expect(attackResult.length).toBe(1);
      expect(attackResult[0].triggerCondition).toBe("attacked");
    });

    it("should handle multiple triggers of same type", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "trigger-1",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
      );
      placeCardOnBattlefield(
        createMockCard({
          id: "trigger-2",
          oracle_text:
            "When this creature enters the battlefield, gain 1 life.",
        }),
        aliceId,
      );
      placeCardOnBattlefield(
        createMockCard({
          id: "trigger-3",
          oracle_text: "When this creature enters the battlefield, scry 1.",
        }),
        aliceId,
      );

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(3);
    });

    it("should not trigger for cards not on battlefield", () => {
      // Create card but don't place on battlefield
      const card = createCardInstance(
        createMockCard({
          id: "hand-trigger",
          oracle_text:
            "When this creature enters the battlefield, draw a card.",
        }),
        aliceId,
        aliceId,
      );
      state.cards.set(card.id, card);

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(0);
    });

    it("should include effect text for triggered ability", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "effect-trigger",
          oracle_text:
            "When this creature enters the battlefield, create a 1/1 white Spirit token.",
        }),
        aliceId,
      );

      const result = detectTriggeredAbilities(state, "entersBattlefield");
      expect(result.length).toBe(1);
      expect(result[0].effect).toContain("1/1");
      expect(result[0].sourceCardId).toBe(cardId);
    });
  });

  describe("Life Gain Triggers", () => {
    it("should detect lifeGain trigger on lifeGain event", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "life-gain-trigger",
          oracle_text: "Whenever you gain life, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "lifeGain");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("lifeGain");
      expect(result[0].sourceCardId).toBe(cardId);
    });

    it("should detect gains life trigger", () => {
      placeCardOnBattlefield(
        createMockCard({
          id: "gains-life-trigger",
          oracle_text:
            "Whenever a player gains life, each opponent loses 1 life.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "lifeGain");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("lifeGain");
    });
  });

  describe("Attacked Triggers", () => {
    it("should detect you attack trigger", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "attack-trigger",
          oracle_text: "Whenever you attack, create a 1/1 white Soldier token.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "attacked");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("attacked");
      expect(result[0].sourceCardId).toBe(cardId);
    });
  });

  describe("Leaves Battlefield Triggers", () => {
    it("should detect leaves battlefield trigger", () => {
      const cardId = placeCardOnBattlefield(
        createMockCard({
          id: "ltb-trigger",
          oracle_text:
            "When this permanent leaves the battlefield, draw a card.",
        }),
        aliceId,
      );
      const result = detectTriggeredAbilities(state, "leavesBattlefield");
      expect(result.length).toBe(1);
      expect(result[0].triggerCondition).toBe("leavesBattlefield");
      expect(result[0].sourceCardId).toBe(cardId);
    });
  });
});

describe("Triggered Abilities System - checkTriggeredAbilities (Stack Integration)", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  function placeCardOnBattlefield(cardData: ScryfallCard, playerId: string) {
    const card = createCardInstance(cardData, playerId, playerId);
    card.hasSummoningSickness = false;
    const bf = state.zones.get(`${playerId}-battlefield`)!;
    state.zones.set(`${playerId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, card.id],
    });
    state.cards.set(card.id, card);
    return card.id;
  }

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
  });

  it("should put triggered ability on the stack", () => {
    const cardId = placeCardOnBattlefield(
      createMockCard({
        id: "stack-test",
        oracle_text: "When this creature enters the battlefield, draw a card.",
      }),
      aliceId,
    );
    const result = checkTriggeredAbilities(state, "entersBattlefield");
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].type).toBe("ability");
    expect(result.state.stack[0].sourceCardId).toBe(cardId);
  });

  it("should put multiple triggered abilities on the stack", () => {
    placeCardOnBattlefield(
      createMockCard({
        id: "stack-test-1",
        oracle_text: "When this creature enters the battlefield, draw a card.",
      }),
      aliceId,
    );
    placeCardOnBattlefield(
      createMockCard({
        id: "stack-test-2",
        oracle_text: "When this creature enters the battlefield, gain 1 life.",
      }),
      aliceId,
    );
    const result = checkTriggeredAbilities(state, "entersBattlefield");
    expect(result.state.stack.length).toBe(2);
  });

  it("should return both abilities and updated state", () => {
    const cardId = placeCardOnBattlefield(
      createMockCard({
        id: "result-test",
        oracle_text: "When this creature enters the battlefield, draw a card.",
      }),
      aliceId,
    );
    const result = checkTriggeredAbilities(state, "entersBattlefield");
    expect(result.abilities.length).toBe(1);
    expect(result.abilities[0].sourceCardId).toBe(cardId);
    expect(result.state.stack.length).toBe(1);
  });
});

describe("Triggered Abilities - hasTriggeredAbilities and getTriggeredAbilities", () => {
  it("should correctly identify cards with triggered abilities", () => {
    const etbCard = createMockCard({
      oracle_text: "When this creature enters the battlefield, draw a card.",
    });
    expect(hasTriggeredAbilities(etbCard)).toBe(true);

    const staticCard = createMockCard({
      oracle_text: "Flying. Trample.",
    });
    expect(hasTriggeredAbilities(staticCard)).toBe(false);
  });

  it("should correctly parse different trigger types", () => {
    const upkeepCard = createMockCard({
      oracle_text: "At the beginning of your upkeep, lose 1 life.",
    });
    const abilities = getTriggeredAbilities(upkeepCard);
    expect(abilities.length).toBe(1);
    expect(abilities[0].trigger.event).toBe("upkeep");

    const damageCard = createMockCard({
      oracle_text: "When this creature deals damage, gain that much life.",
    });
    const damageAbilities = getTriggeredAbilities(damageCard);
    expect(damageAbilities.length).toBe(1);
    expect(damageAbilities[0].trigger.event).toBe("damageDealt");
  });

  it("should return empty array for cards without triggered abilities", () => {
    const card = createMockCard({
      oracle_text: "{T}: Add {W}.",
    });
    expect(getTriggeredAbilities(card)).toEqual([]);
  });
});
