/**
 * Landfall ability word (issue #2300, Standard remainder slice).
 */
import { detectLandfallTriggers, moveCardToZone } from "../keyword-actions";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { playLand } from "../mana";
import { parseOracleText } from "../oracle-text-parser";
import { Phase } from "../types";
import type { GameState, PlayerId, CardInstanceId, ScryfallCard } from "../types";

function card(name: string, typeLine: string, oracle: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
  } as unknown as ScryfallCard;
}

const LANDFALL = card(
  "Landfall Elf",
  "Creature — Elf",
  "Landfall — Whenever a land you control enters, you gain 1 life.",
);
const OLD_LANDFALL = card(
  "Old Landfall Elf",
  "Creature — Elf",
  "Landfall — Whenever a land enters the battlefield under your control, you gain 1 life.",
);
const FOREST = card("Forest", "Basic Land — Forest", "({T}: Add {G}.)");
const BEAR = card("Bear", "Creature — Bear", "");

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "hand" = "battlefield",
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

function landfallStack(state: GameState) {
  return state.stack.filter((o) => o.sourceCardId === id("elf"));
}

describe("landfall", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    let s = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(s.players.keys());
    while (s.turn.currentPhase !== Phase.PRECOMBAT_MAIN) {
      s = passPriority(s, s.priorityPlayerId!);
    }
    state = put(s, p1, "elf", LANDFALL);
  });

  it("parses current and older landfall wording as landfall triggers", () => {
    for (const data of [LANDFALL, OLD_LANDFALL]) {
      const [ability] = parseOracleText(data).triggeredAbilities;
      expect(ability.trigger.event).toBe("landfall");
      expect(ability.effect).toBe("you gain 1 life");
    }
  });

  it("triggers when you play a land", () => {
    const st = put(state, p1, "forest", FOREST, "hand");
    const result = playLand(st, p1, id("forest"));
    expect(result.success).toBe(true);
    const triggers = landfallStack(result.state);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].text).toBe("you gain 1 life");
  });

  it("triggers when a land is put onto the battlefield", () => {
    const st = put(state, p1, "forest", FOREST, "hand");
    const result = moveCardToZone(st, id("forest"), "battlefield");
    expect(result.success).toBe(true);
    expect(landfallStack(result.state)).toHaveLength(1);
  });

  it("does not trigger for an opponent's land", () => {
    const st = put(state, p2, "theirForest", FOREST, "hand");
    const result = moveCardToZone(st, id("theirForest"), "battlefield");
    expect(result.success).toBe(true);
    expect(landfallStack(result.state)).toHaveLength(0);
  });

  it("does not trigger when a nonland permanent enters", () => {
    const st = put(state, p1, "bear", BEAR, "hand");
    const result = moveCardToZone(st, id("bear"), "battlefield");
    expect(result.success).toBe(true);
    expect(landfallStack(result.state)).toHaveLength(0);
    expect(detectLandfallTriggers(result.state, id("bear"))).toHaveLength(0);
  });

  it("triggers each landfall permanent you control", () => {
    let st = put(state, p1, "oldElf", OLD_LANDFALL);
    st = put(st, p1, "forest", FOREST, "hand");
    const result = moveCardToZone(st, id("forest"), "battlefield");
    const sources = result.state.stack.map((o) => o.sourceCardId).sort();
    expect(sources).toEqual([id("elf"), id("oldElf")].sort());
  });
});
