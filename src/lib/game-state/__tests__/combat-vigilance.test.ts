/**
 * Combat integration tests — vigilance.
 *
 * Issue #2328 — evergreen keyword enforcement (Plan D, vigilance portion).
 *
 * End-to-end combat assertions verifying that:
 *   - `combat/queries.ts::canAttack` rejects a tapped creature without
 *     vigilance and accepts a tapped creature whose `keywords` array
 *     contains the vigilance tag;
 *   - `combat/queries.ts::getAvailableAttackers` filters out tapped
 *     non-vigilant creatures and includes tapped vigilant creatures;
 *   - `combat/declaration.ts::declareAttackers` suppresses the tap on
 *     a vigilant attacker and still taps a non-vigilant attacker;
 *   - the strict `hasVigilanceStrict` path correctly drives all three
 *     sites: a card whose `keywords` array is empty but whose
 *     `oracle_text` mentions vigilance does NOT trigger the strict
 *     path (regression pin for the substring-oracle-text fallback
 *     anti-pattern).
 *
 * Mirrors the per-blocker / declaration-time distinction documented in
 * `.handoff-archive/2026-09-28-plan-c-prep.md`: vigilance is a
 * declaration-time concern (don't tap on attack), NOT a blocker-pipeline
 * concern.
 */

import { canAttack, declareAttackers, getAvailableAttackers } from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import { hasVigilanceStrict } from "../keyword-actions/vigilance";
import type { CardInstance, GameState, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  oracleText?: string,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: oracleText ?? keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
    rarity: "common",
    set: "tst",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: string;
  bobId: string;
}

function setupGameWithCreatures(
  player1Creatures: Array<{
    name: string;
    power: number;
    toughness: number;
    keywords?: string[];
    oracleText?: string;
  }> = [],
  player2Creatures: Array<{
    name: string;
    power: number;
    toughness: number;
    keywords?: string[];
    oracleText?: string;
  }> = [],
): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  for (const creature of player1Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
      creature.oracleText,
    );
    const creatureInstance = createCardInstance(creatureData, aliceId, aliceId);
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  for (const creature of player2Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
      creature.oracleText,
    );
    const creatureInstance = createCardInstance(creatureData, bobId, bobId);
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  return { state, aliceId, bobId };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) canAttack — strict parsed-keywords drives the tapped-creature gate
// ─────────────────────────────────────────────────────────────────────────────

describe("combat canAttack — vigilance strict parsed-keywords contract (CR 702.2b)", () => {
  it("rejects a tapped creature whose keywords array lacks vigilance", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      { name: "Tapped Fighter", power: 2, toughness: 2 },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const creature = state.cards.get(creatureId)!;
    creature.isTapped = true;

    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toContain("tapped");
  });

  it("allows a tapped creature whose keywords array contains vigilance to attack", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Vigilant Fighter",
        power: 2,
        toughness: 2,
        keywords: ["Vigilance"],
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const creature = state.cards.get(creatureId)!;
    creature.isTapped = true;

    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(true);
  });

  it("rejects a tapped creature whose keywords array is empty even when oracle_text mentions vigilance", () => {
    // Regression pin for the substring-oracle-text anti-pattern. The
    // strict path in `combat/queries.ts::canAttack` consults only the
    // parsed `keywords` array, so a card whose oracle text mentions
    // "vigilance" as a flavor word or grant reference but has no
    // keyword tag must NOT bypass the tap gate.
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Mentions-Vigilance Flavor",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText:
          "Other creatures you control have vigilance. (This creature does not.)",
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const creature = state.cards.get(creatureId)!;
    creature.isTapped = true;

    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toContain("tapped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) getAvailableAttackers — strict parsed-keywords filters the eligible set
// ─────────────────────────────────────────────────────────────────────────────

describe("combat getAvailableAttackers — vigilance strict parsed-keywords contract (CR 702.2b)", () => {
  it("filters out a tapped non-vigilant creature", () => {
    const { state, aliceId } = setupGameWithCreatures([
      { name: "Tapped Fighter", power: 2, toughness: 2 },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    state.cards.get(creatureId)!.isTapped = true;

    const available = getAvailableAttackers(state, aliceId);
    expect(available).not.toContain(creatureId);
  });

  it("includes a tapped vigilant creature", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Vigilant Fighter",
        power: 2,
        toughness: 2,
        keywords: ["Vigilance"],
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    state.cards.get(creatureId)!.isTapped = true;

    const available = getAvailableAttackers(state, aliceId);
    expect(available).toContain(creatureId);
  });

  it("filters out a tapped creature whose oracle text mentions vigilance but lacks the keyword tag", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Mentions-Vigilance Flavor",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText:
          "The night watchman kept his vigil with unwavering vigilance.",
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    state.cards.get(creatureId)!.isTapped = true;

    const available = getAvailableAttackers(state, aliceId);
    expect(available).not.toContain(creatureId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) declareAttackers — strict parsed-keywords drives the tap suppression
// ─────────────────────────────────────────────────────────────────────────────

describe("combat declareAttackers — vigilance strict parsed-keywords contract (CR 702.2b)", () => {
  it("does NOT tap a vigilant attacker at declaration (keyword tag present)", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Vigilant Attacker",
        power: 2,
        toughness: 2,
        keywords: ["Vigilance"],
      },
    ]);
    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const attacker = state.cards.get(attackerId)!;
    attacker.isTapped = false;
    expect(attacker.isTapped).toBe(false);

    const declareState = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const result = declareAttackers(declareState, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(result.success).toBe(true);
    const afterAttacker = result.state.cards.get(attackerId)!;
    expect(afterAttacker.isTapped).toBe(false);
  });

  it("DOES tap a non-vigilant attacker at declaration (keyword tag absent)", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      { name: "Plain Attacker", power: 2, toughness: 2 },
    ]);
    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const attacker = state.cards.get(attackerId)!;
    attacker.isTapped = false;
    expect(attacker.isTapped).toBe(false);

    const declareState = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const result = declareAttackers(declareState, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(result.success).toBe(true);
    const afterAttacker = result.state.cards.get(attackerId)!;
    expect(afterAttacker.isTapped).toBe(true);
  });

  it("DOES tap an attacker whose oracle text mentions vigilance but lacks the keyword tag", () => {
    // Regression pin for the substring-oracle-text anti-pattern. The
    // strict path in `combat/declaration.ts::declareAttackers` consults
    // only the parsed `keywords` array, so a card whose oracle text
    // mentions "vigilance" but has no keyword tag must still be tapped
    // at attack declaration.
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Mentions-Vigilance Flavor",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText:
          "Other creatures you control have vigilance. (This creature does not.)",
      },
    ]);
    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const attacker = state.cards.get(attackerId)!;
    attacker.isTapped = false;
    expect(attacker.isTapped).toBe(false);

    const declareState = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const result = declareAttackers(declareState, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(result.success).toBe(true);
    const afterAttacker = result.state.cards.get(attackerId)!;
    expect(afterAttacker.isTapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) hasVigilanceStrict — direct contract pin on the wired helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("hasVigilanceStrict — direct contract pin on the wired helpers", () => {
  it("returns true for a creature with the vigilance keyword tag", () => {
    const data = createMockCreature("Vigil", 2, 2, ["Vigilance"]);
    const inst = createCardInstance(data, "alice", "alice");
    expect(hasVigilanceStrict(inst)).toBe(true);
  });

  it("returns false for a creature whose oracle text only mentions vigilance (no keyword tag)", () => {
    const data = createMockCreature(
      "Mentions",
      2,
      2,
      [],
      "Other creatures you control have vigilance.",
    );
    const inst = createCardInstance(data, "alice", "alice");
    expect(hasVigilanceStrict(inst)).toBe(false);
  });
});
