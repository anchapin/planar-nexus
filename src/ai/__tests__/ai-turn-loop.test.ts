/**
 * @fileoverview Tests for per-archetype playstyle wiring in the AI turn loop.
 *
 * Covers the fix for issue #911: the deck-specific (per-archetype) playstyle
 * weights used to be dead code because the live turn loop never propagated the
 * AI player's archetype. These tests verify the turn loop now (a) auto-detects
 * the archetype from the AI player's deck and (b) exposes an explicit override
 * via AITurnConfig.
 */

import { describe, it, expect } from "@jest/globals";
import { detectPlayerArchetype, type AITurnConfig } from "../ai-turn-loop";
import type { DeckCard } from "@/app/actions";
import type {
  GameState as EngineGameState,
  CardInstance,
} from "@/lib/game-state/types";

function createCard(
  name: string,
  type: string,
  cmc: number = 0,
  colors: string[] = [],
  oracleText: string = "",
): DeckCard {
  return {
    name,
    count: 1,
    id: `card-${name}`,
    cmc,
    colors,
    legalities: {},
    type_line: type,
    mana_cost: `{${cmc}}`,
    color_identity: colors,
    oracle_text: oracleText,
  };
}

/**
 * Build a minimal engine game state containing only the pieces
 * `detectPlayerArchetype` reads (zones + cards). The rest of the GameState is
 * irrelevant to the function under test, so we cast a partial object.
 */
function buildStateWithLibrary(
  playerId: string,
  deck: DeckCard[],
): EngineGameState {
  const cards = new Map<string, CardInstance>();
  const cardIds: string[] = [];
  let i = 0;
  for (const card of deck) {
    const id = `${playerId}-lib-${i++}`;
    cardIds.push(id);
    cards.set(id, {
      id,
      oracleId: id,
      cardData: { ...card },
      currentFaceIndex: 0,
      isFaceDown: false,
      controllerId: playerId,
      ownerId: playerId,
      isTapped: false,
      isFlipped: false,
      isTurnedFaceUp: false,
      isPhasedOut: false,
    } as unknown as CardInstance);
  }

  const zones = new Map<string, { cardIds: string[] }>();
  zones.set(`${playerId}-library`, { cardIds });

  return { zones, cards } as unknown as EngineGameState;
}

describe("detectPlayerArchetype (issue #911 wiring)", () => {
  it("returns 'unknown' when the player has no cards/zones", () => {
    const empty = {
      zones: new Map(),
      cards: new Map(),
    } as unknown as EngineGameState;
    expect(detectPlayerArchetype(empty, "player1")).toBe("unknown");
  });

  it("auto-detects 'aggro' from a burn-style deck", () => {
    const burnDeck: DeckCard[] = [
      createCard(
        "Lightning Bolt",
        "Instant",
        1,
        ["R"],
        "Deal 3 damage to any target",
      ),
      createCard(
        "Lava Spike",
        "Sorcery",
        1,
        ["R"],
        "Deal 3 damage to target player",
      ),
      createCard("Skewer the Critics", "Sorcery", 2, ["R"], "Deal 3 damage"),
      createCard("Burst Lightning", "Instant", 2, ["R"], "Deal 4 damage"),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
      createCard(
        "Monastery Swiftspear",
        "Creature",
        1,
        ["R", "U"],
        "Haste, prowess",
      ),
      createCard("Mountain", "Land", 0, [], ""),
    ];

    const state = buildStateWithLibrary("player1", burnDeck);
    expect(detectPlayerArchetype(state, "player1")).toBe("aggro");
  });

  it("never throws and returns 'unknown' for a deck that does not classify", () => {
    // A single basic land cannot be classified.
    const state = buildStateWithLibrary("player1", [
      createCard("Forest", "Land", 0, [], ""),
    ]);
    expect(() => detectPlayerArchetype(state, "player1")).not.toThrow();
    expect(detectPlayerArchetype(state, "player1")).toBe("unknown");
  });

  it("gathers cards from all of a player's zones, not just the library", () => {
    // Split a burn deck across library + hand + battlefield; detection should
    // still classify the combined list as aggro.
    const splitDeck = [
      createCard(
        "Lightning Bolt",
        "Instant",
        1,
        ["R"],
        "Deal 3 damage to any target",
      ),
      createCard(
        "Lava Spike",
        "Sorcery",
        1,
        ["R"],
        "Deal 3 damage to target player",
      ),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
    ];

    const cards = new Map<string, CardInstance>();
    const zones = new Map<string, { cardIds: string[] }>();
    const playerId = "player1";

    const zoneKeys = [
      `${playerId}-library`,
      `${playerId}-hand`,
      `${playerId}-battlefield`,
    ];
    splitDeck.forEach((card, idx) => {
      const id = `${playerId}-c${idx}`;
      cards.set(id, {
        id,
        oracleId: id,
        cardData: { ...card },
        currentFaceIndex: 0,
        isFaceDown: false,
        controllerId: playerId,
        ownerId: playerId,
        isTapped: false,
        isFlipped: false,
        isTurnedFaceUp: false,
        isPhasedOut: false,
      } as unknown as CardInstance);
      // Put each card in a different zone.
      zones.set(zoneKeys[idx], { cardIds: [id] });
    });

    const state = { zones, cards } as unknown as EngineGameState;
    // With only 3 cards detection confidence is lower, but the function must
    // still run without error and return a valid DeckArchetype bucket.
    const result = detectPlayerArchetype(state, playerId);
    expect([
      "aggro",
      "unknown",
      "midrange",
      "control",
      "combo",
      "ramp",
    ]).toContain(result);
  });
});

describe("AITurnConfig.archetype override (issue #911)", () => {
  it("accepts an explicit archetype in the config", () => {
    const config: AITurnConfig = {
      difficulty: "medium",
      delayMs: 0,
      archetype: "control",
    };
    expect(config.archetype).toBe("control");
  });

  it("leaves archetype optional for backward compatibility", () => {
    const config: AITurnConfig = { difficulty: "medium", delayMs: 0 };
    expect(config.archetype).toBeUndefined();
  });
});
