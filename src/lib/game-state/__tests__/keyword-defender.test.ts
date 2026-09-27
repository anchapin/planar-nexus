/**
 * Defender keyword enforcement tests (CR 702.13).
 *
 * Issue #2293 — evergreen keyword enforcement (defender portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "defender" (e.g. as a continuous-effect grant, or in flavor text)
 *     must NOT acquire defender on its own;
 *   - combat-attacker selection: defender creatures cannot be declared as
 *     attackers (this closes the pre-fix bug where `canAttack` checked
 *     tapped/sickness/creature-type but not defender);
 *   - `getAvailableAttackers` filters defenders out of the eligible set;
 *   - `declareAttackers` rejects a defender-only attacker list and accepts
 *     a mixed board where only the non-defender attackers proceed;
 *   - a defender creature that loses the keyword (post-layer effect) can
 *     attack again (regression guard on the strict parsed-keywords check);
 *   - defender + vigilance: a vigilant defender creature still cannot
 *     attack (vigilance only affects tapping, not attack legality).
 */

import { canAttack, declareAttackers, getAvailableAttackers } from "../combat";
import {
  hasDefenderStrict,
  canAttackAsNonDefender,
} from "../keyword-actions/defender";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase, type CardInstanceId, type GameState } from "../types";
import type { ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers (local; mirror the flash test style)
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "test-card",
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature — Test",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    rarity: overrides.rarity ?? "common",
    set: overrides.set ?? "tst",
    ...overrides,
  } as ScryfallCard;
}

function addToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: string,
): CardInstanceId {
  const instance = createCardInstance(
    cardData,
    controllerId as CardInstanceId,
    controllerId as CardInstanceId,
  );
  instance.hasSummoningSickness = false;
  state.cards.set(instance.id, instance);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, instance.id],
  });
  return instance.id;
}

function setupGame(
  player1Creatures: Array<{
    name: string;
    power?: number;
    toughness?: number;
    keywords?: string[];
    oracleText?: string;
    typeLine?: string;
  }> = [],
  player2Creatures: Array<{
    name: string;
    power?: number;
    toughness?: number;
    keywords?: string[];
    oracleText?: string;
    typeLine?: string;
  }> = [],
): { state: GameState; aliceId: string; bobId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  function makeCreature(spec: {
    name: string;
    power?: number;
    toughness?: number;
    keywords?: string[];
    oracleText?: string;
    typeLine?: string;
  }): ScryfallCard {
    return makeCardData({
      id: `mock-${spec.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: spec.name,
      type_line: spec.typeLine ?? "Creature — Test",
      power: spec.power != null ? spec.power.toString() : undefined,
      toughness: spec.toughness != null ? spec.toughness.toString() : undefined,
      keywords: spec.keywords ?? [],
      oracle_text: spec.oracleText ?? (spec.keywords ?? []).join(" "),
      cmc: 2,
      colors: ["R"],
      color_identity: ["R"],
      legalities: { standard: "legal", commander: "legal" },
      layout: "normal",
    });
  }

  for (const spec of player1Creatures) {
    addToBattlefield(state, makeCreature(spec), aliceId);
  }
  for (const spec of player2Creatures) {
    addToBattlefield(state, makeCreature(spec), bobId);
  }

  return { state, aliceId, bobId };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Strict detection: parsed keywords, not substring oracle text
// ─────────────────────────────────────────────────────────────────────────────

describe("hasDefenderStrict (CR 702.13)", () => {
  it("returns true for a creature with 'defender' in its parsed keywords", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Wall of Wood",
        keywords: ["Defender"],
        oracle_text: "Defender",
      }),
      "p1",
      "p1",
    );
    expect(hasDefenderStrict(card)).toBe(true);
  });

  it("matches the keyword regardless of case", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Wall",
        keywords: ["defender"],
        oracle_text: "",
      }),
      "p1",
      "p1",
    );
    expect(hasDefenderStrict(card)).toBe(true);
  });

  it("returns false for a creature without the defender keyword", () => {
    const card = createCardInstance(
      makeCardData({ name: "Bear", keywords: [], oracle_text: "" }),
      "p1",
      "p1",
    );
    expect(hasDefenderStrict(card)).toBe(false);
  });

  it("returns false for a creature whose oracle text mentions 'defender' as a grant (regression: substring oracle-text fallback would false-positive here)", () => {
    // A card that gives other creatures defender must NOT itself be a
    // defender. The substring fallback in evergreen-keywords.hasKeyword
    // would have flagged this; the strict check must not.
    const card = createCardInstance(
      makeCardData({
        name: "Mentor of Walls",
        keywords: [],
        oracle_text:
          "Other creatures you control have defender. (They can't attack.)",
      }),
      "p1",
      "p1",
    );
    expect(hasDefenderStrict(card)).toBe(false);
  });
});

describe("canAttackAsNonDefender (CR 702.13)", () => {
  it("returns true for a creature without defender", () => {
    const card = createCardInstance(
      makeCardData({ name: "Bear", keywords: [], oracle_text: "" }),
      "p1",
      "p1",
    );
    expect(canAttackAsNonDefender(card)).toBe(true);
  });

  it("returns false for a creature with defender", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Wall of Wood",
        keywords: ["Defender"],
        oracle_text: "Defender",
      }),
      "p1",
      "p1",
    );
    expect(canAttackAsNonDefender(card)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) canAttack gate — the real fix
// ─────────────────────────────────────────────────────────────────────────────

describe("canAttack — defender gate (CR 702.13)", () => {
  it("rejects a defender creature from attacking", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
      ],
      [],
    );
    const wallId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = canAttack(state, wallId, bobId);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toMatch(/defender/i);
  });

  it("permits a non-defender creature to attack", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Bear", power: 2, toughness: 2 }],
      [],
    );
    const bearId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = canAttack(state, bearId, bobId);
    expect(result.canAttack).toBe(true);
  });

  it("rejects only the defender from a mixed board; the non-defender can attack", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
        { name: "Bear", power: 2, toughness: 2 },
      ],
      [],
    );
    const ids = state.zones.get(`${aliceId}-battlefield`)!.cardIds;
    // Card order matches construction order.
    const wallId = ids[0];
    const bearId = ids[1];
    expect(canAttack(state, wallId, bobId).canAttack).toBe(false);
    expect(canAttack(state, bearId, bobId).canAttack).toBe(true);
  });

  it("allows a defender to attack after losing the keyword (layer-effect removal regression)", () => {
    // A "remove all abilities" effect (e.g. a hypothetical layer 6 wipe that
    // strips keywords) would set keywords to []. After such an effect the
    // strict check should permit attacking.
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
      ],
      [],
    );
    const wallId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    expect(canAttack(state, wallId, bobId).canAttack).toBe(false);

    // Simulate the post-layer effect: strip the keyword.
    state.cards.get(wallId)!.cardData.keywords = [];
    expect(canAttack(state, wallId, bobId).canAttack).toBe(true);
  });

  it("vigilant defender still cannot attack (vigilance does not override defender)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Vigilant Wall",
          power: 0,
          toughness: 6,
          keywords: ["Defender", "Vigilance"],
        },
      ],
      [],
    );
    const wallId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = canAttack(state, wallId, bobId);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toMatch(/defender/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) getAvailableAttackers — defender filtered out of the eligible set
// ─────────────────────────────────────────────────────────────────────────────

describe("getAvailableAttackers — defender filtered out (CR 702.13)", () => {
  it("excludes a defender creature from the available attackers list", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
      ],
      [],
    );
    expect(getAvailableAttackers(state, aliceId)).toEqual([]);
  });

  it("returns only the non-defender creatures from a mixed board", () => {
    const { state, aliceId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
        { name: "Bear", power: 2, toughness: 2 },
        {
          name: "Vigilant Wall",
          power: 1,
          toughness: 5,
          keywords: ["Defender", "Vigilance"],
        },
      ],
      [],
    );
    const ids = getAvailableAttackers(state, aliceId);
    expect(ids).toHaveLength(1);
    const onlyAvailable = state.cards.get(ids[0])!;
    expect(onlyAvailable.cardData.name).toBe("Bear");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) declareAttackers end-to-end — the integration pin
// ─────────────────────────────────────────────────────────────────────────────

describe("declareAttackers — defender enforcement (CR 702.13)", () => {
  it("rejects a defender-only attacker list (no attackers declared)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
      ],
      [],
    );
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const wallId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = declareAttackers(state, [
      { cardId: wallId, defenderId: bobId },
    ]);
    // declareAttackers rejects the all-invalid list; the wall stays untapped.
    expect(result.success).toBe(false);
    expect(result.state.combat.attackers).toHaveLength(0);
    expect(result.state.cards.get(wallId)!.isTapped).toBe(false);
  });

  it("on a mixed board, declares only the non-defender as an attacker and surfaces the defender's rejection as an error", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Wall of Wood",
          power: 0,
          toughness: 6,
          keywords: ["Defender"],
        },
        { name: "Bear", power: 2, toughness: 2 },
      ],
      [],
    );
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const ids = state.zones.get(`${aliceId}-battlefield`)!.cardIds;
    const wallId = ids[0];
    const bearId = ids[1];

    const result = declareAttackers(state, [
      { cardId: wallId, defenderId: bobId },
      { cardId: bearId, defenderId: bobId },
    ]);

    // The bear attacks; the wall's rejection is surfaced in errors.
    expect(result.success).toBe(true);
    expect(result.state.combat.attackers).toHaveLength(1);
    expect(result.state.combat.attackers[0].cardId).toBe(bearId);
    expect(result.errors?.join(" ")).toMatch(/defender/i);
    expect(result.errors?.join(" ")).toMatch(/Wall of Wood/i);
    // The wall is not tapped — only the bear is.
    expect(result.state.cards.get(wallId)!.isTapped).toBe(false);
    expect(result.state.cards.get(bearId)!.isTapped).toBe(true);
  });
});
