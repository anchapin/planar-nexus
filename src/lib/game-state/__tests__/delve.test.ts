/**
 * @fileoverview Unit tests for the Delve keyword (CR 702.61).
 *
 * Issue #1407 — [Rules Engine] Implement Delve (CR 702.61)
 * exile-graveyard-cards-to-pay alternative cost.
 *
 * Delve is a static ability that functions while the spell with delve is on
 * the stack. "For each card you exile from your graveyard while casting this
 * spell, you may pay {1} rather than pay that card's mana cost."
 *
 * CR 702.61a — each card exiled from the caster's graveyard reduces the
 * GENERIC portion of the spell's cost by {1}. Delve CANNOT pay colored pips
 * (this is the key difference from Convoke, CR 702.93).
 *
 * NOTE on issue text: the issue title says "colored-pips" but the ACTUAL CR
 * 702.61a is generic-only. These tests assert the correct, CR-faithful
 * generic-reduction behaviour and document the deviation in the PR body.
 *
 * Coverage: parsing, the alternative-cost switch branch in `castSpell`, the
 * generic-cost-reduction semantics per CR 702.61a, validation rules (in
 * graveyard, controller, no duplicates), the post-cast exile state
 * (graveyard shrinks, exile grows, currentZoneKey updated), combinations
 * with mana in the pool, the "not enough energy" fall-through, over-exiling
 * (wasted cards), the colored-pips-still-required invariant, and the
 * validation-service bypass for the printed-cost precheck.
 */

import { describe, it, expect } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { parseDelve } from "../oracle-text-parser";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/**
 * Treasure Cruise — the canonical delve card. {7}{U}{U} = 8 mana value, 6
 * generic + 2 blue pips. With 6 cards in the graveyard, delve can reduce it
 * to {U}{U}.
 */
function treasureCruise(): ScryfallCard {
  return makeCard({
    id: "mock-treasure-cruise",
    name: "Treasure Cruise",
    type_line: "Sorcery",
    oracle_text: "Delve\nDraw three cards.",
    mana_cost: "{7}{U}{U}",
    cmc: 8,
    colors: ["U"],
    color_identity: ["U"],
    keywords: ["delve"],
  });
}

/** Same cost as Treasure Cruise but WITHOUT the Delve keyword. */
function nonDelveSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-non-delve",
    name: "Big Draw",
    type_line: "Sorcery",
    oracle_text: "Draw three cards.",
    mana_cost: "{7}{U}{U}",
    cmc: 8,
    colors: ["U"],
    color_identity: ["U"],
  });
}

/** A cheap delve spell with mixed generic + colored: {2}{U} (1 colored pip). */
function cheapDelve(): ScryfallCard {
  return makeCard({
    id: "mock-logic-of-the-goblin",
    name: "Cheap Delve",
    type_line: "Instant",
    oracle_text: "Delve\nDraw a card.",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
    keywords: ["delve"],
  });
}

/** A generic-only delve spell: {6}{B}{B}. */
function murderousCut(): ScryfallCard {
  return makeCard({
    id: "mock-murderous-cut",
    name: "Murderous Cut",
    type_line: "Instant",
    oracle_text: "Delve\nDestroy target creature.",
    mana_cost: "{6}{B}{B}",
    cmc: 8,
    colors: ["B"],
    color_identity: ["B"],
    keywords: ["delve"],
  });
}

/** A filler card to populate the graveyard (cheap instant). */
function fillerCard(id: string): ScryfallCard {
  return makeCard({
    id,
    name: `Filler ${id}`,
    type_line: "Instant",
    oracle_text: "Draw a card.",
    mana_cost: "{U}",
    cmc: 1,
    colors: ["U"],
    color_identity: ["U"],
  });
}

// ---------------------------------------------------------------------------
// Shared state scaffolding
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
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

/** Place a card into a player's hand. */
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

/** Place a card into a player's graveyard. */
function putInGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-graveyard`;
  state.cards.set(card.id, card);
  const grave = state.zones.get(`${playerId}-graveyard`)!;
  state.zones.set(`${playerId}-graveyard`, {
    ...grave,
    cardIds: [...grave.cardIds, card.id],
  });
  return card;
}

/** Read a player's mana pool total (for spent-mana assertions). */
function manaTotal(state: GameState, playerId: PlayerId): number {
  const p = state.players.get(playerId)!;
  return (
    p.manaPool.generic +
    p.manaPool.colorless +
    p.manaPool.white +
    p.manaPool.blue +
    p.manaPool.black +
    p.manaPool.red +
    p.manaPool.green
  );
}

// ===========================================================================
// Parsing (CR 702.61)
// ===========================================================================

describe("Delve — parsing (CR 702.61)", () => {
  it("parseDelve detects the 'Delve' keyword", () => {
    const r = parseDelve("Delve");
    expect(r.hasDelve).toBe(true);
    expect(r.description).toBe("Delve");
  });

  it("parseDelve detects 'Delve' alongside other rules text", () => {
    expect(parseDelve("Delve\nDraw three cards.").hasDelve).toBe(true);
  });

  it("parseDelve is case-insensitive", () => {
    expect(parseDelve("delve").hasDelve).toBe(true);
    expect(parseDelve("DELVE").hasDelve).toBe(true);
    expect(parseDelve("DeLvE").hasDelve).toBe(true);
  });

  it("parseDelve tolerates the reminder-text form", () => {
    expect(
      parseDelve(
        "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)",
      ).hasDelve,
    ).toBe(true);
  });

  it("parseDelve returns false when the keyword is absent", () => {
    expect(parseDelve("Flying").hasDelve).toBe(false);
    expect(parseDelve("Flashback {2}{U}").hasDelve).toBe(false);
    expect(parseDelve("Convoke").hasDelve).toBe(false);
  });

  it("parseDelve returns false for empty / nullish text", () => {
    expect(parseDelve("").hasDelve).toBe(false);
    expect(parseDelve("").description).toBe("");
    expect(parseDelve(null as unknown as string).hasDelve).toBe(false);
  });

  it("parseDelve does not match 'delve' inside other words", () => {
    // Word-boundary anchored: "delved" is its own word and should NOT match
    // "delve". The word-boundary regex catches this.
    expect(parseDelve("delved").hasDelve).toBe(false);
    expect(parseDelve("nondelveing").hasDelve).toBe(false);
  });
});

// ===========================================================================
// castSpell — the alternative-cost switch branch (CR 702.61)
// ===========================================================================

describe("Delve — castSpell generic-cost reduction (CR 702.61a)", () => {
  it("each exiled graveyard card reduces the generic cost by {1}", () => {
    // Treasure Cruise {7}{U}{U}. Alice exiles 7 cards to cover all 7 generic
    // pips; remaining {U}{U} paid from pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    const after = result.state;
    // Spell on the stack.
    expect(after.zones.get("stack")!.cardIds).toContain(spellId);
    // All 7 graveyard cards exiled.
    const aliceGrave = after.zones.get(`${aliceId}-graveyard`)!;
    const aliceExile = after.zones.get(`${aliceId}-exile`)!;
    for (const gid of graveIds) {
      expect(aliceGrave.cardIds).not.toContain(gid);
      expect(aliceExile.cardIds).toContain(gid);
    }
    // alternativeCostsUsed recorded delve.
    expect(after.stack[0].alternativeCostsUsed).toContain("delve");
    // Mana pool: 2 blue spent on the {U}{U} pips → 0 blue.
    expect(after.players.get(aliceId)!.manaPool.blue).toBe(0);
  });

  it("delve can reduce the entire generic portion with no mana in the pool", () => {
    // Murderous Cut {6}{B}{B}. Alice exiles 6 cards to cover all generic
    // pips, pays {B}{B} from pool. Generic pool contribution = 0.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, murderousCut());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 6; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { black: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    // Generic pool untouched (was 0; delve covered all 6 generic).
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.black).toBe(0);
  });

  it("delve combines with mana already in the pool for the generic portion", () => {
    // Treasure Cruise {7}{U}{U}. Alice exiles 4 cards (-4 generic), pays the
    // remaining {3}{U}{U} from the pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 4; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 2, generic: 3 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    expect(result.state.players.get(aliceId)!.manaPool.blue).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
  });

  it("delve with empty delveCards uses only the mana pool", () => {
    // Same as casting without delve — full cost paid from pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    // 1 grave card available but not declared.
    putInGraveyard(state, aliceId, fillerCard("g-0"));
    state = addMana(state, aliceId, { blue: 2, generic: 7 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [],
    });

    expect(result.success).toBe(true);
    // The available (but undeclared) card stays in the graveyard.
    const aliceGrave = result.state.zones.get(`${aliceId}-graveyard`)!;
    expect(aliceGrave.cardIds.length).toBe(1);
    // Full {7}{U}{U} paid from pool.
    expect(result.state.players.get(aliceId)!.manaPool.blue).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
    // alternativeCostsUsed still records delve (the branch pushed it) but
    // no cards were exiled.
    expect(result.state.stack[0].alternativeCostsUsed).toContain("delve");
  });

  it("spells WITHOUT the Delve keyword are not reduced even when delveCards is passed", () => {
    // The delve switch branch only fires when parseDelve returns true.
    // Otherwise the keyword is silently dropped (matches the engine's
    // established convention inherited from convoke).
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, nonDelveSorcery());
    const g = putInGraveyard(state, aliceId, fillerCard("g-0"));
    // Pool covers the FULL printed {7}{U}{U} cost — castSpell must NOT use
    // the grave card since the spell lacks the Delve keyword.
    state = addMana(state, aliceId, { blue: 2, generic: 7 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [g.id],
    });

    // Cast succeeds because the pool covers the full printed cost — the
    // grave card is NOT exiled.
    expect(result.success).toBe(true);
    expect(result.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
      g.id,
    );
    expect(result.state.zones.get(`${aliceId}-exile`)!.cardIds).not.toContain(
      g.id,
    );
    expect(result.state.stack[0].alternativeCostsUsed).not.toContain("delve");
  });
});

// ===========================================================================
// castSpell — CR 702.61a "generic only" invariant (deviation from issue text)
// ===========================================================================

describe("Delve — colored pips are NOT payable by delve (CR 702.61a)", () => {
  it("delve cannot pay colored pips — colored mana must come from the pool", () => {
    // Treasure Cruise {7}{U}{U}. Alice exiles 7 cards but only has 1 blue in
    // the pool (needs {U}{U}). Cast must FAIL on the second blue pip —
    // delve cannot pay colored pips.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/energy/i);
    // Failure: no state mutation. Graveyard intact.
    for (const gid of graveIds) {
      expect(result.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
        gid,
      );
    }
  });

  it("delve does not produce a negative generic cost (over-exile wastes cards but reduces nothing beyond 0)", () => {
    // Cheap Delve {2}{U}. Alice exiles 5 cards but the generic portion is
    // only 2. The cast should still succeed (all 5 exiled, generic reduced
    // by exactly 2, {U} paid from pool). The 3 extra cards are wasted.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, cheapDelve());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 5; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    const after = result.state;
    // ALL 5 cards exiled (over-exile is binding per CR 601.2h).
    const aliceExile = after.zones.get(`${aliceId}-exile`)!;
    for (const gid of graveIds) {
      expect(aliceExile.cardIds).toContain(gid);
    }
    expect(aliceExile.cardIds.length).toBe(5);
    // Blue pip paid from pool.
    expect(after.players.get(aliceId)!.manaPool.blue).toBe(0);
  });
});

// ===========================================================================
// castSpell — affordability fall-through
// ===========================================================================

describe("Delve — affordability fall-through", () => {
  it("insufficient delve + insufficient mana → 'Not enough energy'", () => {
    // Treasure Cruise {7}{U}{U} = 9 pips. Alice exiles only 3 cards and has
    // no mana. Remaining {4}{U}{U} cannot be paid.
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 3; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/energy/i);
    // State returned unchanged on failure — graveyard intact, exile empty.
    const aliceGrave = result.state.zones.get(`${aliceId}-graveyard`)!;
    const aliceExile = result.state.zones.get(`${aliceId}-exile`)!;
    for (const gid of graveIds) {
      expect(aliceGrave.cardIds).toContain(gid);
    }
    expect(aliceExile.cardIds.length).toBe(0);
  });

  it("delve cannot pay colored pips — not-enough-colored-mana fails even with a full graveyard", () => {
    // Treasure Cruise {7}{U}{U}. Alice exiles 7 cards but has NO blue mana.
    // The {U}{U} pips cannot be paid by delve → failure.
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/energy/i);
  });
});

// ===========================================================================
// castSpell — validation rules (CR 702.61a)
// ===========================================================================

describe("Delve — validation rules (CR 702.61a)", () => {
  it("rejects a duplicate graveyard card in the exile list", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, cheapDelve());
    const g = putInGraveyard(state, aliceId, fillerCard("g-0"));

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [g.id, g.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/more than once/i);
  });

  it("rejects a card that is not in the graveyard (in hand)", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, cheapDelve());
    // A card in hand (not in graveyard).
    const inHand = putInHand(state, aliceId, fillerCard("c-hand"));

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [inHand],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/graveyard/i);
  });

  it("rejects a card in the opponent's graveyard", () => {
    const { state, aliceId, bobId } = makeFixture();
    const spellId = putInHand(state, aliceId, cheapDelve());
    // Bob's graveyard card.
    const bobs = putInGraveyard(state, bobId, fillerCard("bob-g-0"));

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [bobs.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/graveyard|controller/i);
  });

  it("rejects a card id that does not exist", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, cheapDelve());

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: ["nonexistent-id" as CardInstanceId],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ===========================================================================
// castSpell — post-cast state invariants
// ===========================================================================

describe("Delve — post-cast state invariants", () => {
  it("delved cards move graveyard → exile (CR 702.61a, permanent exile)", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 2 });

    const beforeGrave = state.zones.get(`${aliceId}-graveyard`)!.cardIds.length;
    const beforeExile = state.zones.get(`${aliceId}-exile`)!.cardIds.length;
    expect(beforeGrave).toBe(7);
    expect(beforeExile).toBe(0);

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    const after = result.state;
    // Graveyard shrunk by 7.
    expect(after.zones.get(`${aliceId}-graveyard`)!.cardIds.length).toBe(0);
    // Exile grew by 7.
    expect(after.zones.get(`${aliceId}-exile`)!.cardIds.length).toBe(7);
    // Each card's currentZoneKey updated to exile.
    for (const gid of graveIds) {
      expect(after.cards.get(gid)!.currentZoneKey).toBe(`${aliceId}-exile`);
    }
  });

  it("the spell stack object records 'delve' in alternativeCostsUsed", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, cheapDelve());
    const g1 = putInGraveyard(state, aliceId, fillerCard("g-1"));
    const g2 = putInGraveyard(state, aliceId, fillerCard("g-2"));
    state = addMana(state, aliceId, { blue: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [g1.id, g2.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("delve");
  });

  it("graveyard cards NOT in the delve list stay in the graveyard", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, cheapDelve());
    const exiled = putInGraveyard(state, aliceId, fillerCard("g-exiled"));
    const idle = putInGraveyard(state, aliceId, fillerCard("g-idle"));
    state = addMana(state, aliceId, { blue: 1, generic: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [exiled.id],
    });

    expect(result.success).toBe(true);
    const after = result.state;
    // The exiled card went to exile.
    expect(after.zones.get(`${aliceId}-exile`)!.cardIds).toContain(exiled.id);
    // The idle (undeclared) card stayed in the graveyard.
    expect(after.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(idle.id);
  });

  it("a single delve card reduces exactly one generic pip", () => {
    // Cheap Delve {2}{U}. Alice exiles 1 card (-1 generic), pays {1}{U} from
    // the pool. Proves the per-card reduction is exactly 1 (not 0, not >1).
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, cheapDelve());
    const g = putInGraveyard(state, aliceId, fillerCard("g-0"));
    state = addMana(state, aliceId, { blue: 1, generic: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: [g.id],
    });

    expect(result.success).toBe(true);
    // {1}{U} paid from pool → both 0.
    expect(result.state.players.get(aliceId)!.manaPool.blue).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
  });
});

// ===========================================================================
// Validation service — printed-cost precheck bypass
// ===========================================================================

describe("Delve — validation-service bypass", () => {
  it("the printed-cost precheck does NOT reject a legal delve cast", () => {
    // The validation service's pre-check would normally reject a {7}{U}{U}
    // cast when the player's pool only covers {U}{U}. For delve, the
    // pre-check is bypassed so castSpell can do the authoritative math
    // after applying delve reductions. If the bypass is missing, this test
    // fails with a "Not enough mana" reason from the validation service.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, treasureCruise());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) {
      graveIds.push(putInGraveyard(state, aliceId, fillerCard(`g-${i}`)).id);
    }
    state = addMana(state, aliceId, { blue: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
