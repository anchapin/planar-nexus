/**
 * Issue #2443: the AI answers corpse, tribute and attack-return offers.
 */
import { describe, it, expect } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
  createCardInstance,
  processTributeOnEtb,
  Phase,
} from "@/lib/game-state";
import type {
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "@/lib/game-state";
import {
  answerAIOfferChoices,
  decideHandSizeDiscard,
  decideOfferChoice,
  isHandSizeDiscardChoice,
  isOfferChoice,
} from "../offer-choices";
import { passPriority } from "@/lib/game-state";

function offer(
  type: WaitingChoice["type"],
  payPrefix: "pay" | "accept",
  payValid: boolean,
): WaitingChoice {
  return {
    type,
    playerId: "p2" as PlayerId,
    stackObjectId: null,
    prompt: "offer",
    choices: [
      { label: "Pay", value: `${payPrefix}:card-1`, isValid: payValid },
      { label: "Decline", value: "decline:card-1", isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: 0,
  };
}

describe("decideOfferChoice", () => {
  const cases: Array<[WaitingChoice["type"], "pay" | "accept"]> = [
    ["corpse_offer", "pay"],
    ["tribute_offer", "accept"],
    ["attack_return_offer", "pay"],
  ];

  it.each(cases)("%s: pays when the pay option is valid", (type, prefix) => {
    expect(decideOfferChoice(offer(type, prefix, true))).toBe(
      `${prefix}:card-1`,
    );
  });

  it.each(cases)("%s: declines when it cannot afford", (type, prefix) => {
    expect(decideOfferChoice(offer(type, prefix, false))).toBe(
      "decline:card-1",
    );
  });

  it("only treats the three offer types as offers", () => {
    expect(isOfferChoice(offer("corpse_offer", "pay", true))).toBe(true);
    expect(isOfferChoice(offer("choose_mode", "pay", true))).toBe(false);
    expect(isOfferChoice(null)).toBe(false);
  });
});

function tributeCreature(): ScryfallCard {
  return {
    id: "mock-tribute-2",
    name: "Fanatic of Rhonas",
    type_line: "Creature \u2014 Snake Druid",
    oracle_text:
      "Tribute 2 (As this creature enters the battlefield, an opponent of your choice may pay 2. If they don't, sacrifice this creature.)",
    mana_cost: "{3}{G}",
    cmc: 4,
    colors: ["G"],
    color_identity: ["G"],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "4",
    toughness: "4",
  } as unknown as ScryfallCard;
}

function tributeFixture(aiMana: number): {
  state: GameState;
  humanId: PlayerId;
  aiId: PlayerId;
} {
  let state = createInitialGameState(["Human", "AI Opponent"], 20, false);
  state = startGame(state);
  const [humanId, aiId] = Array.from(state.players.keys());
  state.status = "in_progress";
  state.turn.activePlayerId = humanId;
  state.priorityPlayerId = humanId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];

  const card = createCardInstance(tributeCreature(), humanId, humanId);
  card.hasSummoningSickness = false;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${humanId}-battlefield`)!;
  state.zones.set(`${humanId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });

  const ai = state.players.get(aiId)!;
  state.players.set(aiId, {
    ...ai,
    manaPool: {
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: aiMana,
    },
  });

  const res = processTributeOnEtb(state, card.id);
  return { state: res.state, humanId, aiId };
}

describe("answerAIOfferChoices (tribute offer owned by the AI)", () => {
  it("pays the tribute when the AI can afford it and clears the choice", () => {
    const f = tributeFixture(10);
    expect(f.state.waitingChoice?.type).toBe("tribute_offer");
    expect(f.state.waitingChoice?.playerId).toBe(f.aiId);

    const { state, answered } = answerAIOfferChoices(f.state, f.aiId);
    expect(answered).toHaveLength(1);
    expect(answered[0].value.startsWith("accept:")).toBe(true);
    expect(state.waitingChoice).toBeNull();
  });

  it("declines when the AI cannot pay, and still clears the choice", () => {
    const f = tributeFixture(0);
    const { state, answered } = answerAIOfferChoices(f.state, f.aiId);
    expect(answered).toHaveLength(1);
    expect(answered[0].value.startsWith("decline:")).toBe(true);
    expect(state.waitingChoice).toBeNull();
  });

  it("leaves an offer that belongs to another player alone", () => {
    const f = tributeFixture(10);
    const { state, answered } = answerAIOfferChoices(f.state, f.humanId);
    expect(answered).toHaveLength(0);
    expect(state).toBe(f.state);
  });
});

describe("AI cleanup discard to hand size (#2446)", () => {
  function overLimit(n: number): { state: GameState; ai: PlayerId } {
    let state = startGame(createInitialGameState(["Human", "AI"], 20, false));
    const ai = state.turn.activePlayerId;
    const other = Array.from(state.players.keys()).find((id) => id !== ai)!;
    const cards = new Map(state.cards);
    const zones = new Map(state.zones);
    const key = `${ai}-hand`;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `ai-h${i}`;
      const card = {
        id: `mock-${i}`,
        name: i % 2 ? `Forest ${i}` : `Bear ${i}`,
        type_line: i % 2 ? "Basic Land — Forest" : "Creature — Bear",
        oracle_text: "",
        mana_cost: i % 2 ? "" : "{1}{G}",
        cmc: i % 2 ? 0 : 2,
        colors: [],
        color_identity: [],
        keywords: [],
        legalities: { standard: "legal" },
        layout: "normal",
      } as unknown as ScryfallCard;
      cards.set(
        id,
        createCardInstance(card, ai, ai, { id, currentZoneKey: key }),
      );
      ids.push(id);
    }
    zones.set(key, { ...zones.get(key)!, cardIds: ids });
    state = {
      ...state,
      cards,
      zones,
      turn: { ...state.turn, currentPhase: Phase.CLEANUP },
      priorityPlayerId: ai,
    };
    state = passPriority(passPriority(state, ai), other);
    return { state, ai };
  }

  it("recognises the discard choice", () => {
    const { state } = overLimit(9);
    expect(isHandSizeDiscardChoice(state.waitingChoice)).toBe(true);
    expect(isOfferChoice(state.waitingChoice)).toBe(false);
  });

  it("picks exactly the required number of distinct cards from hand", () => {
    const { state } = overLimit(10);
    const picked = decideHandSizeDiscard(state, state.waitingChoice!);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    const hand = state.waitingChoice!.choices.map((c) => c.value);
    for (const id of picked) expect(hand).toContain(id);
  });

  it("answers the discard and lets the turn end", () => {
    const { state, ai } = overLimit(9);
    const { state: after, answered } = answerAIOfferChoices(state, ai);
    expect(answered).toHaveLength(1);
    expect(answered[0].type).toBe("discard_to_hand_size");
    expect(after.waitingChoice).toBeNull();
    expect(after.zones.get(`${ai}-hand`)!.cardIds).toHaveLength(7);
    expect(after.turn.activePlayerId).not.toBe(ai);
  });

  it("leaves a human's discard alone", () => {
    const { state, ai } = overLimit(9);
    const human = Array.from(state.players.keys()).find((id) => id !== ai)!;
    const { state: after, answered } = answerAIOfferChoices(state, human);
    expect(answered).toHaveLength(0);
    expect(after).toBe(state);
  });
});
