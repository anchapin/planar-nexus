/**
 * "As this enters, choose a [thing]" — enter-time choice engine arm
 * (Wave 4.7 lane 39, #2594 follow-up).
 *
 * v1 ships only `kind: "color"` (Heraldic Banner's chosen-color
 * anthem and AddMana halves are lanes 40 + 41). The engine:
 *  1. recognises `script.enter_choice` on a permanent,
 *  2. surfaces a `enter_choice` waitingChoice of W/U/B/R/G to the
 *     controller as the permanent enters,
 *  3. resolves the choice by stamping `card.chosenColor`.
 *
 * Sample card: `Test Goggles` (cards/test_goggles_enter_choice.json)
 * exercises ONLY the new arm. Downstream lanes will reuse the
 * `chosenColor` field for the chosen-color anthem and AddMana.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
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
import { getCardScript } from "../card-scripts/registry";
import { resolveWaitingChoice } from "../spell-casting/choices";
import {
  ENTER_CHOICE_TYPE,
  hasEnterChoice,
  resolveEnterChoice,
} from "../keyword-actions/enter-choice";
import type { WaitingChoice } from "../types";
import {
  applyDecisionAnswer,
  listDecisionAnswers,
} from "../legal-choices";
import { fireEntersTriggers } from "../keyword-actions/enters";

const ENTER_CHOICE_ORACLE = "As Test Goggles enters, choose a color.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Artifact",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const testGoggles = card({
  name: "Test Goggles",
  oracle_text: ENTER_CHOICE_ORACLE,
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

function enterChoiceFixture(
  state: GameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): WaitingChoice {
  return {
    type: ENTER_CHOICE_TYPE,
    playerId,
    stackObjectId: cardId,
    prompt: "As Test Goggles enters, choose a color.",
    choices: ["W", "U", "B", "R", "G"].map((v) => ({
      label: v,
      value: v,
      isValid: true,
    })),
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

describe("enter_choice — engine arm (Wave 4.7 lane 39)", () => {
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
    state = addMana(state, alice, { generic: 4 });
  });

  it("registers the enter_choice field on the script", () => {
    const script = getCardScript("Test Goggles");
    expect(script).toBeDefined();
    expect(script!.enter_choice).toEqual({
      kind: "color",
      text: "As Test Goggles enters, choose a color.",
    });
  });

  it("hasEnterChoice is true for the test goggles card", () => {
    const id = put(state, alice, "battlefield", testGoggles);
    const cardInstance = state.cards.get(id)!;
    expect(hasEnterChoice(cardInstance)).toBe(true);
    expect(cardInstance.chosenColor).toBeNull();
  });

  it("hasEnterChoice is false for a card without a script", () => {
    const id = put(state, alice, "battlefield", {
      ...card({ name: "Vanilla" }),
    });
    const cardInstance = state.cards.get(id)!;
    expect(hasEnterChoice(cardInstance)).toBe(false);
  });

  it("resolves the enter choice and stamps chosenColor", () => {
    const id = put(state, alice, "battlefield", testGoggles);
    const choice = enterChoiceFixture(state, id, alice);
    const withChoice: GameState = {
      ...state,
      waitingChoice: choice,
    };
    const r = resolveEnterChoice(withChoice, alice, "W");
    expect(r.success).toBe(true);
    expect(r.state.waitingChoice).toBeNull();
    expect(r.state.cards.get(id)?.chosenColor).toBe("W");
  });

  it("resolveEnterChoice rejects an invalid value", () => {
    const id = put(state, alice, "battlefield", testGoggles);
    const choice = enterChoiceFixture(state, id, alice);
    const withChoice: GameState = {
      ...state,
      waitingChoice: choice,
    };
    const r = resolveEnterChoice(withChoice, alice, "X");
    expect(r.success).toBe(false);
    expect(r.state.waitingChoice).toBe(choice);
  });

  it("resolveEnterChoice rejects when the player doesn't own the choice", () => {
    const id = put(state, alice, "battlefield", testGoggles);
    const choice = enterChoiceFixture(state, id, alice);
    const withChoice: GameState = {
      ...state,
      waitingChoice: choice,
    };
    const r = resolveEnterChoice(withChoice, bob, "W");
    expect(r.success).toBe(false);
  });

  it("fireEntersTriggers surfaces a waitingChoice for the entering card", () => {
    // Skip the cast path: place the card directly and run fireEntersTriggers
    // to mirror the land-play / token / moveCardToZone ETB flow.
    const id = put(state, alice, "battlefield", testGoggles);
    const after = fireEntersTriggers(state, id);
    expect(after.waitingChoice).not.toBeNull();
    expect(after.waitingChoice!.type).toBe(ENTER_CHOICE_TYPE);
    expect(after.waitingChoice!.playerId).toBe(alice);
    expect(after.waitingChoice!.choices.map((c) => c.value)).toEqual([
      "W",
      "U",
      "B",
      "R",
      "G",
    ]);
  });

  it("fireEntersTriggers does not surface a choice for a card without enter_choice", () => {
    const vanilla = card({ name: "Vanilla" });
    const id = put(state, alice, "battlefield", vanilla);
    const after = fireEntersTriggers(state, id);
    expect(after.waitingChoice).toBeNull();
  });

  it("casting Test Goggles surfaces the enter choice and resolves through resolveWaitingChoice", () => {
    const handId = put(state, alice, "hand", testGoggles);
    const cast = castSpell(state, alice, handId, []);
    expect(cast.success).toBe(true);
    let s = cast.state;
    s = resolveTopOfStack(s);
    // resolveTopOfStack already runs the ETB pipeline; the choice should
    // be surfaced on the resulting state.
    expect(s.waitingChoice).not.toBeNull();
    expect(s.waitingChoice!.type).toBe(ENTER_CHOICE_TYPE);
    // listDecisionAnswers surfaces W/U/B/R/G; applyDecisionAnswer routes
    // through resolveWaitingChoice and stamps chosenColor.
    const answers = listDecisionAnswers(s, alice);
    expect(answers.length).toBe(5);
    const pickW = answers.find(
      (a) =>
        a.kind === "waiting_choice" &&
        typeof a.value === "string" &&
        a.value === "W",
    );
    expect(pickW).toBeDefined();
    const r = applyDecisionAnswer(s, alice, pickW!);
    expect(r.success).toBe(true);
    const gogglesId = s.zones.get(`${alice}-battlefield`)!.cardIds.find(
      (cid) => state.cards.get(cid)?.cardData.name === "Test Goggles",
    );
    expect(gogglesId).toBeDefined();
    expect(r.state.cards.get(gogglesId!)?.chosenColor).toBe("W");
    expect(r.state.waitingChoice).toBeNull();
  });

  it("resolves the choice through resolveWaitingChoice directly", () => {
    const id = put(state, alice, "battlefield", testGoggles);
    const choice = enterChoiceFixture(state, id, alice);
    const withChoice: GameState = {
      ...state,
      waitingChoice: choice,
    };
    const r = resolveWaitingChoice(withChoice, alice, "U");
    expect(r.success).toBe(true);
    expect(r.state.cards.get(id)?.chosenColor).toBe("U");
  });
});
