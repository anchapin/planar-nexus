/**
 * @fileoverview Unit tests for the Spectacle keyword (CR 702.135).
 *
 * Issue #1408 — [Rules Engine] Wire Spectacle alternative-cost branch into
 * castSpell (CR 702.135).
 *
 * Spectacle (CR 702.135):
 * - 702.135a: "Spectacle [cost]" is a static ability that functions while the
 *   spell is on the stack. It offers an alternative cost. The spell's
 *   controller may pay [cost] rather than the printed mana cost IF an
 *   opponent has lost life this turn.
 * - 702.135b: Casting for the spectacle cost follows the rules for
 *   alternative costs. The spell's mana value is unchanged; other additional
 *   costs/taxes still apply (same treatment as Blitz/Foretell).
 *
 * These tests cover: parsing (parseSpectacle / parseAlternativeCost), the
 * alternative-cost cast path (mana spend + CMC unchanged), the precondition
 * gate (opponent lost life this turn — combat and non-combat), the fallback
 * to printed cost when the precondition is false, the multiple-opponents
 * case, life-gain-after-loss (still satisfies), and replay determinism.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseSpectacle,
  parseAlternativeCost,
  AlternativeCostType,
} from "../oracle-text-parser";
import { dealDamageToPlayer, loseLife, gainLife } from "../player-actions";
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
 * A spectacle sorcery. Printed mana cost {3}{B}{B} (mana value 5); spectacle
 * cost {1}{B}. Oracle text intentionally avoids "Choose one"/"•" markers so
 * the modal-spell detector in `castSpell` does not require a mode selection;
 * the spectacle keyword is what matters for these tests.
 */
function spectacleSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-spectacle-sorcery",
    name: "Angrath's Rampage",
    type_line: "Sorcery",
    oracle_text: "Spectacle {1}{B}\nDestroy target artifact or enchantment.",
    mana_cost: "{3}{B}{B}",
    cmc: 5,
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

// ===========================================================================
// Parsing (CR 702.135a)
// ===========================================================================

describe("Spectacle — parsing (CR 702.135)", () => {
  it("parseSpectacle detects 'Spectacle {cost}' and parses the cost", () => {
    const r = parseSpectacle("Spectacle {1}{B}");
    expect(r.hasSpectacle).toBe(true);
    expect(r.spectacleCost).not.toBeNull();
    expect(r.spectacleCost!.generic).toBe(1);
    expect(r.spectacleCost!.black).toBe(1);
    expect(r.description).toBe("Spectacle {1}{B}");
  });

  it("parseSpectacle is case-insensitive", () => {
    expect(parseSpectacle("spectacle {2}{R}").hasSpectacle).toBe(true);
    expect(parseSpectacle("SPECTACLE {3}").hasSpectacle).toBe(true);
  });

  it("parseSpectacle returns false when the keyword is absent", () => {
    expect(parseSpectacle("Flying").hasSpectacle).toBe(false);
    expect(parseSpectacle("Dash {2}{R}").hasSpectacle).toBe(false);
    expect(parseSpectacle("").hasSpectacle).toBe(false);
    expect(parseSpectacle("").spectacleCost).toBeNull();
  });

  it("parseSpectacle does not match 'spectacle' inside other words", () => {
    expect(parseSpectacle("spectacular").hasSpectacle).toBe(false);
  });

  it("parseAlternativeCost recognizes spectacle as an alternative cost", () => {
    const r = parseAlternativeCost("Spectacle {1}{B}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.SPECTACLE);
    expect(r.manaCost).not.toBeNull();
    expect(r.manaCost!.black).toBe(1);
    expect(r.description).toContain("Spectacle");
  });

  it("parseAlternativeCost reports the opponent-lost-life requirement", () => {
    const r = parseAlternativeCost("Spectacle {1}{B}");
    expect(r.additionalRequirement).toMatch(/opponent.*lost life/i);
  });
});

// ===========================================================================
// Alternative-cost casting (CR 702.135a/b)
// ===========================================================================

describe("Spectacle — casting for the spectacle cost (CR 702.135b)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, spectacleSorcery());
    // Enough mana for either the printed cost ({3}{B}{B} = 3 generic + 2 black)
    // or the spectacle cost ({1}{B} = 1 generic + 1 black).
    f.state = addMana(f.state, f.aliceId, { black: 2, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];

    // Precondition: Bob lost life this turn (combat damage from Alice).
    // Use dealDamageToPlayer so lastTurnLifeLost is populated.
    f.state = dealDamageToPlayer(f.state, f.bobId, 2, true, undefined);
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(2);
  });

  it("castSpell with alternativeCost spectacle succeeds and records the cost used", () => {
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("spectacle");
  });

  it("pays the spectacle cost (not the printed mana cost) when the precondition holds", () => {
    // Printed {3}{B}{B} = 3 generic + 2 black; spectacle {1}{B} = 1 generic + 1 black.
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // Spent exactly 1 generic + 1 black (the spectacle cost).
    expect(before.generic - after.generic).toBe(1);
    expect(before.black - after.black).toBe(1);
  });

  it("leaves the spell's mana value (printed mana_cost / cmc) unchanged (CR 702.135b)", () => {
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    // The StackObject keeps the printed mana_cost string, not the spectacle cost.
    expect(result.state.stack[0].manaCost).toBe("{3}{B}{B}");
    const card = result.state.cards.get(cardId)!;
    expect(card.cardData.cmc).toBe(5);
  });

  it("spectacle cast is rejected when the spectacle cost cannot be paid", () => {
    // Give Alice only 1 black + 0 generic: spectacle cost is {1}{B}
    // (1 generic + 1 black) — not affordable.
    const poor: GameState = {
      ...f.state,
      players: new Map(f.state.players).set(f.aliceId, {
        ...f.state.players.get(f.aliceId)!,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 1,
          red: 0,
          green: 0,
          generic: 0,
        },
      }),
    };
    const result = castSpell(poor, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(false);
  });

  it("the same spell can be cast normally (without spectacle) by paying its printed cost", () => {
    const result = castSpell(f.state, f.aliceId, cardId);
    expect(result.success).toBe(true);
    // Normal cast does not record the spectacle alternative cost.
    expect(result.state.stack[0].alternativeCostsUsed ?? []).not.toContain(
      "spectacle",
    );
  });
});

// ===========================================================================
// Precondition gate (CR 702.135a — "if an opponent has lost life this turn")
// ===========================================================================

describe("Spectacle — precondition gate (CR 702.135a)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, spectacleSorcery());
    f.state = addMana(f.state, f.aliceId, { black: 2, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("falls back to the printed cost when no opponent lost life this turn", () => {
    // Precondition: nobody has lost life. The `lastTurnLifeLost` defaults to 0.
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(0);

    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    // Printed cost {3}{B}{B} was charged (NOT the spectacle cost {1}{B}).
    const after = result.state.players.get(f.aliceId)!.manaPool;
    expect(before.generic - after.generic).toBe(3);
    expect(before.black - after.black).toBe(2);
    // Crucially, spectacle was NOT recorded as a used alternative cost.
    expect(result.state.stack[0].alternativeCostsUsed ?? []).not.toContain(
      "spectacle",
    );
  });

  it("falls back to the printed cost and fails when printed cost is unaffordable", () => {
    // Alice cannot afford the printed cost {3}{B}{B} (needs 3 generic + 2 black)
    // but could afford the spectacle cost {1}{B}. With the precondition false,
    // the fallback to printed cost must fail (Spectacle is a player OPTION, not
    // an override of the printed cost).
    const poor: GameState = {
      ...f.state,
      players: new Map(f.state.players).set(f.aliceId, {
        ...f.state.players.get(f.aliceId)!,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 1,
          red: 0,
          green: 0,
          generic: 1,
        },
      }),
    };
    // Nobody lost life — precondition false.
    expect(poor.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(0);

    const result = castSpell(poor, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(false);
  });

  it("is satisfied by NON-COMBAT life loss (e.g. a shock) — CR 118.3 / 702.135a", () => {
    // Bob loses 2 life directly (not damage). CR 702.135a says "lost life" —
    // CR 118.3 confirms all life loss counts regardless of source.
    f.state = loseLife(f.state, f.bobId, 2);
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(2);

    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    // Spectacle cost {1}{B} charged, not printed cost.
    const after = result.state.players.get(f.aliceId)!.manaPool;
    expect(before.generic - after.generic).toBe(1);
    expect(before.black - after.black).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("spectacle");
  });

  it("remains satisfied if the opponent GAINS life after losing it (CR 702.135a — 'lost life', not net)", () => {
    // Bob loses 3 life, then gains 3 life. Net change is zero, but the
    // spectacle rule tracks life *lost* (a one-way, monotonic-per-turn
    // counter), so the precondition is STILL satisfied.
    f.state = loseLife(f.state, f.bobId, 3);
    expect(f.state.players.get(f.bobId)?.life).toBe(17);
    f.state = gainLife(f.state, f.bobId, 3);
    expect(f.state.players.get(f.bobId)?.life).toBe(20);
    // The per-turn loss counter is NOT decremented by life gain.
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(3);

    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // Spectacle cost {1}{B} charged — precondition still holds.
    expect(before.generic - after.generic).toBe(1);
    expect(before.black - after.black).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("spectacle");
  });

  it("does NOT count life lost by the caster themselves", () => {
    // Alice loses life; Bob does not. Spectacle should NOT trigger.
    f.state = loseLife(f.state, f.aliceId, 4);
    expect(f.state.players.get(f.aliceId)?.lastTurnLifeLost ?? 0).toBe(4);
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(0);

    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    // Printed cost charged — caster's own life loss does not satisfy spectacle.
    const after = result.state.players.get(f.aliceId)!.manaPool;
    expect(before.generic - after.generic).toBe(3);
    expect(before.black - after.black).toBe(2);
    expect(result.state.stack[0].alternativeCostsUsed ?? []).not.toContain(
      "spectacle",
    );
  });
});

// ===========================================================================
// Multiple opponents (CR 702.135a — "an opponent", any one suffices)
// ===========================================================================

describe("Spectacle — multiple opponents (CR 702.135a)", () => {
  it("in a 3-player game, life loss by ANY one opponent satisfies the precondition", () => {
    let state = createInitialGameState(["Alice", "Bob", "Carol"], 20, false);
    state = startGame(state);
    const [aliceId, bobId, carolId] = Array.from(
      state.players.keys(),
    ) as PlayerId[];

    state.status = "in_progress";
    state.priorityPlayerId = aliceId;
    state.turn.activePlayerId = aliceId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];
    state.consecutivePasses = 0;
    state.players.forEach((p) =>
      state.players.set(p.id, { ...p, hasPassedPriority: false }),
    );

    const cardId = putInHand(state, aliceId, spectacleSorcery());
    state = addMana(state, aliceId, { black: 2, generic: 8 });

    // Only Carol lost life; Bob did not. CR 702.135a says "an opponent" (any).
    state = loseLife(state, carolId, 2);
    expect(state.players.get(bobId)?.lastTurnLifeLost ?? 0).toBe(0);
    expect(state.players.get(carolId)?.lastTurnLifeLost ?? 0).toBe(2);

    const before = state.players.get(aliceId)!.manaPool;
    const result = castSpell(state, aliceId, cardId, [], [], 0, false, {
      type: "spectacle",
    });
    expect(result.success).toBe(true);
    const after = result.state.players.get(aliceId)!.manaPool;
    // Spectacle cost {1}{B} charged — Carol's loss satisfied the gate.
    expect(before.generic - after.generic).toBe(1);
    expect(before.black - after.black).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("spectacle");
  });
});

// ===========================================================================
// Per-turn reset (CR 702.135a — "lost life THIS turn")
// ===========================================================================

describe("Spectacle — per-turn reset (CR 702.135a)", () => {
  it("a fresh player has lastTurnLifeLost defaulting to 0 (no life lost yet)", () => {
    const f = makeFixture();
    expect(f.state.players.get(f.aliceId)?.lastTurnLifeLost ?? 0).toBe(0);
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(0);
  });

  it("accumulates multiple life-loss events on the same turn", () => {
    const f = makeFixture();
    f.state = loseLife(f.state, f.bobId, 2);
    f.state = dealDamageToPlayer(f.state, f.bobId, 3, false, undefined);
    f.state = loseLife(f.state, f.bobId, 1);
    // 2 + 3 + 1 = 6 accumulated on the turn counter.
    expect(f.state.players.get(f.bobId)?.lastTurnLifeLost ?? 0).toBe(6);
    expect(f.state.players.get(f.bobId)?.life).toBe(14);
  });
});

// ===========================================================================
// Replay determinism
// ===========================================================================

describe("Spectacle — replay determinism", () => {
  it("casting for the spectacle cost is deterministic (identical setup → identical result)", () => {
    // Build two independent, identical fixtures. Run the same cast on each.
    // The two resulting states must agree on every observable field the
    // replay system cares about (stack contents, mana spent, alternative
    // costs recorded). This rules out nondeterministic ID/cost generation
    // in the spectacle branch.
    const runOnce = (): {
      success: boolean;
      stackLen: number;
      altCosts: string[];
      manaPool: unknown;
      bobLife: number;
    } => {
      const f = makeFixture();
      const cardId = putInHand(f.state, f.aliceId, spectacleSorcery());
      f.state = addMana(f.state, f.aliceId, { black: 2, generic: 8 });
      f.state = loseLife(f.state, f.bobId, 2);

      const r = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
        type: "spectacle",
      });
      return {
        success: r.success,
        stackLen: r.state.stack.length,
        altCosts: r.state.stack[0]?.alternativeCostsUsed ?? [],
        manaPool: r.state.players.get(f.aliceId)?.manaPool,
        bobLife: r.state.players.get(f.bobId)?.life ?? -1,
      };
    };

    const r1 = runOnce();
    const r2 = runOnce();
    expect(r2.success).toBe(r1.success);
    expect(r2.stackLen).toBe(r1.stackLen);
    expect(r2.altCosts).toEqual(r1.altCosts);
    expect(r2.manaPool).toEqual(r1.manaPool);
    expect(r2.bobLife).toBe(r1.bobLife);

    // Spot-check the substantive invariant: spectacle was applied and the
    // spectacle cost (1 generic + 1 black) was actually charged.
    expect(r1.success).toBe(true);
    expect(r1.altCosts).toContain("spectacle");
    expect(r1.bobLife).toBe(18); // 20 - 2 life lost
  });
});
