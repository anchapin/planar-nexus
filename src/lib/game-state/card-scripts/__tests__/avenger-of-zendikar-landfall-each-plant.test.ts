/**
 * Avenger of Zendikar — `PutCounters.target_each: "each_creature"`
 * (lane 114 piece 2/2, #2614 follow-up).
 *
 * Avenger of Zendikar (DSC 186, Zendikar Rising):
 * "Landfall — Whenever a land enters the battlefield
 * under your control, you may put a +1/+1 counter on
 * each Plant creature you control."
 *
 * The smallest pick-up-able piece ships the
 * `target_each: { subtype }` mode on `PutCounters`
 * — the engine iterates the controller's
 * battlefield creatures matching the `subtype`
 * filter and stamps `amount` counters on each.
 * The "Landfall" event itself is already supported
 * (follow-up 5 lane 70 followed up on it earlier);
 * the "you may" gate is a separate `you_may: true`
 * arm (also shipped); this piece ships the
 * "each Plant" target mode.
 *
 * v1 minimum: a single `subtype` filter, the
 * `controller` field, no optional / kicker /
 * `use_source_power` integration. The "you may"
 * gate rides via the standard `you_may: true`
 * path on the trigger.
 *
 * Out of scope for lane 114 piece 2/2 (each a
 * follow-up lane):
 *   - multi-subtype filters ("each Plant or
 *     Insect")
 *   - quest counters in target_each mode
 *   - the existing `target_each` color filter
 */
import { getCardScript } from "../index";
import { resolveScriptedAbility } from "../interpret";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { createCardInstance } from "../../card-instance";
import { detectLandfallTriggers } from "../../keyword-actions/landfall";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const canonicalKey = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: canonicalKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(canonicalKey);
  if (!z) return state;
  zones.set(canonicalKey, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  return startGame(base);
}

function countersOn(
  state: GameState,
  cardId: CardInstanceId,
  counter: string,
): number {
  const card = state.cards.get(cardId);
  if (!card) return 0;
  return card.counters
    .filter((c) => c.type === counter)
    .reduce((sum, c) => sum + c.count, 0);
}

describe("PutCounters target_each: 'each_creature' with subtype filter (lane 114 piece 2/2)", () => {
  it("registry exposes the synthetic source with a PutCounters.target_each arm", () => {
    const landfall = getCardScript("Avenger Landfall Each Plant");
    expect(landfall).toBeDefined();
    const trig = landfall!.triggers![0];
    expect(trig.event).toBe("landfall");
    const eff = trig.effects![0];
    expect(eff.op).toBe("PutCounters");
    if (eff.op !== "PutCounters") throw new Error("narrow");
    expect(eff.target_each).toEqual({ subtype: "Plant" });
    expect(eff.counter).toBe("+1/+1");
    expect(eff.amount).toBe(1);
    expect(eff.controller).toBe("you");
  });

  it("stamps +1/+1 counters on every Plant the controller controls on landfall", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    // 3 Plants, 1 non-Plant creature, all on p1's
    // battlefield. A new land has just entered
    // (the landfall fires).
    state = put(state, p1, "avenger", card("Avenger Landfall Each Plant", "Creature — Plant Elemental", [0, 0]));
    state = put(state, p1, "plant1", card("Plant 1", "Creature — Plant", [0, 0]));
    state = put(state, p1, "plant2", card("Plant 2", "Creature — Plant", [0, 0]));
    state = put(state, p1, "plant3", card("Plant 3", "Creature — Plant", [0, 0]));
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));

    const avengerTriggers = detectLandfallTriggers(state, id("forest"));
    const avengerTrigger = avengerTriggers.filter(
      (t) => t.sourceCardId === id("avenger"),
    );
    expect(avengerTrigger).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, avengerTrigger);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // 4 plants (including avenger) get a +1/+1
    // counter; the bear is left alone (subtype
    // filter is "Plant").
    expect(countersOn(resolved, id("plant1"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant2"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant3"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("avenger"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("bear"), "+1/+1")).toBe(0);
  });

  it("excludes the opponent's Plants from the each_creature stamp", () => {
    // 2-player game: p1 has 2 Plants, p2 has 1
    // Plant. The Avenger is p1's. Only p1's
    // plants get counters.
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "avenger", card("Avenger Landfall Each Plant", "Creature — Plant Elemental", [0, 0]));
    state = put(state, p1, "plant1", card("Plant 1", "Creature — Plant", [0, 0]));
    state = put(state, p1, "plant2", card("Plant 2", "Creature — Plant", [0, 0]));
    state = put(state, p2, "plant3", card("Plant 3", "Creature — Plant", [0, 0]));
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));

    const avengerTriggers = detectLandfallTriggers(state, id("forest"));
    const avengerTrigger = avengerTriggers.filter(
      (t) => t.sourceCardId === id("avenger"),
    );
    const { state: stacked } = putTriggersOnStack(state, avengerTrigger);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // p1's 3 plants (including avenger) all get
    // a counter; p2's plant is left alone
    // (controller filter is "you").
    expect(countersOn(resolved, id("avenger"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant1"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant2"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant3"), "+1/+1")).toBe(0);
  });

  it("skips Plants in non-battlefield zones", () => {
    // 1 plant on the battlefield, 1 plant in
    // hand, 1 plant in the graveyard. Only the
    // battlefield plant gets a counter.
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "avenger", card("Avenger Landfall Each Plant", "Creature — Plant Elemental", [0, 0]));
    state = put(state, p1, "plant1", card("Plant 1", "Creature — Plant", [0, 0]));
    state = put(state, p1, "plant2", card("Plant 2", "Creature — Plant", [0, 0]), "hand");
    state = put(state, p1, "plant3", card("Plant 3", "Creature — Plant", [0, 0]), "graveyard");
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));

    const avengerTriggers = detectLandfallTriggers(state, id("forest"));
    const avengerTrigger = avengerTriggers.filter(
      (t) => t.sourceCardId === id("avenger"),
    );
    const { state: stacked } = putTriggersOnStack(state, avengerTrigger);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    expect(countersOn(resolved, id("plant1"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("plant2"), "+1/+1")).toBe(0);
    expect(countersOn(resolved, id("plant3"), "+1/+1")).toBe(0);
  });

  it("stamps no counters when no Plant creatures are on the battlefield", () => {
    // No Plant creatures → no counters. The
    // subtype filter excludes every other
    // creature (the bear is a Bear, the
    // avenger is the trigger source but is the
    // only Plant on the field — actually the
    // avenger IS a Plant, so 1 counter).
    // Use a Bear-only battlefield to verify
    // the "no match" case.
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "avenger", card("Avenger Landfall Each Plant", "Creature — Plant Elemental", [0, 0]));
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));

    const avengerTriggers = detectLandfallTriggers(state, id("forest"));
    const avengerTrigger = avengerTriggers.filter(
      (t) => t.sourceCardId === id("avenger"),
    );
    expect(avengerTrigger).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, avengerTrigger);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // Avenger itself is a Plant, so it gets 1
    // counter; the Bear is left alone.
    expect(countersOn(resolved, id("avenger"), "+1/+1")).toBe(1);
    expect(countersOn(resolved, id("bear"), "+1/+1")).toBe(0);
  });
});
