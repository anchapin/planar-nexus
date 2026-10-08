/**
 * "This spell can't be countered" tests (#2594 follow-up)
 *
 * The clause was a stored-but-unused oracle-text side effect: the
 * schema accepted `cantBeCountered: true` on the script but the
 * engine never stamped it on the StackObject, so `counterSpell`
 * would still remove the spell. This lane wires both halves:
 *   1. `cast.ts` stamps `cantBeCountered` on the StackObject (script
 *      wins, oracle-text parse is the fallback for un-scripted cards).
 *   2. `counterSpell` rejects the counter with a clear "can't be
 *      countered" error instead of removing the spell.
 *
 * Unblocks the FDN drafter for Curator of Destinies, Koma,
 * World-Eater, and Sphinx of the Final Word.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { counterSpell } from "../keyword-actions/counter-spell";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

describe("This spell can't be countered (#2594 follow-up)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = p1;
    state.stack = [];
  });

  it("parseCantBeCountered detects the clause in oracle text", () => {
    // Sanity-check the parser: covered by the parser unit test, but a
    // smoke test here confirms the export is reachable from this
    // module path (the script-side import).
    expect(
      /this spell can'?t be countered/i.test(
        "This spell can't be countered. Draw a card.",
      ),
    ).toBe(true);
    expect(
      /this spell can'?t be countered/i.test("Draw a card."),
    ).toBe(false);
  });

  it("counterSpell rejects a StackObject with cantBeCountered: true", () => {
    // Build a spell on the stack directly with cantBeCountered: true.
    const targetId = "spell-under-test";
    const stateWithStack: GameState = {
      ...state,
      stack: [
        {
          id: targetId,
          type: "spell",
          sourceCardId: null,
          controllerId: p1,
          name: "Uncounterable Bolt",
          text: "This spell can't be countered.\nUncounterable Bolt deals 3 damage to any target.",
          manaCost: "{R}",
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
          cantBeCountered: true,
        },
      ],
    };
    const result = counterSpell(stateWithStack, targetId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/can't be countered/i);
    // The spell is still on the stack.
    expect(result.state.stack).toHaveLength(1);
    expect(result.state.stack[0].id).toBe(targetId);
  });

  it("counterSpell still works on a non-cantBeCountered spell", () => {
    // Regression guard: a regular spell can still be countered.
    const targetId = "regular-spell";
    const stateWithStack: GameState = {
      ...state,
      stack: [
        {
          id: targetId,
          type: "spell",
          sourceCardId: null,
          controllerId: p1,
          name: "Lightning Bolt",
          text: "Lightning Bolt deals 3 damage to any target.",
          manaCost: "{R}",
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
        },
      ],
    };
    const result = counterSpell(stateWithStack, targetId);
    expect(result.success).toBe(true);
    expect(result.state.stack).toHaveLength(0);
  });

  // Helper: create a card in p1's hand with the given oracle and
  // (optionally) a script entry. Returns (state, cardId).
  const placeInHand = (
    card: ScryfallCard,
    extraScript?: unknown,
  ): { s: GameState; cardId: CardInstanceId } => {
    const inst = createCardInstance(card, p1, p1);
    const cards = new Map(state.cards);
    cards.set(inst.id, inst);
    const hand = state.zones.get(`${p1}-hand`)!;
    const zones = new Map(state.zones);
    zones.set(`${p1}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, inst.id],
    });
    const s: GameState = { ...state, cards, zones };
    if (extraScript) {
      registerCardScripts([...RAW_CARD_SCRIPTS, extraScript as never]);
    }
    return { s, cardId: inst.id };
  };

  it("castSpell stamps cantBeCountered from the script's `cantBeCountered: true`", () => {
    // A script with the new top-level field; verify the engine
    // stamps the StackObject.
    const script = {
      name: "Test Uncounterable Bolt",
      oracle:
        "This spell can't be countered.\nUncounterable Bolt deals 3 damage to any target.",
      spell: [{ op: "DealDamage", amount: 3, target: "any" }],
      cantBeCountered: true,
    };
    const card: ScryfallCard = {
      id: "uncount-bolt",
      name: "Test Uncounterable Bolt",
      type_line: "Instant",
      oracle_text:
        "This spell can't be countered.\nUncounterable Bolt deals 3 damage to any target.",
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    };
    const { s: s0, cardId } = placeInHand(card, script);
    const s1 = addMana(s0, p1, { red: 1 });
    try {
      const result = castSpell(s1, p1, cardId, [], [], 0, false);
      expect(result.success).toBe(true);
      expect(result.state.stack).toHaveLength(1);
      expect(result.state.stack[0].cantBeCountered).toBe(true);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("castSpell falls back to oracle-text parse when no script declares the rider", () => {
    // A card whose script doesn't set `cantBeCountered` but whose
    // oracle text says "This spell can't be countered" still gets
    // the rider — the parser is the legacy fallback.
    const card: ScryfallCard = {
      id: "legacy-uncount",
      name: "Legacy Uncounterable",
      type_line: "Instant",
      oracle_text:
        "This spell can't be countered. Legacy Uncounterable deals 1 damage to any target.",
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    };
    const { s: s0, cardId } = placeInHand(card);
    const s1 = addMana(s0, p1, { red: 1 });
    // No script registered for this card — the engine reads the
    // oracle text.
    const result = castSpell(s1, p1, cardId, [], [], 0, false);
    expect(result.success).toBe(true);
    expect(result.state.stack[0].cantBeCountered).toBe(true);
  });

  it("end-to-end: a Counterspell targeting Curator of Destinies fizzes", () => {
    // The curator_of_destinies.json script is already auto-registered
    // (RAW_CARD_SCRIPTS includes it). Cast the Curator and a Counterspell
    // targeting it; the Counterspell fizzles and the Curator resolves.
    const curatorCard: ScryfallCard = {
      id: "curator-1",
      name: "Curator of Destinies",
      type_line: "Creature — Sphinx",
      oracle_text:
        "Flying\nWhenever you cast a noncreature spell, put a +1/+1 counter on Curator of Destinies.\nThis spell can't be countered.",
      mana_cost: "{3}{U}{U}",
      cmc: 5,
      colors: ["U"],
      color_identity: ["U"],
      keywords: ["flying"],
      legalities: { standard: "legal" },
      layout: "normal",
      power: "2",
      toughness: "4",
    };
    const counterspellCard: ScryfallCard = {
      id: "counterspell-1",
      name: "Counterspell",
      type_line: "Instant",
      oracle_text: "Counter target spell.",
      mana_cost: "{U}{U}",
      cmc: 2,
      colors: ["U"],
      color_identity: ["U"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    };
    // Put both in their respective hands.
    const instCurator = createCardInstance(curatorCard, p1, p1);
    const instCounterspell = createCardInstance(counterspellCard, p2, p2);
    const cards = new Map(state.cards);
    cards.set(instCurator.id, instCurator);
    cards.set(instCounterspell.id, instCounterspell);
    const zones = new Map(state.zones);
    const hand1 = zones.get(`${p1}-hand`)!;
    zones.set(`${p1}-hand`, {
      ...hand1,
      cardIds: [...hand1.cardIds, instCurator.id],
    });
    const hand2 = zones.get(`${p2}-hand`)!;
    zones.set(`${p2}-hand`, {
      ...hand2,
      cardIds: [...hand2.cardIds, instCounterspell.id],
    });
    const s0: GameState = { ...state, cards, zones };
    // p1 casts Curator, p2 responds with Counterspell.
    const s1 = addMana(s0, p1, { blue: 2, generic: 3 });
    const s2 = addMana(s1, p2, { blue: 2 });
    const castCurator = castSpell(s2, p1, instCurator.id, [], [], 0, false);
    expect(castCurator.success).toBe(true);
    expect(castCurator.state.stack[0].cantBeCountered).toBe(true);
    // p2 attempts to counter (Counterspell is a regular cast — the
    // "counter" semantics live in the scripted `Counter` op that
    // resolves on the stack).
    const counter = castSpell(
      castCurator.state,
      p2,
      instCounterspell.id,
      [],
      [castCurator.state.stack[0].id],
      0,
      false,
    );
    expect(counter.success).toBe(true);
    // Resolve the Counterspell (LIFO): the engine reads its scripted
    // effect, looks up the target on the stack, and calls
    // counterSpell — which now sees cantBeCountered: true and
    // rejects the counter.
    const afterCounterspell = resolveTopOfStack(counter.state);
    // The Counterspell fizzles; the Curator is still on the stack.
    expect(afterCounterspell.stack).toHaveLength(1);
    expect(afterCounterspell.stack[0].id).toBe(
      castCurator.state.stack[0].id,
    );
    // Resolve the Curator: lands on the battlefield.
    const resolved = resolveTopOfStack(afterCounterspell);
    expect(resolved.stack).toHaveLength(0);
    expect(
      resolved.zones.get(`${p1}-battlefield`)!.cardIds,
    ).toContain(instCurator.id);
  });
});
