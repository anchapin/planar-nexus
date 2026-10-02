/**
 * Domain ability word (issue #2300): Fblthp, Knows the Way.
 */
import {
  countBasicLandTypes,
  hasDomainPowerCDA,
  refreshDomainPower,
} from "../keyword-actions/domain";
import { checkStateBasedActions } from "../state-based-actions";
import { getEffectivePower } from "../evergreen-keywords";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const FBLTHP =
  "Domain \u2014 Fblthp's power is equal to the number of basic land types among lands you control.\nWhen Fblthp enters, search your library for up to X basic land cards with different names, reveal them, put them into your hand, then shuffle.";

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
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: oracle.startsWith("Domain") ? ["Domain"] : [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt?.[0],
    toughness: pt?.[1],
  } as unknown as ScryfallCard;
}

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

const fblthp = () =>
  data(
    "Fblthp, Knows the Way",
    "Legendary Creature \u2014 Homunculus Scout",
    FBLTHP,
    ["*", "2"],
  );
const land = (name: string, sub: string) =>
  data(name, `Basic Land \u2014 ${sub}`);
const power = (s: GameState, c: string) =>
  getEffectivePower(s.cards.get(id(c))!);

describe("domain", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p1, "fblthp", fblthp());
  });

  it("detects Fblthp's power-defining ability", () => {
    expect(hasDomainPowerCDA(state.cards.get(id("fblthp"))!)).toBe(true);
  });

  it("is 0 with no lands", () => {
    expect(power(refreshDomainPower(state), "fblthp")).toBe(0);
  });

  it("counts distinct basic land types, not lands", () => {
    let s = put(state, p1, "f1", land("Forest", "Forest"));
    s = put(s, p1, "f2", land("Forest", "Forest"));
    s = put(s, p1, "i1", land("Island", "Island"));
    expect(countBasicLandTypes(s, p1)).toBe(2);
    expect(power(refreshDomainPower(s), "fblthp")).toBe(2);
  });

  it("counts every type on a dual land", () => {
    let s = put(
      state,
      p1,
      "dual",
      data("Breeding Pool", "Land \u2014 Forest Island"),
    );
    s = put(s, p1, "m", land("Mountain", "Mountain"));
    expect(countBasicLandTypes(s, p1)).toBe(3);
  });

  it("ignores opponents' lands and nonbasic types", () => {
    let s = put(state, p2, "o1", land("Swamp", "Swamp"));
    s = put(s, p1, "cave", data("Hidden Cave", "Land \u2014 Cave"));
    expect(countBasicLandTypes(s, p1)).toBe(0);
    expect(power(refreshDomainPower(s), "fblthp")).toBe(0);
  });

  it("updates through state-based actions as lands arrive", () => {
    let s = put(state, p1, "p", land("Plains", "Plains"));
    s = put(s, p1, "sw", land("Swamp", "Swamp"));
    s = put(s, p1, "mt", land("Mountain", "Mountain"));
    const after = checkStateBasedActions(s).state;
    expect(power(after, "fblthp")).toBe(3);
  });

  it("returns the same state when nothing changed", () => {
    const once = refreshDomainPower(state);
    expect(refreshDomainPower(once)).toBe(once);
  });
});
