/**
 * "Other <Type>s you control get +N/+N" lords (issue #2300): Stormscale Scion.
 */
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { checkStateBasedActions } from "../state-based-actions";
import {
  parseOtherTypeAnthems,
  refreshTribalAnthems,
  singularSubtype,
} from "../keyword-actions/tribal-anthem";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const SCION_TEXT =
  "Flying\nOther Dragons you control get +1/+1.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. Copies become tokens.)";

function data(
  name: string,
  typeLine: string,
  oracle = "",
  pt: [string, string] = ["2", "2"],
): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt[0],
    toughness: pt[1],
  } as unknown as ScryfallCard;
}

const scion = () =>
  data("Stormscale Scion", "Creature \u2014 Dragon", SCION_TEXT, ["4", "4"]);
const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  card: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(card, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

const pt = (s: GameState, c: string) => {
  const card = s.cards.get(id(c))!;
  return [getEffectivePower(card), getEffectiveToughness(card)];
};

describe("tribal anthem", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["A", "B"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("parses the lord clause and singularizes the type", () => {
    expect(parseOtherTypeAnthems(SCION_TEXT)).toEqual([
      { subtype: "Dragon", power: 1, toughness: 1 },
    ]);
    expect(singularSubtype("Elves")).toBe("Elf");
    expect(
      parseOtherTypeAnthems("Other creatures you control get +1/+1."),
    ).toEqual([]);
  });

  it("pumps your other Dragons but not the scion itself", () => {
    let s = put(state, p1, "scion", scion());
    s = put(s, p1, "drake", data("Drake", "Creature \u2014 Dragon"));
    s = refreshTribalAnthems(s);
    expect(pt(s, "scion")).toEqual([4, 4]);
    expect(pt(s, "drake")).toEqual([3, 3]);
  });

  it("ignores non-Dragons and opponents' Dragons", () => {
    let s = put(state, p1, "scion", scion());
    s = put(s, p1, "bear", data("Bear", "Creature \u2014 Bear"));
    s = put(s, p2, "enemy", data("Enemy Drake", "Creature \u2014 Dragon"));
    s = refreshTribalAnthems(s);
    expect(pt(s, "bear")).toEqual([2, 2]);
    expect(pt(s, "enemy")).toEqual([2, 2]);
  });

  it("drops the bonus when the lord leaves", () => {
    let s = put(state, p1, "scion", scion());
    s = put(s, p1, "drake", data("Drake", "Creature \u2014 Dragon"));
    s = refreshTribalAnthems(s);
    const zones = new Map(s.zones);
    const bf = zones.get(`${p1}-battlefield`)!;
    zones.set(`${p1}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((c) => c !== id("scion")),
    });
    s = refreshTribalAnthems({ ...s, zones });
    expect(pt(s, "drake")).toEqual([2, 2]);
  });

  it("returns the same state when nothing changes", () => {
    const s = refreshTribalAnthems(put(state, p1, "scion", scion()));
    expect(refreshTribalAnthems(s)).toBe(s);
  });

  it("storm copies of the scion pump each other", () => {
    let s: GameState = { ...state, stack: [], priorityPlayerId: p1 };
    s.status = "in_progress";
    s.turn = {
      ...s.turn,
      activePlayerId: p1,
      currentPhase: Phase.PRECOMBAT_MAIN,
      isFirstTurn: false,
    };
    const players = new Map(s.players);
    players.set(p1, {
      ...players.get(p1)!,
      spellsCastThisTurn: 2,
      hasPassedPriority: false,
    });
    s = { ...s, players };
    const card = createCardInstance(scion(), p1, p1);
    const cards = new Map(s.cards);
    cards.set(card.id, card);
    const zones = new Map(s.zones);
    const hand = zones.get(`${p1}-hand`)!;
    zones.set(`${p1}-hand`, { ...hand, cardIds: [...hand.cardIds, card.id] });
    s = addMana({ ...s, cards, zones }, p1, { red: 2, generic: 4 });

    const cast = castSpell(s, p1, card.id);
    expect(cast.success).toBe(true);
    let after = cast.state;
    for (let i = 0; i < 5 && after.stack.length > 0; i++) {
      after = resolveTopOfStack(after);
    }
    after = checkStateBasedActions(after).state;
    const dragons = after.zones
      .get(`${p1}-battlefield`)!
      .cardIds.map((c) => after.cards.get(c)!)
      .filter((c) => /Dragon/.test(c.cardData.type_line ?? ""));
    expect(dragons).toHaveLength(3);
    for (const d of dragons) {
      expect(getEffectivePower(d)).toBe(6);
      expect(getEffectiveToughness(d)).toBe(6);
    }
  });
});
