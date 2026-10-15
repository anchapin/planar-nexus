/**
 * Wave 4.8 follow-up 19 lane 116 (#2614 follow-up):
 * "X spent on the previous spell" cast-filter arm
 * (CR 107.3, CR 601.2b).
 *
 * v1 minimum (this test) is the **schema + read-only
 * path**:
 *   1. The schema arm
 *      `TriggerSchema.X: "X_spent_on_spell"`
 *      lands on the cast trigger cast-filter.
 *   2. The engine surfaces an
 *      `evaluateCastVariable(state, spellCardId)`
 *      helper that reads
 *      `state.castVariableValues[spellCardId]`.
 *   3. `castTriggerMatches` gates the trigger on:
 *        - the cast spell having `X` in its mana
 *          cost (the schema-side enum value), AND
 *        - the spell being present in
 *          `state.castVariableValues` (the
 *          read-side ledger — a follow-up
 *          sub-piece, lane 116 piece 2/2, will
 *          write to this map at cast time).
 *
 * v1 does NOT yet write to
 * `state.castVariableValues` at cast time. The
 * synthetic test pre-populates the map directly so
 * the read-side arm is exercised end-to-end.
 *
 * The sample card (`cast_x_spent_watcher.json`) is a
 * synthetic "Whenever you cast a spell with X in
 * its mana cost, this creature gets +1/+1 counters
 * equal to the X spent on that spell" trigger.
 *
 * Out of scope for lane 116 piece 1/2 (each a
 * follow-up lane):
 *   - the cast-time writer (piece 2/2)
 *   - the "X spent on the most recent instant or
 *     sorcery" / "X spent on any prior spell this
 *     turn" variants
 *   - multi-X-spell filters (cards with `{X}{X}` in
 *     the mana cost)
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { evaluateCastVariable } from "../abilities/triggered";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { getCardScript } from "../card-scripts/registry";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Spirit",
    oracle_text: "",
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
    color_identity: ["U"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
    ...overrides,
  } as ScryfallCard;
}

const watcher = card({
  name: "Cast X Spent Watcher",
  mana_cost: "{2}{U}",
  power: "0",
  toughness: "0",
});
// A vanilla X-cost instant ("X in its mana cost") so
// the test can exercise the cast filter on an
// opponent's turn as well (sorcery-speed spells
// require the active player).
const xSpell = card({
  name: "Mind Spring",
  type_line: "Instant",
  oracle_text: "Draw X cards.",
  mana_cost: "{X}{U}{U}",
  cmc: 2,
  colors: ["U"],
});
// A non-X-cost sorcery (must NOT trigger the watcher).
const nonXSpell = card({
  name: "Opt",
  type_line: "Instant",
  oracle_text: "Draw a card.",
  mana_cost: "{U}",
  cmc: 1,
  colors: ["U"],
});

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Cast filter X: 'X_spent_on_spell' (lane 116, piece 1/2 — read-only path)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { blue: 4, generic: 4, colorless: 4 });
    state = addMana(state, bob, { blue: 4, generic: 4 });
  });

  it("registers the X: 'X_spent_on_spell' arm on the synthetic source's cast trigger", () => {
    const script = getCardScript("Cast X Spent Watcher");
    expect(script).toBeDefined();
    const trigger = script!.triggers?.[0];
    expect(trigger).toBeDefined();
    expect(trigger!.event).toBe("cast");
    expect((trigger as { X?: string }).X).toBe("X_spent_on_spell");
  });

  it("evaluateCastVariable returns undefined for an X spell not in the ledger", () => {
    const spellId = put(state, alice, "hand", xSpell);
    expect(evaluateCastVariable(state, spellId)).toBeUndefined();
  });

  it("evaluateCastVariable returns the stored X for a spell pre-populated in the ledger", () => {
    const spellId = put(state, alice, "hand", xSpell);
    const next = {
      ...state,
      castVariableValues: new Map([[spellId, 3]]),
    };
    expect(evaluateCastVariable(next, spellId)).toBe(3);
  });

  it("fires the cast trigger when the X-spell's X is pre-populated in the ledger", () => {
    put(state, alice, "battlefield", watcher);
    const spellId = put(state, alice, "hand", xSpell);
    // Pre-populate the read-side ledger (the v1 cast-time
    // writer — lane 116 piece 2/2 — would do this at cast
    // time).
    const beforeCast = {
      ...state,
      castVariableValues: new Map<CardInstanceId, number>([
        [spellId, 3],
      ]),
    };
    const r = castSpell(beforeCast, alice, spellId);
    expect(r.success).toBe(true);
    // Stack: original X spell + the watcher's cast trigger.
    expect(r.state.stack).toHaveLength(2);
    const trigger = r.state.stack[1];
    expect(trigger.triggered).toBe(true);
  });

  it("does NOT fire the cast trigger for a non-X-cost spell", () => {
    put(state, alice, "battlefield", watcher);
    const spellId = put(state, alice, "hand", nonXSpell);
    const r = castSpell(state, alice, spellId);
    expect(r.success).toBe(true);
    // No X in mana cost → no cast-filter match.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does NOT fire the cast trigger for an X-spell not in the ledger", () => {
    put(state, alice, "battlefield", watcher);
    const spellId = put(state, alice, "hand", xSpell);
    // No `castVariableValues` map set — the read-side
    // ledger is empty, so the trigger is gated off.
    const r = castSpell(state, alice, spellId);
    expect(r.success).toBe(true);
    // X in mana cost, but no stored X → no cast-filter
    // match.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does NOT fire the cast trigger for an X-spell cast by an opponent", () => {
    put(state, alice, "battlefield", watcher);
    const spellId = put(state, bob, "hand", xSpell);
    const beforeCast = {
      ...state,
      castVariableValues: new Map<CardInstanceId, number>([
        [spellId, 2],
      ]),
    };
    // Bob's mana pool starts empty in the test setup —
    // X=2 + {U}{U} costs 4 generic (2 X + 2 blue mapped
    // to generic via the spendMana cascade). Top up
    // Bob's pool so the cast succeeds.
    const bobReady = addMana(beforeCast, bob, {
      blue: 4,
      generic: 4,
      colorless: 4,
    });
    const r = castSpell(
      { ...bobReady, priorityPlayerId: bob },
      bob,
      spellId,
      [],
      [],
      2,
    );
    expect(r.success).toBe(true);
    // Bob is the opponent; the trigger's `caster: "you"`
    // gate excludes the X spell from Bob's hand.
    expect(r.state.stack).toHaveLength(1);
  });
});
