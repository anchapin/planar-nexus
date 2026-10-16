/**
 * Redcap Gutter-Dweller full JSON — lane 57 (Wave 4.8
 * follow-up, #2614 follow-up).
 *
 * Lane 55 shipped the chosen-color addition static
 * (`affects.add_color: "W"|"U"|"B"|"R"|"G"|"chosen"` +
 * `addColorToSelf: true` opt-in flag). Lane 57 lands the
 * full real card JSON:
 *  - `enter_choice: { kind: "color" }` (Heraldic-Banner
 *    shape) so the player picks a color on ETB.
 *  - chosen-color `add_color: "chosen"` static — Redcap
 *    Gutter-Dweller is the chosen color in addition to
 *    its other colors. (The "literal form" referenced in
 *    the handoff is the lane-55 arm family — `add_color:
 *    "R"` literal was the engine-arm test, not a
 *    contradictory instruction; the real card text uses
 *    the chosen-color variant.)
 *  - `attacks` trigger that creates a red Treasure
 *    token (`CreatePredefinedToken`, shipped Wave 2 lane
 *    2544).
 *
 * Deferred: the "Goblins you control have menace as long
 * as Redcap Gutter-Dweller has three or more counters on
 * it" trigger is a counter-based trigger gate. The engine
 * has no general-purpose "this permanent has N+ counters"
 * trigger gate today; the new gate would be a multi-lane
 * addition (#2614 follow-up). Lane 57 ships the JSON
 * WITHOUT that trigger; the deferral is documented in
 * `docs/card-scripts/wave4-blockers.md`.
 *
 * Test coverage:
 *  1. Redcap Gutter-Dweller JSON ships the chosen-color
 *     `enter_choice` + chosen-color `add_color` static +
 *     attacks Treasure-token trigger.
 *  2. After resolving the chosen-color enter choice on
 *     the Redcap card, the engine stamps `chosenColor`
 *     and the `add_color: "chosen"` static arm picks it
 *     up via `chosenColorAdditions` → `getCardColors`
 *     unions the chosen color with the printed colors.
 *  3. The attacks trigger fires when Redcap attacks and
 *     creates a Treasure token via `CreatePredefinedToken`.
 *  4. The deferred Goblin-menace-when-3+-counters
 *     trigger is NOT in the script (per the lane 57
 *     documented deferral).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  getCardScript,
  registerCardScripts,
} from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { getCardColors } from "../evergreen-keywords";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature — Goblin Warrior",
    oracle_text: "",
    mana_cost: "{3}{R}",
    cmc: 4,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "3",
    toughness: "3",
    ...overrides,
  } as ScryfallCard;
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

describe("Redcap Gutter-Dweller full JSON (Wave 4.8 follow-up lane 57, #2614 follow-up)", () => {
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
    // Re-register the freshly regenerated index so
    // `getCardScript` reads the Redcap JSON.
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  it("Redcap Gutter-Dweller JSON ships chosen-color enter_choice + add_color chosen static + menace-when-3+-counters static + attacks Treasure trigger (Wave 4.8 follow-up 14 lane 57)", () => {
    const redcap = RAW_CARD_SCRIPTS.find(
      (s): s is {
        name: string;
        enter_choice?: { kind: string };
        statics?: Array<{
          affects?: {
            add_color?: string;
            addColorToSelf?: boolean;
            controller?: string;
            subtype?: string;
          };
          keywords?: string[];
          while_condition?: {
            kind: string;
            counter?: string;
            op?: string;
            n?: number;
          };
        }>;
        triggers?: Array<{
          event: string;
          subject: string;
          effects?: Array<{
            op: string;
            token?: string;
            count?: number;
          }>;
        }>;
      } =>
        typeof s === "object" &&
        s !== null &&
        "name" in s &&
        (s as { name: unknown }).name === "Redcap Gutter-Dweller",
    );
    expect(redcap).toBeDefined();
    if (!redcap) throw new Error("Redcap Gutter-Dweller JSON not found");
    // enter_choice: color
    expect(redcap.enter_choice?.kind).toBe("color");
    // Wave 4.8 follow-up 14 lane 57 (#2614 follow-up): two
    // statics now — the chosen-color self-add (lane 55) AND
    // the menace-when-3+-counters anthem (this lane).
    expect(redcap.statics?.length).toBe(2);
    // static 0: add_color "chosen" + addColorToSelf: true
    expect(redcap.statics?.[0].affects?.add_color).toBe("chosen");
    expect(redcap.statics?.[0].affects?.addColorToSelf).toBe(true);
    // static 1: Goblin menace-with-counter-conditional
    expect(redcap.statics?.[1].affects?.controller).toBe("you");
    expect(redcap.statics?.[1].affects?.subtype).toBe("Goblin");
    expect(redcap.statics?.[1].keywords).toEqual(["menace"]);
    expect(redcap.statics?.[1].while_condition?.kind).toBe(
      "counter_minimum",
    );
    expect(redcap.statics?.[1].while_condition?.counter).toBe("+1/+1");
    expect(redcap.statics?.[1].while_condition?.op).toBe("gte");
    expect(redcap.statics?.[1].while_condition?.n).toBe(3);
    // attacks trigger → CreatePredefinedToken treasure x1
    expect(redcap.triggers?.length).toBe(1);
    expect(redcap.triggers?.[0].event).toBe("attacks");
    expect(redcap.triggers?.[0].subject).toBe("self");
    expect(redcap.triggers?.[0].effects?.[0].op).toBe(
      "CreatePredefinedToken",
    );
    expect(redcap.triggers?.[0].effects?.[0].token).toBe("treasure");
    expect(redcap.triggers?.[0].effects?.[0].count).toBe(1);
  });

  it("the chosen-color static picks up the chosenColor instance field (lane 55 + lane 57 integration)", () => {
    // End-to-end: place a Redcap on the battlefield,
    // resolve the chosen-color enter choice, and verify
    // getCardColors unions the chosen color with the
    // printed Red (so a Redcap that's already printed R
    // sees no change; a colorless printed Redcap picks up
    // the chosen color).
    const redcap = card({
      name: "Redcap Gutter-Dweller",
      colors: [],
      color_identity: [],
    });
    const redcapId = put(state, alice, "battlefield", redcap);
    // Build a synthesized enter_choice waitingChoice
    // matching the schema's color arm (the real ETB
    // pipeline does this; we hand-build it for unit
    // isolation).
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: redcapId,
        prompt: "As Redcap Gutter-Dweller enters, choose a color.",
        choices: [
          { label: "White", value: "W", isValid: true },
          { label: "Blue", value: "U", isValid: true },
          { label: "Black", value: "B", isValid: true },
          { label: "Red", value: "R", isValid: true },
          { label: "Green", value: "G", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "R");
    expect(r.success).toBe(true);
    state = r.state;
    const redcapCard: CardInstance | undefined =
      state.cards.get(redcapId);
    expect(redcapCard?.chosenColor).toBe("R");
    // refreshScriptedStatics stamps chosenColorAdditions
    // on the source for `add_color: "chosen"` +
    // addColorToSelf.
    state = refreshScriptedStatics(state);
    const refreshed = state.cards.get(redcapId)!;
    expect(refreshed.chosenColorAdditions).toEqual(["R"]);
    // getCardColors unions printed colors (empty) with
    // chosenColorAdditions (["R"]).
    const colors = getCardColors(refreshed);
    expect(colors).toContain("red");
  });

  it("the chosen-color static merges with printed colors when both are present", () => {
    // Redcap Gutter-Dweller with printed colors [G].
    // Picking R on enter → colors becomes [G, R].
    const redcap = card({
      name: "Redcap Gutter-Dweller",
      colors: ["G"],
      color_identity: ["G", "R"],
    });
    const redcapId = put(state, alice, "battlefield", redcap);
    state = {
      ...state,
      waitingChoice: {
        type: "enter_choice",
        playerId: alice,
        stackObjectId: redcapId,
        prompt: "As Redcap Gutter-Dweller enters, choose a color.",
        choices: [
          { label: "White", value: "W", isValid: true },
          { label: "Blue", value: "U", isValid: true },
          { label: "Black", value: "B", isValid: true },
          { label: "Red", value: "R", isValid: true },
          { label: "Green", value: "G", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      },
    };
    const r = resolveEnterChoice(state, alice, "R");
    expect(r.success).toBe(true);
    state = r.state;
    state = refreshScriptedStatics(state);
    const refreshed = state.cards.get(redcapId)!;
    expect(refreshed.chosenColorAdditions).toEqual(["R"]);
    const colors = getCardColors(refreshed);
    expect(colors).toContain("green");
    expect(colors).toContain("red");
  });

  it("the deferred Goblin-menace-when-3+-counters trigger is NOT in the script (per the lane 57 deferral)", () => {
    // Lane 57 ships the JSON WITHOUT that trigger; the
    // counter-based trigger gate is a multi-lane gap
    // (#2614 follow-up) and the deferral is documented in
    // docs/card-scripts/wave4-blockers.md. We pin the
    // documented deferral here so a future lane that
    // adds it surfaces the change in this test.
    const hydrated = getCardScript("Redcap Gutter-Dweller");
    expect(hydrated).toBeDefined();
    expect(hydrated!.triggers?.length).toBe(1);
    // The one shipped trigger is the attacks → Treasure
    // trigger; no menace-on-3+-counters gate exists.
    expect(hydrated!.triggers?.[0].event).toBe("attacks");
  });
});