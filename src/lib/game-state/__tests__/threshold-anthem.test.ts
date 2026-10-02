/**
 * Threshold anthems on other players' creatures (issue #2300): Mindwhisker.
 */
import {
  parseThresholdOpponentAnthem,
  parseThresholdStatic,
  refreshThresholdBonuses,
} from "../keyword-actions/threshold";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function creature(
  name: string,
  power: number,
  toughness: number,
  oracle = "",
  keywords: string[] = [],
) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Rat",
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords,
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

function fillGraveyard(state: GameState, playerId: PlayerId, n: number) {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = put(
      s,
      playerId,
      `gy-${playerId}-${i}`,
      creature(`Filler${i}`, 1, 1),
      "graveyard",
    );
  }
  return s;
}

const MINDWHISKER =
  "At the beginning of your upkeep, surveil 1. (Look at the top card of your library. You may put it into your graveyard.)\nThreshold — As long as there are seven or more cards in your graveyard, creatures your opponents control get -1/-0.";

describe("threshold opponent anthem (Mindwhisker)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p1, "whisker", creature("Mindwhisker", 3, 2, MINDWHISKER));
    state = put(state, p2, "bear", creature("Bear", 2, 2));
  });

  it("parses the anthem and not as a self bonus", () => {
    expect(parseThresholdOpponentAnthem(MINDWHISKER)).toEqual({
      power: -1,
      toughness: 0,
    });
    expect(parseThresholdStatic(MINDWHISKER)).toBeNull();
    expect(parseThresholdOpponentAnthem("Flying")).toBeNull();
  });

  it("does nothing below seven cards in the graveyard", () => {
    const s = refreshThresholdBonuses(fillGraveyard(state, p1, 6));
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(2);
  });

  it("gives opponents' creatures -1/-0 with threshold, not its own side", () => {
    let s = put(state, p1, "ally", creature("Ally", 2, 2));
    s = refreshThresholdBonuses(fillGraveyard(s, p1, 7));
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(1);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(getEffectivePower(s.cards.get(id("ally"))!)).toBe(2);
    expect(getEffectivePower(s.cards.get(id("whisker"))!)).toBe(3);
  });

  it("only counts the threshold card's controller's graveyard", () => {
    const s = refreshThresholdBonuses(fillGraveyard(state, p2, 7));
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(2);
  });

  it("stacks two Mindwhiskers and clears when threshold is lost", () => {
    let s = put(
      state,
      p1,
      "whisker2",
      creature("Mindwhisker", 3, 2, MINDWHISKER),
    );
    s = refreshThresholdBonuses(fillGraveyard(s, p1, 7));
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(0);

    const gy = `${p1}-graveyard`;
    const zones = new Map(s.zones);
    zones.set(gy, { ...zones.get(gy)!, cardIds: [] });
    s = refreshThresholdBonuses({ ...s, zones });
    expect(s.cards.get(id("bear"))!.thresholdAnthemPT).toBeUndefined();
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(2);
  });

  it("returns the same state when nothing changes", () => {
    const s = refreshThresholdBonuses(fillGraveyard(state, p1, 7));
    expect(refreshThresholdBonuses(s)).toBe(s);
  });
});
