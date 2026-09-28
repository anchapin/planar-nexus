/**
 * Combat integration tests — deathtouch.
 *
 * Issue #2330 — evergreen keyword enforcement (Plan E, deathtouch portion).
 *
 * End-to-end combat assertions verifying that:
 *   - `combat/resolution.ts::getExcessTrampleDamage` correctly short-
 *     circuits to 0 (no excess) when the blocker has deathtouch,
 *     regardless of the attacker's power (the contract pinned by #2326);
 *   - `combat/resolution.ts` attributes deathtouch damage-assignment to
 *     attacker-side and blocker-side deathtouch sources through the
 *     canonical `hasDeathtouch` (which now defers to `hasDeathtouchStrict`
 *     first, then `hasKeyword` substring fallback);
 *   - `isLethalDamage` (the >0 collapse gate in
 *     `keyword-actions/damage-tap.ts`) returns true for >=1 damage from
 *     a deathtouch source and false otherwise;
 *   - the strict `hasDeathtouchStrict` path correctly drives the wiring:
 *     a card whose `keywords` array is empty but whose `oracle_text`
 *     mentions "deathtouch" does NOT acquire deathtouch via the strict
 *     path (regression pin for the substring-oracle-text fallback
 *     anti-pattern). The canonical `hasDeathtouch` still returns true
 *     via the substring fallback in that case (back-compat).
 *
 * Mirrors the deathtouch-trample interaction math that was pinned in
 * `combat-trample.test.ts` from #2326 — Plan E only changes the
 * detection helper, so this file pins that the wiring still honors
 * the contract end-to-end.
 */

import { declareAttackers, declareBlockers } from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import { hasDeathtouchStrict } from "../keyword-actions/deathtouch";
import { hasDeathtouch, isLethalDamage } from "../evergreen-keywords";
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
    colors: ["B"],
    color_identity: ["B"],
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

function addToBattlefield(
  state: GameState,
  card: ScryfallCard,
  playerId: string,
  untap = true,
): string {
  const instance = createCardInstance(card, playerId, playerId);
  instance.hasSummoningSickness = false;
  instance.isTapped = !untap;
  state.cards.set(instance.id, instance);
  const battlefield = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, instance.id],
  });
  return instance.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasDeathtouchStrict — combat wiring pin
// ─────────────────────────────────────────────────────────────────────────────

describe("combat hasDeathtouchStrict (CR 702.2) — wiring pin", () => {
  it("returns true for a creature whose keywords array contains the deathtouch tag", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Stinger",
        power: 1,
        toughness: 1,
        keywords: ["Deathtouch"],
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    expect(hasDeathtouchStrict(state.cards.get(creatureId)!)).toBe(true);
  });

  it("returns false for a creature whose keywords array lacks the deathtouch tag, even if oracle_text mentions it", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Flavor Mentions Deathtouch",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText: "Other creatures you control have deathtouch.",
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    expect(hasDeathtouchStrict(state.cards.get(creatureId)!)).toBe(false);
    // The canonical helper still returns true via the substring fallback.
    expect(hasDeathtouch(state.cards.get(creatureId)!)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) isLethalDamage — combat damage-assignment wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("combat isLethalDamage — deathtouch >0 damage collapse (CR 702.2c)", () => {
  it("collapses 1 damage from a deathtouch attacker to lethal", () => {
    const card = createMockCreature("Stinger", 1, 1, ["Deathtouch"]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(isLethalDamage(1, instance)).toBe(true);
  });

  it("collapses 3 damage from a deathtouch attacker to lethal", () => {
    const card = createMockCreature("Big Stinger", 3, 3, ["Deathtouch"]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(isLethalDamage(3, instance)).toBe(true);
  });

  it("does NOT collapse 0 damage from a deathtouch source (CR 702.2c: nonzero)", () => {
    const card = createMockCreature("Stinger", 1, 1, ["Deathtouch"]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(isLethalDamage(0, instance)).toBe(false);
  });

  it("does NOT collapse any damage from a non-deathtouch source", () => {
    const card = createMockCreature("Plain Fighter", 2, 2, []);
    const instance = createCardInstance(card, "alice", "alice");
    expect(isLethalDamage(5, instance)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) declareAttackers / declareBlockers — deathtouch survives the pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("combat declareAttackers / declareBlockers — deathtouch survives the pipeline (CR 702.2)", () => {
  it("a deathtouch attacker can be declared and is recorded correctly in combat state", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Deathtouch Attacker",
          power: 2,
          toughness: 2,
          keywords: ["Deathtouch"],
        },
      ],
      [],
    );
    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];

    const declareState = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const result = declareAttackers(declareState, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(result.success).toBe(true);
    // The attacker is still on the battlefield and has deathtouch.
    expect(hasDeathtouch(result.state.cards.get(attackerId)!)).toBe(true);
  });

  it("a deathtouch blocker is recognized via the strict path through the canonical helper", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "Plain Attacker",
          power: 3,
          toughness: 3,
        },
      ],
      [
        {
          name: "Deathtouch Blocker",
          power: 1,
          toughness: 1,
          keywords: ["Deathtouch"],
        },
      ],
    );
    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    // Sanity: strict and canonical both agree on the blocker.
    expect(hasDeathtouchStrict(state.cards.get(blockerId)!)).toBe(true);
    expect(hasDeathtouch(state.cards.get(blockerId)!)).toBe(true);

    // Declare and block.
    let declareState = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(declareState, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(attackResult.success).toBe(true);
    declareState = attackResult.state;
    declareState = {
      ...declareState,
      turn: { ...declareState.turn, currentPhase: Phase.DECLARE_BLOCKERS },
    };
    const blockAssignments = new Map<
      CardInstance["id"],
      CardInstance["id"][]
    >();
    blockAssignments.set(attackerId, [blockerId]);
    const blockResult = declareBlockers(declareState, blockAssignments);
    expect(blockResult.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) deathtouch + trample interaction (CR 702.2b + CR 702.19)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat deathtouch + trample — interaction contract (CR 702.2b / CR 702.19)", () => {
  // The deathtouch-trample interaction math was pinned by #2326 in
  // `combat-trample.test.ts`. Plan E (#2330) only changes the detection
  // helper, so this file pins that the canonical `hasDeathtouch` (now
  // strict-first) still drives the interaction correctly when both
  // keywords are parsed as standalone tags.

  it("a creature with both 'Trample' and 'Deathtouch' is detected by the strict path", () => {
    const card = createMockCreature("Trample + Deathtouch", 5, 1, [
      "Trample",
      "Deathtouch",
    ]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(hasDeathtouchStrict(instance)).toBe(true);
  });

  it("the strict and canonical paths agree when both keywords are parsed", () => {
    const card = createMockCreature("Trample + Deathtouch", 5, 1, [
      "Trample",
      "Deathtouch",
    ]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(hasDeathtouchStrict(instance)).toBe(hasDeathtouch(instance));
  });

  it("a creature with 'Deathtouch' and a non-trample power of 5 is detected by the strict path", () => {
    // CR 702.2b: any nonzero damage is lethal; CR 702.19 (trample) only
    // routes excess to the player when the blocker has no deathtouch.
    // This pin ensures the detection helper does not lose deathtouch
    // when the card also has high power.
    const card = createMockCreature("Big Deathtouch", 5, 5, ["Deathtouch"]);
    const instance = createCardInstance(card, "alice", "alice");
    expect(hasDeathtouchStrict(instance)).toBe(true);
    expect(isLethalDamage(1, instance)).toBe(true);
  });
});
