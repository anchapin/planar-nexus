/**
 * Heraldic Banner — chosen-color anthem (Wave 4.7 lane 40, #2594
 * follow-up, CR 604 / 611.3c).
 *
 * "As Heraldic Banner enters, choose a color. Creatures you control
 * of the chosen color get +1/+1. {T}: Add one mana of the chosen
 * color." v1 ships ONLY the anthem half — the chosen-color
 * AddMana half is a separate follow-up (lane 41).
 *
 * The script combines two Wave 4.7 primitives:
 *  - lane 39's `enter_choice: { kind: "color" }` surfaces a
 *    `enter_choice` waiting choice when the Banner enters; the
 *    resolver stamps `card.chosenColor`.
 *  - lane 40's `affects.color: "chosen"` sentinel makes the anthem
 *    read `source.chosenColor` and substitute it at refresh time.
 *    Before the enter choice resolves `source.chosenColor` is null
 *    and the anthem is inert; once the player picks W/U/B/R/G, the
 *    refresh pass buffs creatures of that color.
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

const HERALDIC_BANNER_ORACLE =
  "As Heraldic Banner enters, choose a color. Creatures you control of the chosen color get +1/+1. {T}: Add one mana of the chosen color.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Artifact",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const heraldicBanner = card({
  name: "Heraldic Banner",
  oracle_text: HERALDIC_BANNER_ORACLE,
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
    prompt: "As Heraldic Banner enters, choose a color.",
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

describe("Heraldic Banner — chosen-color anthem (Wave 4.7 lane 40)", () => {
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
    const script = getCardScript("Heraldic Banner");
    expect(script).toBeDefined();
    expect(script!.enter_choice).toEqual({
      kind: "color",
      text: "As Heraldic Banner enters, choose a color.",
    });
    const stat = script!.statics?.[0];
    expect(stat).toBeDefined();
    expect((stat as { affects?: { color?: string } }).affects?.color).toBe(
      "chosen",
    );
  });

  it("anthem is inert before the enter choice resolves", () => {
    const bannerId = put(state, alice, "battlefield", heraldicBanner);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const after = refreshScriptedStatics(state);
    // source.chosenColor is null → anthem doesn't apply → bear gets
    // no +1/+1.
    expect(after.cards.get(bannerId)?.chosenColor).toBeNull();
    expect(pt(after, bearId)).toBeUndefined();
  });

  it("after choosing W, white creatures you control get +1/+1", () => {
    const bannerId = put(state, alice, "battlefield", heraldicBanner);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const withChoice = withEnterChoice(state, bannerId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    expect(r.success).toBe(true);
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(bannerId)?.chosenColor).toBe("W");
    expect(pt(after, bearId)).toEqual({ power: 1, toughness: 1 });
  });

  it("after choosing W, red creatures you control do not get the anthem", () => {
    const bannerId = put(state, alice, "battlefield", heraldicBanner);
    const redId = put(state, alice, "battlefield", redBear);
    const withChoice = withEnterChoice(state, bannerId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, redId)).toBeUndefined();
  });

  it("after choosing W, opponent's white creature does not get the anthem", () => {
    const bannerId = put(state, alice, "battlefield", heraldicBanner);
    const oppId = put(state, bob, "battlefield", oppWhiteBear);
    const withChoice = withEnterChoice(state, bannerId, alice);
    const r = resolveEnterChoice(withChoice, alice, "W");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, oppId)).toBeUndefined();
  });

  it("after choosing R, the anthem is for red creatures, not white", () => {
    const bannerId = put(state, alice, "battlefield", heraldicBanner);
    const whiteId = put(state, alice, "battlefield", whiteBear);
    const redId = put(state, alice, "battlefield", redBear);
    const withChoice = withEnterChoice(state, bannerId, alice);
    const r = resolveEnterChoice(withChoice, alice, "R");
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(bannerId)?.chosenColor).toBe("R");
    expect(pt(after, whiteId)).toBeUndefined();
    expect(pt(after, redId)).toEqual({ power: 1, toughness: 1 });
  });

  it("casting the Banner surfaces the enter choice; resolving applies the anthem", () => {
    const handId = put(state, alice, "hand", heraldicBanner);
    const bearId = put(state, alice, "battlefield", whiteBear);
    const cast = castSpell(state, alice, handId, []);
    expect(cast.success).toBe(true);
    let s = cast.state;
    s = resolveTopOfStack(s);
    expect(s.waitingChoice).not.toBeNull();
    // pick W
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
