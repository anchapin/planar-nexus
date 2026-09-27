/**
 * Flash keyword enforcement tests (CR 702.8).
 *
 * Issue #2293 — evergreen keyword enforcement (flash portion).
 *
 * Pin:
 *   - canonical detection (parsed keywords list, not substring search);
 *   - false-positive regression: "Flashback" and any other card with the
 *     substring "flash" in oracle_text must NOT be granted flash;
 *   - cast-timing decision: instant-speed cast permitted when flash present;
 *   - sorcery-speed restrictions still apply to non-flash non-instant cards.
 */

import { canCastAtInstantSpeed, hasFlash } from "../keyword-actions/flash";
import { canCastSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type { CardInstance, ScryfallCard } from "../types";

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

function makeInstance(data: ScryfallCard, controllerId: string): CardInstance {
  return createCardInstance(data, controllerId, controllerId);
}

describe("canCastAtInstantSpeed (CR 702.8)", () => {
  it("returns true for a creature with the Flash keyword", () => {
    const card = makeInstance(
      makeCardData({
        keywords: ["Flash"],
        oracle_text: "Flash",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(card)).toBe(true);
  });

  it("returns true for an Instant even without Flash", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Instant",
        keywords: [],
        oracle_text: "Counter target spell.",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(card)).toBe(true);
  });

  it("returns false for a sorcery even with Flash on the type line", () => {
    // Hypothetical contradiction; the type line wins.
    const card = makeInstance(
      makeCardData({
        type_line: "Sorcery",
        keywords: ["Flash"],
        oracle_text: "Flash",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(card)).toBe(false);
  });

  it("returns false for a creature without Flash", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Creature — Bear",
        keywords: [],
        oracle_text: "Trample",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(card)).toBe(false);
  });

  // Regression: the previous substring oracle-text search granted flash
  // to any card with the literal word "flash" in its oracle text — most
  // notably Flashback, which is an entirely different keyword.
  it("does NOT grant flash to a non-instant card with Flashback", () => {
    const nonInstantFlashback = makeInstance(
      makeCardData({
        type_line: "Creature — Spirit",
        keywords: ["Flashback"],
        oracle_text: "Flashback {3}{R}",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(nonInstantFlashback)).toBe(false);
  });

  it("does NOT grant flash via oracle-text substring fallback", () => {
    // Simulates a card with "flash" in oracle text but NOT in keywords.
    // The previous substring check would have falsely granted flash.
    const card = makeInstance(
      makeCardData({
        type_line: "Creature — Human",
        keywords: [],
        oracle_text: "When this creature dies, it flashes bright.",
      }),
      "p1",
    );
    expect(canCastAtInstantSpeed(card)).toBe(false);
  });
});

describe("hasFlash (canonical detection)", () => {
  it("returns true when Flash is in the parsed keywords list", () => {
    const card = makeInstance(makeCardData({ keywords: ["Flash"] }), "p1");
    expect(hasFlash(card)).toBe(true);
  });

  it("returns false when Flash is missing from keywords and oracle text", () => {
    const card = makeInstance(makeCardData({ keywords: ["Trample"] }), "p1");
    expect(hasFlash(card)).toBe(false);
  });
});

describe("canCastSpell integration (CR 702.8 + 117)", () => {
  function setupGameWithFlashCreatureInHand() {
    const flashCard = makeCardData({
      id: "flash-creature",
      name: "Ambush Viper",
      type_line: "Creature — Snake",
      keywords: ["Flash"],
      oracle_text: "Flash",
      mana_cost: "{1}{G}",
      cmc: 2,
      colors: ["G"],
      color_identity: ["G"],
    });
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const playerIds = Array.from(state.players.keys());
    const aliceId = playerIds[0];
    const bobId = playerIds[1];

    const card = createCardInstance(flashCard, aliceId, aliceId);
    state.cards.set(card.id, card);

    const hand = state.zones.get(`${aliceId}-hand`)!;
    state.zones.set(`${aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, card.id],
    });

    state = addMana(state, aliceId, {
      blue: 2,
      red: 3,
      green: 2,
      generic: 5,
    });

    return { state, aliceId, bobId, flashCardId: card.id };
  }

  it("permits casting a flash creature on the opponent's turn during combat", () => {
    const { state, aliceId, bobId, flashCardId } =
      setupGameWithFlashCreatureInHand();
    // Force an opponent's turn in combat phase.
    state.turn.activePlayerId = bobId;
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.priorityPlayerId = aliceId; // alice has priority
    state.stack = [];

    const result = canCastSpell(state, aliceId, flashCardId);
    expect(result.canCast).toBe(true);
  });

  it("rejects casting a non-flash creature on the opponent's turn", () => {
    const { state, aliceId, bobId } = setupGameWithFlashCreatureInHand();
    // Replace the flash card with a non-flash creature.
    const bear = makeCardData({
      id: "bear",
      type_line: "Creature — Bear",
      keywords: [],
      oracle_text: "",
      mana_cost: "{1}{G}",
      cmc: 2,
      colors: ["G"],
      color_identity: ["G"],
    });
    const bearInstance = createCardInstance(bear, aliceId, aliceId);
    state.cards.set(bearInstance.id, bearInstance);
    const handZone = state.zones.get(`${aliceId}-hand`)!;
    state.zones.set(`${aliceId}-hand`, {
      ...handZone,
      cardIds: [bearInstance.id],
    });

    state.turn.activePlayerId = bobId;
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.priorityPlayerId = aliceId;
    state.stack = [];

    const result = canCastSpell(state, aliceId, bearInstance.id);
    expect(result.canCast).toBe(false);
  });

  it("rejects casting a flash creature when the player does not have priority", () => {
    const { state, aliceId, bobId, flashCardId } =
      setupGameWithFlashCreatureInHand();
    state.turn.activePlayerId = bobId;
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.priorityPlayerId = bobId; // opponent has priority
    state.stack = [];

    const result = canCastSpell(state, aliceId, flashCardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toMatch(/priority/i);
  });

  it("rejects casting a flash creature when a split-second spell is on the stack (CR 702.60b)", () => {
    const { state, aliceId, bobId, flashCardId } =
      setupGameWithFlashCreatureInHand();
    state.turn.activePlayerId = bobId;
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.priorityPlayerId = aliceId;
    state.stack = [
      {
        id: "split_second_spell",
        type: "spell",
        sourceCardId: null,
        controllerId: bobId,
        name: "Sudden Death",
        text: "Split second",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: 0,
        splitSecond: true,
      } as never,
    ];

    const result = canCastSpell(state, aliceId, flashCardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toMatch(/split second/i);
  });
});
