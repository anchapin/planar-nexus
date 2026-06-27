/**
 * @fileoverview Unit tests for the Foretell keyword (CR 702.142).
 *
 * Issue #1060 — [Rules Engine] Implement Foretell alternate-cast mechanic
 * (CR 702.142).
 *
 * Foretell is a two-step mechanic:
 * - CR 702.142b (keyword action): Once per turn, on your turn, during a main
 *   phase while the stack is empty, you may pay {2} and exile a card from your
 *   hand face down. It becomes "foretold" — hidden from opponents, visible to
 *   you.
 * - CR 702.142c (alternate cast): On a later turn you may cast a foretold card
 *   from exile by paying its printed foretell cost (an alternative cost),
 *   revealing it as you cast it. The spell's mana value is unchanged.
 *
 * These tests cover: parsing (parseForetell / parseAlternativeCost), the
 * foretell action (exile face down, pay {2}, once-per-turn, timing, illegal
 * rejection), the zone helpers, the cast-for-foretell action (cast from exile,
 * pay foretell cost, reveal, later-turn restriction), and illegal-cast
 * rejection.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseForetell,
  parseAlternativeCost,
  extractKeywords,
  AlternativeCostType,
} from "../oracle-text-parser";
import { foretellCard, castForetoldCard } from "../keyword-actions";
import { isForetoldCard, getForetoldCardIds } from "../zones";
import { Phase, ZoneType } from "../types";
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
    type_line: "Creature — Goblin",
    oracle_text: "",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    power: "4",
    toughness: "4",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A card with Foretell. Printed mana cost {2}{U}{U} (mana value 4); foretell
 * cost {1}{U}. Used across the parsing, action, and casting tests.
 */
function foretellInstant(): ScryfallCard {
  return makeCard({
    id: "mock-foretell-instant",
    name: "Saw It Coming",
    type_line: "Instant",
    oracle_text: "Foretell {1}{U}",
    mana_cost: "{2}{U}{U}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
  });
}

/** A card WITHOUT Foretell, used to assert illegal-action rejection. */
function plainInstant(): ScryfallCard {
  return makeCard({
    id: "mock-plain-instant",
    name: "Cancel",
    type_line: "Instant",
    oracle_text: "Counter target spell.",
    mana_cost: "{1}{U}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  });
}

/** A cheap card used to populate a drawable library. */
function basicIsland(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `island-${idSuffix}`,
    name: "Island",
    type_line: "Basic Land — Island",
    oracle_text: "({T}: Add {U}.)",
    mana_cost: "",
    cmc: 0,
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

/** Place a card into a player's hand and the global card map. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

/** Hand size for a player. */
function handSize(state: GameState, playerId: PlayerId): number {
  return state.zones.get(`${playerId}-hand`)!.cardIds.length;
}

/** Exile IDs for a player. */
function exileIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-exile`)!.cardIds;
}

// ===========================================================================
// Parsing (CR 702.142)
// ===========================================================================

describe("Foretell — parsing (CR 702.142)", () => {
  it("parseForetell detects 'Foretell {cost}' and parses the cost", () => {
    const r = parseForetell("Foretell {1}{U}");
    expect(r.hasForetell).toBe(true);
    expect(r.foretellCost).not.toBeNull();
    expect(r.foretellCost!.generic).toBe(1);
    expect(r.foretellCost!.blue).toBe(1);
    expect(r.description).toBe("Foretell {1}{U}");
  });

  it("parseForetell is case-insensitive", () => {
    expect(parseForetell("foretell {2}{B}").hasForetell).toBe(true);
    expect(parseForetell("FORETELL {3}").hasForetell).toBe(true);
  });

  it("parseForetell returns false when the keyword is absent", () => {
    expect(parseForetell("Flying").hasForetell).toBe(false);
    expect(parseForetell("Flashback {2}{R}").hasForetell).toBe(false);
    expect(parseForetell("").hasForetell).toBe(false);
    expect(parseForetell("").foretellCost).toBeNull();
  });

  it("parseForetell does not match 'foretell' inside other words", () => {
    expect(parseForetell("foretelling").hasForetell).toBe(false);
  });

  it("parseAlternativeCost recognizes foretell as an alternative cost", () => {
    const r = parseAlternativeCost("Foretell {1}{U}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.FORETELL);
    expect(r.manaCost).not.toBeNull();
    expect(r.manaCost!.blue).toBe(1);
    expect(r.description).toContain("Foretell");
  });

  it("extractKeywords detects the foretell mechanic keyword", () => {
    const parsed = extractKeywords("Foretell {1}{U}", "Instant");
    expect(parsed.some((k) => k.keyword.includes("foretell"))).toBe(true);
  });
});

// ===========================================================================
// Foretell keyword action (CR 702.142b)
// ===========================================================================

describe("Foretell — keyword action: exile face down (CR 702.142b)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, foretellInstant());
    // Enough generic mana to pay the {2} foretell cost.
    f.state = addMana(f.state, f.aliceId, { generic: 5 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("foretellCard succeeds, pays {2}, and exiles the card face down", () => {
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const beforeHand = handSize(f.state, f.aliceId);

    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Card left the hand.
    expect(handSize(result.state, f.aliceId)).toBe(beforeHand - 1);
    // Card is now in Alice's exile.
    expect(exileIds(result.state, f.aliceId)).toContain(cardId);

    // The foretold marker and face-down flag are set, and the foretell turn is
    // recorded (for the later-turn cast restriction).
    const card = result.state.cards.get(cardId)!;
    expect(card.foretold).toBe(true);
    expect(card.isFaceDown).toBe(true);
    expect(card.foretoldTurn).toBe(f.state.turn.turnNumber);

    // Exactly {2} generic was spent.
    const after = result.state.players.get(f.aliceId)!.manaPool;
    expect(before.generic - after.generic).toBe(2);

    // The once-per-turn allowance was consumed.
    expect(result.state.players.get(f.aliceId)!.foretoldThisTurn).toBe(1);
  });

  it("isForetoldCard / getForetoldCardIds identify the foretold card", () => {
    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(true);

    const card = result.state.cards.get(cardId)!;
    expect(isForetoldCard(card)).toBe(true);
    // A plain exiled card is not foretold.
    const plainId = putInHand(result.state, f.aliceId, plainInstant());
    // Move it to exile face up via the generic exile helper path.
    const exileZone = result.state.zones.get(`${f.aliceId}-exile`)!;
    result.state.zones.set(`${f.aliceId}-exile`, {
      ...exileZone,
      cardIds: [...exileZone.cardIds, plainId],
    });
    expect(isForetoldCard(result.state.cards.get(plainId))).toBe(false);

    const foretoldIds = getForetoldCardIds(
      result.state.zones.get(`${f.aliceId}-exile`)!,
      result.state.cards,
    );
    expect(foretoldIds).toEqual([cardId]);
  });

  it("is limited to once per turn (CR 702.142b)", () => {
    const first = foretellCard(f.state, f.aliceId, cardId);
    expect(first.success).toBe(true);

    // Foretell a second card the same turn — must be rejected.
    const secondId = putInHand(first.state, f.aliceId, foretellInstant());
    const second = foretellCard(first.state, f.aliceId, secondId);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already foretold/i);
  });

  it("is rejected for a card without Foretell", () => {
    const plainId = putInHand(f.state, f.aliceId, plainInstant());
    const result = foretellCard(f.state, f.aliceId, plainId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/foretell/i);
  });

  it("is rejected when it is not your turn", () => {
    f.state.turn.activePlayerId = f.bobId;
    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/your turn/i);
  });

  it("is rejected outside a main phase", () => {
    f.state.turn.currentPhase = Phase.BEGIN_COMBAT;
    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/main phase/i);
  });

  it("is rejected when the stack is not empty", () => {
    f.state.stack = [
      {
        id: "dummy-stack-object",
        type: "spell",
        sourceCardId: null,
        controllerId: f.aliceId,
        name: "Dummy",
        text: "",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      },
    ];
    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/stack/i);
  });

  it("is rejected when there is not enough mana to pay {2}", () => {
    const poor: GameState = {
      ...f.state,
      players: new Map(f.state.players).set(f.aliceId, {
        ...f.state.players.get(f.aliceId)!,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 1,
        },
      }),
    };
    const result = foretellCard(poor, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mana/i);
  });

  it("is rejected when the player does not have priority", () => {
    f.state.priorityPlayerId = f.bobId;
    const result = foretellCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/priority/i);
  });
});

// ===========================================================================
// Cast a foretold card for its foretell cost (CR 702.142c)
// ===========================================================================

describe("Foretell — cast for the foretell cost (CR 702.142c)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, foretellInstant());
    f.state = addMana(f.state, f.aliceId, { generic: 5, blue: 5 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  /** Foretell `cardId` on the current turn, returning the post-foretell state. */
  function foretellOnCurrentTurn(): GameState {
    const r = foretellCard(f.state, f.aliceId, cardId);
    expect(r.success).toBe(true);
    return r.state;
  }

  /** Advance to a strictly later turn (CR 702.142c). */
  function advanceTurn(state: GameState): GameState {
    return {
      ...state,
      turn: { ...state.turn, turnNumber: state.turn.turnNumber + 1 },
    };
  }

  it("castForetoldCard casts from exile for the foretell cost and reveals it", () => {
    let state = foretellOnCurrentTurn();
    state = advanceTurn(state);
    // Fresh mana on the later turn (foretell cost {1}{U} = 1 generic + 1 blue).
    state = addMana(state, f.aliceId, { generic: 1, blue: 1 });
    state.priorityPlayerId = f.aliceId;
    state.turn.activePlayerId = f.aliceId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];

    const before = state.players.get(f.aliceId)!.manaPool;
    const result = castForetoldCard(state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("foretell");
    expect(result.state.stack[0].sourceCardId).toBe(cardId);

    // The spell is announced revealed: face up and no longer foretold.
    const card = result.state.cards.get(cardId)!;
    expect(card.isFaceDown).toBe(false);
    expect(card.foretold).toBe(false);

    // Paid the foretell cost ({1}{U}), not the printed mana cost ({2}{U}{U}).
    const after = result.state.players.get(f.aliceId)!.manaPool;
    expect(before.generic - after.generic).toBe(1);
    expect(before.blue - after.blue).toBe(1);

    // The card moved from exile onto the stack.
    expect(exileIds(result.state, f.aliceId)).not.toContain(cardId);
  });

  it("the spell's mana value (printed mana_cost / cmc) is unchanged (CR 702.142c)", () => {
    let state = foretellOnCurrentTurn();
    state = advanceTurn(state);
    state = addMana(state, f.aliceId, { generic: 5, blue: 5 });
    state.priorityPlayerId = f.aliceId;
    state.turn.activePlayerId = f.aliceId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];

    const result = castForetoldCard(state, f.aliceId, cardId);
    expect(result.success).toBe(true);
    expect(result.state.stack[0].manaCost).toBe("{2}{U}{U}");
    expect(result.state.cards.get(cardId)!.cardData.cmc).toBe(4);
  });

  it("the foretell cast can be cast directly via castSpell with the foretell alt cost", () => {
    let state = foretellOnCurrentTurn();
    state = advanceTurn(state);
    state = addMana(state, f.aliceId, { generic: 5, blue: 5 });
    state.priorityPlayerId = f.aliceId;
    state.turn.activePlayerId = f.aliceId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];

    const result = castSpell(state, f.aliceId, cardId, [], [], 0, false, {
      type: "foretell",
    });
    expect(result.success).toBe(true);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("foretell");
    expect(result.state.cards.get(cardId)!.foretold).toBe(false);
    expect(result.state.cards.get(cardId)!.isFaceDown).toBe(false);
  });

  it("a foretold instant resolves normally after being cast", () => {
    let state = foretellOnCurrentTurn();
    state = advanceTurn(state);
    state = addMana(state, f.aliceId, { generic: 5, blue: 5 });
    state.priorityPlayerId = f.aliceId;
    state.turn.activePlayerId = f.aliceId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];

    const cast = castForetoldCard(state, f.aliceId, cardId);
    expect(cast.success).toBe(true);

    // Resolve the top of the stack — the instant should leave the stack and go
    // to its owner's graveyard (standard spell resolution).
    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.stack.length).toBe(0);
    expect(resolved.zones.get(`${f.aliceId}-graveyard`)!.cardIds).toContain(
      cardId,
    );
  });

  it("cannot be cast the same turn it was foretold (CR 702.142c)", () => {
    const state = foretellOnCurrentTurn();
    // Do NOT advance the turn.
    const result = castForetoldCard(state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/later turn/i);
  });

  it("is rejected for a card that is not foretold", () => {
    // A plain card in hand (not foretold, not in exile).
    const result = castForetoldCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not foretold/i);
  });

  it("is rejected when the foretell cost cannot be paid", () => {
    let state = foretellOnCurrentTurn();
    state = advanceTurn(state);
    // Only 1 generic, no blue — cannot pay foretell cost {1}{U}.
    const broke: GameState = {
      ...state,
      players: new Map(state.players).set(f.aliceId, {
        ...state.players.get(f.aliceId)!,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 1,
        },
      }),
    };
    broke.priorityPlayerId = f.aliceId;
    broke.turn.activePlayerId = f.aliceId;
    broke.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    broke.stack = [];
    const result = castForetoldCard(broke, f.aliceId, cardId);
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// Sanity: unrelated mechanics are untouched
// ===========================================================================

describe("Foretell — does not interfere with non-foretell cards", () => {
  it("a non-foretell card is not flagged foretold after being exiled normally", () => {
    const f = makeFixture();
    const plainId = putInHand(f.state, f.aliceId, plainInstant());
    // Manually exile it the normal (face-up) way.
    const hand = f.state.zones.get(`${f.aliceId}-hand`)!;
    const exile = f.state.zones.get(`${f.aliceId}-exile`)!;
    f.state.zones.set(`${f.aliceId}-hand`, {
      ...hand,
      cardIds: hand.cardIds.filter((id) => id !== plainId),
    });
    f.state.zones.set(`${f.aliceId}-exile`, {
      ...exile,
      cardIds: [...exile.cardIds, plainId],
    });
    expect(isForetoldCard(f.state.cards.get(plainId))).toBe(false);
    expect(
      getForetoldCardIds(
        f.state.zones.get(`${f.aliceId}-exile`)!,
        f.state.cards,
      ),
    ).toEqual([]);
  });

  it("basicIsland helper still produces a land card (scaffold sanity)", () => {
    const island = basicIsland("1");
    expect(island.type_line).toContain("Land");
    // Reference ZoneType to keep the import meaningful for readers.
    expect(ZoneType.EXILE).toBe("exile");
  });
});
