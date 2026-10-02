/**
 * Modern "When this creature enters" ETB wording (issue #2300).
 *
 * Current Oracle text drops "the battlefield". The parser now recognises
 * both wordings and records whose entry a trigger watches (CR 603.6a), and
 * spell resolution passes the entering permanent so "this creature enters"
 * fires only for that permanent.
 */
import { parseTriggeredAbilities } from "../oracle-text-parser/abilities";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function creature(name: string, oracle: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Human",
    mana_cost: "{1}{G}",
    cmc: 2,
    power: "2",
    toughness: "2",
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    oracle_text: oracle,
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function newGame(): { state: GameState; p1: PlayerId; p2: PlayerId } {
  const state = startGame(
    createInitialGameState(["Player1", "Player2"], 20, false),
  );
  const [p1, p2] = Array.from(state.players.keys()) as PlayerId[];
  return { state, p1, p2 };
}

function put(
  state: GameState,
  data: ScryfallCard,
  owner: PlayerId,
  zone: "battlefield" | "hand",
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(data, owner, owner);
  const cards = new Map(state.cards);
  cards.set(card.id, card);
  const zones = new Map(state.zones);
  const key = `${owner}-${zone}`;
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, card.id] });
  return { state: { ...state, cards, zones }, cardId: card.id };
}

describe("modern ETB trigger wording", () => {
  it("parses 'When this creature enters' as a self ETB trigger", () => {
    const [ability] = parseTriggeredAbilities(
      "When this creature enters, draw a card.",
    );
    expect(ability.trigger.event).toBe("entersBattlefield");
    expect(ability.trigger.subject).toBe("self");
    expect(ability.effect).toBe("draw a card");
  });

  it("still parses older 'enters the battlefield' wording as self", () => {
    const [ability] = parseTriggeredAbilities(
      "When Elvish Visionary enters the battlefield, draw a card.",
    );
    expect(ability.trigger.event).toBe("entersBattlefield");
    expect(ability.trigger.subject).toBe("self");
  });

  it("parses 'another creature you control enters' with its filter", () => {
    const [ability] = parseTriggeredAbilities(
      "Whenever another creature you control enters, you gain 1 life.",
    );
    expect(ability.trigger.subject).toBe("another");
    expect(ability.trigger.enteringFilter).toEqual({
      types: ["creature"],
      controller: "you",
      nontoken: undefined,
    });
  });

  it("fires a self ETB only for the permanent that entered", () => {
    const g = newGame();
    const etb = "When this creature enters, draw a card.";
    const a = put(g.state, creature("A", etb), g.p1, "battlefield");
    const b = put(a.state, creature("B", etb), g.p1, "battlefield");
    const fired = detectTriggeredAbilities(b.state, "entersBattlefield", {
      enteringCardId: a.cardId,
    });
    expect(fired.map((t) => t.sourceCardId)).toEqual([a.cardId]);
  });

  it("fires 'another creature you control' for others you control only", () => {
    const g = newGame();
    const watcher = put(
      g.state,
      creature(
        "Watcher",
        "Whenever another creature you control enters, you gain 1 life.",
      ),
      g.p1,
      "battlefield",
    );
    const mine = put(watcher.state, creature("Mine", ""), g.p1, "battlefield");
    const theirs = put(mine.state, creature("Theirs", ""), g.p2, "battlefield");
    const s = theirs.state;
    const count = (id: CardInstanceId) =>
      detectTriggeredAbilities(s, "entersBattlefield", { enteringCardId: id })
        .length;
    expect(count(mine.cardId)).toBe(1);
    expect(count(watcher.cardId)).toBe(0);
    expect(count(theirs.cardId)).toBe(0);
  });

  it("checks raid on a modern ETB: no trigger unless you attacked", () => {
    const g = newGame();
    const spy = put(
      g.state,
      creature(
        "Storm Fleet Spy",
        "Raid — When this creature enters, if you attacked this turn, draw a card.",
      ),
      g.p1,
      "battlefield",
    );
    const ctx = { enteringCardId: spy.cardId };
    expect(
      detectTriggeredAbilities(spy.state, "entersBattlefield", ctx),
    ).toHaveLength(0);
    const players = new Map(spy.state.players);
    players.set(g.p1, { ...players.get(g.p1)!, attackedThisTurn: true });
    expect(
      detectTriggeredAbilities(
        { ...spy.state, players },
        "entersBattlefield",
        ctx,
      ),
    ).toHaveLength(1);
  });

  it("puts only the cast creature's ETB on the stack when it resolves", () => {
    const g = newGame();
    const etb = "When this creature enters, you gain 3 life.";
    const old = put(g.state, creature("Old", etb), g.p1, "battlefield");
    const fresh = put(old.state, creature("Fresh", etb), g.p1, "hand");
    let s = addMana(fresh.state, g.p1, { green: 2 });
    s = {
      ...s,
      turn: {
        ...s.turn,
        currentPhase: Phase.PRECOMBAT_MAIN,
        activePlayerId: g.p1,
      },
      stack: [],
      priorityPlayerId: g.p1,
    };
    const cast = castSpell(s, g.p1, fresh.cardId, [], [], 0, false);
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.stack.map((o) => o.sourceCardId)).toEqual([fresh.cardId]);
    const lifeBefore = resolved.players.get(g.p1)!.life;
    const afterTrigger = resolveTopOfStack(resolved);
    expect(afterTrigger.players.get(g.p1)!.life).toBe(lifeBefore + 3);
  });
});
