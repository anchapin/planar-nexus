/**
 * Multikicker Tests (CR 702.85, multikicker variant)
 *
 * Verifies the rules engine supports paying the kicker cost N times on a
 * multikicker spell (e.g. "Multikicker {1}"). For single-kicker cards the
 * behavior must remain backward-compatible (N ∈ {0, 1}).
 *
 * Reference: Issue #1223 — Rules Engine support for multikicker.
 */

import { castSpell, copySpellOnStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import { addMana } from "../mana";
import { parseKicker } from "../oracle-text-parser";
import type { ScryfallCard } from "@/app/actions";
import type { StackObject } from "../types";

/**
 * Helper — build a multikicker creature (Cinder Pyromancer-style).
 * Default base cost {2}{R}, multikicker cost {1}{R}, oracle text mentions the
 * multikicker count so the cast flow can fan the bonus out N times at
 * resolution.
 */
function createMockMultikickerCreature(
  name: string,
  opts: {
    baseCost?: string;
    multikickerCost?: string;
    bonusPerKick?: string;
  } = {},
): ScryfallCard {
  const baseCost = opts.baseCost ?? "{2}{R}";
  const multikickerCost = opts.multikickerCost ?? "{1}{R}";
  const bonusPerKick = opts.bonusPerKick ?? "1";
  const oracleText = `Multikicker ${multikickerCost}\nWhenever this creature attacks, it deals ${bonusPerKick} damage to any target for each time this creature was kicked.`;
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: "2",
    toughness: "2",
    keywords: [],
    oracle_text: oracleText,
    mana_cost: baseCost,
    cmc: 3,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

/** Helper — put a card in Alice's hand and seed her mana pool. */
function setupGameWithMultikicker(
  cardData: ScryfallCard,
  mana: Parameters<typeof addMana>[2],
) {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const card = createCardInstance(cardData, aliceId, aliceId);
  state.cards.set(card.id, card);

  const hand = state.zones.get(`${aliceId}-hand`)!;
  state.zones.set(`${aliceId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });

  state = addMana(state, aliceId, mana);

  return { state, aliceId, bobId, cardId: card.id };
}

function putInMainPhaseWithPriority(
  state: ReturnType<typeof setupGameWithMultikicker>["state"],
  aliceId: string,
) {
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.turn.activePlayerId = aliceId;
  state.priorityPlayerId = aliceId;
  state.stack = [];
  return state;
}

describe("Multikicker — Parser (CR 702.85)", () => {
  it("detects a multikicker cost and exposes isMultiKicker=true", () => {
    const result = parseKicker("Multikicker {1}");
    expect(result.hasKicker).toBe(true);
    expect(result.isMultiKicker).toBe(true);
    expect(result.kickerCost).not.toBeNull();
    expect(result.kickerCost!.generic).toBe(1);
  });

  it("distinguishes single-kicker from multikicker text", () => {
    expect(parseKicker("Kicker {2}{U}").isMultiKicker).toBe(false);
    expect(parseKicker("Multikicker {2}{U}").isMultiKicker).toBe(true);
  });
});

describe("Multikicker — castSpell mana cost (CR 702.85)", () => {
  const card = createMockMultikickerCreature("Cinder Pyromancer");
  // Base cost {2}{R} = 2G + R. Multikicker {1}{R} = 1G + R per kick.

  it("N=0 — pays only the base mana cost and stamps timesKicked=0", () => {
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 5,
      generic: 5,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const aliceBefore = state.players.get(aliceId)!;
    const genericBefore = aliceBefore.manaPool.generic;
    const redBefore = aliceBefore.manaPool.red;

    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      0,
    );

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(0);
    expect(stackObject.wasKicked).toBe(false);
    expect(stackObject.alternativeCostsUsed ?? []).not.toContain("kicker");

    // Only base cost was charged: {2}{R} → 2 generic + 1 red
    const aliceAfter = result.state.players.get(aliceId)!;
    expect(aliceAfter.manaPool.red).toBe(redBefore - 1);
    expect(aliceAfter.manaPool.generic).toBe(genericBefore - 2);
  });

  it("N=1 — single-kick behaves identically to the boolean isKicked=true path", () => {
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 5,
      generic: 5,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const aliceBefore = state.players.get(aliceId)!;
    const genericBefore = aliceBefore.manaPool.generic;
    const redBefore = aliceBefore.manaPool.red;

    // Pass timesKicked explicitly. This must equal the legacy isKicked=true
    // behavior (1× the multikicker cost on top of base).
    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      1,
    );

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(1);
    expect(stackObject.wasKicked).toBe(true);
    expect(stackObject.alternativeCostsUsed).toContain("kicker");

    // Base {2}{R} + 1× multikicker {1}{R} = 3 generic + 2 red
    const aliceAfter = result.state.players.get(aliceId)!;
    expect(aliceAfter.manaPool.red).toBe(redBefore - 2);
    expect(aliceAfter.manaPool.generic).toBe(genericBefore - 3);
  });

  it("N=3 — pays the multikicker cost three times (max for available mana)", () => {
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 5,
      generic: 5,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const aliceBefore = state.players.get(aliceId)!;
    const genericBefore = aliceBefore.manaPool.generic;
    const redBefore = aliceBefore.manaPool.red;

    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      3,
    );

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(3);
    expect(stackObject.wasKicked).toBe(true);

    // Base {2}{R} + 3× multikicker {1}{R} = 5 generic + 4 red
    const aliceAfter = result.state.players.get(aliceId)!;
    expect(aliceAfter.manaPool.red).toBe(redBefore - 4);
    expect(aliceAfter.manaPool.generic).toBe(genericBefore - 5);
  });

  it("N>available — rejects casting when mana is insufficient for the chosen N", () => {
    // Player only has enough for 2 multikicks (base {2}{R} + 2× {1}{R}).
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 3,
      generic: 4,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      3, // would need base (2G+R) + 3×(1G+R) = 5G + 4R; pool has 4G + 3R
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mana/i);
    // Card must remain in hand — not consumed by a failed cast.
    expect(result.state.zones.get(`${aliceId}-hand`)!.cardIds).toContain(
      cardId,
    );
  });

  it("legacy isKicked=true still works when timesKicked is not provided", () => {
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 5,
      generic: 5,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const result = castSpell(state, aliceId, cardId, [], [], 0, true);

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(1);
    expect(stackObject.wasKicked).toBe(true);
  });

  it("timesKicked=0 with isKicked=true is normalized to N=0 (explicit wins)", () => {
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 5,
      generic: 5,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      true, // legacy hint
      undefined,
      0, // explicit override — the canonical input
    );

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(0);
    expect(stackObject.wasKicked).toBe(false);
  });

  it("non-kicker spell with timesKicked>0 is a no-op for mana (CR 702.85 only)", () => {
    const plainCard: ScryfallCard = {
      id: "mock-plain",
      name: "Vanilla Creature",
      type_line: "Creature — Test",
      power: "1",
      toughness: "1",
      keywords: [],
      oracle_text: "",
      mana_cost: "{1}{G}",
      cmc: 2,
      colors: ["G"],
      color_identity: ["G"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
    } as ScryfallCard;
    const { state, aliceId, cardId } = setupGameWithMultikicker(plainCard, {
      green: 3,
      generic: 2,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const result = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      5, // asking to "multikicker" a non-kicker card: must NOT charge extra
    );

    expect(result.success).toBe(true);
    const stackObject = result.state.stack[
      result.state.stack.length - 1
    ] as StackObject;
    expect(stackObject.timesKicked).toBe(0);
    expect(stackObject.wasKicked).toBe(false);
    expect(stackObject.alternativeCostsUsed ?? []).not.toContain("kicker");
  });
});

describe("Multikicker — copySpellOnStack propagation (CR 707.10)", () => {
  it("a copied kicker spell preserves timesKicked and wasKicked", () => {
    const card = createMockMultikickerCreature("Roiling Storm");
    const { state, aliceId, cardId } = setupGameWithMultikicker(card, {
      red: 10,
      generic: 10,
    });
    putInMainPhaseWithPriority(state, aliceId);

    const cast = castSpell(
      state,
      aliceId,
      cardId,
      [],
      [],
      0,
      false,
      undefined,
      2,
    );
    expect(cast.success).toBe(true);

    const original = cast.state.stack[cast.state.stack.length - 1];

    const copied = copySpellOnStack(cast.state, original.id);
    expect(copied.success).toBe(true);
    const copyOnStack = copied.state.stack[
      copied.state.stack.length - 1
    ] as StackObject;
    expect(copyOnStack.timesKicked).toBe(2);
    expect(copyOnStack.wasKicked).toBe(true);
  });
});
