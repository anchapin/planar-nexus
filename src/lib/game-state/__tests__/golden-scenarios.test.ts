/**
 * Golden Scenario Tests
 *
 * These tests run complete game sequences and verify the final state against expected values.
 * Useful for catching regressions in complex interactions.
 */

import {
  createInitialGameState,
  startGame,
  loadDeckForPlayer,
  passPriority,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { playLand, activateManaAbility } from "../mana";
import { castSpell } from "../spell-casting";
import { resolveCombatDamage } from "../combat";
import { Phase, PlayerId } from "../types";
import {
  serializeGameState,
  deserializeGameState,
} from "../state-serialization";
import type { ScryfallCard } from "@/app/actions";

// Mock cards
const MOUNTAIN: ScryfallCard = {
  id: "mountain-1",
  name: "Mountain",
  type_line: "Basic Land — Mountain",
  keywords: [],
  oracle_text: "{T}: Add {R}.",
  mana_cost: "",
  cmc: 0,
  colors: [],
  color_identity: ["R"],
  legalities: { standard: "legal", commander: "legal" },
};

const RAGAVAN: ScryfallCard = {
  id: "ragavan-1",
  name: "Ragavan, Nimble Pilferer",
  type_line: "Legendary Creature — Monkey Pirate",
  keywords: [],
  oracle_text:
    "Whenever Ragavan, Nimble Pilferer deals combat damage to a player...",
  mana_cost: "{R}",
  cmc: 1,
  colors: ["red"],
  color_identity: ["R"],
  legalities: { standard: "legal", commander: "legal" },
  power: "2",
  toughness: "1",
};

describe("Golden Scenarios", () => {
  it("should execute a simple turn sequence correctly", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    const aliceId = Array.from(state.players.keys())[0] as PlayerId;
    const bobId = Array.from(state.players.keys())[1] as PlayerId;

    // Load decks
    state = loadDeckForPlayer(state, aliceId, [MOUNTAIN, RAGAVAN]);
    state = loadDeckForPlayer(state, bobId, [MOUNTAIN]);

    // Start game
    state = startGame(state);

    // Alice's turn 1
    // 1. Move to Precombat Main
    while (state.turn.currentPhase !== Phase.PRECOMBAT_MAIN) {
      state = passPriority(state, state.priorityPlayerId!);
    }

    // Alice plays mountain
    const handAlice = state.zones.get(`${aliceId}-hand`)!;
    const mountainId = handAlice.cardIds.find(
      (id) => state.cards.get(id)?.cardData.name === "Mountain",
    )!;

    const playLandResult = playLand(state, aliceId, mountainId);
    expect(playLandResult.success).toBe(true);
    state = playLandResult.state;

    // Alice taps mountain for R
    const activateResult = activateManaAbility(state, aliceId, mountainId, 0);
    expect(activateResult.success).toBe(true);
    state = activateResult.state;
    expect(state.players.get(aliceId)?.manaPool.red).toBe(1);

    // Alice casts Ragavan
    const ragavanId = handAlice.cardIds.find(
      (id) => state.cards.get(id)?.cardData.name === "Ragavan, Nimble Pilferer",
    )!;
    const castResult = castSpell(state, aliceId, ragavanId);
    expect(castResult.success).toBe(true);
    state = castResult.state;
    expect(state.stack.length).toBe(1);
    expect(state.players.get(aliceId)?.manaPool.red).toBe(0);

    // Resolve Ragavan (both players pass)
    // After casting, priority should be with Bob
    state = passPriority(state, state.priorityPlayerId!); // Bob passes
    state = passPriority(state, state.priorityPlayerId!); // Alice passes
    expect(state.stack.length).toBe(0);
    expect(state.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(
      ragavanId,
    );

    // End Alice's turn
    while (state.turn.activePlayerId === aliceId) {
      state = passPriority(state, state.priorityPlayerId!);
    }

    // Bob's turn 1 (just pass)
    while (state.turn.activePlayerId === bobId) {
      state = passPriority(state, state.priorityPlayerId!);
    }

    // Alice's turn 2
    // Total turns: Alice(1), Bob(2), Alice(3)
    expect(state.turn.turnNumber).toBe(3);
    expect(state.turn.activePlayerId).toBe(aliceId);

    // Move to Combat
    while (state.turn.currentPhase !== Phase.DECLARE_ATTACKERS) {
      state = passPriority(state, state.priorityPlayerId!);
    }

    // Alice attacks with Ragavan
    state.combat.inCombatPhase = true;
    state.combat.attackers = [
      {
        cardId: ragavanId,
        defenderId: bobId,
        isAttackingPlaneswalker: false,
        damageToDeal: 2,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ];

    // Resolve combat damage
    const combatResult = resolveCombatDamage(state);
    expect(combatResult.success).toBe(true);
    state = combatResult.state;

    // Bob should have 18 life
    expect(state.players.get(bobId)?.life).toBe(18);
  });

  it("should preserve state through serialization/deserialization round-trip", () => {
    const state = createInitialGameState(["Alice", "Bob"], 20, true); // Commander game
    const aliceId = Array.from(state.players.keys())[0] as PlayerId;
    const bobId = Array.from(state.players.keys())[1] as PlayerId;

    // Modify state to include some Maps and complex data
    const alice = state.players.get(aliceId)!;
    alice.commanderDamage.set(bobId, 5);
    alice.manaPool.white = 3;

    // Add a card
    const card = createCardInstance(RAGAVAN, aliceId, aliceId);
    state.cards.set(card.id, card);
    state.zones.get(`${aliceId}-battlefield`)!.cardIds.push(card.id);

    // Serialize
    const json = serializeGameState(state);
    expect(json).toContain("commanderDamage");
    expect(json).toContain('"dataType": "Map"');

    // Deserialize
    const newState = deserializeGameState(json);

    // Verify
    expect(newState.gameId).toBe(state.gameId);
    expect(newState.players.size).toBe(2);
    expect(newState.players.get(aliceId)?.commanderDamage.get(bobId)).toBe(5);
    expect(newState.players.get(aliceId)?.manaPool.white).toBe(3);
    expect(newState.cards.size).toBe(1);
    expect(newState.cards.get(card.id)?.cardData.name).toBe(
      "Ragavan, Nimble Pilferer",
    );
    expect(newState.zones.get(`${aliceId}-battlefield`)?.cardIds).toContain(
      card.id,
    );
  });
});
