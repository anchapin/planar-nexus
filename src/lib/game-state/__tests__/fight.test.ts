/**
 * Fight keyword action (CR 701.14; issue #2300, Standard remainder slice).
 */
import { getFightDamage, isFightText } from "../keyword-actions";
import {
  resolveFight,
  parseSpellEffects,
  resolveStackObjectEffects,
} from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { GameState, PlayerId, CardInstanceId, ScryfallCard } from "../types";

function creature(name: string, power: number, toughness: number, extra = "") {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Beast",
    oracle_text: extra,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: extra ? [extra] : [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: String(power),
    toughness: String(toughness),
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "graveyard" = "battlefield",
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

const dmg = (s: GameState, c: string) => s.cards.get(id(c))!.damage;

describe("fight", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p1, "mine", creature("Mine", 3, 3));
    state = put(state, p2, "theirs", creature("Theirs", 2, 4));
  });

  it("each creature deals damage equal to its power to the other", () => {
    const result = resolveFight(state, id("mine"), id("theirs"));
    expect(result.success).toBe(true);
    expect(dmg(result.state, "theirs")).toBe(3);
    expect(dmg(result.state, "mine")).toBe(2);
  });

  it("deals no damage when a creature has left the battlefield", () => {
    const st = put(state, p2, "gone", creature("Gone", 5, 5), "graveyard");
    expect(getFightDamage(st, id("mine"), id("gone"))).toEqual([]);
    const result = resolveFight(st, id("mine"), id("gone"));
    expect(result.success).toBe(true);
    expect(dmg(result.state, "mine")).toBe(0);
  });

  it("a creature fighting itself takes twice its power", () => {
    expect(getFightDamage(state, id("mine"), id("mine"))).toEqual([
      { sourceId: id("mine"), targetId: id("mine"), amount: 6 },
    ]);
  });

  it("applies lifelink to fight damage", () => {
    const st = put(state, p1, "link", creature("Link", 2, 2, "Lifelink"));
    const before = st.players.get(p1)!.life;
    const result = resolveFight(st, id("link"), id("theirs"));
    expect(result.state.players.get(p1)!.life).toBe(before + 2);
  });

  it("recognises fight text and ignores reminder text", () => {
    expect(
      isFightText(
        "Target creature you control fights target creature an opponent controls.",
      ),
    ).toBe(true);
    expect(isFightText("Then those creatures fight each other.")).toBe(true);
    expect(
      isFightText(
        "Destroy target creature. (Creatures that fight each deal damage equal to their power to the other.)",
      ),
    ).toBe(false);
  });

  it("resolves a fight spell against its two targets", () => {
    const effects = parseSpellEffects(
      "Target creature you control fights target creature an opponent controls.",
    );
    expect(effects.map((e) => e.effectType)).toContain("fight");
    const after = resolveStackObjectEffects(state, effects, undefined, [
      { type: "card", targetId: "mine" },
      { type: "card", targetId: "theirs" },
    ]);
    expect(dmg(after, "theirs")).toBe(3);
    expect(dmg(after, "mine")).toBe(2);
  });

  it("with one target, the source creature fights it", () => {
    const effects = parseSpellEffects(
      "When this creature enters, it fights up to one target creature an opponent controls.",
    );
    const after = resolveStackObjectEffects(state, effects, id("mine"), [
      { type: "card", targetId: "theirs" },
    ]);
    expect(dmg(after, "theirs")).toBe(3);
    expect(dmg(after, "mine")).toBe(2);
  });
});
