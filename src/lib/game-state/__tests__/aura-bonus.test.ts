/**
 * Aura static P/T bonuses (issue #2453): Ethereal Armor's "Enchanted creature
 * gets +1/+1 for each enchantment you control".
 */
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { checkStateBasedActions } from "../state-based-actions";
import { parseAuraPT, refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const ARMOR_TEXT =
  "Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.";

function data(
  name: string,
  typeLine: string,
  oracle = "",
  pt?: [string, string],
): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "{W}",
    cmc: 1,
    colors: ["W"],
    color_identity: ["W"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;
const bear = () => data("Bear", "Creature \u2014 Bear", "", ["2", "1"]);
const armor = () =>
  data("Ethereal Armor", "Enchantment \u2014 Aura", ARMOR_TEXT);

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  card: ScryfallCard,
  attachedTo?: string,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  const inst = createCardInstance(card, playerId, playerId, {
    id: id(cardId),
    currentZoneKey: key,
  });
  cards.set(id(cardId), {
    ...inst,
    attachedToId: attachedTo ? id(attachedTo) : null,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

const pt = (s: GameState, c: string) => {
  const card = s.cards.get(id(c))!;
  return [getEffectivePower(card), getEffectiveToughness(card)];
};

describe("aura P/T bonuses (#2453)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["A", "B"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("parses flat and per-enchantment clauses", () => {
    expect(parseAuraPT(ARMOR_TEXT)).toEqual([
      { power: 1, toughness: 1, perEnchantment: true },
    ]);
    expect(parseAuraPT("Enchanted creature gets +2/-1.")).toEqual([
      { power: 2, toughness: -1, perEnchantment: false },
    ]);
    expect(parseAuraPT("Creatures you control get +1/+1.")).toEqual([]);
  });

  it("Ethereal Armor alone gives +1/+1", () => {
    let s = put(state, p1, "bear", bear());
    s = put(s, p1, "armor", armor(), "bear");
    s = refreshAuraBonuses(s);
    expect(pt(s, "bear")).toEqual([3, 2]);
  });

  it("counts every enchantment its controller has", () => {
    let s = put(state, p1, "bear", bear());
    s = put(s, p1, "armor", armor(), "bear");
    s = put(s, p1, "ench", data("Glorious Anthem", "Enchantment"));
    s = put(s, p2, "theirs", data("Their Enchantment", "Enchantment"));
    s = refreshAuraBonuses(s);
    expect(pt(s, "bear")).toEqual([4, 3]);
  });

  it("drops the bonus when the aura leaves", () => {
    let s = put(state, p1, "bear", bear());
    s = put(s, p1, "armor", armor(), "bear");
    s = refreshAuraBonuses(s);
    const zones = new Map(s.zones);
    const bf = zones.get(`${p1}-battlefield`)!;
    zones.set(`${p1}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((c) => c !== id("armor")),
    });
    s = refreshAuraBonuses({ ...s, zones });
    expect(pt(s, "bear")).toEqual([2, 1]);
    expect(s.cards.get(id("bear"))!.auraPT).toBeUndefined();
  });

  it("is refreshed by the state-based-action pass", () => {
    let s = put(state, p1, "bear", bear());
    s = put(s, p1, "armor", armor(), "bear");
    s = checkStateBasedActions(s).state;
    expect(pt(s, "bear")).toEqual([3, 2]);
  });

  it("returns the same state when nothing changes", () => {
    const s = put(state, p1, "bear", bear());
    expect(refreshAuraBonuses(s)).toBe(s);
  });
});
