/**
 * Diamond Mare — chosen-color anthem on a creature
 * (Wave 4.7 follow-up lane 43, #2704, #2594 follow-up).
 *
 * "As Diamond Mare enters, choose a color. Creatures you control
 * of the chosen color get +1/+1." This is the lane 40 (Heraldic
 * Banner) anthem pattern verbatim, exercised on a CREATURE
 * permanent instead of an artifact. The Wave 4.7 lane 39
 * `enter_choice: { kind: "color" }` engine arm surfaces the
 * waiting choice and stamps `chosenColor` on the card instance;
 * the lane 40 `affects.color: "chosen"` sentinel makes the
 * anthem substitute `source.chosenColor` at refresh time. Both
 * arms already work on a creature permanent — no engine change.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { getCardScript } from "../card-scripts/registry";
import { applyDecisionAnswer, listDecisionAnswers } from "../legal-choices";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import type { WaitingChoice } from "../types";

const DIAMOND_MARE_ORACLE =
  "As Diamond Mare enters, choose a color. Creatures you control of the chosen color get +1/+1.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Horse",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
    colors: ["W"],
    color_identity: ["W"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

const diamondMare = card({
  name: "Diamond Mare",
  oracle_text: DIAMOND_MARE_ORACLE,
  type_line: "Creature \u2014 Horse",
});

// White creature target — gets +1/+1 when chosen color is "W".
const whiteBear = card({
  name: "White Bear",
  type_line: "Creature \u2014 Bear",
  oracle_text: "",
  mana_cost: "{W}",
  cmc: 1,
  colors: ["W"],
  color_identity: ["W"],
  power: "1",
  toughness: "1",
});
// Red creature — does NOT get +1/+1 when chosen color is "W".
const redBear = card({
  name: "Red Bear",
  type_line: "Creature \u2014 Bear",
  oracle_text: "",
  mana_cost: "{R}",
  cmc: 1,
  colors: ["R"],
  color_identity: ["R"],
  power: "1",
  toughness: "1",
});
// An opponent's white bear — does NOT get the anthem (controller: "you").
const oppWhiteBear = card({
  name: "Opponent White Bear",
  type_line: "Creature \u2014 Bear",
  oracle_text: "",
  mana_cost: "{W}",
  cmc: 1,
  colors: ["W"],
  color_identity: ["W"],
  power: "1",
  toughness: "1",
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

function enterChoiceFor(
  cardId: CardInstanceId,
  playerId: PlayerId,
): WaitingChoice {
  return {
    type: "enter_choice",
    playerId,
    stackObjectId: cardId,
    prompt: "As Diamond Mare enters, choose a color.",
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

function withEnterChoice(
  state: GameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): GameState {
  return { ...state, waitingChoice: enterChoiceFor(cardId, playerId) };
}

const pt = (s: GameState, id: CardInstanceId) =>
  s.cards.get(id)?.scriptStaticPT;

describe("Diamond Mare — chosen-color anthem on a creature (Wave 4.7 follow-up #2704)", () => {
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

  it("registers enter_choice + chosen-color anthem on the script", () => {
    const script = getCardScript("Diamond Mare");
    expect(script).toBeDefined();
    expect(script!.enter_choice).toEqual({
      kind: "color",
      text: "As Diamond Mare enters, choose a color.",
    });
    const stat = script!.statics?.[0];
    expect(stat).toBeDefined();
    expect((stat as { affects?: { color?: string } }).affects?.color).toBe(
      "chosen",
    );
  });

  it("anthem is inert before the enter choice resolves", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const after = refreshScriptedStatics(state);
    expect(after.cards.get(mareId)?.chosenColor).toBeNull();
    expect(pt(after, bearId)).toBeUndefined();
  });

  it("after choosing W, white creatures you control get +1/+1", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const withChoice = withEnterChoice(state, mareId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    expect(r.success).toBe(true);
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(mareId)?.chosenColor).toBe("W");
    expect(pt(after, bearId)).toEqual({ power: 1, toughness: 1 });
  });

  it("after choosing W, red creatures you control do not get the anthem", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const redId = put(state, alice, "battlefield", redBear);
    const withChoice = withEnterChoice(state, mareId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, redId)).toBeUndefined();
  });

  it("after choosing W, opponent's white creature does not get the anthem", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const oppId = put(state, bob, "battlefield", oppWhiteBear);
    const withChoice = withEnterChoice(state, mareId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, oppId)).toBeUndefined();
  });

  it("after choosing R, the anthem is for red creatures, not white", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const whiteId = put(state, alice, "battlefield", whiteBear);
    const redId = put(state, alice, "battlefield", redBear);
    const withChoice = withEnterChoice(state, mareId, alice);
    const r = resolveEnterChoice(withChoice, alice, "R");
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(mareId)?.chosenColor).toBe("R");
    expect(pt(after, whiteId)).toBeUndefined();
    expect(pt(after, redId)).toEqual({ power: 1, toughness: 1 });
  });

  it("Diamond Mare itself is buffed by its own anthem (controller: 'you' includes self)", () => {
    const mareId = put(state, alice, "battlefield", diamondMare);
    const withChoice = withEnterChoice(state, mareId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    const after = refreshScriptedStatics(r.state);
    // Diamond Mare is white; with chosenColor="W" its own anthem
    // applies and buffs the source.
    expect(pt(after, mareId)).toEqual({ power: 1, toughness: 1 });
  });

  it("casting Diamond Mare surfaces the enter choice; resolving applies the anthem", () => {
    const handId = put(state, alice, "hand", diamondMare);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const cast = castSpell(state, alice, handId, []);
    expect(cast.success).toBe(true);
    let s = cast.state;
    s = resolveTopOfStack(s);
    expect(s.waitingChoice).not.toBeNull();
    const answers = listDecisionAnswers(s, alice);
    const pickW = answers.find(
      (a) =>
        a.kind === "waiting_choice" &&
        typeof a.value === "string" &&
        a.value === "W",
    );
    expect(pickW).toBeDefined();
    const r = applyDecisionAnswer(s, alice, pickW!);
    expect(r.success).toBe(true);
    const refreshed = refreshScriptedStatics(r.state);
    expect(pt(refreshed, bearId)).toEqual({ power: 1, toughness: 1 });
  });
});
