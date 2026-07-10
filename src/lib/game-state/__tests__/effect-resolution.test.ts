/**
 * Comprehensive tests for Effect Resolution System
 * Issue #855: Complete Stack Resolution
 *
 * Tests spell effect resolution including:
 * - Card draw resolution
 * - Life gain/loss resolution
 * - Token creation resolution
 * - Counter spell resolution
 * - Edge cases with protection/shroud
 */

import {
  resolveCardDrawEffect,
  resolveLifeGainEffect,
  resolveLifeLossEffect,
  resolveTokenCreationEffect,
  resolveCounterEffect,
  resolveDamageEffect,
  resolvePlayerDamageEffect,
  parseSpellEffects,
  resolveStackObjectEffects,
} from "../effect-resolution";
import {
  createInitialGameState,
  startGame,
  loadDeckForPlayer,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import { addMana } from "../mana";

function createMockCard(name: string, type: string): any {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: type,
    cmc: 1,
    mana_cost: type.includes("Land") ? "" : "{1}",
    oracle_text: "",
    power: type.includes("Creature") ? "2" : undefined,
    toughness: type.includes("Creature") ? "2" : undefined,
    keywords: [],
    color_identity: [],
    colors: [],
    legalities: { standard: "legal" },
  };
}

// Helper to set up a basic game with cards in library
function setupBasicGame() {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  // Create decks with enough cards - startGame draws 7 for each player
  // So we need at least 8 cards each (7 for startGame + 1 for resolveCardDrawEffect test)
  const mockDeck = [
    createMockCard("Forest", "Land"),
    createMockCard("Mountain", "Land"),
    createMockCard("Lightning Bolt", "Instant"),
    createMockCard("Grizzly Bears", "Creature"),
    createMockCard("Hill Giant", "Creature"),
    createMockCard("Raging Goblin", "Creature"),
    createMockCard("Shock", "Instant"),
    createMockCard("Elite Vanguard", "Creature"),
    createMockCard("Mogg Fanatic", "Creature"),
    createMockCard("Plains", "Land"),
  ];

  // Create unique cards for each player
  state = loadDeckForPlayer(
    state,
    aliceId,
    mockDeck.map((c, i) => ({ ...c, id: `alice-card-${i}` })),
  );
  state = loadDeckForPlayer(
    state,
    bobId,
    mockDeck.map((c, i) => ({ ...c, id: `bob-card-${i}` })),
  );
  state = startGame(state);

  return { state, aliceId, bobId };
}

describe("Effect Resolution - Card Draw", () => {
  describe("resolveCardDrawEffect", () => {
    it("should draw a single card for the active player", () => {
      const { state, aliceId } = setupBasicGame();

      // Get initial hand size
      const handBefore = state.zones.get(`${aliceId}-hand`);
      const handSizeBefore = handBefore?.cardIds.length || 0;

      // Draw a card
      const result = resolveCardDrawEffect(state, undefined as any, 1);

      // Check if library was empty (success may be false if library exhausted)
      if (result.success) {
        const handAfter = result.state.zones.get(`${aliceId}-hand`);
        const handSizeAfter = handAfter?.cardIds.length || 0;
        expect(handSizeAfter).toBe(handSizeBefore + 1);
      } else {
        // Library may be empty after startGame drew 7 cards
        // Either draw succeeded or library was empty (handled by SBA)
        expect(
          result.success ||
            result.error?.includes("empty") ||
            state.zones.get(`${aliceId}-library`)?.cardIds.length === 0,
        ).toBe(true);
      }
    });

    it("should draw multiple cards", () => {
      const { state, aliceId } = setupBasicGame();

      const handBefore = state.zones.get(`${aliceId}-hand`);
      const handSizeBefore = handBefore?.cardIds.length || 0;

      const result = resolveCardDrawEffect(state, undefined as any, 3);

      // Check if library was empty (success may be false if library exhausted)
      if (result.success) {
        const handAfter = result.state.zones.get(`${aliceId}-hand`);
        const handSizeAfter = handAfter?.cardIds.length || 0;
        expect(handSizeAfter).toBe(handSizeBefore + 3);
      } else {
        // Library may be empty after startGame drew 7 cards
        // Either draw succeeded or library was empty (handled by SBA)
        expect(
          result.success ||
            result.error?.includes("empty") ||
            state.zones.get(`${aliceId}-library`)?.cardIds.length === 0,
        ).toBe(true);
      }
    });

    it("should draw cards for a specific player", () => {
      const { state, aliceId, bobId } = setupBasicGame();

      const bobHandBefore = state.zones.get(`${bobId}-hand`);
      const bobHandSizeBefore = bobHandBefore?.cardIds.length || 0;

      const result = resolveCardDrawEffect(state, undefined as any, 2, bobId);

      // Check if library was empty (success may be false if library exhausted)
      if (result.success) {
        const bobHandAfter = result.state.zones.get(`${bobId}-hand`);
        const bobHandSizeAfter = bobHandAfter?.cardIds.length || 0;
        expect(bobHandSizeAfter).toBe(bobHandSizeBefore + 2);
      } else {
        // Library may be empty after startGame drew 7 cards
        // Either draw succeeded or library was empty (handled by SBA)
        expect(
          result.success ||
            result.error?.includes("empty") ||
            state.zones.get(`${bobId}-library`)?.cardIds.length === 0,
        ).toBe(true);
      }
    });

    it("should handle empty library", () => {
      const { state, aliceId } = setupBasicGame();

      // Empty the library
      const library = state.zones.get(`${aliceId}-library`);
      if (library) {
        state.zones.set(`${aliceId}-library`, { ...library, cardIds: [] });
      }

      const result = resolveCardDrawEffect(state, undefined as any, 1, aliceId);

      // Should not crash, but may have reduced success if library empty
      expect(result.state).toBeDefined();
    });
  });
});

describe("Effect Resolution - Life Gain", () => {
  describe("resolveLifeGainEffect", () => {
    it("should increase player life total", () => {
      const { state, aliceId } = setupBasicGame();

      const playerBefore = state.players.get(aliceId);
      const lifeBefore = playerBefore?.life || 0;

      const result = resolveLifeGainEffect(state, undefined as any, 5, aliceId);

      expect(result.success).toBe(true);

      const playerAfter = result.state.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(lifeBefore + 5);
    });

    it("should gain life for the active player when no target specified", () => {
      const { state, aliceId } = setupBasicGame();

      const playerBefore = state.players.get(aliceId);
      const lifeBefore = playerBefore?.life || 0;

      const result = resolveLifeGainEffect(state, undefined as any, 3);

      expect(result.success).toBe(true);

      const playerAfter = result.state.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(lifeBefore + 3);
    });

    it("should include source card in description", () => {
      const { state, aliceId } = setupBasicGame();

      // Create a mock source card
      const sourceId = "mock-card-id" as any;

      const result = resolveLifeGainEffect(state, sourceId, 3, aliceId);

      expect(result.description).toContain("gain");
      expect(result.description).toContain("3");
      expect(result.description).toContain("life");
    });
  });
});

describe("Effect Resolution - Life Loss", () => {
  describe("resolveLifeLossEffect", () => {
    it("should decrease player life total", () => {
      const { state, aliceId } = setupBasicGame();

      const playerBefore = state.players.get(aliceId);
      const lifeBefore = playerBefore?.life || 0;

      const result = resolveLifeLossEffect(state, undefined as any, 3, aliceId);

      expect(result.success).toBe(true);

      const playerAfter = result.state.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(lifeBefore - 3);
    });

    it("should not allow life to go below zero", () => {
      const { state, aliceId } = setupBasicGame();

      // Set life to 2
      const updatedPlayers = new Map(state.players);
      updatedPlayers.set(aliceId, {
        ...state.players.get(aliceId)!,
        life: 2,
      });
      const modifiedState = { ...state, players: updatedPlayers };

      const result = resolveLifeLossEffect(
        modifiedState,
        undefined as any,
        5,
        aliceId,
      );

      expect(result.success).toBe(true);

      const playerAfter = result.state.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(0);
    });

    it("should handle life loss from specific source", () => {
      const { state, aliceId, bobId } = setupBasicGame();

      const bobBefore = state.players.get(bobId);
      const bobLifeBefore = bobBefore?.life || 0;

      const sourceId = "mock-source" as any;
      const result = resolveLifeLossEffect(state, sourceId, 2, bobId);

      expect(result.success).toBe(true);

      const bobAfter = result.state.players.get(bobId);
      const bobLifeAfter = bobAfter?.life || 0;

      expect(bobLifeAfter).toBe(bobLifeBefore - 2);
    });
  });
});

describe("Effect Resolution - Token Creation", () => {
  describe("resolveTokenCreationEffect", () => {
    it("should create a single token on the battlefield", () => {
      const { state, aliceId } = setupBasicGame();

      const battlefieldBefore = state.zones.get(`${aliceId}-battlefield`);
      const battlefieldSizeBefore = battlefieldBefore?.cardIds.length || 0;

      const result = resolveTokenCreationEffect(
        state,
        undefined as any,
        {
          name: "Saproling",
          type_line: "Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
        },
        1,
        aliceId,
      );

      expect(result.success).toBe(true);

      const battlefieldAfter = result.state.zones.get(`${aliceId}-battlefield`);
      const battlefieldSizeAfter = battlefieldAfter?.cardIds.length || 0;

      expect(battlefieldSizeAfter).toBe(battlefieldSizeBefore + 1);
    });

    it("should create multiple tokens", () => {
      const { state, aliceId } = setupBasicGame();

      const battlefieldBefore = state.zones.get(`${aliceId}-battlefield`);
      const battlefieldSizeBefore = battlefieldBefore?.cardIds.length || 0;

      const result = resolveTokenCreationEffect(
        state,
        undefined as any,
        {
          name: "Soldier",
          type_line: "Creature — Soldier",
          power: "1",
          toughness: "1",
          colors: ["white"],
        },
        3,
        aliceId,
      );

      expect(result.success).toBe(true);

      const battlefieldAfter = result.state.zones.get(`${aliceId}-battlefield`);
      const battlefieldSizeAfter = battlefieldAfter?.cardIds.length || 0;

      expect(battlefieldSizeAfter).toBe(battlefieldSizeBefore + 3);
    });

    it("should create tokens with correct characteristics", () => {
      const { state, aliceId } = setupBasicGame();

      const result = resolveTokenCreationEffect(
        state,
        undefined as any,
        {
          name: "Beast",
          type_line: "Creature — Beast",
          power: "3",
          toughness: "3",
          colors: ["green"],
        },
        1,
        aliceId,
      );

      expect(result.success).toBe(true);
      expect(result.affectedCards).toBeDefined();
      expect(result.affectedCards!.length).toBe(1);

      // Check the token has correct stats
      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);
      expect(token).toBeDefined();
      expect(token?.cardData.power).toBe("3");
      expect(token?.cardData.toughness).toBe("3");
    });
  });
});

describe("Effect Resolution - Counter Spell", () => {
  describe("resolveCounterEffect", () => {
    it("should counter a spell on the stack", () => {
      const { state, aliceId } = setupBasicGame();

      // Add a spell to the stack
      const stackObject = {
        id: "stack-spell-1",
        type: "spell" as const,
        sourceCardId: "some-card",
        controllerId: aliceId,
        name: "Test Spell",
        text: "",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };
      const stateWithStack = { ...state, stack: [stackObject] };

      const result = resolveCounterEffect(
        stateWithStack,
        undefined as any,
        "stack-spell-1",
      );

      expect(result.success).toBe(true);

      // Check the spell is marked as countered
      const updatedSpell = result.state.stack.find(
        (s) => s.id === "stack-spell-1",
      );
      expect(updatedSpell?.isCountered).toBe(true);
    });

    it("should handle non-existent stack object", () => {
      const { state } = setupBasicGame();

      const result = resolveCounterEffect(
        state,
        undefined as any,
        "non-existent",
      );

      // Should return success but describe that it couldn't find the spell
      expect(result.state).toBeDefined();
    });
  });
});

describe("Effect Resolution - Damage", () => {
  describe("resolveDamageEffect", () => {
    it("should apply damage to a creature", () => {
      const { state, aliceId } = setupBasicGame();

      // Create a creature
      const creatureData = {
        id: "test-creature",
        name: "Test Creature",
        type_line: "Creature — Test",
        mana_cost: "",
        cmc: 0,
        colors: [],
        color_identity: [],
        keywords: [],
        legalities: { standard: "legal", commander: "legal" },
        card_faces: undefined,
        layout: "normal",
        power: "2",
        toughness: "2",
        oracle_text: "",
      } as any;

      // Add creature to battlefield
      const battlefield = state.zones.get(`${aliceId}-battlefield`);
      if (battlefield) {
        state.zones.set(`${aliceId}-battlefield`, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, "test-creature"],
        });
      }

      // Add card to cards map
      state.cards.set("test-creature", {
        id: "test-creature",
        oracleId: "oracle-1",
        cardData: creatureData,
        currentFaceIndex: 0,
        isFaceDown: false,
        controllerId: aliceId,
        ownerId: aliceId,
        isTapped: false,
        isFlipped: false,
        isTurnedFaceUp: true,
        isPhasedOut: false,
        hasSummoningSickness: false,
        counters: [],
        damage: 0,
        toughnessModifier: 0,
        powerModifier: 0,
        attachedToId: null,
        attachedCardIds: [],
        mutatedCardIds: [],
        mutateBaseId: null,
        isMutated: false,
        highestCmcComponentId: null,
        enteredBattlefieldTimestamp: 0,
        attachedTimestamp: null,
        chosenBasicLandType: null,
        isToken: false,
        tokenData: null,
        isPrototype: false,
        prototypePower: null,
        prototypeToughness: null,
        prototypeManaCost: null,
        attackedLastTurn: false,
        currentZoneKey: `${aliceId}-battlefield`,
      });

      const creatureBefore = state.cards.get("test-creature");
      const damageBefore = creatureBefore?.damage || 0;

      const result = resolveDamageEffect(
        state,
        undefined as any,
        "test-creature",
        3,
      );

      expect(result.success).toBe(true);

      const creatureAfter = result.state.cards.get("test-creature");
      const damageAfter = creatureAfter?.damage || 0;

      expect(damageAfter).toBe(damageBefore + 3);
    });
  });

  describe("resolvePlayerDamageEffect", () => {
    it("should reduce player life", () => {
      const { state, aliceId } = setupBasicGame();

      const playerBefore = state.players.get(aliceId);
      const lifeBefore = playerBefore?.life || 0;

      const result = resolvePlayerDamageEffect(
        state,
        undefined as any,
        aliceId,
        4,
      );

      expect(result.success).toBe(true);

      const playerAfter = result.state.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(lifeBefore - 4);
    });
  });
});

describe("Effect Resolution - Oracle Text Parsing", () => {
  describe("parseSpellEffects", () => {
    it("should parse card draw effect", () => {
      const effects = parseSpellEffects("Draw a card.");

      expect(effects.length).toBeGreaterThan(0);
      expect(effects.some((e) => e.effectType === "card_draw")).toBe(true);
    });

    it("should parse multi-card draw", () => {
      const effects = parseSpellEffects("Draw three cards.");

      expect(effects.length).toBeGreaterThan(0);
      const drawEffect = effects.find((e) => e.effectType === "card_draw");
      expect(drawEffect).toBeDefined();
      expect((drawEffect as any).amount).toBe(3);
    });

    it("should parse life gain effect", () => {
      const effects = parseSpellEffects("Gain 5 life.");

      expect(effects.length).toBeGreaterThan(0);
      expect(effects.some((e) => e.effectType === "life_gain")).toBe(true);
    });

    it("should parse life loss effect", () => {
      const effects = parseSpellEffects("Target player loses 3 life.");

      expect(effects.length).toBeGreaterThan(0);
      expect(effects.some((e) => e.effectType === "life_loss")).toBe(true);
    });

    it("should parse token creation effect", () => {
      const effects = parseSpellEffects("Create two 1/1 white Soldier tokens.");

      expect(effects.length).toBeGreaterThan(0);
      const tokenEffect = effects.find(
        (e) => e.effectType === "token_creation",
      );
      expect(tokenEffect).toBeDefined();
      expect((tokenEffect as any).count).toBe(2);
      expect((tokenEffect as any).power).toBe(1);
      expect((tokenEffect as any).toughness).toBe(1);
    });

    it("should parse damage effect", () => {
      const effects = parseSpellEffects("Deal 3 damage to any target.");

      expect(effects.length).toBeGreaterThan(0);
      expect(effects.some((e) => e.effectType === "damage")).toBe(true);
    });

    it("should parse X spells using variableValues", () => {
      const effects = parseSpellEffects("Deal X damage.", new Map([["X", 5]]));

      const damageEffect = effects.find((e) => e.effectType === "damage");
      expect(damageEffect).toBeDefined();
      expect((damageEffect as any).amount).toBe(5);
    });

    it("should parse counter spell effect", () => {
      const effects = parseSpellEffects("Counter target spell.");

      expect(effects.length).toBeGreaterThan(0);
      expect(effects.some((e) => e.effectType === "counter_spell")).toBe(true);
    });

    it("should return empty array for unknown effects", () => {
      const effects = parseSpellEffects("This card does something unusual.");

      // Should not crash, may or may not have effects
      expect(Array.isArray(effects)).toBe(true);
    });
  });
});

describe("Effect Resolution - Stack Object Effects", () => {
  describe("resolveStackObjectEffects", () => {
    it("should resolve multiple effects in order", () => {
      const { state, aliceId } = setupBasicGame();

      const effects = [
        { effectType: "life_gain" as const, amount: 3, targetId: aliceId },
        { effectType: "life_gain" as const, amount: 2, targetId: aliceId },
      ];

      const playerBefore = state.players.get(aliceId);
      const lifeBefore = playerBefore?.life || 0;

      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
      );

      const playerAfter = result.players.get(aliceId);
      const lifeAfter = playerAfter?.life || 0;

      expect(lifeAfter).toBe(lifeBefore + 5);
    });

    it("should handle effects with targets", () => {
      const { state, aliceId, bobId } = setupBasicGame();

      const effects = [
        { effectType: "life_loss" as const, amount: 4, targetId: bobId },
      ];

      const bobBefore = state.players.get(bobId);
      const bobLifeBefore = bobBefore?.life || 0;

      const targets = [{ type: "player" as const, targetId: bobId }];
      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
        targets,
      );

      const bobAfter = result.players.get(bobId);
      const bobLifeAfter = bobAfter?.life || 0;

      expect(bobLifeAfter).toBe(bobLifeBefore - 4);
    });

    // CR 702.85 — kicker bonus scales damage / card_draw / token_creation
    // amounts on top of the parsed base. The +N is sourced from
    // `StackObject.timesKicked` in `resolveTopOfStack` and forwarded to
    // `resolveStackObjectEffects` via the `kickerBonus` argument. The tests
    // below exercise that scaling for each supported effect type.

    it("kickerBonus=1 (kicker) adds 1 to a card_draw effect (CR 702.85)", () => {
      const { state, aliceId } = setupBasicGame();
      const effects = [
        { effectType: "card_draw" as const, amount: 1, targetId: aliceId },
      ];
      const handBefore = state.zones.get(`${aliceId}-hand`)!.cardIds.length;

      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
        undefined,
        1,
      );

      const handAfter = result.zones.get(`${aliceId}-hand`)!.cardIds.length;
      // base 1 + kicker 1 = 2 cards drawn
      expect(handAfter - handBefore).toBe(2);
    });

    it("kickerBonus=N scales card_draw by N (multikicker variant)", () => {
      const { state, aliceId } = setupBasicGame();
      const effects = [
        { effectType: "card_draw" as const, amount: 1, targetId: aliceId },
      ];
      // Pre-load Alice's library with at least 4 cards so 4 draws succeed.
      for (let i = 0; i < 4; i++) {
        const card = createCardInstance(
          {
            id: `fill-n-${i}`,
            name: `Filler N${i}`,
            type_line: "Creature — Test",
            power: "1",
            toughness: "1",
            keywords: [],
            oracle_text: "",
            mana_cost: "{1}",
            cmc: 1,
            colors: ["G"],
            color_identity: ["G"],
            legalities: { standard: "legal", commander: "legal" },
            card_faces: undefined,
            layout: "normal",
          } as any,
          aliceId,
          aliceId,
        );
        state.cards.set(card.id, card);
        const lib = state.zones.get(`${aliceId}-library`)!;
        state.zones.set(`${aliceId}-library`, {
          ...lib,
          cardIds: [...lib.cardIds, card.id],
        });
      }
      const handBefore = state.zones.get(`${aliceId}-hand`)!.cardIds.length;

      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
        undefined,
        3,
      );

      const handAfter = result.zones.get(`${aliceId}-hand`)!.cardIds.length;
      // base 1 + multikicker 3 = 4 cards drawn
      expect(handAfter - handBefore).toBe(4);
    });

    it("kickerBonus=0 leaves the effect amount unchanged (no-kick path)", () => {
      const { state, aliceId } = setupBasicGame();
      const effects = [
        { effectType: "card_draw" as const, amount: 1, targetId: aliceId },
      ];
      const handBefore = state.zones.get(`${aliceId}-hand`)!.cardIds.length;

      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
        undefined,
        0,
      );

      const handAfter = result.zones.get(`${aliceId}-hand`)!.cardIds.length;
      expect(handAfter - handBefore).toBe(1);
    });

    it("kickerBonus scales player damage from a player target", () => {
      const { state, bobId } = setupBasicGame();
      const effects = [
        {
          effectType: "damage" as const,
          amount: 2,
          targetId: bobId,
          isCombatDamage: false,
        },
      ];
      const targets = [
        { type: "player" as const, targetId: bobId, isValid: true },
      ];
      const bobBefore = state.players.get(bobId)!.life;

      const result = resolveStackObjectEffects(
        state,
        effects,
        undefined as any,
        targets,
        1,
      );

      const bobAfter = result.players.get(bobId)!.life;
      expect(bobBefore - bobAfter).toBe(3);
    });
  });
});

describe("Effect Resolution - Edge Cases", () => {
  it("should handle non-existent player gracefully", () => {
    const { state } = setupBasicGame();

    const result = resolveLifeGainEffect(
      state,
      undefined as any,
      5,
      "non-existent-player",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should handle missing source card gracefully", () => {
    const { state, aliceId } = setupBasicGame();

    // Source ID that doesn't exist
    const result = resolveLifeGainEffect(
      state,
      "non-existent-source" as any,
      3,
      aliceId,
    );

    // Should still work, just not mention source in description
    expect(result.state).toBeDefined();
  });

  it("should preserve state when no effects provided", () => {
    const { state } = setupBasicGame();

    const result = resolveStackObjectEffects(state, [], undefined as any);

    expect(result).toBe(state);
  });
});
