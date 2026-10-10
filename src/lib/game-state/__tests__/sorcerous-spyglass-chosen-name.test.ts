/**
 * Sorcerous Spyglass — chosen_name enter_choice engine arm
 * (Wave 4.7 phase 2 lane 49, #2708 phase 2a, #2594 follow-up, CR 614.1b).
 *
 * Sorcerous Spyglass reads:
 *   "As Sorcerous Spyglass enters, look at an opponent's hand, then
 *    choose any card name. Activated abilities of sources with the
 *    chosen name can't be activated unless they're mana abilities."
 *
 * v1 lane 49 ships ONLY the chosen-name engine arm:
 *  - `enter_choice: { kind: "chosen_name" }` surfaces a `choose_cards`
 *    waitingChoice pointing at the opponent's hand (reuses the
 *    existing `choose_cards` waitingChoice type per the handoff).
 *  - On resolve, `card.chosenCardName` is stamped with the chosen
 *    card's `name`. The chosen card stays in the opponent's hand
 *    (Sorcerous Spyglass does NOT exile it — unlike Duress / Thoughtseize).
 *
 * The chosen-name static block (lane 50, "activated abilities of
 * sources named X can't be activated unless they're mana abilities")
 * and the {T}: Add {C} AddMana ride a separate lane; this test
 * covers engine-arm + schema + resolution in isolation.
 *
 * The chosen-card-stays-in-hand part is the meaningful difference
 * vs the existing `choose_cards` resolver (which exiles via
 * `completeHandTargeting`, modeled after Duress / Thoughtseize).
 *
 * Lane 49 ships no card JSON (per the handoff: "the sample card
 * rides lane 50"), so this test registers a synthetic chosen_name
 * script under a Test Spyglass name and exercises the engine arms
 * on that synthetic. The harness mirrors the historic Test Goggles
 * pattern (Wave 4.7 lane 39 → 47 cleanup) and the lane 47 removal
 * confirmed synthetic cards of this shape add no unique coverage
 * once a real card ships. Lane 50's real Sorcerous Spyglass JSON
 * takes over end-to-end coverage.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveWaitingChoice } from "../spell-casting/choices";
import { fireEntersTriggers } from "../keyword-actions/enters";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import {
  CHOSEN_NAME_PROMPT_MARKER,
  ENTER_CHOICE_TYPE,
  createChosenNameWaitingChoice,
  createEnterChoiceWaitingChoice,
  hasEnterChoice,
  resolveChosenName,
} from "../keyword-actions/enter-choice";

const SORCEROUS_SPYGLASS_ORACLE =
  "As Sorcerous Spyglass enters, look at an opponent's hand, then choose any card name. Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.";

const TEST_SPYGLASS_NAME = "Test Spyglass (lane 49 engine)";
const TEST_SPYGLASS_SCRIPT = CardScriptSchema.parse({
  name: TEST_SPYGLASS_NAME,
  oracle: SORCEROUS_SPYGLASS_ORACLE,
  enter_choice: {
    kind: "chosen_name",
    text:
      "As Sorcerous Spyglass enters, look at an opponent's hand, then choose any card name.",
  },
});

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

const testSpyglass = card({
  name: TEST_SPYGLASS_NAME,
  oracle_text: SORCEROUS_SPYGLASS_ORACLE,
});

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

describe("Sorcerous Spyglass — chosen_name engine arm (Wave 4.7 phase 2 lane 49, #2708 phase 2a)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;
  let spyglassId: CardInstanceId;
  let bobHandId: CardInstanceId;

  beforeAll(() => {
    registerCardScripts([...RAW_CARD_SCRIPTS, TEST_SPYGLASS_SCRIPT]);
  });

  afterAll(() => {
    // Restore the canonical registry so later tests see the
    // production set; `card-scripts.test.ts`'s
    // "registers every script file under its card name" loops
    // would otherwise fail because we added one extra name.
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 4 });
    // Place the synthetic Spyglass on Alice's battlefield and a
    // card named "Lightning Bolt" in Bob's hand so the
    // resolution tests have something concrete to pick.
    spyglassId = put(state, alice, "battlefield", testSpyglass);
    bobHandId = put(
      state,
      bob,
      "hand",
      card({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}" }),
    );
  });

  it("hasEnterChoice is true for a chosen_name scripted card", () => {
    expect(hasEnterChoice(state.cards.get(spyglassId)!)).toBe(true);
  });

  it("createEnterChoiceWaitingChoice routes chosen_name to a choose_cards waitingChoice", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId);
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe("choose_cards");
    expect(choice!.playerId).toBe(alice);
    expect(choice!.stackObjectId).toBe(spyglassId);
    expect(choice!.prompt.startsWith(CHOSEN_NAME_PROMPT_MARKER)).toBe(true);
    // The opponent's hand has Lightning Bolt — that's the only
    // option for the controller to pick.
    expect(choice!.choices.map((c) => c.value)).toEqual([bobHandId]);
    expect(choice!.choices[0].label).toBe("Lightning Bolt");
    expect(choice!.minChoices).toBe(1);
    expect(choice!.maxChoices).toBe(1);
  });

  it("createChosenNameWaitingChoice returns null when the opponent has no cards in hand", () => {
    // Empty Bob's hand.
    const bobHandKey = `${bob}-hand`;
    state.zones.set(bobHandKey, {
      ...state.zones.get(bobHandKey)!,
      cardIds: [],
    });
    expect(createChosenNameWaitingChoice(state, spyglassId)).toBeNull();
    expect(createEnterChoiceWaitingChoice(state, spyglassId)).toBeNull();
  });

  it("fireEntersTriggers surfaces the choose_cards waitingChoice for chosen_name", () => {
    const after = fireEntersTriggers(state, spyglassId);
    expect(after.waitingChoice).not.toBeNull();
    const wc = after.waitingChoice!;
    expect(wc.type).toBe("choose_cards");
    expect(wc.playerId).toBe(alice);
    expect(wc.stackObjectId).toBe(spyglassId);
    expect(wc.prompt.startsWith(CHOSEN_NAME_PROMPT_MARKER)).toBe(true);
    expect(wc.choices.map((c) => c.value)).toEqual([bobHandId]);
    // Crucially NOT the value-list enter_choice type — chosen_name
    // uses the choose_cards shape so the UI doesn't need a new
    // waitingChoice type.
    expect(wc.type).not.toBe(ENTER_CHOICE_TYPE);
  });

  it("resolveChosenName stamps chosenCardName with the picked card's name", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveChosenName(state, alice, bobHandId);
    expect(r.success).toBe(true);
    expect(state.cards.get(spyglassId)!.chosenCardName).toBeNull();
    const updated = r.state.cards.get(spyglassId)!;
    expect(updated.chosenCardName).toBe("Lightning Bolt");
    // The chosen card stays in Bob's hand — Sorcerous Spyglass
    // only learns its name; nothing is exiled.
    expect(r.state.zones.get(`${bob}-hand`)!.cardIds).toContain(bobHandId);
    // And the prompt is cleared.
    expect(r.state.waitingChoice).toBeNull();
  });

  it("resolveChosenName leaves the chosen card in the opponent's hand (no exile)", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveChosenName(state, alice, bobHandId);
    expect(r.success).toBe(true);
    // Defensive: the chosen card is in Bob's hand AND not in exile.
    expect(
      r.state.zones.get(`${bob}-hand`)!.cardIds.includes(bobHandId),
    ).toBe(true);
    const exileZone = r.state.zones.get("exile");
    expect(exileZone?.cardIds.includes(bobHandId) ?? false).toBe(false);
  });

  it("resolveWaitingChoice routes choose_cards + chosen_name marker through resolveChosenName", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId)!;
    const beforeHandCardIds = state.zones.get(`${bob}-hand`)!.cardIds.slice();
    expect(beforeHandCardIds).toContain(bobHandId);
    state = { ...state, waitingChoice: choice };
    const r = resolveWaitingChoice(state, alice, bobHandId);
    expect(r.success).toBe(true);
    expect(r.state.waitingChoice).toBeNull();
    expect(r.state.cards.get(spyglassId)!.chosenCardName).toBe(
      "Lightning Bolt",
    );
    // Bob's hand is unchanged — the chosen card was not exiled.
    expect(r.state.zones.get(`${bob}-hand`)!.cardIds).toEqual(beforeHandCardIds);
  });

  it("resolveChosenName rejects the wrong playerId", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveChosenName(state, bob, bobHandId);
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/not this player/i);
  });

  it("resolveChosenName rejects an invalid card id (not in the choice)", () => {
    const choice = createEnterChoiceWaitingChoice(state, spyglassId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveChosenName(state, alice, "not-a-card-id");
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/invalid choice/i);
  });

  it("resolveChosenName no-ops idempotently when chosenCardName is already set", () => {
    const cardInstance = state.cards.get(spyglassId)! as CardInstance;
    state = {
      ...state,
      cards: new Map(state.cards).set(spyglassId, {
        ...cardInstance,
        chosenCardName: "Pre-set Name",
      }),
      waitingChoice: createEnterChoiceWaitingChoice(state, spyglassId),
    };
    const r = resolveChosenName(state, alice, bobHandId);
    expect(r.success).toBe(true);
    expect(r.description).toMatch(/already resolved/i);
    expect(r.state.cards.get(spyglassId)!.chosenCardName).toBe(
      "Pre-set Name",
    );
  });
});
