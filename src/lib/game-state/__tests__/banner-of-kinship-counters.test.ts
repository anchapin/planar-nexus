/**
 * Banner of Kinship — "enters with X counters" arm
 * (Wave 4.8 follow-up lane 59, #2614 follow-up).
 *
 * Banner of Kinship's "choose a creature type + enters with
 * X counters" pattern ships a new schema field on the card
 * script: `enters_with_counters_per_match: { subtype:
 * "chosen", counter: "+1/+1" }`. The engine reads the field
 * after `resolveEnterChoice` stamps
 * `card.chosenCreatureType` (the existing
 * `enter_choice: { kind: "creature_type" }` arm from
 * Wave 4.7 follow-up lane 44, #2705a) and counts how many
 * creatures `card.controllerId` controls on the battlefield
 * of the chosen subtype at that moment; it stamps that
 * many `+1/+1` counters on the source itself.
 *
 * The chosen-subtype anthem half is already shipped via
 * Wave 4.7 follow-up lane 45 (#2705b). Lane 59 ships ONLY
 * the counter-stamping arm + the real-card JSON.
 *
 * Sample-card rationale: Banner of Kinship IS the sample
 * card — its JSON (`cards/banner_of_kinship.json`) carries
 * both halves (chosen-subtype anthem + counter-stamping).
 * The synthetic script in this file exercises the engine
 * arm in isolation (same registry-helper pattern as
 * lanes 44 / 52 / 55).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import {
  getCardScript,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const STUB_BANNER_NAME = "Test Banner of Kinship Stub (lane 59)";
const HOST_SOLDIER_NAME = "Test Host Soldier (lane 59)";
const HOST_GOBLIN_NAME = "Test Host Goblin (lane 59)";
const HOST_HUMAN_NAME = "Test Host Human (lane 59)";

const STUB_SCRIPT = CardScriptSchema.parse({
  name: STUB_BANNER_NAME,
  oracle:
    "As this enters, choose a creature type. This enters with X counters on it, where X is the number of creatures you control of the chosen type.",
  enter_choice: {
    kind: "creature_type",
    text: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
  },
  enters_with_counters_per_match: {
    subtype: "chosen",
    counter: "+1/+1",
  },
});

function card(
  name: string,
  type_line: string,
  colors: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
  } as ScryfallCard;
}

function installSynthetic(): void {
  resetCardScriptsForTests();
  registerCardScripts([STUB_SCRIPT]);
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

describe("Banner of Kinship enters-with-X-counters arm (Wave 4.8 follow-up lane 59, #2614 follow-up)", () => {
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
    state = addMana(state, alice, { generic: 6 });
    installSynthetic();
  });

  afterEach(() => {
    resetCardScriptsForTests();
  });

  it("stamps 0 counters when no creatures of the chosen type are controlled", () => {
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [
          { label: "Soldier", value: "Soldier", isValid: true },
          { label: "Goblin", value: "Goblin", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "Soldier");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(bannerId) as CardInstance | undefined;
    expect(updated?.chosenCreatureType).toBe("Soldier");
    expect(updated?.instanceCounters?.["+1/+1"] ?? 0).toBe(0);
  });

  it("stamps N counters when N matching creatures are controlled", () => {
    // 3 Soldiers under Alice's control.
    put(state, alice, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    put(state, alice, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    put(state, alice, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    // 1 Goblin — should NOT be counted for a Soldier pick.
    put(state, alice, "battlefield", card(HOST_GOBLIN_NAME, "Creature — Goblin"));
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [
          { label: "Soldier", value: "Soldier", isValid: true },
          { label: "Goblin", value: "Goblin", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "Soldier");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(bannerId) as CardInstance | undefined;
    expect(updated?.chosenCreatureType).toBe("Soldier");
    expect(updated?.instanceCounters?.["+1/+1"]).toBe(3);
  });

  it("stamps the Goblin count when Goblin is chosen (filters by subtype)", () => {
    put(state, alice, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    put(state, alice, "battlefield", card(HOST_GOBLIN_NAME, "Creature — Goblin"));
    put(state, alice, "battlefield", card(HOST_GOBLIN_NAME, "Creature — Goblin"));
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [
          { label: "Soldier", value: "Soldier", isValid: true },
          { label: "Goblin", value: "Goblin", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "Goblin");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(bannerId) as CardInstance | undefined;
    expect(updated?.chosenCreatureType).toBe("Goblin");
    expect(updated?.instanceCounters?.["+1/+1"]).toBe(2);
  });

  it("only counts creatures controlled by the entering card's controller", () => {
    // Alice has 1 Soldier + 1 Goblin; Bob has 2 Soldiers.
    put(state, alice, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    put(state, alice, "battlefield", card(HOST_GOBLIN_NAME, "Creature — Goblin"));
    const [bob] = Array.from(state.players.keys()).filter(
      (p) => p !== alice,
    );
    put(state, bob, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    put(state, bob, "battlefield", card(HOST_SOLDIER_NAME, "Creature — Soldier"));
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [{ label: "Soldier", value: "Soldier", isValid: true }],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "Soldier");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(bannerId) as CardInstance | undefined;
    // Alice has 1 Soldier (Bob's 2 are not counted).
    expect(updated?.instanceCounters?.["+1/+1"]).toBe(1);
  });

  it("includes chosen-type additions (lane 52) in the count", () => {
    // Place a creature whose chosenTypeAdditions are
    // "Soldier" (Adaptive Automaton-style). The count
    // helper reads `chosenTypeAdditions` so this card
    // counts even though the printed type line is
    // "Creature — Construct".
    const automatonId = put(state, alice, "battlefield", card(
      "Test Adaptive Automaton (lane 59)",
      "Creature — Construct",
    ));
    const automaton = state.cards.get(automatonId)!;
    state.cards.set(automatonId, {
      ...automaton,
      chosenTypeAdditions: ["Soldier"],
    });
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [{ label: "Soldier", value: "Soldier", isValid: true }],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "Soldier");
    expect(r.success).toBe(true);
    const updated = r.state.cards.get(bannerId) as CardInstance | undefined;
    expect(updated?.instanceCounters?.["+1/+1"]).toBe(1);
  });

  it("the schema accept the enters_with_counters_per_match field shape", () => {
    // Pin the field on a minimal script (the schema is
    // exercised by the STUB_SCRIPT above; this test
    // confirms a card with ONLY the new field is a legal
    // script — the schema refine passes because the
    // script also carries `enter_choice`).
    const r = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "Enters with X counters.",
      enter_choice: { kind: "creature_type", text: "Choose a creature type." },
      enters_with_counters_per_match: {
        subtype: "chosen",
        counter: "+1/+1",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty subtype string (schema validation)", () => {
    // The schema's `subtype` is `z.string().min(1) | "chosen"`.
    // An empty literal fails the `min(1)` check.
    const r = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "Enters with X counters.",
      enter_choice: { kind: "creature_type", text: "Choose a creature type." },
      enters_with_counters_per_match: {
        subtype: "" as unknown as "chosen",
        counter: "+1/+1",
      },
    });
    expect(r.success).toBe(false);
  });

  it("Banner of Kinship JSON ships the dual chosen-subtype anthem + counter-stamping arm", () => {
    registerCardScripts(RAW_CARD_SCRIPTS);
    const banner = RAW_CARD_SCRIPTS.find(
      (s): s is {
        name: string;
        enter_choice?: { kind: string };
        enters_with_counters_per_match?: {
          subtype: string;
          counter: string;
        };
        statics?: Array<{ affects?: { subtype?: string } }>;
      } =>
        typeof s === "object" &&
        s !== null &&
        "name" in s &&
        (s as { name: unknown }).name === "Banner of Kinship",
    );
    expect(banner).toBeDefined();
    if (!banner)
      throw new Error("Banner of Kinship JSON not found in RAW_CARD_SCRIPTS");
    expect(banner.enter_choice?.kind).toBe("creature_type");
    // The new field is present with the chosen sentinel.
    expect(banner.enters_with_counters_per_match?.subtype).toBe("chosen");
    expect(banner.enters_with_counters_per_match?.counter).toBe("+1/+1");
    // The chosen-subtype anthem (lane 45) is also shipped.
    expect(banner.statics?.length).toBe(1);
    expect(banner.statics?.[0].affects?.subtype).toBe("chosen");
    // Card script registry hydrates from index.generated.ts.
    const hydrated = getCardScript("Banner of Kinship");
    expect(hydrated).toBeDefined();
    expect(hydrated!.enters_with_counters_per_match?.subtype).toBe("chosen");
  });

  it("refreshScriptedStatics does NOT clear instanceCounters (they persist on the source)", () => {
    // The counter ledger is stamped at ETB and survives
    // until the card leaves the battlefield. Refresh
    // passes don't touch the ledger — only ETB
    // resolution does. Pin the documented persistence
    // so a future lane that introduces a refresh-side
    // clear surfaces here.
    const bannerId = put(state, alice, "battlefield", card(
      STUB_BANNER_NAME,
      "Enchantment",
    ));
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: bannerId,
        prompt: `As ${STUB_BANNER_NAME} enters, choose a creature type.`,
        choices: [{ label: "Human", value: "Human", isValid: true }],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    put(state, alice, "battlefield", card(HOST_HUMAN_NAME, "Creature — Human"));
    put(state, alice, "battlefield", card(HOST_HUMAN_NAME, "Creature — Human"));
    const r = resolveEnterChoice(state, alice, "Human");
    expect(r.success).toBe(true);
    state = r.state;
    const after = state.cards.get(bannerId)!;
    expect(after.instanceCounters?.["+1/+1"]).toBe(2);
    // Refresh pass; ledger stays.
    const afterRefresh = refreshScriptedStatics(state);
    const refreshedBanner = afterRefresh.cards.get(bannerId)!;
    expect(refreshedBanner.instanceCounters?.["+1/+1"]).toBe(2);
  });
});