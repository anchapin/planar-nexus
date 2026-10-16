/**
 * Rhystic Study — "draw N where N = cards drawn by opponents
 * this turn" (lane 95).
 *
 * Wave 4.8 follow-up 13 lane 95 (#2614 follow-up). The
 * `X: "cardsDrawnThisTurnByOpponents"` arm sums the
 * per-opponent counters across every opponent of the
 * controller — Rhystic Study's "Whenever an opponent
 * draws a card, you may draw a card" half is the
 * canonical example; this lane implements the
 * "draw N where N = cards drawn by opponents this turn"
 * aggregation pattern.
 *
 * The v1 minimum:
 * - `DrawSchema.X: "cardsDrawnThisTurnByOpponents"` arm
 *   reads `sum(p.cardsDrawnThisTurn for [pid, p] in
 *   state.players if pid !== controllerId)`.
 * - `resolveDrawAmount` handles the new arm (parallel
 *   to the lane 94 `cardsDrawnThisTurn` arm, but
 *   summing across opponents instead of reading the
 *   controller's own counter).
 *
 * The sample card (`draw_x_opponents_drawn_this_turn.json`)
 * is a synthetic "at the beginning of your upkeep, draw
 * a card equal to the number of cards opponents have
 * drawn this turn" trigger.
 *
 * Out of scope for lane 95 (each a follow-up lane):
 * - the "draw N where N = cards drawn by a SPECIFIC
 *   opponent" variant (the v1 sums across all
 *   opponents — single-opponent filtering is a
 *   follow-up lane)
 * - the "where N = cards drawn by opponents since [event]"
 *   timed-arm variant
 */
import { getCardScript } from "../index";
import { resolveScriptedAbility } from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { createCardInstance } from "../../card-instance";
import { recordCardsDrawn, cardsDrawnThisTurn } from "../../keyword-actions/cards-drawn";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string) {
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

function startNPlayerState(names: string[]): GameState {
  const base = createInitialGameState(names, 20, false);
  return startGame(base);
}

function countCardsInZone(
  state: GameState,
  playerId: PlayerId,
  zoneSuffix: "library" | "hand" | "graveyard" | "exile" | "battlefield",
): number {
  const zone = state.zones.get(`${playerId}-${zoneSuffix}`);
  return zone?.cardIds.length ?? 0;
}

describe("Draw X Opponents Drawn This Turn (lane 95): cardsDrawnThisTurnByOpponents X-count", () => {
  it("registry exposes the synthetic source with a Draw.X: 'cardsDrawnThisTurnByOpponents' arm", () => {
    const drawX = getCardScript("Draw X Opponents Drawn This Turn");
    expect(drawX).toBeDefined();
    const trig = drawX!.triggers![0];
    expect(trig.event).toBe("upkeep");
    expect(trig.whose).toBe("you");
    const eff = trig.effects![0];
    expect(eff.op).toBe("Draw");
    if (eff.op !== "Draw") throw new Error("narrow");
    expect(eff.X).toBe("cardsDrawnThisTurnByOpponents");
    expect(eff.who).toBe("you");
  });

  it("Draw.X: 'cardsDrawnThisTurnByOpponents' sums the opponents' counters (2-player)", () => {
    // 2-player game: p1 (controller) and p2 (opponent).
    // Drive p2's counter to 3 via recordCardsDrawn; the
    // controller's counter is irrelevant (the lane 95
    // helper excludes the controller).
    let state = startNPlayerState(["Player1", "Player2"]);
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "drawX", card("Draw X Opponents Drawn This Turn", "Enchantment"));
    // Drive the OPPONENT's counter to 3. startGame draws
    // 7 cards per player; the opponent's counter is
    // already > 0. Record 3 more draws to bump by 3.
    const baseOpponent = cardsDrawnThisTurn(state, p2);
    state = recordCardsDrawn(state, p2, 3);
    expect(cardsDrawnThisTurn(state, p2)).toBe(baseOpponent + 3);

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");
    expect(libraryBefore).toBeGreaterThanOrEqual(baseOpponent + 3);

    const detected = detectTriggeredAbilities(state, "upkeep", {
      upkeepPlayerId: p1,
    });
    const drawXTriggers = detected.filter(
      (t) => t.sourceCardId === id("drawX"),
    );
    expect(drawXTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, drawXTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // The lane 95 helper draws N = opponent's counter
    // (3 from the recordCardsDrawn bump). The library
    // loses N cards; the hand gains N cards.
    const opponentDrawn = baseOpponent + 3;
    expect(countCardsInZone(resolved, p1, "library")).toBe(
      libraryBefore - opponentDrawn,
    );
    expect(countCardsInZone(resolved, p1, "hand")).toBe(
      handBefore + opponentDrawn,
    );
  });

  it("Draw.X: 'cardsDrawnThisTurnByOpponents' excludes the controller's own draws", () => {
    // The lane 95 helper MUST exclude the controller's
    // counter — only opponents count. Drive the
    // controller's counter to a high value and the
    // opponent's to 0; the result should be 0.
    let state = createInitialGameState(["Player1", "Player2"], 20, false);
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "drawX", card("Draw X Opponents Drawn This Turn", "Enchantment"));
    // Controller's counter: a delta of +5. Opponent's
    // counter: unchanged (0 since we skipped startGame's
    // 7-card draw).
    state = recordCardsDrawn(state, p1, 5);
    expect(cardsDrawnThisTurn(state, p1)).toBe(5);

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");

    const detected = detectTriggeredAbilities(state, "upkeep", {
      upkeepPlayerId: p1,
    });
    const drawXTriggers = detected.filter(
      (t) => t.sourceCardId === id("drawX"),
    );
    expect(drawXTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, drawXTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // The controller's 5 draws are excluded; the
    // opponent's 0 draws give 0. Library and hand
    // unchanged.
    expect(countCardsInZone(resolved, p1, "library")).toBe(libraryBefore);
    expect(countCardsInZone(resolved, p1, "hand")).toBe(handBefore);
  });

  it("Draw.X: 'cardsDrawnThisTurnByOpponents' sums across multiple opponents (3-player)", () => {
    // 3-player game: p1 (controller), p2 + p3
    // (opponents). Drive p2 to 2 and p3 to 4 — the
    // lane 95 helper should sum to 6 (excluding the
    // controller's own counter).
    let state = createInitialGameState(
      ["Player1", "Player2", "Player3"],
      20,
      false,
    );
    const [p1, p2, p3] = Array.from(state.players.keys());
    state = put(state, p1, "drawX", card("Draw X Opponents Drawn This Turn", "Enchantment"));
    state = recordCardsDrawn(state, p2, 2);
    state = recordCardsDrawn(state, p3, 4);
    // Drive the controller's counter to 1 too — to
    // confirm it's excluded.
    state = recordCardsDrawn(state, p1, 1);
    expect(cardsDrawnThisTurn(state, p1)).toBe(1);
    expect(cardsDrawnThisTurn(state, p2)).toBe(2);
    expect(cardsDrawnThisTurn(state, p3)).toBe(4);

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");
    expect(libraryBefore).toBeGreaterThanOrEqual(6);

    const detected = detectTriggeredAbilities(state, "upkeep", {
      upkeepPlayerId: p1,
    });
    const drawXTriggers = detected.filter(
      (t) => t.sourceCardId === id("drawX"),
    );
    expect(drawXTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, drawXTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // The lane 95 helper sums to 2 + 4 = 6 (excluding
    // the controller's own 1).
    expect(countCardsInZone(resolved, p1, "library")).toBe(libraryBefore - 6);
    expect(countCardsInZone(resolved, p1, "hand")).toBe(handBefore + 6);
  });

  it("Draw.X: 'cardsDrawnThisTurnByOpponents' returns 0 when no opponent has drawn", () => {
    // Build state via createInitialGameState (skip
    // startGame's 7-card draw). All counters are 0.
    let state = createInitialGameState(["Player1", "Player2"], 20, false);
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "drawX", card("Draw X Opponents Drawn This Turn", "Enchantment"));

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");

    const detected = detectTriggeredAbilities(state, "upkeep", {
      upkeepPlayerId: p1,
    });
    const drawXTriggers = detected.filter(
      (t) => t.sourceCardId === id("drawX"),
    );
    expect(drawXTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, drawXTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // N=0 → library and hand unchanged.
    expect(countCardsInZone(resolved, p1, "library")).toBe(libraryBefore);
    expect(countCardsInZone(resolved, p1, "hand")).toBe(handBefore);
  });

  it("the existing cardsDrawnThisTurn arm still works (regression check)", () => {
    // Lane 94 must not regress; the controller's own
    // counter is read (NOT summed across opponents).
    let state = createInitialGameState(["Player1", "Player2"], 20, false);
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "drawX", card("Draw X Opponents Drawn This Turn", "Enchantment"));
    state = recordCardsDrawn(state, p1, 3);
    state = recordCardsDrawn(state, p2, 5);
    // Lane 94 reads the controller's 3; lane 95 reads
    // the opponent's 5. Different values.
    expect(cardsDrawnThisTurn(state, p1)).toBe(3);
    expect(cardsDrawnThisTurn(state, p2)).toBe(5);
  });
});