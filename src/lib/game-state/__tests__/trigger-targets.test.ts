/**
 * Choosing targets for triggered abilities (CR 603.3d; issue #2300).
 */
import {
  parseTriggerTargetSpec,
  getLegalTriggerTargets,
  chooseTriggerTargets,
  autoChooseTriggerTargets,
  triggerNeedsTargets,
} from "../trigger-system";
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

function card(name: string, p: number, t: number, keywords: string[] = []) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Beast",
    oracle_text: keywords.join(", "),
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords,
    legalities: { standard: "legal" },
    layout: "normal",
    power: String(p),
    toughness: String(t),
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;
const FIGHT = "it fights up to one target creature an opponent controls";

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

function onStack(
  state: GameState,
  sourceId: string,
  controllerId: PlayerId,
  text: string,
): GameState {
  const obj = {
    id: `trigger-${sourceId}`,
    type: "ability",
    triggered: true,
    sourceCardId: id(sourceId),
    controllerId,
    name: "triggered ability",
    text,
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  } as StackObject;
  return { ...state, stack: [...state.stack, obj] };
}

describe("triggered ability targets", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("parses target requirements from trigger text", () => {
    expect(parseTriggerTargetSpec(FIGHT)).toEqual({
      kind: "creature",
      controller: "opponent",
      optional: true,
      excludeSource: false,
    });
    expect(parseTriggerTargetSpec("it deals 2 damage to any target")).toMatchObject({
      kind: "any",
      optional: false,
    });
    expect(
      parseTriggerTargetSpec("put a +1/+1 counter on another target creature you control"),
    ).toMatchObject({ kind: "creature", controller: "you", excludeSource: true });
    expect(parseTriggerTargetSpec("target opponent loses 2 life")).toMatchObject({
      kind: "opponent",
    });
    expect(parseTriggerTargetSpec("you gain 1 life")).toBeNull();
  });

  it("lists only legal targets, skipping hexproof opponents' creatures", () => {
    let st = put(state, p1, "beast", card("Beast", 3, 3));
    st = put(st, p1, "friend", card("Friend", 1, 1));
    st = put(st, p2, "bear", card("Bear", 2, 2));
    st = put(st, p2, "elusive", card("Elusive", 1, 1, ["Hexproof"]));
    st = onStack(st, "beast", p1, FIGHT);
    expect(getLegalTriggerTargets(st, st.stack[0])).toEqual(["bear"]);
  });

  it("rejects illegal and missing mandatory targets", () => {
    let st = put(state, p1, "beast", card("Beast", 3, 3));
    st = put(st, p2, "bear", card("Bear", 2, 2));
    st = onStack(st, "beast", p1, "it deals 2 damage to target creature");
    const objId = st.stack[0].id;
    expect(chooseTriggerTargets(st, objId, []).success).toBe(false);
    expect(chooseTriggerTargets(st, objId, ["nope"]).success).toBe(false);
    const ok = chooseTriggerTargets(st, objId, ["bear"]);
    expect(ok.success).toBe(true);
    expect(ok.state.stack[0].targets[0]).toMatchObject({ type: "card", targetId: "bear" });
    expect(triggerNeedsTargets(ok.state.stack[0])).toBe(false);
  });

  it("allows choosing nothing for an 'up to one' trigger", () => {
    let st = put(state, p1, "beast", card("Beast", 3, 3));
    st = onStack(st, "beast", p1, FIGHT);
    const r = chooseTriggerTargets(st, st.stack[0].id, []);
    expect(r.success).toBe(true);
    expect(triggerNeedsTargets(r.state.stack[0])).toBe(false);
  });

  it("AI fights the biggest creature it can kill, then the fight resolves", () => {
    let st = put(state, p1, "beast", card("Beast", 3, 3));
    st = put(st, p2, "small", card("Small", 1, 1));
    st = put(st, p2, "mid", card("Mid", 3, 3));
    st = put(st, p2, "big", card("Big", 5, 5));
    st = onStack(st, "beast", p1, FIGHT);
    st = autoChooseTriggerTargets(st, p1);
    expect(st.stack[0].targets.map((t) => t.targetId)).toEqual(["mid"]);
    st = resolveTopOfStack(st);
    expect(st.cards.get(id("mid"))!.damage).toBe(3);
    expect(st.cards.get(id("beast"))!.damage).toBe(3);
  });

  it("AI declines an optional fight it can't win", () => {
    let st = put(state, p1, "beast", card("Beast", 1, 1));
    st = put(st, p2, "big", card("Big", 5, 5));
    st = onStack(st, "beast", p1, FIGHT);
    st = autoChooseTriggerTargets(st, p1);
    expect(st.stack[0].targets).toEqual([]);
    expect(triggerNeedsTargets(st.stack[0])).toBe(false);
  });

  it("AI aims damage at the opponent when no creature dies to it", () => {
    let st = put(state, p1, "pinger", card("Pinger", 1, 1));
    st = put(st, p2, "big", card("Big", 5, 5));
    st = onStack(st, "pinger", p1, "it deals 2 damage to any target");
    st = autoChooseTriggerTargets(st, p1);
    expect(st.stack[0].targets[0]).toMatchObject({ type: "player", targetId: p2 });
  });

  it("only picks for the given controller", () => {
    let st = put(state, p1, "beast", card("Beast", 3, 3));
    st = put(st, p2, "bear", card("Bear", 2, 2));
    st = onStack(st, "beast", p1, FIGHT);
    st = autoChooseTriggerTargets(st, p2);
    expect(triggerNeedsTargets(st.stack[0])).toBe(true);
  });
});
