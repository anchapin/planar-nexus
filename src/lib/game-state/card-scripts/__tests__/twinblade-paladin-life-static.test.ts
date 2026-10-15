/**
 * Twinblade Paladin (FDN 503) — life-condition static (lane 91).
 *
 * Wave 4.8 follow-up 12 lane 91 (#2614 follow-up). Twinblade
 * Paladin's full oracle:
 *
 *   "Whenever you gain life, put a +1/+1 counter on this creature.
 *    As long as you have 25 or more life, this creature has double
 *    strike and lifelink."
 *
 * The lane 86 v1 minimum (follow-up 11) shipped the
 * `event: "lifeGain"` half only. This lane adds the static half:
 * a `while_condition: { kind: "life_minimum", value: 25 }` gate
 * that activates the source's `keywords: ["double strike",
 * "lifelink"]` arm only when the controller's life is `>= 25`.
 *
 * Out of scope for lane 91 (each a follow-up lane):
 * - the "as long as an opponent has less than X life" variant
 * - the "this creature gets +1/+1 instead" / "+X/+X where X =
 *   your life total" anthem variants
 * - the "you can't lose the game while you control this creature"
 *   replacement-effect layer (lane 61's territory)
 */
import { getCardScript } from "../index";
import { createCardInstance } from "../../card-instance";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
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

describe("Twinblade Paladin (FDN 503): life-condition static (lane 91)", () => {
  it("registry exposes Twinblade Paladin with the life_gain trigger + life static (lane 91)", () => {
    const paladin = getCardScript("Twinblade Paladin");
    expect(paladin).toBeDefined();
    expect(paladin!.triggers).toBeDefined();
    expect(paladin!.triggers![0].event).toBe("lifeGain");
    expect(paladin!.statics).toBeDefined();
    expect(paladin!.statics).toHaveLength(1);
    const staticAbility = paladin!.statics![0];
    expect(staticAbility.keywords).toEqual(["double strike", "lifelink"]);
    expect(staticAbility.while_condition).toEqual({
      kind: "life_minimum",
      value: 25,
    });
    expect(staticAbility.affects!.controller).toBe("you");
    expect(staticAbility.affects!.self).toBe(true);
  });

  it("static is INERT when the controller's life is below 25 (no keywords stamped)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "paladin",
      card("Twinblade Paladin", "Creature — Human Knight", [2, 2]),
    );
    // p1 starts at 20 life (below the 25 threshold).
    expect(state.players.get(p1)!.life).toBe(20);

    const refreshed = refreshScriptedStatics(state);
    const paladin = refreshed.cards.get(id("paladin"))!;
    // While-condition fails — scriptStaticKeywords is not stamped.
    expect(paladin.scriptStaticKeywords ?? []).toEqual([]);
  });

  it("static ACTIVATES when the controller's life is 25 or more (keywords stamped)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "paladin",
      card("Twinblade Paladin", "Creature — Human Knight", [2, 2]),
    );

    // Boost the controller's life to 26 (above the 25 threshold).
    const players = new Map(state.players);
    players.set(p1, { ...state.players.get(p1)!, life: 26 });
    state = { ...state, players };

    const refreshed = refreshScriptedStatics(state);
    const paladin = refreshed.cards.get(id("paladin"))!;
    expect(paladin.scriptStaticKeywords ?? []).toEqual([
      "double strike",
      "lifelink",
    ]);
  });

  it("static ACTIVATES at exactly 25 life (the threshold inclusive)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "paladin",
      card("Twinblade Paladin", "Creature — Human Knight", [2, 2]),
    );

    const players = new Map(state.players);
    players.set(p1, { ...state.players.get(p1)!, life: 25 });
    state = { ...state, players };

    const refreshed = refreshScriptedStatics(state);
    const paladin = refreshed.cards.get(id("paladin"))!;
    expect(paladin.scriptStaticKeywords ?? []).toEqual([
      "double strike",
      "lifelink",
    ]);
  });

  it("static DEACTIVATES when the controller's life drops below 25 (keywords stripped)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "paladin",
      card("Twinblade Paladin", "Creature — Human Knight", [2, 2]),
    );

    // Start above the threshold, then drop.
    let players = new Map(state.players);
    players.set(p1, { ...state.players.get(p1)!, life: 26 });
    state = { ...state, players };

    let refreshed = refreshScriptedStatics(state);
    let paladin = refreshed.cards.get(id("paladin"))!;
    expect(paladin.scriptStaticKeywords ?? []).toEqual([
      "double strike",
      "lifelink",
    ]);

    // Drop to 20 (below threshold).
    players = new Map(refreshed.players);
    players.set(p1, { ...refreshed.players.get(p1)!, life: 20 });
    const dropped = { ...refreshed, players };
    refreshed = refreshScriptedStatics(dropped);
    paladin = refreshed.cards.get(id("paladin"))!;
    expect(paladin.scriptStaticKeywords ?? []).toEqual([]);
  });

  it("schema accepts while_condition alongside keywords (lane 91)", () => {
    const paladin = getCardScript("Twinblade Paladin");
    expect(paladin).toBeDefined();
    // The build-card-script-index step above proves the schema accepts
    // this shape (zod parses without error). Just assert the static
    // carries both the keywords arm and the while_condition gate.
    expect(paladin!.statics![0].keywords).toEqual([
      "double strike",
      "lifelink",
    ]);
    expect(paladin!.statics![0].while_condition).toEqual({
      kind: "life_minimum",
      value: 25,
    });
  });
});