/**
 * Converge ability word (issue #2300, Standard remainder slice).
 */
import { countColorsSpent, isConvergeX } from "../keyword-actions/converge";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  GameState,
  ManaPool,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const TOGETHER_AS_ONE =
  "Converge — Target player draws X cards, Together as One deals X damage to any target, and you gain X life, where X is the number of colors of mana spent to cast this spell.";
const CONVERGE_LIFE =
  "Converge — You gain X life, where X is the number of colors of mana spent to cast this spell.";

function sorcery(name: string, oracle: string, manaCost: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Sorcery",
    mana_cost: manaCost,
    cmc: 6,
    colors: [],
    color_identity: [],
    keywords: oracle.startsWith("Converge") ? ["Converge"] : [],
    oracle_text: oracle,
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function pool(p: Partial<ManaPool>): ManaPool {
  return {
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    generic: 0,
    ...p,
  };
}

function setup(
  data: ScryfallCard,
  mana: Partial<ManaPool>,
): { state: GameState; p1: PlayerId; cardId: CardInstanceId } {
  let state = startGame(
    createInitialGameState(["Player1", "Player2"], 20, false),
  );
  const [p1] = Array.from(state.players.keys()) as PlayerId[];
  const card = createCardInstance(data, p1, p1);
  const cards = new Map(state.cards);
  cards.set(card.id, card);
  const zones = new Map(state.zones);
  const hand = zones.get(`${p1}-hand`)!;
  zones.set(`${p1}-hand`, { ...hand, cardIds: [...hand.cardIds, card.id] });
  state = addMana({ ...state, cards, zones }, p1, mana);
  state = {
    ...state,
    turn: {
      ...state.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: p1,
    },
    stack: [],
    priorityPlayerId: p1,
  };
  return { state, p1, cardId: card.id };
}

describe("converge", () => {
  it("counts distinct colors that left the pool, generic payments included", () => {
    const before = pool({ white: 2, blue: 1, red: 1, colorless: 2 });
    expect(countColorsSpent(before, pool({ white: 1 }))).toBe(3);
    expect(countColorsSpent(before, before)).toBe(0);
    expect(
      countColorsSpent(before, pool({ blue: 1, red: 1, colorless: 0 })),
    ).toBe(1);
  });

  it("recognises converge X wording but not a plain X spell", () => {
    expect(isConvergeX(TOGETHER_AS_ONE)).toBe(true);
    expect(
      isConvergeX(
        "Converge — Target player discards X cards, where X is the number of colors of mana spent to cast this spell.",
      ),
    ).toBe(true);
    expect(isConvergeX("Draw X cards.")).toBe(false);
    expect(isConvergeX(undefined)).toBe(false);
  });

  it("sets X to the number of colors spent when a converge spell is cast", () => {
    const { state, p1, cardId } = setup(
      sorcery("Together as One", TOGETHER_AS_ONE, "{6}"),
      { white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 1 },
    );
    const result = castSpell(state, p1, cardId, [], [], 0, false);
    expect(result.success).toBe(true);
    const top = result.state.stack[result.state.stack.length - 1];
    expect(top.colorsSpent).toBe(5);
    expect(top.variableValues.get("X")).toBe(5);
  });

  it("counts one color when all the mana spent is the same color", () => {
    const { state, p1, cardId } = setup(
      sorcery("Together as One", TOGETHER_AS_ONE, "{6}"),
      { red: 6 },
    );
    const result = castSpell(state, p1, cardId, [], [], 0, false);
    expect(result.success).toBe(true);
    const top = result.state.stack[result.state.stack.length - 1];
    expect(top.variableValues.get("X")).toBe(1);
  });

  it("leaves the chosen X alone on spells without converge", () => {
    const { state, p1, cardId } = setup(
      sorcery("Plain X", "You gain X life.", "{X}{G}"),
      { green: 1, white: 3 },
    );
    const result = castSpell(state, p1, cardId, [], [], 3, false);
    expect(result.success).toBe(true);
    const top = result.state.stack[result.state.stack.length - 1];
    expect(top.variableValues.get("X")).toBe(3);
    expect(top.colorsSpent).toBe(2);
  });

  it("resolves a converge life gain for the number of colors spent", () => {
    const { state, p1, cardId } = setup(
      sorcery("Converge Life", CONVERGE_LIFE, "{4}"),
      { white: 1, blue: 1, black: 2 },
    );
    const lifeBefore = state.players.get(p1)!.life;
    const cast = castSpell(state, p1, cardId, [], [], 0, false);
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.players.get(p1)!.life).toBe(lifeBefore + 3);
  });
});
