/**
 * Wave 4.8 follow-up 5 lane 69 — X-spent-on-other-spells
 * (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * with the "spend this mana only on [X]" pattern: Force of
 * Will, Cabal Therapy, the Storm-Crow specter pattern. The
 * v1 minimum adds a `mana_restriction: { colors: string[],
 * generic: number }` arm on the existing `additionalCosts`
 * object (parallel to lane 63's `pay_life` / `sacrifice`).
 *
 * Schema (card-scripts/schema.ts, CardScriptSchema):
 *   `additionalCosts.mana_restriction: { colors: ["W" | "U" |
 *    "B" | "R" | "G"], generic: number }` — v1 enforces
 *   `colors.length === 1` (multi-color restrictions are a
 *   follow-up lane). The engine reads the field at cast time
 *   and auto-applies the restriction when the player can't
 *   pay the printed cost but CAN pay the cost under the
 *   restriction. The deduction happens via the color-
 *   restricted mana payment path; the per-instance
 *   `manaRestriction` field on the StackObject carries the
 *   same shape so resolve-time effects can reference it.
 *
 * Engine:
 *   `castSpell` (spell-casting/cast.ts) reads the
 *   `mana_restriction` field and shifts `generic` mana from
 *   the total generic cost to the named color's total when
 *   the printed cost isn't payable. The cast path pushes
 *   `"mana_restriction"` to `alternativeCostsUsed` and stamps
 *   `manaRestriction` on the StackObject. The cast fails
 *   ("Not enough energy (mana) available.") if the player
 *   can't pay the cost under either path.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68 pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { castSpell, canCastSpell } from "../spell-casting/cast";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Mana Restriction (lane 69)";

const SCRIPT_SINGLE_BLUE: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Counter target nonblue spell. (You may pay the generic portion of this spell's cost using only blue mana.)",
  spell: [{ op: "Draw", amount: 1 }],
  additionalCosts: {
    mana_restriction: {
      colors: ["U"],
      generic: 1,
    },
  },
});

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Instant",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{U}{U}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

/**
 * Adds a host-named card to Alice's hand at the start of her
 * main phase (so timing legality is satisfied).
 */
function addCardToHand(
  state: GameState,
  aliceId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-card-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, aliceId, aliceId, {
    id: cardId,
    currentZoneKey: `${aliceId}-hand`,
  });
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const handKey = `${aliceId}-hand`;
  const hand = newZones.get(handKey);
  if (!hand) throw new Error("hand zone not found");
  newZones.set(handKey, { ...hand, cardIds: [...hand.cardIds, cardId] });
  const nextState: GameState = {
    ...state,
    cards: newCards,
    zones: newZones,
    lastModifiedAt: Date.now(),
  };
  // Move to Alice's main phase so the cast is timing-legal.
  return {
    state: {
      ...nextState,
      turn: {
        ...nextState.turn,
        activePlayerId: aliceId,
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
      priorityPlayerId: aliceId,
      stack: [],
      status: "in_progress",
    },
    cardId,
  };
}

describe("Wave 4.8 follow-up 5 lane 69 — mana restriction", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_SINGLE_BLUE]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script that declares two restriction colors (v1 single-color only)", () => {
    // Schema guard: the v1 minimum is a single-color restriction.
    // Multi-color restrictions (`colors: ["U", "B"]`) are a
    // follow-up lane; the schema rejects them up front.
    expect(() =>
      CardScriptSchema.parse({
        name: "Multi-color guard (lane 69)",
        oracle: "test",
        spell: [{ op: "Draw", amount: 1 }],
        additionalCosts: {
          mana_restriction: { colors: ["U", "B"], generic: 1 },
        },
      }),
    ).toThrow();
  });

  it("accepts the v1 single-color restriction on the additionalCosts slot", () => {
    // Sanity check on the schema: the script is parseable and
    // carries the restriction on `additionalCosts.mana_restriction`.
    const parsed = CardScriptSchema.parse(SCRIPT_SINGLE_BLUE);
    expect(parsed.additionalCosts?.mana_restriction).toEqual({
      colors: ["U"],
      generic: 1,
    });
  });

  it("can cast normally with 2U in the pool (printed cost {U}{U} is payable)", () => {
    // The restriction is a *permissive* alternative, not a
    // forced path: when the player has enough mana for the
    // printed cost, the engine pays the printed cost and does
    // NOT stamp `manaRestriction` on the StackObject. The
    // `"mana_restriction"` entry must NOT appear in
    // `alternativeCostsUsed` either.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { blue: 2 });
    const cardDef = makeCard({ id: "normal-blue-pay" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const canCast = canCastSpell(withCard, aliceId, cardId);
    expect(canCast.canCast).toBe(true);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const stackObject = result.state.stack.at(-1);
    expect(stackObject).toBeDefined();
    expect(stackObject?.alternativeCostsUsed ?? []).not.toContain(
      "mana_restriction",
    );
    expect(stackObject?.manaRestriction).toBeUndefined();
    // The pool after the cast is drained of both blue pips.
    const finalPool = result.state.players.get(aliceId)?.manaPool;
    expect(finalPool?.blue).toBe(0);
  });

  it("applies the restriction when the player has 1 blue + 1 generic + 1 blue", () => {
    // Player has 1 blue + 1 generic + 1 blue (3 total mana but
    // only 1 explicit blue). The printed cost is {U}{U} = 2
    // blue pips. The pool has 2 blue, so the printed cost is
    // technically payable — this is the "no auto-apply" path.
    // To force the restriction, we need 1 blue + 1 generic +
    // 1 colorless (which is generic-equivalent) so the printed
    // cost can't be paid with two blue pips.
    //
    // Pool: 1 blue + 1 generic — printed cost {U}{U} is NOT
    // payable (need 2 blue). Restriction applies: shift the
    // generic 1 to blue, so the cost is paid as {U}{U} (one
    // explicit blue + one generic-as-blue).
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { blue: 1, generic: 1 });
    const cardDef = makeCard({ id: "restriction-blue-generic" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const canCast = canCastSpell(withCard, aliceId, cardId);
    expect(canCast.canCast).toBe(true);

    const result = castSpell(withCard, aliceId, cardId);
    console.log("RESTRICTION RESULT:", JSON.stringify({ success: result.success, error: result.success ? null : result.error }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const stackObject = result.state.stack.at(-1);
    expect(stackObject).toBeDefined();
    expect(stackObject?.alternativeCostsUsed).toContain("mana_restriction");
    expect(stackObject?.manaRestriction).toEqual({
      colors: ["U"],
      generic: 1,
    });
    // The pool after the cast: both blue and generic are drained.
    const finalPool = result.state.players.get(aliceId)?.manaPool;
    expect(finalPool?.blue).toBe(0);
    expect(finalPool?.generic).toBe(0);
  });

  it("fails when the player has 0 blue mana (printed and restricted costs both fail)", () => {
    // Pool has only 1 generic, no blue. Printed cost {U}{U}
    // is not payable (no blue). The restriction shifts the
    // generic 1 to blue, but the cost still requires 2 blue
    // pips total — only 1 will be available. Cast fails.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { generic: 1 });
    const cardDef = makeCard({ id: "no-blue-fail" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const canCast = canCastSpell(withCard, aliceId, cardId);
    // canCastSpell does NOT validate mana; only timing. The
    // cast-time check is in castSpell.
    expect(canCast.canCast).toBe(true);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(false);
    if (result.success) return;
    // The cast-time legality check fails with "Not enough
    // colored mana" because the player has zero blue and
    // the adjusted cost still requires 2 blue pips.
    expect(result.error).toMatch(/Not enough (energy|colored mana)/);
  });

  it("rejects the script when colors array has wrong length (v1 length === 1)", () => {
    // Schema-level guard: zero-length colors is rejected.
    expect(() =>
      CardScriptSchema.parse({
        name: "Empty colors (lane 69)",
        oracle: "test",
        spell: [{ op: "Draw", amount: 1 }],
        additionalCosts: {
          mana_restriction: { colors: [], generic: 1 },
        },
      }),
    ).toThrow();
  });

  it("rejects the script when generic is zero (v1 generic >= 1)", () => {
    // Schema-level guard: zero generic is rejected.
    expect(() =>
      CardScriptSchema.parse({
        name: "Zero generic (lane 69)",
        oracle: "test",
        spell: [{ op: "Draw", amount: 1 }],
        additionalCosts: {
          mana_restriction: { colors: ["U"], generic: 0 },
        },
      }),
    ).toThrow();
  });
});