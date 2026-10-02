/**
 * Threshold ability word (issue #2300, Standard remainder slice).
 */
import {
  parseThresholdStatic,
  refreshThresholdBonuses,
  hasThreshold,
} from "../keyword-actions/threshold";
import {
  getEffectivePower,
  getEffectiveToughness,
  hasDeathtouch,
  hasFlying,
} from "../evergreen-keywords";
import { evaluateInterveningIfClause } from "../abilities/evaluate";
import { canBlock } from "../combat/queries";
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

const SHRIEKMASS =
  "Flying\nWhen this creature enters, mill three cards.\nThreshold — This creature gets +2/+1 as long as there are seven or more cards in your graveyard.";
const DREADWING =
  "Flying\nWhenever this creature enters or attacks, draw a card, then discard a card.\nThreshold — This creature gets +1/+1 and has deathtouch as long as there are seven or more cards in your graveyard.";
const HERMIT =
  "Vigilance\nThreshold — As long as there are seven or more cards in your graveyard, this creature gets +1/+0 and can't be blocked.";
const THEORIX =
  "This creature enters prepared.\nThreshold — This creature gets +1/+0 and has flying as long as there are seven or more cards in your graveyard.";

describe("threshold", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = s;
  });

  it("parses static threshold bonuses from Standard card text", () => {
    expect(parseThresholdStatic(SHRIEKMASS)).toEqual({
      power: 2,
      toughness: 1,
      keywords: [],
      unblockable: false,
    });
    expect(parseThresholdStatic(DREADWING)).toEqual({
      power: 1,
      toughness: 1,
      keywords: ["deathtouch"],
      unblockable: false,
    });
    expect(parseThresholdStatic(HERMIT)).toEqual({
      power: 1,
      toughness: 0,
      keywords: [],
      unblockable: true,
    });
    expect(parseThresholdStatic(THEORIX)?.keywords).toEqual(["flying"]);
  });

  it("ignores threshold triggers and activated abilities", () => {
    expect(
      parseThresholdStatic(
        "Menace\nThreshold — Whenever this creature attacks, if there are seven or more cards in your graveyard, this creature gets +2/+0 until end of turn.",
      ),
    ).toBeNull();
    expect(
      parseThresholdStatic(
        "Threshold — {1}{U}: Put a +1/+1 counter on this creature and draw a card. Activate only if there are seven or more cards in your graveyard and only once.",
      ),
    ).toBeNull();
  });

  it("applies power and toughness only with seven cards in the graveyard", () => {
    state = put(
      state,
      p1,
      "shriek",
      creature("Billowing Shriekmass", 2, 1, SHRIEKMASS, [
        "Flying",
        "Threshold",
      ]),
    );
    state = fillGraveyard(state, p1, 6);
    state = refreshThresholdBonuses(state);
    expect(hasThreshold(state, p1)).toBe(false);
    expect(getEffectivePower(state.cards.get(id("shriek"))!)).toBe(2);

    state = refreshThresholdBonuses(fillGraveyard(state, p1, 1));
    const card = state.cards.get(id("shriek"))!;
    expect(getEffectivePower(card)).toBe(4);
    expect(getEffectiveToughness(card)).toBe(2);
  });

  it("counts only the controller's graveyard", () => {
    state = put(
      state,
      p1,
      "shriek",
      creature("Billowing Shriekmass", 2, 1, SHRIEKMASS),
    );
    state = refreshThresholdBonuses(fillGraveyard(state, p2, 9));
    expect(getEffectivePower(state.cards.get(id("shriek"))!)).toBe(2);
  });

  it("grants threshold-only keywords only while threshold is active", () => {
    state = put(
      state,
      p1,
      "dread",
      creature("Dreadwing Scavenger", 2, 2, DREADWING, ["Flying", "Threshold"]),
    );
    state = put(
      state,
      p1,
      "theo",
      creature("Theorix Metamage", 2, 2, THEORIX, ["Threshold"]),
    );
    state = refreshThresholdBonuses(state);
    expect(hasDeathtouch(state.cards.get(id("dread"))!)).toBe(false);
    expect(hasFlying(state.cards.get(id("dread"))!)).toBe(true);
    expect(hasFlying(state.cards.get(id("theo"))!)).toBe(false);

    state = refreshThresholdBonuses(fillGraveyard(state, p1, 7));
    expect(hasDeathtouch(state.cards.get(id("dread"))!)).toBe(true);
    expect(hasFlying(state.cards.get(id("theo"))!)).toBe(true);
  });

  it("drops the bonus when the graveyard shrinks", () => {
    state = put(
      state,
      p1,
      "shriek",
      creature("Billowing Shriekmass", 2, 1, SHRIEKMASS),
    );
    state = refreshThresholdBonuses(fillGraveyard(state, p1, 7));
    const zones = new Map(state.zones);
    const gy = zones.get(`${p1}-graveyard`)!;
    zones.set(`${p1}-graveyard`, { ...gy, cardIds: gy.cardIds.slice(1) });
    state = refreshThresholdBonuses({ ...state, zones });
    expect(state.cards.get(id("shriek"))!.thresholdBonus).toBeUndefined();
  });

  it("makes a threshold unblockable attacker unblockable", () => {
    state = put(
      state,
      p1,
      "hermit",
      creature("Nightwhorl Hermit", 1, 3, HERMIT),
    );
    state = put(state, p2, "wall", creature("Wall", 0, 5));
    expect(canBlock(state, id("wall"), id("hermit")).canBlock).toBe(true);
    state = refreshThresholdBonuses(fillGraveyard(state, p1, 7));
    expect(canBlock(state, id("wall"), id("hermit")).canBlock).toBe(false);
  });

  it("evaluates threshold intervening-if clauses", () => {
    const cond = "there are seven or more cards in your graveyard";
    expect(evaluateInterveningIfClause(cond, state, p1)).toBe(false);
    state = fillGraveyard(state, p1, 7);
    expect(evaluateInterveningIfClause(cond, state, p1)).toBe(true);
  });
});
