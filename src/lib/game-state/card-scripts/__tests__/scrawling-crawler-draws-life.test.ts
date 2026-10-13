/**
 * Scrawling Crawler (FDN 132) — opponent-draws life-loss half (lane 87).
 *
 * Wave 4.8 follow-up 12 lane 87 (#2614 follow-up). Scrawling Crawler's
 * second half: "Whenever an opponent draws a card, that player loses
 * 1 life." The lane 85 test covered the upkeep half; this lane
 * exercises the drawCard event:
 *
 *   1. The engine's `event: "drawCard"` trigger fires whenever ANY
 *      player draws a card (CR 121.2 / 603.2, lane 87 schema arm).
 *   2. The `whose_draws: "opponent"` filter narrows the trigger to
 *      opponent-only draws (Scrawling Crawler's "an opponent draws").
 *   3. The `LoseLife.who: "drawer"` op routes the life loss to whoever
 *      drew (the opponent, not the controller).
 *
 * Out of scope for lane 87 (each a follow-up lane): "you may" prompts
 * on a draw, "where X is the number of cards drawn this turn" X-count,
 * and the "you draw a card" mirror variant.
 */
import { getCardScript } from "../index";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
import { resolveScriptedAbility } from "../interpret";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import { drawCards } from "../../keyword-actions/draw";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const canonicalKey = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: canonicalKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(canonicalKey);
  if (!z) return state;
  zones.set(canonicalKey, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function seedLibrary(
  state: GameState,
  playerId: PlayerId,
  cardName: string,
  count: number,
): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    next = put(
      next,
      playerId,
      `${cardName}-${playerId}-${i}`,
      card(cardName, "Instant"),
      "library",
    );
  }
  return next;
}

describe("Scrawling Crawler (FDN 132): opponent-draws loses 1 life (lane 87)", () => {
  it("opponent's draw fires the drawCard trigger; controller's draw does not", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );

    // Detect both players' draws with the opponent's draw context.
    const oppDraws = detectTriggeredAbilities(state, "drawCard", {
      drawingPlayerId: p2,
    });
    const crawlerTriggers = oppDraws.filter(
      (t) => t.sourceCardId === id("crawler"),
    );
    expect(crawlerTriggers).toHaveLength(1);

    // The same engine context but with the controller as the drawer
    // should NOT fire (whose_draws: "opponent" filter excludes it).
    const selfDraws = detectTriggeredAbilities(state, "drawCard", {
      drawingPlayerId: p1,
    });
    const crawlerSelfTriggers = selfDraws.filter(
      (t) => t.sourceCardId === id("crawler"),
    );
    expect(crawlerSelfTriggers).toHaveLength(0);
  });

  it("drawCard trigger carries drawingPlayerId on the context for the resolver (lane 87)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );

    const triggers = detectTriggeredAbilities(state, "drawCard", {
      drawingPlayerId: p2,
    });
    const crawler = triggers.find((t) => t.sourceCardId === id("crawler"));
    expect(crawler).toBeDefined();
    expect(crawler!.context?.drawingPlayerId).toBe(p2);
  });

  it("end-to-end: opponent draws through drawCards → opponent loses 1 life (lane 87)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );
    state = seedLibrary(state, p2, "Cantrip", 3);

    const beforeP1 = state.players.get(p1)!.life;
    const beforeP2Life = state.players.get(p2)!.life;
    const beforeP2Hand = state.zones.get(`${p2}-hand`)!.cardIds.length;

    // Have p2 draw 1 card. drawCards now fires `event: "drawCard"`
    // triggers, which routes to Scrawling Crawler's "opponent draws"
    // half — p2 (the drawer) loses 1 life.
    const result = drawCards(state, p2, 1);
    expect(result.success).toBe(true);

    // The drawCard trigger is on the stack; resolve it through
    // `resolveScriptedAbility` so `LoseLife.who: "drawer"` fires.
    expect(result.state.stack).toHaveLength(1);
    const stacked = result.state;
    const top = stacked.stack[stacked.stack.length - 1];
    const resolved = resolveScriptedAbility(stacked, top)!;

    const afterP1 = resolved.players.get(p1)!.life;
    const afterP2 = resolved.players.get(p2)!.life;
    const afterP2Hand = resolved.zones.get(`${p2}-hand`)!.cardIds.length;

    expect(afterP2Hand).toBe(beforeP2Hand + 1);
    expect(afterP2).toBe(beforeP2Life - 1);
    expect(afterP1).toBe(beforeP1);
  });

  it("end-to-end: controller draws through drawCards → no life loss (opponent filter excludes it)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );
    state = seedLibrary(state, p1, "Cantrip", 3);

    const beforeP1 = state.players.get(p1)!.life;

    const result = drawCards(state, p1, 1);
    expect(result.success).toBe(true);

    // The drawCard trigger is NOT on the stack: whose_draws: "opponent"
    // excludes the controller's draw.
    expect(result.state.stack).toHaveLength(0);

    // Life unchanged: no life-loss trigger was even detected.
    expect(result.state.players.get(p1)!.life).toBe(beforeP1);
  });

  it("parsed trigger carries whoseDraws: 'opponent' (lane 87)", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Scrawling Crawler",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    const drawTrigger = abilities!.find(
      (a) => a.trigger.event === "drawCard",
    );
    expect(drawTrigger).toBeDefined();
    expect(drawTrigger!.trigger.whoseDraws).toBe("opponent");
  });

  it("drawCard trigger puts a single ability on the stack with triggerContext stamped (lane 87)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "crawler",
      card("Scrawling Crawler", "Artifact Creature — Phyrexian Construct", [3, 3]),
    );

    const triggers = detectTriggeredAbilities(state, "drawCard", {
      drawingPlayerId: p2,
    });
    const crawler = triggers.filter(
      (t) => t.sourceCardId === id("crawler"),
    );
    expect(crawler).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, crawler);
    expect(stacked.stack).toHaveLength(1);
    const top = stacked.stack[stacked.stack.length - 1];
    // Lane 87: triggerContext is stamped on the stack object so the
    // resolver can route `LoseLife.who: "drawer"` to the drawer.
    expect(top.triggerContext?.drawingPlayerId).toBe(p2);
  });

  it("registry: Scrawling Crawler JSON encodes the lane 87 second trigger", () => {
    const crawler = getCardScript("Scrawling Crawler");
    expect(crawler).toBeDefined();
    const drawTrigger = crawler!.triggers!.find(
      (t) => t.event === "drawCard",
    );
    expect(drawTrigger).toBeDefined();
    expect(drawTrigger!.whose_draws).toBe("opponent");
    expect(drawTrigger!.effects).toEqual([
      { op: "LoseLife", amount: 1, who: "drawer" },
    ]);
  });
});