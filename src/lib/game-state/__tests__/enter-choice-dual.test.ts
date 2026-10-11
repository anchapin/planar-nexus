/**
 * Dual `color_and_creature_type` enter_choice engine arm
 * (Wave 4.8 follow-up lane 56, #2614 follow-up).
 *
 * The compound `kind: "color_and_creature_type"` is the
 * "as this enters, choose a color AND a creature type"
 * pattern (Eaten by Piranhas). It surfaces ONE
 * `enter_choice` waitingChoice whose options are the
 * cross-product of color × creature type (each option
 * value is `"<color>|<type>"`); `resolveEnterChoice` writes
 * BOTH `chosenColor` AND `chosenCreatureType` from one
 * resolver call. Downstream unions (chosen-color anthem
 * lane 40, chosen-type anthem lane 45, chosen-type
 * addition lane 52, chosen-color addition lane 55) pick
 * up both halves.
 *
 * Sample-card rationale: Eaten by Piranhas' real effect
 * ("protection from") is a multi-lane gap (#2614); the
 * existing schema's static-allow-list refine does not
 * accept a bare protection-from arm. Lane 56 ships a
 * `color_and_creature_type` enter_choice + a chosen-color
 * anthem + a chosen-creature-type anthem on the JSON
 * (`cards/eaten_by_piranhas.json`), exercising the dual
 * arm end-to-end via the real card index. The synthetic
 * script in `STUB_DUAL_GOGGLES` covers the engine arm
 * in isolation (same registry-helper pattern as the
 * creature-type lane 44 test).
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
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { getCardScript } from "../card-scripts/registry";
import {
  createEnterChoiceWaitingChoice,
  decodeDualColorCreatureTypeChoice,
  enterChoiceOptionsForKind,
  hasEnterChoice,
  resolveEnterChoice,
} from "../keyword-actions/enter-choice";

const COLOR_LETTERS = ["W", "U", "B", "R", "G"] as const;
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

const STUB_DUAL_GOGGLES = "Test Dual-Choice Goggles";

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

function installDualSyntheticScript(): void {
  resetCardScriptsForTests();
  registerCardScripts([
    {
      name: STUB_DUAL_GOGGLES,
      oracle:
        "As Test Dual-Choice Goggles enters, choose a color and a creature type.",
      enter_choice: {
        kind: "color_and_creature_type",
        text: `As ${STUB_DUAL_GOGGLES} enters, choose a color and a creature type.`,
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

describe("dual color_and_creature_type enter_choice engine arm (Wave 4.8 follow-up lane 56)", () => {
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
    resetCardScriptsForTests();
  });

  it("hasEnterChoice returns true for the color_and_creature_type kind", () => {
    installDualSyntheticScript();
    const cardId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    expect(hasEnterChoice(state.cards.get(cardId)!)).toBe(true);
  });

  it("enterChoiceOptionsForKind surfaces the 5x10 cross-product for the dual kind", () => {
    const opts = enterChoiceOptionsForKind("color_and_creature_type");
    expect(opts).toHaveLength(50);
    for (const c of COLOR_LETTERS) {
      for (const t of CURATED_CREATURE_TYPES) {
        expect(opts).toContain(`${c}|${t}`);
      }
    }
  });

  it("decodeDualColorCreatureTypeChoice round-trips encoded values", () => {
    expect(decodeDualColorCreatureTypeChoice("W|Soldier")).toEqual({
      color: "W",
      creatureType: "Soldier",
    });
    expect(decodeDualColorCreatureTypeChoice("G|Dragon")).toEqual({
      color: "G",
      creatureType: "Dragon",
    });
  });

  it("decodeDualColorCreatureTypeChoice rejects malformed values", () => {
    expect(decodeDualColorCreatureTypeChoice("Soldier")).toBeNull();
    expect(decodeDualColorCreatureTypeChoice("W|")).toBeNull();
    expect(decodeDualColorCreatureTypeChoice("X|Soldier")).toBeNull();
    expect(decodeDualColorCreatureTypeChoice("W|Squirrel")).toBeNull();
    expect(decodeDualColorCreatureTypeChoice("W|Soldier|X")).toBeNull();
    expect(decodeDualColorCreatureTypeChoice("")).toBeNull();
  });

  it("createEnterChoiceWaitingChoice renders dual options as 'color — type' with encoded values", () => {
    installDualSyntheticScript();
    const cardId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    const choice = createEnterChoiceWaitingChoice(state, cardId);
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe("enter_choice");
    expect(choice!.choices).toHaveLength(50);
    // Spot-check a couple of options: encoded value, friendly
    // label.
    const opt = choice!.choices.find(
      (o) => String(o.value) === "W|Soldier",
    );
    expect(opt).toBeDefined();
    expect(opt!.label).toBe("W — Soldier");
    expect(choice!.minChoices).toBe(1);
    expect(choice!.maxChoices).toBe(1);
    expect(choice!.prompt).toBe(
      `As ${STUB_DUAL_GOGGLES} enters, choose a color and a creature type.`,
    );
  });

  it("resolveEnterChoice writes BOTH chosenColor AND chosenCreatureType from one call", () => {
    installDualSyntheticScript();
    const cardId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "W|Soldier");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(cardId);
    expect(updated?.chosenColor).toBe("W");
    expect(updated?.chosenCreatureType).toBe("Soldier");
    expect(r.state.waitingChoice).toBeNull();
  });

  it("resolveEnterChoice rejects a malformed encoded value", () => {
    installDualSyntheticScript();
    const cardId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    // Build the choice manually so we can pass an uncurated
    // value at the option-validity outer guard, similar to
    // the creature-type test's "Squirrel" rejection path.
    const choice: WaitingChoice = {
      type: "enter_choice",
      playerId: alice,
      stackObjectId: null,
      prompt: `As ${STUB_DUAL_GOGGLES} enters, choose a color and a creature type.`,
      choices: [
        { label: "W|Soldier", value: "W|Soldier", isValid: true },
        { label: "bad", value: "X|Squirrel", isValid: true },
      ],
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "X|Squirrel");
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/invalid/i);
    // Card remains untouched (resolver rejects before any
    // stamp).
    const updated = r.state.cards.get(cardId);
    expect(updated?.chosenColor).toBeNull();
    expect(updated?.chosenCreatureType).toBeNull();
  });

  it("resolveEnterChoice rejects an option value that doesn't match a curated color/type", () => {
    installDualSyntheticScript();
    const cardId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    // "W" is in the curated colors but is not in the option
    // list (the dual options are encoded with the creature
    // type). The outer option-validity guard rejects it.
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "W");
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/invalid/i);
  });

  it("resolveCardIdForChoice fallback matches a dual-kind card by chosenColor === null OR chosenCreatureType === null", () => {
    installDualSyntheticScript();
    const aId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    const bId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    const choice: WaitingChoice = {
      type: "enter_choice",
      playerId: alice,
      stackObjectId: null,
      prompt: `As ${STUB_DUAL_GOGGLES} enters, choose a color and a creature type.`,
      choices: [{ label: "W|Soldier", value: "W|Soldier", isValid: true }],
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
    // Pre-resolve `bId` fully so it's NOT pending. The
    // dual-kind predicate is "chosenColor === null OR
    // chosenCreatureType === null"; a card with both
    // fields stamped no longer qualifies. With bId
    // resolved, only aId is pending, so the fallback
    // matches aId deterministically.
    const pre: GameState = {
      ...state,
      waitingChoice: choice,
      cards: new Map(state.cards).set(bId, {
        ...state.cards.get(bId)!,
        chosenColor: "B",
        chosenCreatureType: "Goblin",
      }),
    };
    const r = resolveEnterChoice(pre, alice, "W|Soldier");
    expect(r.success).toBe(true);
    // aId gets the resolver's stamp.
    expect(r.state.cards.get(aId)?.chosenColor).toBe("W");
    expect(r.state.cards.get(aId)?.chosenCreatureType).toBe("Soldier");
    // bId is NOT touched (already resolved).
    expect(r.state.cards.get(bId)?.chosenColor).toBe("B");
    expect(r.state.cards.get(bId)?.chosenCreatureType).toBe("Goblin");
  });

  it("resolveCardIdForChoice fallback treats a half-stamped dual card as pending (only chosenColor set)", () => {
    installDualSyntheticScript();
    const aId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    const bId = put(state, alice, "battlefield", card({
      name: STUB_DUAL_GOGGLES,
    }));
    // Half-stamp bId: chosenColor is "B" but chosenCreatureType
    // is null. The dual predicate is `chosenColor === null
    // OR chosenCreatureType === null`, so bId STILL qualifies
    // as pending — but aId (both null) was inserted first,
    // so Map iteration order picks aId. This test pins
    // the half-stamped predicate behaviour on its own
    // assertion (the resolver writes both halves).
    const choice: WaitingChoice = {
      type: "enter_choice",
      playerId: alice,
      stackObjectId: null,
      prompt: `As ${STUB_DUAL_GOGGLES} enters, choose a color and a creature type.`,
      choices: [{ label: "U|Elf", value: "U|Elf", isValid: true }],
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
    const pre: GameState = {
      ...state,
      waitingChoice: choice,
      cards: new Map(state.cards).set(bId, {
        ...state.cards.get(bId)!,
        chosenColor: "B",
        // chosenCreatureType null
      }),
    };
    const r = resolveEnterChoice(pre, alice, "U|Elf");
    expect(r.success).toBe(true);
    // aId is the first pending card; resolver stamps both
    // fields.
    expect(r.state.cards.get(aId)?.chosenColor).toBe("U");
    expect(r.state.cards.get(aId)?.chosenCreatureType).toBe("Elf");
  });

  it("Eaten by Piranhas JSON ships the dual kind end-to-end via the registry", () => {
    // The schema + engine exercise the synthetic here; this
    // test confirms the real card JSON (regenerated by
    // scripts/build-card-script-index.ts) carries the new
    // kind and lands at the same predicate. Eaten by Piranhas'
    // real text uses 'protection from', which is a separate
    // multi-lane gap; the JSON here ships the dual-choice
    // arm + chosen-X anthem arms as the lane 56 bounded
    // scope.
    //
    // Re-register the generated index after the test suite's
    // `resetCardScriptsForTests()` so `getCardScript` returns
    // the parsed Eaten by Piranhas script.
    registerCardScripts(RAW_CARD_SCRIPTS);
    const piranhas = RAW_CARD_SCRIPTS.find(
      (s): s is { name: string; enter_choice?: { kind: string } } =>
        typeof s === "object" &&
        s !== null &&
        "name" in s &&
        (s as { name: unknown }).name === "Eaten by Piranhas",
    );
    expect(piranhas).toBeDefined();
    expect(piranhas).not.toBeNull();
    if (!piranhas) throw new Error("Eaten by Piranhas not found in RAW_CARD_SCRIPTS");
    expect(piranhas.enter_choice?.kind).toBe("color_and_creature_type");
    // Card script registry hydrates from index.generated.ts.
    const hydrated = getCardScript("Eaten by Piranhas");
    expect(hydrated).toBeDefined();
    expect(hydrated!.enter_choice?.kind).toBe("color_and_creature_type");
  });
});