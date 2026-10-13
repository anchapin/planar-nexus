/**
 * Ajani's Pridemate + Twinblade Paladin + Drogskol Reaver: lifeGain triggers.
 *
 * Lane 86 of the Wave 4.8 follow-up 11 loop. All three cards share the
 * "Whenever you gain life, [effect]" trigger template. The trigger
 * template rides on lane 26's lifeGain plumbing (`event: "lifeGain"`,
 * `subject: "self"`, detected on `lifeGain` event). The handoff notes
 * the lane is "the smallest possible lane" — three cards with their
 * core life-gain triggers, with the static / anthem / mana-value
 * variants deferred to follow-up lanes.
 *
 * Out of scope (per handoff, each a follow-up lane):
 *  - Twinblade Paladin's "as long as you have 25 or more life"
 *    static for double strike + lifelink — no life-condition
 *    static arm shipped; deferred.
 *  - Drogskol Reaver's ETB + "if mana value 4 or greater" condition
 *    — the "life gained === 4" parallel pattern from lane 36.
 *  - lifelink keyword grant — parallel to lane 40's chosen-X
 *    anthem.
 *
 * Lane 86's v1 minimum is the three cards' core life-gain triggers.
 */
import {
  getCardScript,
  resolveScriptedAbility,
} from "../index";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
import { createCardInstance } from "../../card-instance";
import { gainLife as gainLifeAction } from "../../player-actions";
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
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("Ajani's Pridemate (FDN): lifeGain → +1/+1 counter on self", () => {
  it("registry exposes Ajani's Pridemate with the lifeGain trigger", () => {
    const pridemate = getCardScript("Ajani's Pridemate");
    expect(pridemate).toBeDefined();
    expect(pridemate!.triggers!).toHaveLength(1);
    const trig = pridemate!.triggers![0];
    expect(trig.event).toBe("lifeGain");
    expect(trig.subject).toBe("self");
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "self",
      },
    ]);
  });

  it("forwards lifeGain to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Ajani's Pridemate",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].trigger.event).toBe("lifeGain");
  });

  it("lifeGain trigger fires and resolves into a +1/+1 counter on the source", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "pridemate",
      card("Ajani's Pridemate", "Creature — Cat Soldier", [2, 2]),
    );

    // Drive a life-gain event so the trigger has a reason to fire.
    state = gainLifeAction(state, p1, 3);

    const triggers = detectTriggeredAbilities(state, "lifeGain");
    const pridemateTriggers = triggers.filter(
      (t) => t.sourceCardId === id("pridemate"),
    );
    expect(pridemateTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, pridemateTriggers);
    expect(stacked.stack).toHaveLength(1);

    const stackObject = stacked.stack[0];
    const beforeCounters = stacked.cards.get(id("pridemate"))!.counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterCounters = resolved.cards.get(id("pridemate"))!.counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    expect(afterCounters).toBe(beforeCounters + 1);
  });
});

describe("Twinblade Paladin (FDN): lifeGain → +1/+1 counter on self", () => {
  it("registry exposes Twinblade Paladin with the lifeGain trigger", () => {
    const paladin = getCardScript("Twinblade Paladin");
    expect(paladin).toBeDefined();
    expect(paladin!.triggers!).toHaveLength(1);
    const trig = paladin!.triggers![0];
    expect(trig.event).toBe("lifeGain");
    expect(trig.subject).toBe("self");
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "self",
      },
    ]);
  });

  it("lifeGain trigger fires and resolves into a +1/+1 counter on the source", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "paladin",
      card("Twinblade Paladin", "Creature — Human Knight", [4, 4]),
    );

    state = gainLifeAction(state, p1, 2);

    const triggers = detectTriggeredAbilities(state, "lifeGain");
    const paladinTriggers = triggers.filter(
      (t) => t.sourceCardId === id("paladin"),
    );
    expect(paladinTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, paladinTriggers);
    const stackObject = stacked.stack[0];
    const beforeCounters = stacked.cards.get(id("paladin"))!.counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterCounters = resolved.cards.get(id("paladin"))!.counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    expect(afterCounters).toBe(beforeCounters + 1);
  });
});

describe("Drogskol Reaver (FDN 655): lifeGain → Draw 1", () => {
  it("registry exposes Drogskol Reaver with both triggers (lane 92)", () => {
    const reaver = getCardScript("Drogskol Reaver");
    expect(reaver).toBeDefined();
    // Wave 4.8 follow-up 12 lane 92 (#2614 follow-up): the
    // existing lifeGain trigger (lane 86 v1 minimum) AND a new
    // "Whenever a creature you control enters, if its mana value
    // is 4 or greater, you gain life equal to its toughness"
    // trigger.
    expect(reaver!.triggers!).toHaveLength(2);
    const lifeGain = reaver!.triggers![0];
    expect(lifeGain.event).toBe("lifeGain");
    expect(lifeGain.subject).toBe("self");
    expect(lifeGain.effects).toEqual([
      { op: "Draw", amount: 1, who: "you" },
    ]);
    const etbTrigger = reaver!.triggers![1];
    expect(etbTrigger.event).toBe("etb");
    expect(etbTrigger.subject).toBe("another");
    expect(etbTrigger.controller).toBe("you");
    expect(etbTrigger.intervening_if).toBe(
      "if its mana value is 4 or greater",
    );
    expect(etbTrigger.effects).toEqual([
      { op: "GainLife", amount: 1, who: "you", X: "toughness" },
    ]);
  });

  it("lifeGain trigger fires and resolves into a drawn card", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "reaver",
      card("Drogskol Reaver", "Creature — Spirit", [3, 3]),
    );

    state = gainLifeAction(state, p1, 4);

    const triggers = detectTriggeredAbilities(state, "lifeGain");
    const reaverTriggers = triggers.filter(
      (t) => t.sourceCardId === id("reaver"),
    );
    expect(reaverTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, reaverTriggers);
    const stackObject = stacked.stack[0];
    const beforeHand = stacked.zones.get(`${p1}-hand`)!.cardIds.length;
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterHand = resolved.zones.get(`${p1}-hand`)!.cardIds.length;
    expect(afterHand).toBe(beforeHand + 1);
  });
});