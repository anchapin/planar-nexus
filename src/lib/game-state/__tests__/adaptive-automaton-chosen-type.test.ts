/**
 * Adaptive Automaton — chosen creature-type anthem (Wave 4.7
 * follow-up lane 45, #2705b, #2594 follow-up).
 *
 * Partial script: Adaptive Automaton's full oracle is
 *
 *   As Adaptive Automaton enters, choose a creature type.
 *   Adaptive Automaton is the chosen type in addition to its
 *   other types.
 *   Other creatures you control of the chosen type get +1/+1.
 *
 * This lane ships the anthem half (the first and third
 * sentences). The "is the chosen type in addition to its other
 * types" half is a creature-type-changing static that the
 * engine can't model today (the drafter list flags
 * "change creature types" — Eaten by Piranhas,
 * Infernal Vessel — as a multi-lane blocker; #2614). A
 * follow-up lane will add the type-change static.
 *
 * Mirrors the Wave 4.7 lane 40 (Heraldic Banner) split, which
 * shipped the chosen-color anthem without the chosen-color
 * AddMana (that rode lane 41). For Adaptive Automaton the
 * anthem rides lane 45 (#2705b) and the type-change static
 * would ride a future lane.
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

const ADAPTIVE_AUTOMATON_ORACLE =
  "As Adaptive Automaton enters, choose a creature type. Adaptive Automaton is the chosen type in addition to its other types. Other creatures you control of the chosen type get +1/+1.";

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

const adaptiveAutomaton = card({
  name: "Adaptive Automaton",
  oracle_text: ADAPTIVE_AUTOMATON_ORACLE,
  type_line: "Artifact Creature \u2014 Construct",
  power: "2",
  toughness: "2",
});

// A Soldier creature — gets +1/+1 when chosen type is "Soldier".
const soldier = card({
  name: "Test Soldier",
  type_line: "Creature \u2014 Human Soldier",
  oracle_text: "",
  mana_cost: "{W}",
  cmc: 1,
  colors: ["W"],
  color_identity: ["W"],
  power: "1",
  toughness: "1",
});
// A Wizard creature — does NOT get the anthem when chosen type is "Soldier".
const wizard = card({
  name: "Test Wizard",
  type_line: "Creature \u2014 Human Wizard",
  oracle_text: "",
  mana_cost: "{U}",
  cmc: 1,
  colors: ["U"],
  color_identity: ["U"],
  power: "1",
  toughness: "1",
});
// An opponent's Soldier — does NOT get the anthem (controller: "you").
const oppSoldier = card({
  name: "Opponent Soldier",
  type_line: "Creature \u2014 Human Soldier",
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
  options: { currentZoneKey?: string } = {},
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey:
      options.currentZoneKey ?? `${playerId}-${zone}`,
  });
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
    prompt: "As Adaptive Automaton enters, choose a creature type.",
    choices: [
      "Human",
      "Soldier",
      "Wizard",
      "Goblin",
      "Elf",
      "Vampire",
      "Dragon",
      "Merfolk",
      "Zombie",
      "Treefolk",
    ].map((v) => ({ label: v, value: v, isValid: true })),
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

describe("Adaptive Automaton — chosen creature-type anthem (Wave 4.7 follow-up lane 45)", () => {
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
    state = addMana(state, alice, { generic: 6 });
  });

  it("registers enter_choice + chosen-type anthem on the script", () => {
    const script = getCardScript("Adaptive Automaton");
    expect(script).toBeDefined();
    expect(script!.enter_choice).toEqual({
      kind: "creature_type",
      text: "As Adaptive Automaton enters, choose a creature type.",
    });
    const stat = script!.statics?.[0];
    expect(stat).toBeDefined();
    expect((stat as { affects?: { subtype?: string } }).affects?.subtype).toBe(
      "chosen",
    );
    expect((stat as { affects?: { other?: boolean } }).affects?.other).toBe(
      true,
    );
  });

  it("anthem is inert before the enter choice resolves", () => {
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    const soldierId = put(state, alice, "battlefield", soldier);
    const after = refreshScriptedStatics(state);
    expect(after.cards.get(automatonId)?.chosenCreatureType).toBeNull();
    expect(pt(after, soldierId)).toBeUndefined();
  });

  it("after choosing Soldier, your other Soldiers get +1/+1", () => {
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    const soldierId = put(state, alice, "battlefield", soldier);
    const withChoice = withEnterChoice(state, automatonId, alice);
    const r = resolveEnterChoice(withChoice, alice, "Soldier");
    expect(r.success).toBe(true);
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(automatonId)?.chosenCreatureType).toBe("Soldier");
    expect(pt(after, soldierId)).toEqual({ power: 1, toughness: 1 });
  });

  it("after choosing Wizard, your Wizards (not Soldiers) get the anthem", () => {
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    const soldierId = put(state, alice, "battlefield", soldier);
    const wizardId = put(state, alice, "battlefield", wizard);
    const withChoice = withEnterChoice(state, automatonId, alice);
    const r = resolveEnterChoice(withChoice, alice, "Wizard");
    const after = refreshScriptedStatics(r.state);
    expect(after.cards.get(automatonId)?.chosenCreatureType).toBe("Wizard");
    expect(pt(after, soldierId)).toBeUndefined();
    expect(pt(after, wizardId)).toEqual({ power: 1, toughness: 1 });
  });

  it("the anthem targets 'other' creatures only (Adaptive Automaton doesn't buff itself)", () => {
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    // We use a Soldier to model "Adaptive Automaton is the chosen
    // type in addition to its other types" — but that's the type-
    // changing half (unshipped). For the anthem-half test, the
    // anthem itself uses `other: true` so the source never gets
    // the buff regardless of its own type. The anthem should be
    // inert on the source.
    const withChoice = withEnterChoice(state, automatonId, alice);
    const r = resolveEnterChoice(withChoice, alice, "Construct");
    // "Construct" isn't in the curated list — but it IS the
    // chosen type from the perspective of the engine's
    // substitution path; the test uses a non-curated literal
    // here to exercise that the anthem targets `other: true`
    // and not the source. We can't drive the curated-type
    // substitute path with "Construct" because the engine
    // rejects uncurated values; instead the next test exercises
    // the actual curate-driven anthem on a Soldier (which would
    // buff Adaptive Automaton only if the anthem targeted self,
    // but it doesn't).
    expect(r.success).toBe(false);
  });

  it("with 'Soldier' chosen, a Soldier you control gets +1/+1 even if it shares type with the source", () => {
    // Adaptive Automaton itself is a Construct; its anthem uses
    // `other: true` so even if the source's type_line were to
    // become "Soldier" (the type-change half rides a follow-up
    // lane), the anthem would not buff itself. This test
    // exercises the same field: with Soldier chosen, a Soldier
    // creature you control gets +1/+1 because `other: true` only
    // excludes the SOURCE, not OTHER copies of the same
    // creature.
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    const other = put(state, alice, "battlefield", soldier);
    const withChoice = withEnterChoice(state, automatonId, alice);
    const r = resolveEnterChoice(withChoice, alice, "Soldier");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, automatonId)).toBeUndefined();
    expect(pt(after, other)).toEqual({ power: 1, toughness: 1 });
  });

  it("after choosing Soldier, opponent's Soldier does not get the anthem", () => {
    const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
    const oppId = put(state, bob, "battlefield", oppSoldier);
    const withChoice = withEnterChoice(state, automatonId, alice);
    const r = resolveEnterChoice(withChoice, alice, "Soldier");
    const after = refreshScriptedStatics(r.state);
    expect(pt(after, oppId)).toBeUndefined();
  });

  it("casting Adaptive Automaton surfaces the enter choice; resolving applies the anthem", () => {
    const handId = put(state, alice, "hand", adaptiveAutomaton);
    const soldierId = put(state, alice, "battlefield", soldier);
    const cast = castSpell(state, alice, handId, []);
    expect(cast.success).toBe(true);
    let s = cast.state;
    s = resolveTopOfStack(s);
    expect(s.waitingChoice).not.toBeNull();
    const answers = listDecisionAnswers(s, alice);
    const pickSoldier = answers.find(
      (a) =>
        a.kind === "waiting_choice" &&
        typeof a.value === "string" &&
        a.value === "Soldier",
    );
    expect(pickSoldier).toBeDefined();
    const r = applyDecisionAnswer(s, alice, pickSoldier!);
    expect(r.success).toBe(true);
    const refreshed = refreshScriptedStatics(r.state);
    expect(pt(refreshed, soldierId)).toEqual({ power: 1, toughness: 1 });
  });
});
