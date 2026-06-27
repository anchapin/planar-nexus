/**
 * Tests for CR 603.4 (intervening "if" clauses) and CR 608.2b parsing.
 *
 * Issue #1057: Replace the naive regex trigger parser and enforce intervening-if
 * clauses. These tests pin down:
 *  - The oracle parser correctly separates trigger condition / intervening-if /
 *    effect (no longer lumping the if-clause into the effect).
 *  - An intervening-if is enforced at TRIGGER time (the ability does not go on
 *    the stack when the clause is false when the trigger event occurs).
 *  - An intervening-if is re-checked at RESOLUTION and the ability fizzles when
 *    the clause is no longer true.
 *  - Triggers without an intervening-if behave exactly as before (no regression).
 */

import {
  parseTriggeredAbilities,
  parseOracleText,
} from "../oracle-text-parser";
import {
  detectTriggeredAbilities,
  evaluateInterveningIfClause,
} from "../abilities";
import { detectTurnStartTriggers } from "../trigger-system";
import { resolveTopOfStack } from "../spell-casting";
import { createInitialGameState } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  StackObject,
  PlayerId,
  CardInstanceId,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `mock-${Math.random().toString(36).substr(2, 9)}`,
    name: overrides.name || "Test Card",
    type_line: overrides.type_line || "Creature — Human",
    oracle_text: overrides.oracle_text || "",
    mana_cost: overrides.mana_cost || "{1}{W}",
    cmc: 2,
    colors: overrides.colors || ["W"],
    color_identity: overrides.color_identity || ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

function makeGame(): GameState {
  return createInitialGameState(["Alice", "Bob"], 20, false);
}

function playerIds(state: GameState): [PlayerId, PlayerId] {
  const ids = Array.from(state.players.keys());
  return [ids[0], ids[1]];
}

function placeOnBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  playerId: PlayerId,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = false;
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  state.cards.set(card.id, card);
  return card.id;
}

function setLife(state: GameState, playerId: PlayerId, life: number): void {
  const player = state.players.get(playerId)!;
  player.life = life;
}

// ---------------------------------------------------------------------------
// 1. Parser: trigger condition / intervening-if / effect separation (CR 603.4)
// ---------------------------------------------------------------------------
describe("CR 603.4 — oracle parser separates trigger / intervening-if / effect", () => {
  it("extracts an intervening-if from a 'When ~ enters, if ..., ...' trigger", () => {
    const abilities = parseTriggeredAbilities(
      "When ~ enters the battlefield, if you have 10 or less life, draw a card.",
    );
    expect(abilities).toHaveLength(1);
    const a = abilities[0];
    expect(a.trigger.event).toBe("entersBattlefield");
    expect(a.interveningIf).toBe("you have 10 or less life");
    // The if-clause must be stripped from the effect text.
    expect(a.effect).toBe("draw a card");
  });

  it("extracts an intervening-if from an 'At ... upkeep, if ..., ...' trigger", () => {
    // Real card: Test of Endurance.
    const abilities = parseTriggeredAbilities(
      "At the beginning of your upkeep, if you have 50 or more life, you win the game.",
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0].trigger.event).toBe("upkeep");
    expect(abilities[0].interveningIf).toBe("you have 50 or more life");
    expect(abilities[0].effect).toBe("you win the game");
  });

  it("extracts a 'you control a <Type>' intervening-if", () => {
    const abilities = parseTriggeredAbilities(
      "Whenever a creature attacks, if you control a Knight, that creature gains trample until end of turn.",
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0].trigger.event).toBe("attacked");
    expect(abilities[0].interveningIf).toBe("you control a Knight");
    expect(abilities[0].effect).toBe(
      "that creature gains trample until end of turn",
    );
  });

  it("leaves effect intact and interveningIf undefined for triggers without an if-clause", () => {
    const abilities = parseTriggeredAbilities(
      "When ~ enters the battlefield, draw a card.",
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0].trigger.event).toBe("entersBattlefield");
    expect(abilities[0].interveningIf).toBeUndefined();
    expect(abilities[0].effect).toBe("draw a card");
  });

  it("does not treat a later-sentence 'If you do' as an intervening-if", () => {
    // The 'If you do' lives in a separate sentence (after a period) so it must
    // NOT be peeled off as an intervening-if.
    const card = createMockCard({
      oracle_text:
        "When ~ enters the battlefield, exile target creature. If you do, draw a card.",
    });
    const result = parseOracleText(card);
    const etb = result.triggeredAbilities.find(
      (a) => a.trigger.event === "entersBattlefield",
    );
    expect(etb).toBeDefined();
    expect(etb!.interveningIf).toBeUndefined();
    expect(etb!.effect).toBe("exile target creature");
  });

  it("parses multiple abilities where only one has an intervening-if", () => {
    const abilities = parseTriggeredAbilities(
      "When ~ enters the battlefield, draw a card.\nAt the beginning of your upkeep, if you have 50 or more life, you win the game.",
    );
    expect(abilities.length).toBeGreaterThanOrEqual(2);
    const withIf = abilities.find((a) => a.interveningIf);
    expect(withIf?.interveningIf).toBe("you have 50 or more life");
    const withoutIf = abilities.find((a) => !a.interveningIf);
    expect(withoutIf).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. evaluateInterveningIfClause — recognized conditions + default-false
// ---------------------------------------------------------------------------
describe("evaluateInterveningIfClause — recognized conditions", () => {
  let state: GameState;
  let alice: PlayerId;
  beforeEach(() => {
    state = makeGame();
    [alice] = playerIds(state);
  });

  it("'you have N or less life' tracks the controller's life", () => {
    setLife(state, alice, 5);
    expect(
      evaluateInterveningIfClause("you have 10 or less life", state, alice),
    ).toBe(true);
    setLife(state, alice, 11);
    expect(
      evaluateInterveningIfClause("you have 10 or less life", state, alice),
    ).toBe(false);
  });

  it("'you have N or more life'", () => {
    setLife(state, alice, 60);
    expect(
      evaluateInterveningIfClause("you have 50 or more life", state, alice),
    ).toBe(true);
    setLife(state, alice, 20);
    expect(
      evaluateInterveningIfClause("you have 50 or more life", state, alice),
    ).toBe(false);
  });

  it("'you control a Knight'", () => {
    expect(
      evaluateInterveningIfClause("you control a Knight", state, alice),
    ).toBe(false);
    placeOnBattlefield(
      state,
      createMockCard({ name: "Knight", type_line: "Creature — Human Knight" }),
      alice,
    );
    expect(
      evaluateInterveningIfClause("you control a Knight", state, alice),
    ).toBe(true);
  });

  it("'you control N or more Mountains'", () => {
    expect(
      evaluateInterveningIfClause(
        "you control 3 or more Mountains",
        state,
        alice,
      ),
    ).toBe(false);
    for (let i = 0; i < 3; i++) {
      placeOnBattlefield(
        state,
        createMockCard({
          name: `Mountain${i}`,
          type_line: "Basic Land — Mountain",
        }),
        alice,
      );
    }
    expect(
      evaluateInterveningIfClause(
        "you control 3 or more Mountains",
        state,
        alice,
      ),
    ).toBe(true);
  });

  it("returns false for an unrecognized clause (CR 603.4 conservative)", () => {
    // 'this turn' tracking is out of scope; the ability must NOT fire/resolve.
    setLife(state, alice, 5);
    expect(
      evaluateInterveningIfClause(
        "an opponent lost 3 or more life this turn",
        state,
        alice,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Trigger-time gating — abilities path (detectTriggeredAbilities)
// ---------------------------------------------------------------------------
describe("CR 603.4 — trigger-time gating (detectTriggeredAbilities)", () => {
  let state: GameState;
  let alice: PlayerId;
  beforeEach(() => {
    state = makeGame();
    [alice] = playerIds(state);
    placeOnBattlefield(
      state,
      createMockCard({
        name: "Lifekeeper",
        oracle_text:
          "When ~ enters the battlefield, if you have 10 or less life, draw a card.",
      }),
      alice,
    );
  });

  it("fires when the intervening-if is true at the trigger event", () => {
    setLife(state, alice, 5);
    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].interveningIf).toBe("you have 10 or less life");
  });

  it("does NOT fire when the intervening-if is false at the trigger event", () => {
    setLife(state, alice, 20);
    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    expect(triggers).toHaveLength(0);
  });

  it("does not affect triggers without an intervening-if (no regression)", () => {
    const plain = makeGame();
    const [a] = playerIds(plain);
    placeOnBattlefield(
      plain,
      createMockCard({
        name: "Cantrip Dude",
        oracle_text: "When ~ enters the battlefield, draw a card.",
      }),
      a,
    );
    setLife(plain, a, 20); // any life
    expect(detectTriggeredAbilities(plain, "entersBattlefield")).toHaveLength(
      1,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Trigger-time gating — trigger-system path (detectTurnStartTriggers)
//    This also proves getTriggeredAbilitiesFromCard now delegates to the oracle
//    parser (issue #1057 acceptance criterion).
// ---------------------------------------------------------------------------
describe("CR 603.4 — trigger-time gating (detectTurnStartTriggers, parser delegation)", () => {
  let state: GameState;
  let alice: PlayerId;
  beforeEach(() => {
    state = makeGame();
    [alice] = playerIds(state);
    placeOnBattlefield(
      state,
      createMockCard({
        name: "Test of Endurance",
        type_line: "Enchantment",
        oracle_text:
          "At the beginning of your upkeep, if you have 50 or more life, you win the game.",
      }),
      alice,
    );
  });

  it("fires when the intervening-if is true at the trigger event", () => {
    setLife(state, alice, 60);
    expect(detectTurnStartTriggers(state, alice)).toHaveLength(1);
  });

  it("does NOT fire when the intervening-if is false at the trigger event", () => {
    setLife(state, alice, 20);
    expect(detectTurnStartTriggers(state, alice)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Resolution re-check / fizzle (CR 603.4 second check)
// ---------------------------------------------------------------------------
function abilityOnStack(
  state: GameState,
  controllerId: PlayerId,
  opts: { interveningIf?: string; effectAmount?: number },
): GameState {
  const stackObject: StackObject = {
    id: `ability-${Math.random().toString(36).substr(2, 9)}`,
    type: "ability",
    sourceCardId: null,
    controllerId,
    name: "triggered ability",
    text: "gain life",
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    effects: [
      {
        effectType: "life_gain",
        amount: opts.effectAmount ?? 2,
        targetId: controllerId,
      },
    ],
    interveningIf: opts.interveningIf,
  };
  return { ...state, stack: [...state.stack, stackObject] };
}

describe("CR 603.4 — resolution re-check (resolveTopOfStack fizzle)", () => {
  let state: GameState;
  let alice: PlayerId;
  beforeEach(() => {
    state = makeGame();
    [alice] = playerIds(state);
  });

  it("applies the effect when the intervening-if is still true at resolution", () => {
    setLife(state, alice, 5);
    const withTrigger = abilityOnStack(state, alice, {
      interveningIf: "you have 10 or less life",
    });
    const resolved = resolveTopOfStack(withTrigger);
    // 5 + 2 (life_gain) = 7
    expect(state.players.get(alice)!.life).toBe(5);
    expect(resolved.players.get(alice)!.life).toBe(7);
    expect(resolved.stack).toHaveLength(0);
  });

  it("fizzles (no effect) when the intervening-if is false at resolution", () => {
    setLife(state, alice, 20);
    const withTrigger = abilityOnStack(state, alice, {
      interveningIf: "you have 10 or less life",
    });
    const resolved = resolveTopOfStack(withTrigger);
    expect(resolved.players.get(alice)!.life).toBe(20); // unchanged
    expect(resolved.stack).toHaveLength(0); // removed (fizzled)
  });

  it("resolves normally when there is no intervening-if (no regression)", () => {
    setLife(state, alice, 20);
    const withTrigger = abilityOnStack(state, alice, {
      interveningIf: undefined,
    });
    const resolved = resolveTopOfStack(withTrigger);
    expect(resolved.players.get(alice)!.life).toBe(22); // 20 + 2
    expect(resolved.stack).toHaveLength(0);
  });
});
