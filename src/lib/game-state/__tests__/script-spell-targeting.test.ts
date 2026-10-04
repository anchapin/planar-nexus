/**
 * Spell targeting from card scripts (#2489).
 */
import {
  getSpellTargetSpec,
  getLegalSpellTargets,
  scriptedSpellTargetSpec,
} from "../trigger-system/trigger-targets";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { CardInstanceId, GameState, PlayerId, ScryfallCard } from "../types";

const id = (s: string) => s as CardInstanceId;

function data(name: string, typeLine: string, oracle = "", pt?: [number, number]) {
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
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  d: ScryfallCard,
  zone: "battlefield" | "hand",
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), createCardInstance(d, playerId, playerId, { id: id(cardId), currentZoneKey: key }));
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("spell targeting from card scripts", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p2, "bear", data("Bear", "Creature — Bear", "", [2, 2]), "battlefield");
  });

  it("returns undefined for an unscripted card so oracle text still decides", () => {
    expect(scriptedSpellTargetSpec("Some Unscripted Card")).toBeUndefined();
  });

  it("uses the script, not the oracle text, for a scripted spell", () => {
    // Oracle text deliberately says nothing about targets.
    const s = put(state, p1, "strike", data("Lightning Strike", "Instant", "placeholder"), "hand");
    expect(getSpellTargetSpec(s, id("strike"))?.kind).toBe("any");
    const legal = getLegalSpellTargets(s, p1, id("strike"));
    expect(legal).toEqual(expect.arrayContaining(["bear", p1, p2]));
  });

  it("Fell targets creatures only", () => {
    const s = put(state, p1, "fell", data("Fell", "Sorcery", "Destroy target creature."), "hand");
    expect(getSpellTargetSpec(s, id("fell"))?.kind).toBe("creature");
    expect(getLegalSpellTargets(s, p1, id("fell"))).toEqual(["bear"]);
  });

  it("an untargeted scripted spell has no target requirement", () => {
    const s = put(state, p1, "fodder", data("Dragon Fodder", "Sorcery", "Create two 1/1 red Goblin creature tokens."), "hand");
    expect(getSpellTargetSpec(s, id("fodder"))).toBeNull();
    expect(getLegalSpellTargets(s, p1, id("fodder"))).toEqual([]);
  });

  it("falls back to oracle text for unscripted spells", () => {
    const s = put(state, p1, "shock", data("Unscripted Shock", "Instant", "Unscripted Shock deals 2 damage to any target."), "hand");
    expect(getSpellTargetSpec(s, id("shock"))?.kind).toBe("any");
  });
});
