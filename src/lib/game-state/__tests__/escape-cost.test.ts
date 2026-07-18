/**
 * @fileoverview Unit tests for the Escape keyword (CR 702.138).
 *
 * Issue #1409 — [Rules Engine] Wire Escape alternative-cost branch into
 * castSpell (CR 702.138).
 *
 * Escape (CR 702.138):
 * - 702.138a: "Escape—[cost], Exile N other cards from your graveyard" is a
 *   static ability that functions while the card is in its owner's
 *   graveyard. It offers an alternative cost: the spell's controller may
 *   pay [cost] rather than the printed mana cost AND exile N OTHER cards
 *   from their graveyard as a mandatory additional cost. The card itself
 *   is not an eligible exile target.
 * - 702.138b: Casting for the escape cost follows the rules for
 *   alternative costs. The spell's mana value is unchanged; other
 *   additional costs/taxes still apply (same treatment as
 *   Blitz/Foretell/Spectacle).
 * - 702.138c: If a resolving spell cast with escape would be put into a
 *   zone other than the stack or the battlefield, exile it instead.
 *
 * These tests cover: parsing (parseEscape / parseAlternativeCost), the
 * alternative-cost cast path (mana spend + CMC unchanged), the N-exile
 * cost (exactly N OTHER graveyard cards moved to exile), insufficient-
 * exile rejection, resolution-to-exile, copy preservation (no double-
 * subtract), and replay determinism.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  castSpell,
  resolveTopOfStack,
  copySpellOnStack,
} from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseEscape,
  parseEscapeExileCount,
  parseAlternativeCost,
  AlternativeCostType,
} from "../oracle-text-parser";
import { Phase } from "../types";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Sorcery",
    oracle_text: "",
    mana_cost: "{3}{B}{B}",
    cmc: 5,
    colors: ["B"],
    color_identity: ["B"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/**
 * An escape sorcery. Printed mana cost {3}{B}{B} (mana value 5); escape
 * cost {1}{B}, exile THREE other cards. Oracle text intentionally avoids
 * "Choose one"/"•" markers so the modal-spell detector in `castSpell`
 * does not require a mode selection; the escape keyword + exile clause is
 * what matters for these tests.
 */
function escapeSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-escape-sorcery",
    name: "Sonic Assault",
    type_line: "Sorcery",
    oracle_text:
      "Escape—{1}{B}, Exile three other cards from your graveyard.\nTarget creature gets -4/-4 until end of turn.",
    mana_cost: "{3}{B}{B}",
    cmc: 5,
  });
}

/** Variant escape sorcery with a digit-form exile count. */
function escapeSorceryDigitN(): ScryfallCard {
  return makeCard({
    id: "mock-escape-sorcery-digit",
    name: "Chrome Courier Clone",
    type_line: "Sorcery",
    oracle_text:
      "Escape—{3}{R}{W}, Exile 5 other cards from your graveyard.\nDo something.",
    mana_cost: "{4}{R}{W}",
    cmc: 6,
  });
}

/** Variant escape sorcery with no explicit exile clause (defaults to N=4). */
function escapeSorceryNoN(): ScryfallCard {
  return makeCard({
    id: "mock-escape-sorcery-non",
    name: "Legacy Escape",
    type_line: "Sorcery",
    oracle_text: "Escape—{2}{R}",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
  });
}

/** A simple instant sorcery used as graveyard filler (not escape-eligible). */
function fillerCard(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `mock-filler-${idSuffix}`,
    name: `Filler ${idSuffix}`,
    type_line: "Sorcery",
    oracle_text: "Draw a card.",
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
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

/** Place a card into a player's graveyard and the global card map. */
function putInGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const grave = state.zones.get(`${playerId}-graveyard`)!;
  state.zones.set(`${playerId}-graveyard`, {
    ...grave,
    cardIds: [...grave.cardIds, card.id],
  });
  // Keep currentZoneKey in sync so isOnBattlefield-style O(1) lookups agree.
  card.currentZoneKey = `${playerId}-graveyard`;
  return card.id;
}

// ===========================================================================
// Parsing — parseEscape / parseEscapeExileCount / parseAlternativeCost
// ===========================================================================

describe("Escape — parsing (CR 702.138)", () => {
  it("parseEscape detects 'Escape—{cost}' with em dash", () => {
    const r = parseEscape("Escape—{1}{B}");
    expect(r.hasEscape).toBe(true);
    expect(r.escapeCost).not.toBeNull();
    expect(r.escapeCost!.generic).toBe(1);
    expect(r.escapeCost!.black).toBe(1);
    expect(r.description).toBe("Escape {1}{B}");
  });

  it("parseEscape tolerates en dash and hyphen separators", () => {
    expect(parseEscape("Escape–{2}{R}").hasEscape).toBe(true);
    expect(parseEscape("Escape-{3}{G}").hasEscape).toBe(true);
  });

  it("parseEscape is case-insensitive", () => {
    expect(parseEscape("escape—{2}{R}").hasEscape).toBe(true);
    expect(parseEscape("ESCAPE—{3}").hasEscape).toBe(true);
  });

  it("parseEscape returns false when the keyword is absent", () => {
    expect(parseEscape("Flying").hasEscape).toBe(false);
    expect(parseEscape("Flashback {2}{R}").hasEscape).toBe(false);
    expect(parseEscape("").hasEscape).toBe(false);
    expect(parseEscape("").escapeCost).toBeNull();
  });

  it("parseEscape does not match 'escape' inside other words", () => {
    // Word-boundary anchored: "escapedout" should not match.
    expect(parseEscape("escapedout—{1}{R}").hasEscape).toBe(false);
  });

  it("parseEscapeExileCount parses spelled-out English numbers", () => {
    expect(
      parseEscapeExileCount(
        "Escape—{1}{B}, Exile three other cards from your graveyard.",
      ),
    ).toBe(3);
    expect(
      parseEscapeExileCount(
        "Escape—{1}{B}, Exile four other cards from your graveyard.",
      ),
    ).toBe(4);
    expect(
      parseEscapeExileCount(
        "Escape—{1}{B}, Exile seven other cards from your graveyard.",
      ),
    ).toBe(7);
  });

  it("parseEscapeExileCount parses Arabic digits", () => {
    expect(
      parseEscapeExileCount(
        "Escape—{3}{R}{W}, Exile 5 other cards from your graveyard.",
      ),
    ).toBe(5);
    expect(
      parseEscapeExileCount(
        "Escape—{2}{U}, Exile 6 other cards from your graveyard.",
      ),
    ).toBe(6);
  });

  it("parseEscapeExileCount returns the default N when no clause is present", () => {
    expect(parseEscapeExileCount("Escape—{2}{R}")).toBe(4);
    expect(parseEscapeExileCount("")).toBe(4);
  });

  it("parseEscape exposes exileCount from the oracle text", () => {
    expect(
      parseEscape("Escape—{1}{B}, Exile three other cards from your graveyard.")
        .exileCount,
    ).toBe(3);
    expect(
      parseEscape("Escape—{3}{R}{W}, Exile 5 other cards from your graveyard.")
        .exileCount,
    ).toBe(5);
    expect(parseEscape("Escape—{2}{R}").exileCount).toBe(4);
  });

  it("parseAlternativeCost recognizes escape and reports a dynamic exile requirement", () => {
    const r = parseAlternativeCost(
      "Escape—{1}{B}, Exile three other cards from your graveyard.",
    );
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.ESCAPE);
    expect(r.manaCost).not.toBeNull();
    expect(r.manaCost!.black).toBe(1);
    expect(r.description).toContain("Escape");
    expect(r.additionalRequirement).toBe(
      "Exile 3 other cards from your graveyard",
    );
  });

  it("parseAlternativeCost handles digit-form N", () => {
    const r = parseAlternativeCost(
      "Escape—{3}{R}{W}, Exile 5 other cards from your graveyard.",
    );
    expect(r.costType).toBe(AlternativeCostType.ESCAPE);
    expect(r.additionalRequirement).toBe(
      "Exile 5 other cards from your graveyard",
    );
  });

  it("parseAlternativeCost falls back to N=4 when no exile clause is present", () => {
    const r = parseAlternativeCost("Escape—{4}{R}");
    expect(r.costType).toBe(AlternativeCostType.ESCAPE);
    expect(r.additionalRequirement).toBe(
      "Exile 4 other cards from your graveyard",
    );
  });
});

// ===========================================================================
// Alternative-cost casting (CR 702.138a/b)
// ===========================================================================

describe("Escape — casting for the escape cost (CR 702.138a/b)", () => {
  let f: Fixture;
  let escapeCardId: CardInstanceId;
  let fillerIds: CardInstanceId[];

  beforeEach(() => {
    f = makeFixture();
    // Set up: Alice has the escape sorcery + 3 filler cards in graveyard.
    escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
    fillerIds = [
      putInGraveyard(f.state, f.aliceId, fillerCard("a")),
      putInGraveyard(f.state, f.aliceId, fillerCard("b")),
      putInGraveyard(f.state, f.aliceId, fillerCard("c")),
    ];
    // Enough mana for either the printed cost ({3}{B}{B} = 3 generic + 2 black)
    // or the escape cost ({1}{B} = 1 generic + 1 black).
    f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("castSpell with alternativeCost escape succeeds and records the cost used", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("escape");
  });

  it("pays the escape cost (not the printed mana cost)", () => {
    // Printed {3}{B}{B} = 3 generic + 2 black; escape {1}{B} = 1 generic + 1 black.
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // Spent exactly 1 generic + 1 black (the escape cost).
    expect(before.generic - after.generic).toBe(1);
    expect(before.black - after.black).toBe(1);
  });

  it("leaves the spell's mana value (printed mana_cost / cmc) unchanged (CR 702.138b)", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(true);
    // The StackObject keeps the printed mana_cost string, not the escape cost.
    expect(result.state.stack[0].manaCost).toBe("{3}{B}{B}");
    const card = result.state.cards.get(escapeCardId)!;
    expect(card.cardData.cmc).toBe(5);
  });

  it("exiles exactly N OTHER graveyard cards as part of paying the cost (CR 702.138a)", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(true);
    const exileIds = result.state.zones.get(`${f.aliceId}-exile`)!.cardIds;
    const graveIds = result.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds;
    // All three fillers are now in exile.
    for (const fid of fillerIds) {
      expect(exileIds).toContain(fid);
      expect(graveIds).not.toContain(fid);
    }
    // The escape card itself is NOT in exile (it moved to the stack).
    expect(exileIds).not.toContain(escapeCardId);
    // Each exiled card's currentZoneKey reflects its new home.
    for (const fid of fillerIds) {
      expect(result.state.cards.get(fid)!.currentZoneKey).toBe(
        `${f.aliceId}-exile`,
      );
    }
  });

  it("moves the escape card from graveyard onto the stack", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(true);
    const graveIds = result.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds;
    expect(graveIds).not.toContain(escapeCardId);
    expect(result.state.stack[0].sourceCardId).toBe(escapeCardId);
  });

  it("supports digit-form N in oracle text", () => {
    // Re-setup with the digit-N card. Needs 5 fillers.
    const localF = makeFixture();
    const digitCard = putInGraveyard(
      localF.state,
      localF.aliceId,
      escapeSorceryDigitN(),
    );
    const fiveFillers: CardInstanceId[] = [];
    for (let i = 0; i < 5; i++) {
      fiveFillers.push(
        putInGraveyard(localF.state, localF.aliceId, fillerCard(`d${i}`)),
      );
    }
    localF.state = addMana(localF.state, localF.aliceId, {
      red: 4,
      white: 4,
      generic: 12,
    });
    localF.state.priorityPlayerId = localF.aliceId;
    localF.state.turn.activePlayerId = localF.aliceId;
    localF.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

    const result = castSpell(
      localF.state,
      localF.aliceId,
      digitCard,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fiveFillers,
      },
    );
    expect(result.success).toBe(true);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("escape");
    // All 5 fillers exiled.
    const exileIds = result.state.zones.get(`${localF.aliceId}-exile`)!.cardIds;
    expect(exileIds).toEqual(expect.arrayContaining(fiveFillers));
  });

  it("supports the legacy 'no N clause' oracle form (default N=4)", () => {
    const localF = makeFixture();
    const noNCard = putInGraveyard(
      localF.state,
      localF.aliceId,
      escapeSorceryNoN(),
    );
    const fourFillers: CardInstanceId[] = [];
    for (let i = 0; i < 4; i++) {
      fourFillers.push(
        putInGraveyard(localF.state, localF.aliceId, fillerCard(`n${i}`)),
      );
    }
    localF.state = addMana(localF.state, localF.aliceId, {
      red: 4,
      generic: 12,
    });
    localF.state.priorityPlayerId = localF.aliceId;
    localF.state.turn.activePlayerId = localF.aliceId;
    localF.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

    const result = castSpell(
      localF.state,
      localF.aliceId,
      noNCard,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fourFillers,
      },
    );
    expect(result.success).toBe(true);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("escape");
    // 4 fillers exiled.
    const exileIds = result.state.zones.get(`${localF.aliceId}-exile`)!.cardIds;
    expect(exileIds).toEqual(expect.arrayContaining(fourFillers));
  });
});

// ===========================================================================
// Validation: insufficient exile targets (CR 702.138a)
// ===========================================================================

describe("Escape — validation (CR 702.138a)", () => {
  let f: Fixture;
  let escapeCardId: CardInstanceId;
  let fillerIds: CardInstanceId[];

  beforeEach(() => {
    f = makeFixture();
    escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
    fillerIds = [
      putInGraveyard(f.state, f.aliceId, fillerCard("a")),
      putInGraveyard(f.state, f.aliceId, fillerCard("b")),
      putInGraveyard(f.state, f.aliceId, fillerCard("c")),
    ];
    f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("is rejected with 'Not enough exile targets' when fewer than N OTHER cards are in graveyard", () => {
    // Manually reduce graveyard to just 2 fillers (N=3 required).
    const grave = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...grave,
      cardIds: grave.cardIds.filter((id) => id !== fillerIds[2]),
    });

    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enough exile targets/i);
  });

  it("is rejected when the declared exile list has fewer than N cards (graveyard has enough)", () => {
    // Graveyard has 3 fillers, but the caller declared only 2.
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exactly 3 other cards/i);
  });

  it("is rejected when the declared exile list has MORE than N cards", () => {
    const extra = putInGraveyard(f.state, f.aliceId, fillerCard("extra"));
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [...fillerIds, extra],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exactly 3 other cards/i);
  });

  it("is rejected when the declared exile list contains the escaping card itself", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [escapeCardId, fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /cannot be exiled to pay its own escape cost/i,
    );
  });

  it("is rejected when the declared exile list contains a duplicate", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [fillerIds[0], fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be exiled more than once/i);
  });

  it("is rejected when the declared exile list contains a non-graveyard card", () => {
    const handCard = createCardInstance(
      fillerCard("hand"),
      f.aliceId,
      f.aliceId,
    );
    f.state.cards.set(handCard.id, handCard);
    const hand = f.state.zones.get(`${f.aliceId}-hand`)!;
    f.state.zones.set(`${f.aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, handCard.id],
    });

    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [handCard.id, fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be in the caster's graveyard/i);
  });

  it("is rejected when the card being cast is NOT in graveyard (no escape from hand)", () => {
    // Move the escape card to Alice's hand.
    const grave = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...grave,
      cardIds: grave.cardIds.filter((id) => id !== escapeCardId),
    });
    const hand = f.state.zones.get(`${f.aliceId}-hand`)!;
    f.state.zones.set(`${f.aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, escapeCardId],
    });

    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: fillerIds,
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only be used.*from your graveyard/i);
  });

  it("does not perform any partial exile when validation fails (atomicity)", () => {
    // Declare 2 cards (needs 3): the cast must fail and NO cards should move.
    const graveBefore = f.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds
      .length;
    const exileBefore = f.state.zones.get(`${f.aliceId}-exile`)!.cardIds.length;

    const result = castSpell(
      f.state,
      f.aliceId,
      escapeCardId,
      [],
      [],
      0,
      false,
      {
        type: "escape",
        escapeExileCards: [fillerIds[0], fillerIds[1]],
      },
    );
    expect(result.success).toBe(false);

    const graveAfter = result.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds
      .length;
    const exileAfter = result.state.zones.get(`${f.aliceId}-exile`)!.cardIds
      .length;
    expect(graveAfter).toBe(graveBefore);
    expect(exileAfter).toBe(exileBefore);
  });
});

// ===========================================================================
// Resolution: escaped instant/sorcery → exile (CR 702.138c)
// ===========================================================================

describe("Escape — resolution (CR 702.138c)", () => {
  let f: Fixture;
  let escapeCardId: CardInstanceId;
  let fillerIds: CardInstanceId[];

  beforeEach(() => {
    f = makeFixture();
    escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
    fillerIds = [
      putInGraveyard(f.state, f.aliceId, fillerCard("a")),
      putInGraveyard(f.state, f.aliceId, fillerCard("b")),
      putInGraveyard(f.state, f.aliceId, fillerCard("c")),
    ];
    f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("on resolution, an escaped instant/sorcery moves to exile (not graveyard)", () => {
    const cast = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
      type: "escape",
      escapeExileCards: fillerIds,
    });
    expect(cast.success).toBe(true);
    expect(cast.state.stack.length).toBe(1);

    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.stack.length).toBe(0);
    // The escaped card is in exile, NOT in the graveyard.
    expect(resolved.zones.get(`${f.aliceId}-exile`)!.cardIds).toContain(
      escapeCardId,
    );
    expect(resolved.zones.get(`${f.aliceId}-graveyard`)!.cardIds).not.toContain(
      escapeCardId,
    );
  });

  it("a normally-cast sorcery (no escape) still goes to graveyard", () => {
    // Set up: put a fresh sorcery in hand for Alice.
    const inHand = createCardInstance(escapeSorcery(), f.aliceId, f.aliceId);
    f.state.cards.set(inHand.id, inHand);
    const hand = f.state.zones.get(`${f.aliceId}-hand`)!;
    f.state.zones.set(`${f.aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, inHand.id],
    });

    // Cast without alternativeCost — pays printed {3}{B}{B}.
    const cast = castSpell(f.state, f.aliceId, inHand.id);
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);
    // Standard resolution: graveyard, NOT exile.
    expect(resolved.zones.get(`${f.aliceId}-graveyard`)!.cardIds).toContain(
      inHand.id,
    );
    expect(resolved.zones.get(`${f.aliceId}-exile`)!.cardIds).not.toContain(
      inHand.id,
    );
  });

  it("cost-exiled fillers stay exiled through resolution", () => {
    const cast = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
      type: "escape",
      escapeExileCards: fillerIds,
    });
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);
    // All 3 fillers stay in exile (escape-cost exile is permanent — CR 702.138a).
    const exileIds = resolved.zones.get(`${f.aliceId}-exile`)!.cardIds;
    for (const fid of fillerIds) {
      expect(exileIds).toContain(fid);
    }
    const graveIds = resolved.zones.get(`${f.aliceId}-graveyard`)!.cardIds;
    for (const fid of fillerIds) {
      expect(graveIds).not.toContain(fid);
    }
  });
});

// ===========================================================================
// Copy interaction: copies do NOT re-subtract the exile cost (CR 707.10)
// ===========================================================================

describe("Escape — copy interaction (CR 707.10 + 702.138)", () => {
  let f: Fixture;
  let escapeCardId: CardInstanceId;
  let fillerIds: CardInstanceId[];

  beforeEach(() => {
    f = makeFixture();
    escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
    fillerIds = [
      putInGraveyard(f.state, f.aliceId, fillerCard("a")),
      putInGraveyard(f.state, f.aliceId, fillerCard("b")),
      putInGraveyard(f.state, f.aliceId, fillerCard("c")),
    ];
    f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("copying an escaped spell does NOT re-exile graveyard cards", () => {
    // Cast the escape spell first.
    const cast = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
      type: "escape",
      escapeExileCards: fillerIds,
    });
    expect(cast.success).toBe(true);

    const exileBefore = cast.state.zones.get(`${f.aliceId}-exile`)!.cardIds
      .length;
    const graveBefore = cast.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds
      .length;

    // Copy the spell on the stack (e.g. Twincast / Storm effect).
    const copyResult = copySpellOnStack(cast.state, cast.state.stack[0].id);
    expect(copyResult.success).toBe(true);
    expect(copyResult.state.stack.length).toBe(2);
    expect(copyResult.copiedStackObjectId).toBeDefined();

    // The copy is marked isCopy: true.
    const copy = copyResult.state.stack.find(
      (o) => o.id === copyResult.copiedStackObjectId,
    )!;
    expect(copy.isCopy).toBe(true);
    // `alternativeCostsUsed` is preserved on the copy for introspection only.
    expect(copy.alternativeCostsUsed ?? []).toContain("escape");

    // NO graveyard cards were exiled by the copy.
    const exileAfter = copyResult.state.zones.get(`${f.aliceId}-exile`)!.cardIds
      .length;
    const graveAfter = copyResult.state.zones.get(`${f.aliceId}-graveyard`)!
      .cardIds.length;
    expect(exileAfter).toBe(exileBefore);
    expect(graveAfter).toBe(graveBefore);
  });

  it("resolving a copy of an escape spell ceases to exist (no card move)", () => {
    const cast = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
      type: "escape",
      escapeExileCards: fillerIds,
    });
    expect(cast.success).toBe(true);

    const copyResult = copySpellOnStack(cast.state, cast.state.stack[0].id);
    expect(copyResult.success).toBe(true);

    // Resolve the COPY first (LIFO — copy is on top of the stack).
    const resolved = resolveTopOfStack(copyResult.state);
    // One stack object (the original) remains.
    expect(resolved.stack.length).toBe(1);
    // The original escaped card is still on the stack (not moved by the copy's
    // resolution).
    expect(resolved.stack[0].sourceCardId).toBe(escapeCardId);
  });

  it("mana was spent exactly once (for the original cast), not for the copy", () => {
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const cast = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
      type: "escape",
      escapeExileCards: fillerIds,
    });
    expect(cast.success).toBe(true);
    const afterCast = cast.state.players.get(f.aliceId)!.manaPool;

    const copyResult = copySpellOnStack(cast.state, cast.state.stack[0].id);
    const afterCopy = copyResult.state.players.get(f.aliceId)!.manaPool;

    // Mana delta from cast = escape cost (1 generic + 1 black).
    expect(before.generic - afterCast.generic).toBe(1);
    expect(before.black - afterCast.black).toBe(1);
    // Copying did NOT spend any additional mana.
    expect(afterCopy.generic).toBe(afterCast.generic);
    expect(afterCopy.black).toBe(afterCast.black);
  });
});

// ===========================================================================
// Replay determinism
// ===========================================================================

describe("Escape — replay determinism", () => {
  it("casting for the escape cost is deterministic (identical setup → identical result)", () => {
    const runOnce = (): {
      success: boolean;
      stackLen: number;
      altCosts: string[];
      manaPool: unknown;
      exileCount: number;
      graveCount: number;
    } => {
      const f = makeFixture();
      const escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
      const fillers = [
        putInGraveyard(f.state, f.aliceId, fillerCard("a")),
        putInGraveyard(f.state, f.aliceId, fillerCard("b")),
        putInGraveyard(f.state, f.aliceId, fillerCard("c")),
      ];
      f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });

      const r = castSpell(f.state, f.aliceId, escapeCardId, [], [], 0, false, {
        type: "escape",
        escapeExileCards: fillers,
      });
      return {
        success: r.success,
        stackLen: r.state.stack.length,
        altCosts: r.state.stack[0]?.alternativeCostsUsed ?? [],
        manaPool: r.state.players.get(f.aliceId)?.manaPool,
        exileCount: r.state.zones.get(`${f.aliceId}-exile`)!.cardIds.length,
        graveCount: r.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds.length,
      };
    };

    const r1 = runOnce();
    const r2 = runOnce();
    expect(r2.success).toBe(r1.success);
    expect(r2.stackLen).toBe(r1.stackLen);
    expect(r2.altCosts).toEqual(r1.altCosts);
    expect(r2.manaPool).toEqual(r1.manaPool);
    expect(r2.exileCount).toBe(r1.exileCount);
    expect(r2.graveCount).toBe(r1.graveCount);

    // Spot-check the substantive invariant.
    expect(r1.success).toBe(true);
    expect(r1.altCosts).toContain("escape");
    expect(r1.exileCount).toBe(3); // 3 fillers exiled
  });

  it("resolving an escaped spell is deterministic", () => {
    const runOnce = (): {
      stackLen: number;
      escapeInExile: boolean;
      escapeInGrave: boolean;
    } => {
      const f = makeFixture();
      const escapeCardId = putInGraveyard(f.state, f.aliceId, escapeSorcery());
      const fillers = [
        putInGraveyard(f.state, f.aliceId, fillerCard("a")),
        putInGraveyard(f.state, f.aliceId, fillerCard("b")),
        putInGraveyard(f.state, f.aliceId, fillerCard("c")),
      ];
      f.state = addMana(f.state, f.aliceId, { black: 4, generic: 8 });

      const cast = castSpell(
        f.state,
        f.aliceId,
        escapeCardId,
        [],
        [],
        0,
        false,
        {
          type: "escape",
          escapeExileCards: fillers,
        },
      );
      const resolved = resolveTopOfStack(cast.state);
      return {
        stackLen: resolved.stack.length,
        escapeInExile: resolved.zones
          .get(`${f.aliceId}-exile`)!
          .cardIds.includes(escapeCardId),
        escapeInGrave: resolved.zones
          .get(`${f.aliceId}-graveyard`)!
          .cardIds.includes(escapeCardId),
      };
    };

    const r1 = runOnce();
    const r2 = runOnce();
    expect(r2).toEqual(r1);
    // Substantive invariant: escaped card ends in exile.
    expect(r1.escapeInExile).toBe(true);
    expect(r1.escapeInGrave).toBe(false);
  });
});
