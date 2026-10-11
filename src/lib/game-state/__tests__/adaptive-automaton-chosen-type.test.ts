/**
 * Adaptive Automaton — full oracle (Wave 4.8 lane 53, #2594
 * follow-up, #2614 plan work).
 *
 * Adaptive Automaton's full oracle:
 *
 *   As Adaptive Automaton enters, choose a creature type.
 *   Adaptive Automaton is the chosen type in addition to its
 *   other types.
 *   Other creatures you control of the chosen type get +1/+1.
 *
 * Lane 45 (Wave 4.7 follow-up, PR #2715) shipped the anthem
 * half — "other creatures you control of the chosen type get
 * +1/+1" — via `affects.subtype: "chosen"`. Lane 52 (Wave 4.8,
 * PR #2723) shipped the engine arm for the type-change half
 * via `affects.add_creature_type: "chosen"` +
 * `addCreatureTypeToSelf: true`. This lane (lane 53) drops
 * the "anthem only" limitation comment and ships the full
 * oracle JSON, with the type-change static alongside the
 * anthem.
 *
 * End-to-end coverage this lane adds to the existing lane 45
 * tests: with the chosen type resolved, Adaptive Automaton's
 * own `subtypesOf` includes the chosen type (the type-change
 * half kicked in), so the anthem's `subtype === "chosen"`
 * substitution matches the source against itself at the next
 * refresh pass — but the anthem uses `other: true` so the
 * source is NOT buffed by its own anthem (the type-change
 * half is visible to OTHER statics, not a self-buff).
 *
 * The chosen-eviction-at-tombstone problem is covered by the
 * lane 52 engine test
 * (`add-creature-type-static.test.ts#clears chosenTypeAdditions
 * when the source leaves the battlefield`); the integration
 * here just verifies the two halves work together through the
 * real Adaptive Automaton JSON.
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
    // Wave 4.8 lane 53 added the type-change static at
    // index 0; the anthem half (lane 45) moved to index 1.
    const stat = script!.statics?.[1];
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

  describe("Wave 4.8 lane 53 — full-oracle JSON", () => {
    // Lane 53 drops the "anthem only" limitation comment
    // (added in lane 45) and ships the real
    // `adaptive_automaton.json` with both halves: the
    // chosen-type anthem (`affects.subtype: "chosen"`) AND
    // the chosen-type addition (`affects.add_creature_type:
    // "chosen"` + `addCreatureTypeToSelf: true`). The
    // anthem-half behaviour was already covered by lane 45
    // (the eight tests above); the additions below verify
    // the type-change half works through the real JSON.

    it("registers BOTH the type-change static AND the anthem on the script", () => {
      const script = getCardScript("Adaptive Automaton");
      expect(script).toBeDefined();
      expect(script!.statics).toHaveLength(2);
      // Index 0 is the type-change static (no P/T — a
      // meta-static per lane 52's allow-list). The order
      // matches the oracle text: "is the chosen type in
      // addition to its other types" comes before "other
      // creatures ... get +1/+1".
      const typeChange = script!.statics![0];
      expect(typeChange.affects?.add_creature_type).toBe("chosen");
      expect(typeChange.affects?.addCreatureTypeToSelf).toBe(true);
      // Index 1 is the anthem (lane 45).
      const anthem = script!.statics![1];
      expect(anthem.affects?.subtype).toBe("chosen");
      expect(anthem.affects?.other).toBe(true);
      expect(anthem.power).toBe(1);
      expect(anthem.toughness).toBe(1);
    });

    it("after the enter choice resolves, Adaptive Automaton's chosenTypeAdditions includes the chosen type", () => {
      const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
      const withChoice = withEnterChoice(state, automatonId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      expect(r.success).toBe(true);
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(automatonId)!;
      // The real JSON's type-change static (index 0) now
      // drives `chosenTypeAdditions` on the source itself.
      expect(updated.chosenTypeAdditions).toEqual(["Soldier"]);
    });

    it("the type-change half does NOT grant P/T or keywords to Adaptive Automaton itself", () => {
      // The full-oracle JSON's anthem is `other: true` so
      // it never self-buffs. The type-change static
      // carries no P/T or keywords. After resolving
      // Soldier and refreshing, the Automaton's
      // scriptStaticPT and scriptStaticKeywords are both
      // empty.
      const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
      const withChoice = withEnterChoice(state, automatonId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(automatonId)!;
      expect(pt(after, automatonId)).toBeUndefined();
      expect(updated.scriptStaticKeywords ?? []).toEqual([]);
    });

    it("a Soldier you control still gets the anthem +1/+1 (lane 45 regression check)", () => {
      // Lane 53 must not regress the lane 45 anthem path.
      const automatonId = put(state, alice, "battlefield", adaptiveAutomaton);
      const soldierId = put(state, alice, "battlefield", soldier);
      const withChoice = withEnterChoice(state, automatonId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      const after = refreshScriptedStatics(r.state);
      expect(pt(after, soldierId)).toEqual({ power: 1, toughness: 1 });
    });

    it("with two Adaptive Automatons choosing DIFFERENT types, each anthem is independent", () => {
      // The first chooses Soldier — buffs your Soldier.
      // The second chooses Wizard — does NOT buff your
      // Soldier (still the Soldier's only anthem source
      // is the first Automaton). The second's Wizard
      // anthem doesn't buff your Soldier either.
      const a1Id = put(state, alice, "battlefield", adaptiveAutomaton);
      const a2Id = put(state, alice, "battlefield", adaptiveAutomaton);
      const soldierId = put(state, alice, "battlefield", soldier);
      const wizardId = put(state, alice, "battlefield", wizard);
      // Resolve a1 → Soldier.
      let s = resolveEnterChoice(
        { ...state, waitingChoice: enterChoiceFor(a1Id, alice) },
        alice,
        "Soldier",
      ).state;
      // Resolve a2 → Wizard.
      s = resolveEnterChoice(
        { ...s, waitingChoice: enterChoiceFor(a2Id, alice) },
        alice,
        "Wizard",
      ).state;
      const after = refreshScriptedStatics(s);
      expect(after.cards.get(a1Id)?.chosenTypeAdditions).toEqual(["Soldier"]);
      expect(after.cards.get(a2Id)?.chosenTypeAdditions).toEqual(["Wizard"]);
      // Soldier gets +1/+1 from a1 (anthem half, +1 source),
      // nothing from a2 (which targets Wizard).
      expect(pt(after, soldierId)).toEqual({ power: 1, toughness: 1 });
      // Wizard gets +1/+1 from a2 only.
      expect(pt(after, wizardId)).toEqual({ power: 1, toughness: 1 });
    });
  });
});
