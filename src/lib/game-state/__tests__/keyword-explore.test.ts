/**
 * Explore keyword action (CR 701.18, issue #2965).
 */
import {
  performExplore,
  validateExploreDecision,
  type ExploreDecider,
} from "../keyword-actions";
import {
  parseSpellEffects,
  parseTriggeredAbilityEffects,
  resolveEffect,
} from "../effect-resolution";
import { resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
  StackObject,
} from "../types";

const mockCard = (
  name: string,
  typeLine: string,
  oracleText = "",
): ScryfallCard =>
  ({
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal" },
    layout: "normal",
  }) as ScryfallCard;

const LAND = mockCard("Forest", "Basic Land — Forest");
const CREATURE = mockCard("Trailblazer", "Creature — Elemental");
const NON_LAND = mockCard("Shock", "Instant");
const EXPLORER = mockCard(
  "Pathfinder",
  "Creature — Beast",
  "When this creature enters, it explores.",
);

function zone(state: GameState, key: string): CardInstanceId[] {
  return state.zones.get(key)?.cardIds ?? [];
}
function library(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return zone(state, `${playerId}-library`);
}
function hand(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return zone(state, `${playerId}-hand`);
}
function graveyard(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return zone(state, `${playerId}-graveyard`);
}
function counters(state: GameState, cardId: CardInstanceId) {
  return state.cards.get(cardId)?.counters ?? [];
}
function plusOneCount(state: GameState, cardId: CardInstanceId): number {
  return counters(state, cardId).find((c) => c.type === "+1/+1")?.count ?? 0;
}

/**
 * Give the player a known library. The END of the array is the top of the
 * library (the end surveil and scry treat as the top).
 */
function withLibrary(
  state: GameState,
  playerId: PlayerId,
  entries: Array<[string, ScryfallCard]>,
): GameState {
  const key = `${playerId}-library`;
  const ids = entries.map(([id]) => id as CardInstanceId);
  const cards = new Map(state.cards);
  for (const [id, data] of entries) {
    cards.set(
      id as CardInstanceId,
      createCardInstance(data, playerId, playerId, {
        id: id as CardInstanceId,
        currentZoneKey: key,
      }),
    );
  }
  const zones = new Map(state.zones);
  const zone = zones.get(key)!;
  zones.set(key, { ...zone, cardIds: ids });
  return { ...state, cards, zones } as GameState;
}

/** Put a permanent on the battlefield. */
function withPermanent(
  state: GameState,
  playerId: PlayerId,
  id: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cardId = id as CardInstanceId;
  const cards = new Map(state.cards);
  cards.set(
    cardId,
    createCardInstance(data, playerId, playerId, {
      id: cardId,
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const zone = zones.get(key)!;
  zones.set(key, { ...zone, cardIds: [...zone.cardIds, cardId] });
  return { ...state, cards, zones } as GameState;
}

describe("explore", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    const s = createInitialGameState(["Player1", "Player2"], 20, false);
    startGame(s);
    p1 = Array.from(s.players.keys())[0];
    state = withPermanent(s, p1, "explorer", EXPLORER);
  });

  it("puts a revealed land into the exploring player's hand", () => {
    const st = withLibrary(state, p1, [
      ["nonland", NON_LAND],
      ["land", LAND],
    ]);
    const result = performExplore(st, p1, "explorer" as CardInstanceId);
    expect(result.success).toBe(true);
    expect(hand(result.state, p1)).toContain("land");
    expect(library(result.state, p1)).toHaveLength(1);
    expect(library(result.state, p1)).not.toContain("land");
    // A land gives no counter.
    expect(plusOneCount(result.state, "explorer" as CardInstanceId)).toBe(0);
  });

  it("puts a +1/+1 counter on the permanent when a non-land is revealed", () => {
    const st = withLibrary(state, p1, [
      ["land", LAND],
      ["nonland", NON_LAND],
    ]);
    const result = performExplore(st, p1, "explorer" as CardInstanceId);
    expect(result.success).toBe(true);
    expect(plusOneCount(result.state, "explorer" as CardInstanceId)).toBe(1);
    // By default the revealed card stays on top of the library.
    expect(library(result.state, p1)).toEqual(["land", "nonland"]);
    expect(hand(result.state, p1)).toHaveLength(0);
  });

  it("lets the player put the revealed non-land into their graveyard", () => {
    const st = withLibrary(state, p1, [
      ["land", LAND],
      ["nonland", NON_LAND],
    ]);
    const decide: ExploreDecider = (_s, _p, revealed) => ({
      toGraveyard: [...revealed],
      toTop: [],
    });
    const result = performExplore(st, p1, "explorer" as CardInstanceId, decide);
    expect(result.success).toBe(true);
    expect(graveyard(result.state, p1)).toContain("nonland");
    expect(library(result.state, p1)).toEqual(["land"]);
    expect(plusOneCount(result.state, "explorer" as CardInstanceId)).toBe(1);
  });

  it("treats an empty library as a legal no-op", () => {
    const st = withLibrary(state, p1, []);
    const result = performExplore(st, p1, "explorer" as CardInstanceId);
    expect(result.success).toBe(true);
    expect(result.state).toBe(st);
    expect(result.affectedCards).toEqual([]);
  });

  it("does nothing when the exploring card is not on the battlefield", () => {
    const st = withLibrary(state, p1, [["nonland", NON_LAND]]);
    const result = performExplore(st, p1, "explorer" as CardInstanceId);
    // The permanent is on the battlefield here, so remove it and retry.
    expect(result.success).toBe(true);
    const zones = new Map(st.zones);
    const bf = zones.get(`${p1}-battlefield`)!;
    zones.set(`${p1}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== "explorer"),
    });
    const withoutExplorer = { ...st, zones } as GameState;
    const missing = performExplore(
      withoutExplorer,
      p1,
      "explorer" as CardInstanceId,
    );
    expect(missing.state).toBe(withoutExplorer);
    expect(plusOneCount(missing.state, "explorer" as CardInstanceId)).toBe(0);
  });

  it("leaves the state untouched when the decider returns an illegal decision", () => {
    const st = withLibrary(state, p1, [["nonland", NON_LAND]]);
    const result = performExplore(st, p1, "explorer" as CardInstanceId, () => ({
      toGraveyard: [],
      toTop: [],
    }));
    expect(result.success).toBe(false);
    expect(result.state).toBe(st);
    expect(
      validateExploreDecision(["nonland" as CardInstanceId], {
        toGraveyard: ["other" as CardInstanceId],
        toTop: [],
      }),
    ).not.toBeNull();
  });

  it("parses explore from oracle text", () => {
    expect(parseSpellEffects("It explores.")).toEqual(
      expect.arrayContaining([{ effectType: "explore" }]),
    );
    expect(parseTriggeredAbilityEffects("it explores", p1)).toEqual(
      expect.arrayContaining([{ effectType: "explore" }]),
    );
  });

  it("resolves an ETB explore through effect resolution", () => {
    const st = withLibrary(state, p1, [
      ["land", LAND],
      ["nonland", NON_LAND],
    ]);
    const trigger: StackObject = {
      id: "trigger-explorer",
      type: "ability",
      triggered: true,
      sourceCardId: "explorer" as CardInstanceId,
      controllerId: p1,
      name: "Pathfinder triggered ability",
      text: "When this creature enters, it explores.",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
    } as StackObject;
    const withStack = { ...st, stack: [trigger] } as GameState;
    const resolved = resolveTopOfStack(withStack);
    expect(resolved.stack).toHaveLength(0);
    expect(plusOneCount(resolved, "explorer" as CardInstanceId)).toBe(1);
    // The revealed non-land stayed on top of the library.
    expect(library(resolved, p1)).toEqual(["land", "nonland"]);
  });

  it("resolves an explore effect for a source permanent", () => {
    const st = withLibrary(state, p1, [
      ["land", LAND],
      ["nonland", NON_LAND],
    ]);
    const resolved = resolveEffect(st, { effectType: "explore" }, "explorer" as CardInstanceId);
    expect(resolved.success).toBe(true);
    expect(plusOneCount(resolved.state, "explorer" as CardInstanceId)).toBe(1);
  });
});
