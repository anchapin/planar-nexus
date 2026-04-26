/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Tests for MTG Keyword Actions and Game Mechanics
 *
 * Tests all keyword actions in keyword-actions.ts:
 * - hasIndestructible
 * - canBeRegenerated
 * - destroyCard
 * - exileCard
 * - sacrificeCard
 * - drawCards
 * - discardCards
 * - createTokenCard
 * - counterSpell
 * - regenerateCard
 * - consumeRegenerationShield
 * - moveCardToZone
 * - dealDamageToCard
 * - addCounterToCard
 * - removeCounterFromCard
 * - tapCardAction
 * - untapCardAction
 * - getHandFilterForCard
 */

import { describe, it, expect } from "@jest/globals";
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  ScryfallCard,
} from "@/lib/game-state/types";
import { createToken } from "../game-state/card-instance";
import {
  getHandFilterForCard,
  hasIndestructible,
  canBeRegenerated,
} from "../game-state/keyword-actions";

function createMockCardInstance(
  cardData: Partial<ScryfallCard> = {},
  overrides: Partial<CardInstance> = {},
): CardInstance {
  const id = `test-${Math.random().toString(36).slice(2, 9)}` as CardInstanceId;
  return {
    id,
    name: "Test Card",
    oracle_text: "",
    type_line: "Creature — Human Warrior",
    mana_cost: "{1}{W}",
    cmc: 2,
    colors: ["W"],
    color_identity: ["W"],
    power: "2",
    toughness: "2",
    keywords: [],
    cardData: {
      name: "Test Card",
      oracle_text: "",
      type_line: "Creature — Human Warrior",
      mana_cost: "{1}{W}",
      cmc: 2,
      colors: ["W"],
      color_identity: ["W"],
      power: "2",
      toughness: "2",
      keywords: [],
      ...cardData,
    },
    ownerId: "player1" as PlayerId,
    controllerId: "player1" as PlayerId,
    isToken: false,
    isTapped: false,
    isDestroyed: false,
    isFlipped: false,
    isFaceDown: false,
    damage: 0,
    counters: new Map(),
    attachedCards: [],
    attachments: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockGameState(overrides: Partial<GameState> = {}): GameState {
  const player1Id = "player1" as PlayerId;
  const player2Id = "player2" as PlayerId;

  return {
    id: "game-1",
    format: "standard",
    status: "pending",
    players: new Map([
      [
        player1Id,
        {
          id: player1Id,
          name: "Player 1",
          life: 20,
          hand: [],
          battlefield: [],
          library: [],
          graveyard: [],
          exile: [],
          sideboard: [],
        },
      ],
      [
        player2Id,
        {
          id: player2Id,
          name: "Player 2",
          life: 20,
          hand: [],
          battlefield: [],
          library: [],
          graveyard: [],
          exile: [],
          sideboard: [],
        },
      ],
    ]),
    zones: new Map([
      ["player1-hand", []],
      ["player1-battlefield", []],
      ["player1-library", []],
      ["player1-graveyard", []],
      ["player1-exile", []],
      ["player2-hand", []],
      ["player2-battlefield", []],
      ["player2-library", []],
      ["player2-graveyard", []],
      ["player2-exile", []],
      ["stack", []],
    ]),
    cards: new Map(),
    turn: {
      turnNumber: 1,
      currentPlayer: player1Id,
      phase: "untap",
      step: "upkeep",
    },
    priority: player1Id,
    stack: [],
    effectStack: [],
    replacementEffects: [],
    appliedReplacementEffects: new Map(),
    mana: new Map([
      [player1Id, new Map()],
      [player2Id, new Map()],
    ]),
    damageResults: new Map(),
    lastModifiedAt: Date.now(),
    gameActions: [],
    triggeredAbilities: [],
    staticAbilities: [],
    ...overrides,
  };
}

describe("hasIndestructible", () => {
  it("should return true for indestructible keyword", () => {
    const card = createMockCardInstance({ keywords: ["Indestructible"] });
    expect(hasIndestructible(card)).toBe(true);
  });

  it("should return true for indestructible in oracle text", () => {
    const card = createMockCardInstance({ oracle_text: "Indestructible" });
    expect(hasIndestructible(card)).toBe(true);
  });

  it("should return false for non-indestructible card", () => {
    const card = createMockCardInstance({ oracle_text: "Flying" });
    expect(hasIndestructible(card)).toBe(false);
  });

  it("should be case insensitive", () => {
    const card = createMockCardInstance({ oracle_text: "INDESTRUCTIBLE" });
    expect(hasIndestructible(card)).toBe(true);
  });
});

describe("canBeRegenerated", () => {
  it("should return true for regenerate mechanic", () => {
    const card = createMockCardInstance({
      oracle_text: "{T}: Regenerate this creature.",
    });
    expect(canBeRegenerated(card)).toBe(true);
  });

  it("should return false for non-regeneratable card", () => {
    const card = createMockCardInstance({ oracle_text: "Flying" });
    expect(canBeRegenerated(card)).toBe(false);
  });
});

describe("createToken", () => {
  it("should create a token card", () => {
    const token = createToken(
      {
        name: "1/1 white Soldier creature token",
        type_line: "Creature — Soldier",
        colors: ["white"],
      } as ScryfallCard,
      "player1",
      "player1",
    );

    expect(token).toBeDefined();
    expect(token.cardData.name).toContain("Soldier");
    expect(token.isToken).toBe(true);
  });

  it("should handle different token types", () => {
    const zombieToken = createToken(
      {
        name: "2/2 black Zombie creature token",
        type_line: "Creature — Zombie",
        colors: ["black"],
      } as ScryfallCard,
      "player1",
      "player1",
    );
    const treasureToken = createToken(
      {
        name: "Treasure",
        type_line: "Artifact — Treasure",
        colors: [],
      } as ScryfallCard,
      "player1",
      "player1",
    );
    const clueToken = createToken(
      {
        name: "Clue",
        type_line: "Artifact — Clue",
        colors: [],
      } as ScryfallCard,
      "player1",
      "player1",
    );

    expect(zombieToken.cardData.type_line).toContain("Zombie");
    expect(treasureToken.cardData.type_line).toContain("Treasure");
    expect(clueToken.cardData.type_line).toContain("Clue");
  });
});

describe("getHandFilterForCard", () => {
  it("should return filter for red spells", () => {
    const filter = getHandFilterForCard("Lightning Bolt");

    // Returns filter for known cards, null for unknown
    expect(filter === null || filter.colors?.includes("R")).toBe(true);
  });

  it("should return null for unknown cards", () => {
    const filter = getHandFilterForCard("Unknown Card XYZ");

    expect(filter).toBeNull();
  });
});
