/**
 * Triggered abilities resolve their text (CR 603.3 / 608.2; issue #2300).
 */
import { moveCardToZone } from "../keyword-actions";
import { parseTriggeredAbilityEffects } from "../effect-resolution";
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

function card(name: string, typeLine: string, oracle: string, p = 1, t = 1) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: String(p),
    toughness: String(t),
  } as unknown as ScryfallCard;
}

const LANDFALL = card(
  "Landfall Elf",
  "Creature — Elf",
  "Landfall — Whenever a land you control enters, you gain 1 life.",
);
const FOREST = card("Forest", "Basic Land — Forest", "({T}: Add {G}.)");
const BEAST = card("Beast", "Creature — Beast", "", 3, 3);
const BEAR = card("Bear", "Creature — Bear", "", 2, 4);

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "hand" = "battlefield",
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

function trigger(
  sourceId: string,
  controllerId: PlayerId,
  text: string,
  targets: string[] = [],
): StackObject {
  return {
    id: `trigger-${sourceId}`,
    type: "ability",
    triggered: true,
    sourceCardId: id(sourceId),
    controllerId,
    name: "triggered ability",
    text,
    manaCost: null,
    targets: targets.map((t) => ({ type: "card", targetId: t, isValid: true })),
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  } as StackObject;
}

const life = (s: GameState, p: PlayerId) => s.players.get(p)!.life;

describe("triggered ability effects", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("assigns untargeted 'you' effects to the controller", () => {
    const [gain] = parseTriggeredAbilityEffects("you gain 1 life", p2);
    expect(gain).toMatchObject({ effectType: "life_gain", amount: 1, targetId: p2 });
    const [draw] = parseTriggeredAbilityEffects("draw a card", p2);
    expect(draw).toMatchObject({ effectType: "card_draw", targetId: p2 });
  });

  it("a landfall trigger gains its controller life when it resolves", () => {
    let st = put(state, p1, "elf", LANDFALL);
    st = put(st, p1, "forest", FOREST, "hand");
    st = moveCardToZone(st, id("forest"), "battlefield").state;
    expect(st.stack).toHaveLength(1);
    const before = life(st, p1);
    st = resolveTopOfStack(st);
    expect(st.stack).toHaveLength(0);
    expect(life(st, p1)).toBe(before + 1);
  });

  it("gains life for the trigger's controller, not the active player", () => {
    const active = state.turn.activePlayerId;
    const other = active === p1 ? p2 : p1;
    let st = put(state, other, "elf", LANDFALL);
    st = put(st, other, "forest", FOREST, "hand");
    st = moveCardToZone(st, id("forest"), "battlefield").state;
    const [beforeActive, beforeOther] = [life(st, active), life(st, other)];
    st = resolveTopOfStack(st);
    expect(life(st, other)).toBe(beforeOther + 1);
    expect(life(st, active)).toBe(beforeActive);
  });

  it("an ETB fight trigger fights its chosen target", () => {
    let st = put(state, p1, "beast", BEAST);
    st = put(st, p2, "bear", BEAR);
    st = {
      ...st,
      stack: [
        trigger(
          "beast",
          p1,
          "it fights up to one target creature an opponent controls",
          ["bear"],
        ),
      ],
    };
    st = resolveTopOfStack(st);
    expect(st.cards.get(id("bear"))!.damage).toBe(3);
    expect(st.cards.get(id("beast"))!.damage).toBe(2);
  });

  it("a targeted trigger with no target chosen does nothing", () => {
    let st = put(state, p1, "beast", BEAST);
    st = put(st, p2, "bear", BEAR);
    st = {
      ...st,
      stack: [
        trigger("beast", p1, "it fights up to one target creature an opponent controls"),
      ],
    };
    const lives = [life(st, p1), life(st, p2)];
    st = resolveTopOfStack(st);
    expect(st.stack).toHaveLength(0);
    expect(st.cards.get(id("bear"))!.damage).toBe(0);
    expect(st.cards.get(id("beast"))!.damage).toBe(0);
    expect([life(st, p1), life(st, p2)]).toEqual(lives);
  });
});
