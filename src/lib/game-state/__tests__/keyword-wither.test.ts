/**
 * Wither keyword (CR 702.80, issue #2300): Spinerock Tyrant.
 *
 * Damage from a source with wither to a creature is dealt as -1/-1 counters
 * instead of being marked (CR 702.80c). Damage to a player or a planeswalker
 * is ordinary damage. The conversion shares `dealDamageToCard` with infect,
 * so protection and replacement effects still run first.
 */
import { hasWither } from "../evergreen-keywords";
import { dealDamageToCard } from "../keyword-actions";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SPINEROCK =
  "Flying\nWither (This deals damage to creatures in the form of -1/-1 counters.)\nWhenever you cast an instant or sorcery spell with a single target, you may copy it. If you do, those spells gain wither. You may choose new targets for the copy.";

function card(over: {
  name: string;
  typeLine?: string;
  oracle?: string;
  keywords?: string[];
  power?: number;
  toughness?: number;
  colors?: string[];
}): ScryfallCard {
  return {
    id: `mock-${over.name}`,
    name: over.name,
    type_line: over.typeLine ?? "Creature — Test",
    oracle_text: over.oracle ?? "",
    mana_cost: "",
    cmc: 0,
    colors: over.colors ?? [],
    color_identity: over.colors ?? [],
    keywords: over.keywords ?? [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: over.power === undefined ? undefined : String(over.power),
    toughness:
      over.toughness === undefined ? undefined : String(over.toughness),
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
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

const minusCounters = (s: GameState, cardId: string) =>
  s.cards.get(id(cardId))!.counters?.find((c) => c.type === "-1/-1")?.count ??
  0;

describe("wither", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = put(
      s,
      p1,
      "tyrant",
      card({
        name: "Spinerock Tyrant",
        typeLine: "Creature — Dragon",
        oracle: SPINEROCK,
        keywords: ["Flying", "Wither"],
        power: 6,
        toughness: 6,
        colors: ["R"],
      }),
    );
    state = put(
      state,
      p2,
      "bear",
      card({ name: "Bear", power: 2, toughness: 2 }),
    );
  });

  it("recognizes the keyword, not a grant phrase", () => {
    expect(hasWither(state.cards.get(id("tyrant"))!)).toBe(true);
    const granter = createCardInstance(
      card({ name: "Granter", oracle: "Spells you cast gain wither." }),
      p1,
      p1,
    );
    expect(hasWither(granter)).toBe(false);
  });

  it("puts -1/-1 counters on a creature instead of marking damage", () => {
    const r = dealDamageToCard(state, id("bear"), 1, false, id("tyrant"));
    expect(minusCounters(r.state, "bear")).toBe(1);
    expect(r.state.cards.get(id("bear"))!.damage).toBe(0);
    expect(r.description).toContain("wither damage");
  });

  it("works for combat damage too", () => {
    const r = dealDamageToCard(state, id("bear"), 2, true, id("tyrant"));
    expect(minusCounters(r.state, "bear")).toBe(2);
    expect(r.state.cards.get(id("bear"))!.damage).toBe(0);
  });

  it("marks ordinary damage from a source without wither", () => {
    const s = put(
      state,
      p1,
      "plain",
      card({ name: "Plain", power: 3, toughness: 3 }),
    );
    const r = dealDamageToCard(s, id("bear"), 1, false, id("plain"));
    expect(minusCounters(r.state, "bear")).toBe(0);
    expect(r.state.cards.get(id("bear"))!.damage).toBe(1);
  });

  it("deals ordinary damage to a noncreature permanent", () => {
    const s = put(
      state,
      p2,
      "rock",
      card({ name: "Rock", typeLine: "Artifact" }),
    );
    const r = dealDamageToCard(s, id("rock"), 2, false, id("tyrant"));
    expect(minusCounters(r.state, "rock")).toBe(0);
  });

  it("is prevented by protection like any damage", () => {
    const s = put(
      state,
      p2,
      "warden",
      card({
        name: "Warden",
        oracle: "Protection from red",
        keywords: ["Protection"],
        power: 2,
        toughness: 2,
      }),
    );
    const r = dealDamageToCard(s, id("warden"), 2, true, id("tyrant"));
    expect(minusCounters(r.state, "warden")).toBe(0);
    expect(r.state.cards.get(id("warden"))!.damage).toBe(0);
  });
});
