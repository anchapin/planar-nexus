/**
 * Scrawling Crawler (FDN 132): upkeep + each_player draws 1.
 *
 * Lane 85 of the Wave 4.8 follow-up 11 loop. Scrawling Crawler's full
 * oracle is two abilities:
 *   1. "At the beginning of your upkeep, each player draws a card."
 *   2. "Whenever an opponent draws a card, that player loses 1 life."
 *
 * The existing `cards/scrawling_crawler.json` only encodes the first
 * ability. The handoff defers the second ability ("Whenever an
 * opponent draws a card, that player loses 1 life") to a follow-up
 * lane; lane 85 is the v1 minimum to verify the upkeep + each_player
 * plumbing works end-to-end with a fresh test.
 *
 * The handoff explicitly notes: "Lane 85 is the smallest possible
 * lane — the JSON already exists; the work is the test."
 */
import {
  getCardScript,
  resolveScriptedAbility,
} from "../index";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
import { createCardInstance } from "../../card-instance";
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

describe("Scrawling Crawler (FDN 132): upkeep + each_player draws 1", () => {
  it("registry exposes Scrawling Crawler with the upkeep trigger", () => {
    const crawler = getCardScript("Scrawling Crawler");
    expect(crawler).toBeDefined();
    expect(crawler!.triggers).toBeDefined();
    expect(crawler!.triggers!).toHaveLength(1);
    const trig = crawler!.triggers![0];
    expect(trig.event).toBe("upkeep");
    expect(trig.whose).toBe("you");
    expect(trig.effects).toEqual([
      { op: "Draw", amount: 1, who: "each_player" },
    ]);
  });

  it("forwards the upkeep trigger with upkeepOf: 'you' to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Scrawling Crawler",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].trigger.event).toBe("upkeep");
    expect(abilities![0].trigger.upkeepOf).toBe("you");
  });

  it("upkeep trigger fires on phaseChange with triggerCondition 'upkeep'", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );

    const triggers = detectTriggeredAbilities(state, "phaseChange");
    const crawlerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("crawler"),
    );
    expect(crawlerTriggers).toHaveLength(1);
    expect(crawlerTriggers[0].triggerCondition).toBe("upkeep");
  });

  it("upkeep trigger resolves and each player draws 1 card", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );

    const triggers = detectTriggeredAbilities(state, "phaseChange");
    const crawlerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("crawler"),
    );
    expect(crawlerTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, crawlerTriggers);
    expect(stacked.stack).toHaveLength(1);

    const stackObject = stacked.stack[0];
    const beforeHand1 = stacked.zones.get(`${p1}-hand`)!.cardIds.length;
    const beforeHand2 = stacked.zones.get(`${p2}-hand`)!.cardIds.length;
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterHand1 = resolved.zones.get(`${p1}-hand`)!.cardIds.length;
    const afterHand2 = resolved.zones.get(`${p2}-hand`)!.cardIds.length;
    expect(afterHand1).toBe(beforeHand1 + 1);
    expect(afterHand2).toBe(beforeHand2 + 1);
  });
});