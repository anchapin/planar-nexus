/**
 * Scry keyword action (CR 701.22, issue #2540).
 */
import {
  performScry,
  getScryCards,
  validateScryDecision,
  type ScryDecider,
} from "../keyword-actions/scry";
import { resolveEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "../types";

const mockCard = (name: string): ScryfallCard =>
  ({
    id: `mock-${name}`,
    name,
    type_line: "Instant",
    keywords: [],
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal" },
    layout: "normal",
  }) as ScryfallCard;

function library(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-library`)?.cardIds ?? [];
}
const lib = (i: number) => `lib-${i}` as CardInstanceId;

/** Give the player a known library: lib-0 at the bottom, lib-(n-1) on top. */
function withLibrary(state: GameState, playerId: PlayerId, n: number) {
  const key = `${playerId}-library`;
  const zone = state.zones.get(key)!;
  const ids = Array.from({ length: n }, (_, i) => lib(i));
  const cards = new Map(state.cards);
  for (const id of ids) {
    cards.set(
      id,
      createCardInstance(mockCard(id), playerId, playerId, {
        id,
        currentZoneKey: key,
      }),
    );
  }
  const zones = new Map(state.zones);
  zones.set(key, { ...zone, cardIds: ids });
  return { ...state, cards, zones } as GameState;
}

describe("scry", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    p1 = Array.from(state.players.keys())[0];
    state = withLibrary(state, p1, 5);
  });

  it("looks at the top N cards, top card first", () => {
    expect(getScryCards(state, p1, 2)).toEqual([lib(4), lib(3)]);
    expect(getScryCards(state, p1, 9)).toHaveLength(5);
    expect(getScryCards(state, p1, 0)).toEqual([]);
  });

  it("keeps every card on top by default", () => {
    const r = performScry(state, p1, 2);
    expect(r.success).toBe(true);
    expect(library(r.state, p1)).toEqual(library(state, p1));
  });

  it("puts chosen cards on the bottom and the rest on top in order", () => {
    const decide: ScryDecider = () => ({
      toBottom: [lib(4)],
      toTop: [lib(2), lib(3)],
    });
    const r = performScry(state, p1, 3, decide);
    expect(r.success).toBe(true);
    // lib-4 goes to the bottom; lib-2 is now on top with lib-3 under it.
    expect(library(r.state, p1)).toEqual([
      lib(4),
      lib(0),
      lib(1),
      lib(3),
      lib(2),
    ]);
  });

  it("orders several cards on the bottom (index 0 bottommost)", () => {
    const decide: ScryDecider = () => ({
      toBottom: [lib(3), lib(4)],
      toTop: [],
    });
    const r = performScry(state, p1, 2, decide);
    expect(library(r.state, p1)).toEqual([
      lib(3),
      lib(4),
      lib(0),
      lib(1),
      lib(2),
    ]);
  });

  it("rejects an illegal decision and leaves the state alone", () => {
    expect(
      validateScryDecision([lib(4)], { toBottom: [lib(0)], toTop: [] }),
    ).toMatch(/not among/);
    expect(
      validateScryDecision([lib(4)], { toBottom: [lib(4)], toTop: [lib(4)] }),
    ).toMatch(/more than once/);
    expect(
      validateScryDecision([lib(4), lib(3)], { toBottom: [lib(4)], toTop: [] }),
    ).toMatch(/top or the bottom/);
    const r = performScry(state, p1, 1, () => ({ toBottom: [], toTop: [] }));
    expect(r.success).toBe(false);
    expect(r.state).toBe(state);
  });

  it("is a legal no-op from an empty library", () => {
    const empty = withLibrary(state, p1, 0);
    const r = performScry(empty, p1, 2);
    expect(r.success).toBe(true);
    expect(library(r.state, p1)).toEqual([]);
  });

  it("resolves through the scry effect type", () => {
    const r = resolveEffect(state, {
      effectType: "scry",
      amount: 1,
      targetId: p1,
    });
    expect(r.success).toBe(true);
    expect(library(r.state, p1)).toEqual(library(state, p1));
  });
});
