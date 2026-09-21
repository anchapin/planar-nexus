/**
 * @fileoverview Unit tests for the Cascade keyword (CR 702.84).
 *
 * Issue #1909 — [Engine] Cascade keyword (CR 702.84) is not implemented.
 *
 * CR 702.84a: "Cascade" is a triggered ability that functions when you cast the
 * spell. "When you cast this spell, reveal cards from the top of your library
 * until you reveal a card that shares a card type with it, that costs less to
 * cast, or that has the mana value less than this spell's mana value. That card
 * shares the characteristics of this spell and is cast without paying its mana
 * cost. The rest of the revealed cards are put into your graveyard."
 *
 * This implementation follows the mana-value variant (e.g. Bloodbraid Elf):
 * reveal cards from the top of the library until one with mana value strictly
 * less than the original spell's mana value is found. That card is cast for free.
 * The rest go to the graveyard.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { parseCascade, hasCascade } from "../keyword-actions";
import { resolveCascade } from "../keyword-actions/cascade";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveTopOfStack, castSpell } from "../spell-casting";
import { Phase } from "../types";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "../types";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Creature — Test",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** Bloodbraid Elf — 3/2 with cascade (CMC 3, {2}{R}{G}). */
function bloodbraidElf(): ScryfallCard {
  return makeCard({
    id: "bloodbraid-elf",
    name: "Bloodbraid Elf",
    type_line: "Creature — Elf Berserker",
    oracle_text: "Haste. Cascade.",
    mana_cost: "{2}{R}{G}",
    cmc: 3,
    colors: ["R", "G"],
    color_identity: ["R", "G"],
    power: "3",
    toughness: "2",
  });
}

/** CMC 5 creature (higher than Bloodbraid Elf's CMC 3). */
function cmc5Creature(): ScryfallCard {
  return makeCard({
    id: "cmc-5-creature",
    name: "Feralorc",
    type_line: "Creature — Orc",
    oracle_text: "",
    mana_cost: "{3}{R}{G}",
    cmc: 5,
    colors: ["R", "G"],
    color_identity: ["R", "G"],
    power: "4",
    toughness: "4",
  });
}

/** CMC 2 creature (lower than Bloodbraid Elf's CMC 3 — should be cascaded). */
function cmc2Creature(): ScryfallCard {
  return makeCard({
    id: "cmc-2-creature",
    name: "Gnome",
    type_line: "Creature — Gnome",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    power: "1",
    toughness: "1",
  });
}

/** CMC 4 creature (higher than Bloodbraid Elf — should go to graveyard). */
function cmc4Creature(): ScryfallCard {
  return makeCard({
    id: "cmc-4-creature",
    name: "Orc",
    type_line: "Creature — Orc",
    oracle_text: "",
    mana_cost: "{2}{R}{G}",
    cmc: 4,
    colors: ["R", "G"],
    color_identity: ["R", "G"],
    power: "3",
    toughness: "3",
  });
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function makeFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const ids = Array.from(state.players.keys());
  const aliceId = ids[0];
  const bobId = ids[1];

  state.status = "in_progress";
  state.priorityPlayerId = aliceId;
  state.turn.activePlayerId = aliceId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.turn.isFirstTurn = false;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-hand`;
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

/**
 * Place a card onto the top of the player's library (end of the cardIds array).
 * Library order: cardIds[0] = bottom, cardIds[cardIds.length - 1] = top.
 */
function putInLibrary(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-library`;
  state.cards.set(card.id, card);
  const lib = state.zones.get(`${playerId}-library`)!;
  state.zones.set(`${playerId}-library`, {
    ...lib,
    cardIds: [...lib.cardIds, card.id],
  });
  return card.id;
}

function libraryCardIds(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.zones.get(`${playerId}-library`)!.cardIds;
}

function exileIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-exile`)!.cardIds;
}

function graveyardIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)!.cardIds;
}

function stackCardIds(state: GameState): CardInstanceId[] {
  return state.stack
    .map((o) => o.sourceCardId)
    .filter(Boolean) as CardInstanceId[];
}

// ===========================================================================
// Parsing (CR 702.84)
// ===========================================================================

describe("Cascade — parsing (CR 702.84)", () => {
  it("detects cascade keyword", () => {
    const r = parseCascade("Haste. Cascade.");
    expect(r.hasCascade).toBe(true);
    expect(r.description).toBe("Cascade");
  });

  it("detects cascade in complex oracle text", () => {
    const r = parseCascade(
      "Flying. Hexproof. Cascade. When Blighted Agent deals combat damage to a player, you may put a curse counter on a permanent that player controls.",
    );
    expect(r.hasCascade).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseCascade("cascade.").hasCascade).toBe(true);
    expect(parseCascade("CASCADE.").hasCascade).toBe(true);
    expect(parseCascade("CaScAdE.").hasCascade).toBe(true);
  });

  it("returns false when cascade is absent", () => {
    expect(parseCascade("Haste. Flying.").hasCascade).toBe(false);
    expect(parseCascade("").hasCascade).toBe(false);
    expect(parseCascade("Flashback {2}{R}").hasCascade).toBe(false);
  });

  it("does not match 'cascade' inside other words", () => {
    expect(parseCascade("decadence").hasCascade).toBe(false);
    expect(parseCascade("concatenate").hasCascade).toBe(false);
  });
});

// ===========================================================================
// Keyword detection helpers
// ===========================================================================

describe("Cascade — keyword detection helpers", () => {
  it("hasCascade returns true for a card with cascade", () => {
    const card = createCardInstance(bloodbraidElf(), "p1", "p1");
    expect(hasCascade(card)).toBe(true);
  });

  it("hasCascade returns false for a card without cascade", () => {
    const card = createCardInstance(cmc2Creature(), "p1", "p1");
    expect(hasCascade(card)).toBe(false);
  });
});

// ===========================================================================
// Cascade resolution (CR 702.84a)
// ===========================================================================

describe("Cascade — resolution (CR 702.84a)", () => {
  let f: Fixture;
  let bloodbraidId: CardInstanceId;
  let cmc5Id: CardInstanceId;
  let cmc2Id: CardInstanceId;
  let cmc4Id: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();

    bloodbraidId = putInHand(f.state, f.aliceId, bloodbraidElf());
    cmc4Id = putInLibrary(f.state, f.aliceId, cmc4Creature());
    cmc2Id = putInLibrary(f.state, f.aliceId, cmc2Creature());
    cmc5Id = putInLibrary(f.state, f.aliceId, cmc5Creature());

    f.state = addMana(f.state, f.aliceId, { red: 1, green: 1, generic: 10 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  /**
   * Bloodbraid Elf scenario from issue #1909:
   *
   * Library top-to-bottom (reveal order): cmc5 (top), cmc2, cmc4 (bottom)
   * (cardIds array: [cmc4, cmc2, cmc5] with cmc5 at the end = top).
   *
   * When Bloodbraid Elf (CMC 3) cascade triggers:
   * 1. Reveal cmc5 (5 > 3) → exile 5
   * 2. Reveal cmc2 (2 < 3) → cast 2 for free
   * 3. cmc4 stays in library (revealed after the cast card → graveyard)
   */
  it("Bloodbraid Elf cascade: exile higher-CMC cards, cast lower-CMC card for free, rest go to graveyard", () => {
    const initialLibrary = libraryCardIds(f.state, f.aliceId);
    expect(initialLibrary).toContain(cmc5Id);
    expect(initialLibrary).toContain(cmc2Id);
    expect(initialLibrary).toContain(cmc4Id);

    const castResult = castSpell(
      f.state,
      f.aliceId,
      bloodbraidId,
      [],
      [],
      0,
      false,
    );
    expect(castResult.success).toBe(true);
    expect(castResult.state.stack.length).toBeGreaterThan(0);
    expect(
      castResult.state.stack[castResult.state.stack.length - 1].cascade,
    ).toBe(true);

    const resolvedState = resolveTopOfStack(castResult.state);

    const exile = exileIds(resolvedState, f.aliceId);
    expect(exile).toContain(cmc4Id);

    const grave = graveyardIds(resolvedState, f.aliceId);
    expect(grave).toContain(cmc4Id);

    const newLibrary = libraryCardIds(resolvedState, f.aliceId);
    expect(newLibrary).not.toContain(cmc4Id);
  });

  it("cascade result: exactly one cascaded spell is on the stack after resolution", () => {
    const castResult = castSpell(
      f.state,
      f.aliceId,
      bloodbraidId,
      [],
      [],
      0,
      false,
    );
    const resolvedState = resolveTopOfStack(castResult.state);

    const stackSpells = resolvedState.stack.filter(
      (o) => o.type === "spell" && o.sourceCardId !== bloodbraidId,
    );
    expect(stackSpells.length).toBeGreaterThanOrEqual(1);

    const cascadedSpell = stackSpells.find((o) => o.sourceCardId === cmc2Id);
    expect(cascadedSpell).toBeDefined();
  });

  it("cascade does not fire for a non-cascade spell", () => {
    const nonCascadeId = putInHand(f.state, f.aliceId, cmc2Creature());

    const castResult = castSpell(
      f.state,
      f.aliceId,
      nonCascadeId,
      [],
      [],
      0,
      false,
    );
    expect(castResult.success).toBe(true);

    const resolvedState = resolveTopOfStack(castResult.state);

    expect(resolvedState.stack.length).toBe(0);
  });
});
