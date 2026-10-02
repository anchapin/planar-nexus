/**
 * Surveil keyword action (issue #2300, Standard remainder slice).
 */
import {
  performSurveil,
  getSurveilCards,
  validateSurveilDecision,
  type SurveilDecider,
} from "../keyword-actions";
import { parseSpellEffects, resolveEffect } from "../effect-resolution";
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
function graveyard(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)?.cardIds ?? [];
}
const fake = (n: number) =>
  Array.from({ length: n }, (_, i) => `lib-${i}` as CardInstanceId);

/** Give the player a known library: lib-0 at the bottom, lib-(n-1) on top. */
function withLibrary(state: GameState, playerId: PlayerId, n: number) {
  const key = `${playerId}-library`;
  const zone = state.zones.get(key)!;
  const ids = fake(n);
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

describe("surveil", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    const s = createInitialGameState(["Player1", "Player2"], 20, false);
    startGame(s);
    p1 = Array.from(s.players.keys())[0];
    state = withLibrary(s, p1, 5);
  });

  it("looks at the top N cards, top card first", () => {
    expect(getSurveilCards(state, p1, 2)).toEqual(["lib-4", "lib-3"]);
  });

  it("looks at the whole library when it holds fewer than N", () => {
    expect(getSurveilCards(state, p1, 9)).toHaveLength(5);
  });

  it("puts chosen cards into the graveyard and the rest back on top in order", () => {
    const decide: SurveilDecider = () => ({
      toGraveyard: ["lib-4" as CardInstanceId],
      toTop: ["lib-2", "lib-3"] as CardInstanceId[],
    });
    const result = performSurveil(state, p1, 3, decide);
    expect(result.success).toBe(true);
    expect(graveyard(result.state, p1)).toContain("lib-4");
    expect(library(result.state, p1)).toEqual([
      "lib-0",
      "lib-1",
      "lib-3",
      "lib-2",
    ]);
  });

  it("defaults to keeping every card on top unchanged", () => {
    const result = performSurveil(state, p1, 2);
    expect(result.success).toBe(true);
    expect(library(result.state, p1)).toEqual(library(state, p1));
    expect(graveyard(result.state, p1)).toHaveLength(0);
  });

  it("can bin everything it looked at", () => {
    const result = performSurveil(state, p1, 2, (_s, _p, seen) => ({
      toGraveyard: seen,
      toTop: [],
    }));
    expect(library(result.state, p1)).toEqual(["lib-0", "lib-1", "lib-2"]);
    expect(graveyard(result.state, p1)).toEqual(
      expect.arrayContaining(["lib-3", "lib-4"]),
    );
  });

  it("rejects a decision that moves a card it did not look at", () => {
    const result = performSurveil(state, p1, 1, () => ({
      toGraveyard: ["lib-0" as CardInstanceId],
      toTop: ["lib-4" as CardInstanceId],
    }));
    expect(result.success).toBe(false);
    expect(result.state).toBe(state);
  });

  it("rejects a decision that drops or duplicates a card", () => {
    const seen = ["lib-4", "lib-3"] as CardInstanceId[];
    expect(
      validateSurveilDecision(seen, {
        toGraveyard: [],
        toTop: ["lib-4"] as CardInstanceId[],
      }),
    ).not.toBeNull();
    expect(
      validateSurveilDecision(seen, {
        toGraveyard: ["lib-4"] as CardInstanceId[],
        toTop: ["lib-4", "lib-3"] as CardInstanceId[],
      }),
    ).not.toBeNull();
  });

  it("surveil 0 and an empty library are legal no-ops", () => {
    expect(performSurveil(state, p1, 0).success).toBe(true);
    const empty = withLibrary(state, p1, 0);
    const result = performSurveil(empty, p1, 2);
    expect(result.success).toBe(true);
    expect(result.affectedCards).toEqual([]);
  });

  it("parses surveil from oracle text and resolves it", () => {
    expect(parseSpellEffects("Surveil 2. Draw a card.")).toEqual(
      expect.arrayContaining([{ effectType: "surveil", amount: 2 }]),
    );
    expect(parseSpellEffects("Surveil one.")).toEqual(
      expect.arrayContaining([{ effectType: "surveil", amount: 1 }]),
    );
    const resolved = resolveEffect(state, {
      effectType: "surveil",
      amount: 2,
      targetId: p1,
    });
    expect(resolved.success).toBe(true);
    expect(resolved.affectedCards).toEqual(["lib-4", "lib-3"]);
  });
});
