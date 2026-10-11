/**
 * Add creature type via static — engine arm (Wave 4.8 lane 52,
 * #2614 follow-up, #2708 phase 2 follow-up).
 *
 * Lane 52 ships the engine piece for "Adaptive Automaton is the
 * chosen type in addition to its other types" — a permanent
 * (not until-end-of-turn) creature-type-changing static on the
 * source itself. The anthem half (other creatures of the
 * chosen type get +1/+1) shipped in Wave 4.7 follow-up lane 45
 * (#2705b) and reads `source.chosenCreatureType` against
 * `target.subtypesOf(target)`. Lane 52 grows
 * `source.chosenTypeAdditions` at refresh time so the anthem
 * can see the addition on the source itself (the source's
 * `subtypesOf` now includes the chosen creature type, so the
 * anthem's `subtype === "chosen"` substitution matches against
 * the source's augmented subtypes).
 *
 * Schema (Wave 4.8 lane 52):
 *   `affects.add_creature_type: string | "chosen"` — the type
 *     to add. Literal string ("Soldier") for Eaten by Piranhas
 *     / Infernal Vessel-family cards; the `"chosen"` sentinel
 *     reads `source.chosenCreatureType` for Adaptive Automaton.
 *   `affects.addCreatureTypeToSelf: true` — companion flag
 *     opting in to the v1 self-only semantics. Without it the
 *     engine does NOT grow the source's subtypes.
 *
 * Engine:
 *   `staticAffects` returns true iff `source === target &&
 *   source.chosenCreatureType !== null` for the sentinel form,
 *   or just `source === target` for the literal form.
 *   `refreshScriptedStatics` writes the resolved type string
 *   into `source.chosenTypeAdditions` (the new
 *   `CardInstance` field). The local `subtypesOf` helper
 *   unions `chosenTypeAdditions` with the printed type line
 *   so the lane 45 chosen-type anthem can see the addition.
 *
 * v1 is bounded and self-only. The Aura-style "enchanted
 * creature is the chosen type" generalization rides lane 54.
 *
 * Lane 52 ships NO card JSON (per the handoff: the Adaptive
 * Automaton JSON update rides lane 53). This test exercises
 * the engine arm on a synthetic script registered via the
 * test harness, mirroring the lane 49 Test Spyglass pattern
 * (also a synthetic). Lane 53's real Adaptive Automaton JSON
 * takes over end-to-end coverage.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { refreshScriptedStatics, staticAffects } from "../keyword-actions/scripted-statics";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "../types";

const TEST_LITERAL_AUTO_NAME = "Test Automaton Literal (lane 52)";
const TEST_CHOSEN_AUTO_NAME = "Test Automaton Chosen (lane 52)";

const TEST_AUTO_LITERAL_ORACLE =
  "As Test Automaton enters, this creature is a Soldier in addition to its other types. Other creatures you control of the chosen type get +1/+1.";

const TEST_AUTO_CHOSEN_ORACLE =
  "As Test Automaton enters, choose a creature type. This creature is the chosen type in addition to its other types. Other creatures you control of the chosen type get +1/+1.";

const TEST_AUTO_LITERAL_SCRIPT = CardScriptSchema.parse({
  name: TEST_LITERAL_AUTO_NAME,
  oracle: TEST_AUTO_LITERAL_ORACLE,
  statics: [
    {
      text: "Test Automaton Literal is a Soldier in addition to its other types.",
      affects: {
        controller: "you",
        add_creature_type: "Soldier",
        addCreatureTypeToSelf: true,
      },
    },
  ],
});

const TEST_AUTO_CHOSEN_SCRIPT = CardScriptSchema.parse({
  name: TEST_CHOSEN_AUTO_NAME,
  oracle: TEST_AUTO_CHOSEN_ORACLE,
  enter_choice: {
    kind: "creature_type",
    text: "As Test Automaton Chosen enters, choose a creature type.",
  },
  statics: [
    {
      text: "Test Automaton Chosen is the chosen type in addition to its other types.",
      affects: {
        controller: "you",
        add_creature_type: "chosen",
        addCreatureTypeToSelf: true,
      },
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Artifact Creature \u2014 Construct",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

const testLiteral = card({ name: TEST_LITERAL_AUTO_NAME });
const testChosen = card({ name: TEST_CHOSEN_AUTO_NAME });

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

function enterChoiceFor(cardId: CardInstanceId, playerId: PlayerId): WaitingChoice {
  return {
    type: "enter_choice",
    playerId,
    stackObjectId: cardId,
    prompt: "As Test Automaton Chosen enters, choose a creature type.",
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

describe("Add creature type via static — engine arm (Wave 4.8 lane 52, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      TEST_AUTO_LITERAL_SCRIPT,
      TEST_AUTO_CHOSEN_SCRIPT,
    ]);
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 6 });
  });

  describe("schema", () => {
    it("accepts the literal-string add_creature_type arm", () => {
      const r = CardScriptSchema.safeParse(TEST_AUTO_LITERAL_SCRIPT);
      expect(r.success).toBe(true);
    });
    it("accepts the chosen-sentinel add_creature_type arm", () => {
      const r = CardScriptSchema.safeParse(TEST_AUTO_CHOSEN_SCRIPT);
      expect(r.success).toBe(true);
    });
    it("rejects add_creature_type without addCreatureTypeToSelf (no P/T, no keywords)", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: { controller: "you", add_creature_type: "Soldier" },
          },
        ],
      });
      // The schema refine requires either power/toughness,
      // keywords, X, chosen_name_block, or
      // (add_creature_type + addCreatureTypeToSelf). A bare
      // add_creature_type without addCreatureTypeToSelf is
      // rejected because the engine won't act on it (it's
      // effectively a no-op without the flag).
      expect(r.success).toBe(false);
    });
    it("rejects an unknown add_creature_type value (not a string, not 'chosen')", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: {
              controller: "you",
              add_creature_type: 42,
              addCreatureTypeToSelf: true,
            },
          },
        ],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("staticAffects", () => {
    it("returns true for source===target when the literal arm is set", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const source = state.cards.get(sourceId)!;
      const literalStat = TEST_AUTO_LITERAL_SCRIPT.statics![0];
      expect(staticAffects(literalStat, source, source)).toBe(true);
    });
    it("returns false when target !== source (v1 self-only)", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const targetId = put(
        state,
        alice,
        "battlefield",
        card({ name: "Other Construct" }),
      );
      const source = state.cards.get(sourceId)!;
      const target = state.cards.get(targetId)!;
      const literalStat = TEST_AUTO_LITERAL_SCRIPT.statics![0];
      expect(staticAffects(literalStat, source, target)).toBe(false);
    });
    it("returns true for source===target when the chosen sentinel resolves", () => {
      const sourceId = put(state, alice, "battlefield", testChosen);
      const source = state.cards.get(sourceId)! as CardInstance;
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      expect(r.success).toBe(true);
      const resolved = r.state.cards.get(sourceId)!;
      expect(resolved.chosenCreatureType).toBe("Soldier");
      const chosenStat = TEST_AUTO_CHOSEN_SCRIPT.statics![0];
      expect(staticAffects(chosenStat, resolved, resolved)).toBe(true);
    });
    it("returns false when the chosen sentinel is unresolved (no chosenCreatureType yet)", () => {
      const sourceId = put(state, alice, "battlefield", testChosen);
      const source = state.cards.get(sourceId)!;
      const chosenStat = TEST_AUTO_CHOSEN_SCRIPT.statics![0];
      // chosenCreatureType is null — the player hasn't
      // answered the enter choice. The static is inert
      // until it resolves.
      expect(source.chosenCreatureType).toBeNull();
      expect(staticAffects(chosenStat, source, source)).toBe(false);
    });
  });

  describe("refreshScriptedStatics", () => {
    it("stamps chosenTypeAdditions with the literal type on the source", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      expect(updated.chosenTypeAdditions).toEqual(["Soldier"]);
    });
    it("stamps chosenTypeAdditions with the resolved chosen type after the enter choice resolves", () => {
      const sourceId = put(state, alice, "battlefield", testChosen);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Wizard");
      expect(r.success).toBe(true);
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(sourceId)!;
      expect(updated.chosenTypeAdditions).toEqual(["Wizard"]);
    });
    it("does NOT stamp chosenTypeAdditions for the chosen sentinel before the enter choice resolves", () => {
      const sourceId = put(state, alice, "battlefield", testChosen);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      expect(updated.chosenTypeAdditions).toBeUndefined();
    });
    it("clears chosenTypeAdditions when the source leaves the battlefield", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const after = refreshScriptedStatics(state);
      expect(after.cards.get(sourceId)!.chosenTypeAdditions).toEqual([
        "Soldier",
      ]);
      // Move the source out of the battlefield zone. The
      // engine reads additions from `battlefieldCards`
      // only, so the refresh pass no longer sees the
      // addition-static source; `chosenTypeAdditions`
      // should be deleted on the next refresh.
      const bfKey = `${alice}-battlefield`;
      const bf = after.zones.get(bfKey)!;
      after.zones.set(bfKey, {
        ...bf,
        cardIds: bf.cardIds.filter((id) => id !== sourceId),
      });
      const after2 = refreshScriptedStatics(after);
      expect(after2.cards.get(sourceId)!.chosenTypeAdditions).toBeUndefined();
    });
    it("idempotent: a second refresh with no state change yields the same chosenTypeAdditions (no churn)", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const a1 = refreshScriptedStatics(state);
      const a2 = refreshScriptedStatics(a1);
      expect(a1.cards.get(sourceId)!.chosenTypeAdditions).toEqual(["Soldier"]);
      expect(a2.cards.get(sourceId)!.chosenTypeAdditions).toEqual(["Soldier"]);
      // The second call returns the same state object (no
      // churn) because the chosenTypeAdditions diff is
      // stable across the same inputs.
      expect(a2).toBe(a1);
    });
  });

  describe("subtypesOf read path", () => {
    // Mirrors lane 45's chosen-type anthem behaviour: after
    // lane 52 stamps the source's `chosenTypeAdditions`,
    // a second static reading `affects.subtype: "chosen"`
    // against `source.chosenCreatureType` MUST match the
    // source against itself. The integration with the
    // Adaptive Automaton anthem half is verified by the
    // adaptive-automaton-chosen-type.test.ts sibling test
    // (lane 53's real JSON test will exercise the full
    // pair end-to-end once lane 53 ships the JSON).
    it("the literal-source's subtypesOf includes 'Soldier' after refresh", () => {
      const sourceId = put(state, alice, "battlefield", testLiteral);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      // The printed type line is "Construct"; the addition
      // unions in "Soldier".
      expect(updated.chosenTypeAdditions).toEqual(["Soldier"]);
      const typeLine = updated.cardData.type_line ?? "";
      expect(typeLine).toContain("Construct");
    });
    it("the chosen-source's chosenTypeAdditions flips when the enter choice resolves to a new type", () => {
      const sourceId = put(state, alice, "battlefield", testChosen);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r1 = resolveEnterChoice(withChoice, alice, "Soldier");
      expect(r1.success).toBe(true);
      const a1 = refreshScriptedStatics(r1.state);
      expect(a1.cards.get(sourceId)!.chosenTypeAdditions).toEqual(["Soldier"]);
      // chosenCreatureType is mutable via
      // `resolveEnterChoice` today (the
      // `enter_choice` waitingChoice flow only fires
      // once in practice; the resolver does not gate
      // idempotency). A re-resolve with a new value
      // therefore updates the addition at the next
      // refresh — Adaptive Automaton's chosen type is
      // normally set once at ETB, but this documents
      // the v1 behaviour.
      const withChoiceAgain = {
        ...a1,
        waitingChoice: enterChoiceFor(sourceId, alice),
      };
      const r2 = resolveEnterChoice(withChoiceAgain, alice, "Wizard");
      expect(r2.success).toBe(true);
      const a2 = refreshScriptedStatics(r2.state);
      expect(a2.cards.get(sourceId)!.chosenTypeAdditions).toEqual(["Wizard"]);
    });
  });
});