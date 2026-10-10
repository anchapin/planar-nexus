/**
 * chosen `creature_type` enter_choice engine arm
 * (Wave 4.7 follow-up lane 44, #2705a, #2594 follow-up).
 *
 * Mirrors the Wave 4.7 lane 39 "color" arm: a card with
 * `enter_choice: { kind: "creature_type" }` surfaces an
 * `enter_choice` `waitingChoice` when it enters, and
 * `resolveEnterChoice` stamps `card.chosenCreatureType`. The
 * downstream anthem (lane 45, tracked as #2705b) reads the
 * instance field via an `affects.subtype: "chosen"` sentinel —
 * this lane covers ONLY the engine arm, no anthem substitution.
 *
 * Sample-card rationale: the two FDN `creature_type` candidates
 * (Banner of Kinship, Adaptive Automaton) both have anthems and
 * ride lane 45. Lane 44 is engine-only — no real card fits the
 * bare-arm shape. To exercise the engine arm in isolation we
 * `resetCardScriptsForTests()` between cases and install a
 * synthetic script via `registerCardScripts(...)`. This is
 * the same registry helper the production code uses — it
 * avoids jest spy tricks (the engine module already imports
 * `getCardScript` at module top, so a spy on the binding is
 * unreliable across Jest transforms).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "../types";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import {
  createEnterChoiceWaitingChoice,
  hasEnterChoice,
  resolveEnterChoice,
} from "../keyword-actions/enter-choice";

const CURATED_CREATURE_TYPES = [
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
] as const;

const STUB_NAME = "Test Creature-Type Goggles";

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

const stubCard = card({
  name: STUB_NAME,
  oracle_text:
    "As Test Creature-Type Goggles enters, choose a creature type.",
  type_line: "Artifact",
});

function installSyntheticScript(
  kind: "color" | "creature_type",
): void {
  resetCardScriptsForTests();
  registerCardScripts([
    {
      name: STUB_NAME,
      oracle: stubCard.oracle_text,
      enter_choice: {
        kind,
        text: `As ${STUB_NAME} enters, choose a ${
          kind === "color" ? "color" : "creature type"
        }.`,
      },
    },
  ]);
}

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zone}`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("chosen `creature_type` enter_choice engine arm (Wave 4.7 follow-up lane 44)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 4 });
  });

  afterEach(() => {
    // Tear down the synthetic script so other tests aren't
    // affected.
    resetCardScriptsForTests();
  });

  it("hasEnterChoice returns true for creature_type kind", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    expect(hasEnterChoice(state.cards.get(cardId)!)).toBe(true);
  });

  it("createEnterChoiceWaitingChoice lists the 10 curated creature types", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId);
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe("enter_choice");
    expect(choice!.choices.map((c) => String(c.value)).sort()).toEqual(
      [...CURATED_CREATURE_TYPES].sort(),
    );
    expect(choice!.minChoices).toBe(1);
    expect(choice!.maxChoices).toBe(1);
    expect(choice!.prompt).toBe(
      `As ${STUB_NAME} enters, choose a creature type.`,
    );
  });

  it("createEnterChoiceWaitingChoice defaults to color letters for kind: 'color' (lane 39 regression)", () => {
    installSyntheticScript("color");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId);
    expect(choice).not.toBeNull();
    expect(choice!.choices.map((c) => String(c.value)).sort()).toEqual(
      ["B", "G", "R", "U", "W"],
    );
    expect(choice!.prompt).toBe(
      `As ${STUB_NAME} enters, choose a color.`,
    );
  });

  it("resolveEnterChoice stamps chosenCreatureType for a curated creature type", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "Soldier");
    expect(r.success).toBe(true);
    expect(r.state.cards.get(cardId)?.chosenCreatureType).toBe("Soldier");
    // chosenColor is NOT touched (parallel field, separate kind).
    expect(r.state.cards.get(cardId)?.chosenColor).toBeNull();
    expect(r.state.waitingChoice).toBeNull();
  });

  it("resolveEnterChoice rejects an uncurated value (freeform types are UI-only)", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "Squirrel");
    expect(r.success).toBe(false);
    // "Squirrel" isn't in the curated list, so the engine's
    // option-validity lookup rejects it at the outer guard —
    // the curated-type validator is unreachable for unknown
    // values. The error description is the generic
    // "Invalid choice for pending enter choice" — the curated
    // validator is the second line of defence for any value
    // that slips past the option list (e.g. a malformed
    // consumer).
    expect(r.description).toMatch(/invalid/i);
    expect(r.state.cards.get(cardId)?.chosenCreatureType).toBeNull();
  });

  it("resolveEnterChoice rejects color letters against a creature_type choice", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "W");
    expect(r.success).toBe(false);
    // "W" isn't in the curated list either; same gate.
    expect(r.description).toMatch(/invalid/i);
  });

  it("the 'color' arm still stamps chosenColor (lane 39 regression)", () => {
    installSyntheticScript("color");
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "W");
    expect(r.success).toBe(true);
    expect(r.state.cards.get(cardId)?.chosenColor).toBe("W");
    // chosenCreatureType untouched.
    expect(r.state.cards.get(cardId)?.chosenCreatureType).toBeNull();
  });

  it("the new chosenCreatureType field defaults to null on freshly-created instances", () => {
    installSyntheticScript("creature_type");
    const cardId = put(state, alice, "battlefield", stubCard);
    expect(state.cards.get(cardId)?.chosenCreatureType).toBeNull();
  });

  it("resolveCardIdForChoice fallback matches a creature_type card by chosenCreatureType === null", () => {
    installSyntheticScript("creature_type");
    const aId = put(state, alice, "battlefield", stubCard);
    const bId = put(state, alice, "battlefield", stubCard);
    const choice: WaitingChoice = {
      type: "enter_choice",
      playerId: alice,
      stackObjectId: null,
      prompt: `As ${STUB_NAME} enters, choose a creature type.`,
      choices: CURATED_CREATURE_TYPES.map((v) => ({
        label: v,
        value: v,
        isValid: true,
      })),
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
    // Pre-resolve the second card to show the fallback only finds
    // the unresolved one.
    const first: GameState = {
      ...state,
      waitingChoice: choice,
      cards: new Map(state.cards).set(bId, {
        ...state.cards.get(bId)!,
        chosenCreatureType: "Elf",
      }),
    };
    const r = resolveEnterChoice(first, alice, "Soldier");
    expect(r.success).toBe(true);
    // The unresolved card wins the fallback.
    expect(r.state.cards.get(aId)?.chosenCreatureType).toBe("Soldier");
    expect(r.state.cards.get(bId)?.chosenCreatureType).toBe("Elf");
  });
});
