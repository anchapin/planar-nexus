/**
 * Card scripts — dies attacks upkeep triggers.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted dies, attacks and upkeep triggers (#2496)
 */
import { CardScriptSchema } from "../index";
import { GameState, PlayerId } from "../../types";
import { Phase } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { declareAttackers } from "../../combat/declaration";
import { destroyCard } from "../../keyword-actions/removal";
import { getTriggeredAbilities } from "../../abilities/parse";
import { id, card, put } from "./helpers";
import { passPriority } from "../../game-state";

describe("scripted dies, attacks and upkeep triggers (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const sources = (s: GameState) => s.stack.map((o) => o.sourceCardId);
  const bothPass = (s: GameState) => passPriority(passPriority(s, p1), p2);
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };
  const at = (s: GameState, phase: Phase): GameState => ({
    ...s,
    stack: [],
    priorityPlayerId: p1,
    turn: { ...s.turn, activePlayerId: p1, currentPhase: phase },
  });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Summit Sentinel's dies trigger resolves from its script after it died", () => {
    state = at(
      put(
        state,
        p1,
        "sentinel",
        card("Summit Sentinel", "Creature — Construct", [2, 1]),
      ),
      Phase.PRECOMBAT_MAIN,
    );
    const [ability] = getTriggeredAbilities(
      state.cards.get(id("sentinel"))!.cardData,
    );
    expect(ability.trigger).toEqual({ event: "dies", subject: "self" });
    const hand = (s: GameState) => s.zones.get(`${p1}-hand`)!.cardIds.length;
    const died = destroyCard(state, id("sentinel")).state;
    expect(sources(died)).toEqual([id("sentinel")]);
    expect(hand(bothPass(died))).toBe(hand(died) + 1);
  });

  it("Sanguine Syphoner drains only when it attacks, from its script", () => {
    state = put(
      state,
      p1,
      "syphoner",
      card("Sanguine Syphoner", "Creature — Vampire Warlock", [1, 3]),
    );
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = at(
      ready(ready(state, "syphoner"), "bear"),
      Phase.DECLARE_ATTACKERS,
    );
    const bearOnly = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(bearOnly)).toEqual([]);
    const both = declareAttackers(state, [
      { cardId: id("syphoner"), defenderId: p2 },
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(both)).toEqual([id("syphoner")]);
    const resolved = bothPass(both);
    expect(resolved.players.get(p2)!.life).toBe(19);
    expect(resolved.players.get(p1)!.life).toBe(21);
  });

  it("validates subject, controller, once and whose", () => {
    const trig = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "X",
        triggers: [
          { text: "X", effects: [{ op: "Draw", amount: 1 }], ...extra },
        ],
      }).success;
    expect(trig({ event: "dies", subject: "another", controller: "you" })).toBe(
      true,
    );
    expect(
      trig({ event: "attacks", subject: "any", controller: "you", once: true }),
    ).toBe(true);
    expect(trig({ event: "upkeep", whose: "each" })).toBe(true);
    expect(trig({ event: "dies", whose: "each" })).toBe(false);
    expect(trig({ event: "upkeep", once: true })).toBe(false);
    expect(trig({ event: "dies", subject: "self", controller: "you" })).toBe(
      false,
    );
  });
});
