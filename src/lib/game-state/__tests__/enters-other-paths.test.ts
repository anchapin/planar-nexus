/**
 * ETB triggers for permanents that enter other than by a resolving
 * permanent spell (issue #2300): lands played, tokens created, cards put
 * onto the battlefield and persist returns (CR 603.6a).
 */
import {
  createTokenCard,
  moveCardToZone,
  handlePersist,
} from "../keyword-actions";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { playLand } from "../mana";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function card(
  name: string,
  typeLine: string,
  oracle: string,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "{1}{G}",
    cmc: 2,
    power: typeLine.includes("Creature") ? "2" : undefined,
    toughness: typeLine.includes("Creature") ? "2" : undefined,
    colors: ["G"],
    color_identity: ["G"],
    keywords,
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  data: ScryfallCard,
  owner: PlayerId,
  zone: "battlefield" | "hand" | "graveyard",
): { state: GameState; cardId: CardInstanceId } {
  const inst = createCardInstance(data, owner, owner);
  const key = `${owner}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(inst.id, { ...inst, currentZoneKey: key });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, inst.id] });
  return { state: { ...state, cards, zones }, cardId: inst.id };
}

const WATCHER = card(
  "Watcher",
  "Creature — Elf",
  "Whenever another creature you control enters, you gain 1 life.",
);
const SELF_ETB = card(
  "Visionary",
  "Creature — Elf",
  "When this creature enters, draw a card.",
);

function fromSource(state: GameState, id: CardInstanceId) {
  return state.stack.filter((o) => o.sourceCardId === id);
}

describe("ETB triggers outside spell resolution", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    let s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys()) as PlayerId[];
    while (s.turn.currentPhase !== Phase.PRECOMBAT_MAIN) {
      s = passPriority(s, s.priorityPlayerId!);
    }
    state = s;
  });

  it("fires a land's own ETB when it is played", () => {
    const land = put(
      state,
      card("Ruins", "Land", "When this land enters, you gain 1 life."),
      p1,
      "hand",
    );
    const result = playLand(land.state, p1, land.cardId);
    expect(result.success).toBe(true);
    const fired = fromSource(result.state, land.cardId);
    expect(fired).toHaveLength(1);
    expect(fired[0].text).toBe("you gain 1 life");
  });

  it("fires 'another creature you control enters' once per token", () => {
    const w = put(state, WATCHER, p1, "battlefield");
    const result = createTokenCard(
      w.state,
      card("Elf Warrior", "Token Creature — Elf Warrior", ""),
      p1,
      p1,
      2,
    );
    expect(result.success).toBe(true);
    expect(fromSource(result.state, w.cardId)).toHaveLength(2);
  });

  it("does not fire an opponent's watcher for your token", () => {
    const w = put(state, WATCHER, p2, "battlefield");
    const result = createTokenCard(
      w.state,
      card("Elf Warrior", "Token Creature — Elf Warrior", ""),
      p1,
      p1,
    );
    expect(fromSource(result.state, w.cardId)).toHaveLength(0);
  });

  it("fires a token's own ETB", () => {
    const result = createTokenCard(
      state,
      card(
        "Thopter",
        "Token Artifact Creature — Thopter",
        "When this creature enters, draw a card.",
      ),
      p1,
      p1,
    );
    const tokenId = result.affectedCards![0];
    expect(fromSource(result.state, tokenId)).toHaveLength(1);
  });

  it("fires a self ETB when a card is put onto the battlefield", () => {
    const c = put(state, SELF_ETB, p1, "graveyard");
    const result = moveCardToZone(c.state, c.cardId, "battlefield");
    expect(result.success).toBe(true);
    const fired = fromSource(result.state, c.cardId);
    expect(fired).toHaveLength(1);
    expect(fired[0].text).toBe("draw a card");
  });

  it("clears a stale zone cache instead of pinning a new key", () => {
    // Casting doesn't refresh currentZoneKey, so a key pinned on the way to
    // hand would still say "hand" once the card is on the stack.
    const c = put(state, SELF_ETB, p1, "graveyard");
    const result = moveCardToZone(c.state, c.cardId, "hand");
    expect(result.success).toBe(true);
    expect(result.state.cards.get(c.cardId)!.currentZoneKey).toBeNull();
  });

  it("fires the ETB of a creature returned by persist", () => {
    const data = card(
      "Kitchen Finks",
      "Creature — Ouphe",
      "When this creature enters, you gain 2 life.\nPersist",
      ["Persist"],
    );
    const c = put(state, data, p1, "graveyard");
    const result = handlePersist(c.state, c.cardId, []);
    expect(result.persistedCards).toEqual([c.cardId]);
    const fired = fromSource(result.state, c.cardId);
    expect(fired).toHaveLength(1);
    expect(fired[0].text).toBe("you gain 2 life");
  });
});
