/**
 * Grandeur ability word (issue #2300): Page, Loose Leaf.
 */
import { getActivatedAbilities } from "../abilities";
import { activateAbility, canActivateAbility } from "../abilities/activated";
import {
  hasGrandeur,
  parseDiscardNamedCost,
  revealUntilInstantOrSorcery,
} from "../keyword-actions/grandeur";
import { resolveEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const PAGE_TEXT =
  "{T}: Add {C}.\nGrandeur \u2014 Discard another card named Page, Loose Leaf: Reveal cards from the top of your library until you reveal an instant or sorcery card. Put that card into your hand and the rest on the bottom of your library in a random order.";

function data(name: string, typeLine: string, oracle = ""): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: oracle.includes("Grandeur") ? ["Grandeur"] : [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "0",
    toughness: "2",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;
const page = () =>
  data(
    "Page, Loose Leaf",
    "Legendary Artifact Creature \u2014 Construct",
    PAGE_TEXT,
  );

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "battlefield" | "hand" | "library",
  cardId: string,
  card: ScryfallCard,
): GameState {
  const key = `${playerId}-${zone}`;
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

function clearZone(state: GameState, key: string): GameState {
  const zones = new Map(state.zones);
  zones.set(key, { ...zones.get(key)!, cardIds: [] });
  return { ...state, zones };
}

const ids = (s: GameState, key: string) => s.zones.get(key)!.cardIds;

describe("grandeur", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(s.players.keys());
    let t = clearZone(s, `${p1}-hand`);
    t = clearZone(t, `${p1}-library`);
    t = { ...t, priorityPlayerId: p1 };
    state = put(t, p1, "battlefield", "page", page());
  });

  it("parses the grandeur ability alongside the mana ability", () => {
    const abilities = getActivatedAbilities(page());
    expect(abilities).toHaveLength(2);
    expect(abilities[1].costs.discard).toBe(false);
    expect(abilities[1].costs.additionalCosts).toContain(
      "discard-named:Page, Loose Leaf",
    );
    expect(hasGrandeur(state.cards.get(id("page"))!)).toBe(true);
    expect(
      parseDiscardNamedCost(
        "Grandeur \u2014 Discard another card named Page, Loose Leaf",
      ),
    ).toBe("Page, Loose Leaf");
  });

  it("can't be activated without another Page in hand", () => {
    const s = put(state, p1, "hand", "bolt", data("Shock", "Instant"));
    const result = canActivateAbility(s, p1, id("page"), 1);
    expect(result.canActivate).toBe(false);
  });

  it("discards the other Page, not some other card, as the cost", () => {
    let s = put(state, p1, "hand", "bolt", data("Shock", "Instant"));
    s = put(s, p1, "hand", "page2", page());
    expect(canActivateAbility(s, p1, id("page"), 1).canActivate).toBe(true);
    const result = activateAbility(s, p1, id("page"), 1);
    expect(result.success).toBe(true);
    expect(ids(result.state, `${p1}-hand`)).toEqual([id("bolt")]);
    expect(ids(result.state, `${p1}-graveyard`)).toContain(id("page2"));
    const top = result.state.stack[result.state.stack.length - 1];
    expect(top.effects?.[0]?.effectType).toBe("reveal_until_instant_sorcery");
  });

  it("puts the first instant or sorcery into hand and the rest on the bottom", () => {
    // Library top is the end of the array.
    let s = put(state, p1, "library", "deep", data("Deep Card", "Creature"));
    s = put(s, p1, "library", "sorc", data("Sorc", "Sorcery"));
    s = put(s, p1, "library", "land", data("Forest", "Basic Land"));
    s = put(s, p1, "library", "bear", data("Bear", "Creature"));
    const result = revealUntilInstantOrSorcery(s, p1, () => 0);
    expect(result.foundCardId).toBe(id("sorc"));
    expect(result.revealed).toBe(3);
    expect(ids(result.state, `${p1}-hand`)).toEqual([id("sorc")]);
    const lib = ids(result.state, `${p1}-library`);
    expect(lib).toHaveLength(3);
    expect(lib[lib.length - 1]).toBe(id("deep"));
    expect(new Set(lib.slice(0, 2))).toEqual(new Set([id("land"), id("bear")]));
  });

  it("with no instant or sorcery, keeps every card in the library", () => {
    let s = put(state, p1, "library", "a", data("A", "Creature"));
    s = put(s, p1, "library", "b", data("B", "Basic Land"));
    const result = revealUntilInstantOrSorcery(s, p1);
    expect(result.foundCardId).toBeNull();
    expect(ids(result.state, `${p1}-hand`)).toEqual([]);
    expect(new Set(ids(result.state, `${p1}-library`))).toEqual(
      new Set([id("a"), id("b")]),
    );
  });

  it("resolves the structured effect for the controller", () => {
    const s = put(state, p1, "library", "inst", data("Opt", "Instant"));
    const result = resolveEffect(
      s,
      { effectType: "reveal_until_instant_sorcery" },
      id("page"),
    );
    expect(result.success).toBe(true);
    expect(ids(result.state, `${p1}-hand`)).toEqual([id("inst")]);
  });
});
