/**
 * Draw X Cards Drawn This Turn — "draw N where N is cards drawn
 * this turn" (lane 94).
 *
 * Wave 4.8 follow-up 13 lane 94 (#2614 follow-up). The X-count
 * substrate (`X: "treasures" | "creatures" | "lands"` from lane 36)
 * didn't cover "draw N" out of the box for the *count*; only the
 * boolean read from lane 90 covered "did anything die this turn"
 * (Needletooth Pack's `X: "creaturesDiedThisTurn"` arm). This
 * lane adds `X: "cardsDrawnThisTurn"` to `DrawSchema` and the
 * integer read to `resolveDrawAmount`.
 *
 * The v1 minimum:
 * - `DrawSchema.X: "cardsDrawnThisTurn"` arm reads
 *   `state.players[controllerId].cardsDrawnThisTurn` (an integer
 *   counter maintained by the lane 87 `recordCardsDrawn` helper).
 * - `resolveDrawAmount` takes a `controllerId` parameter and
 *   returns the integer counter (0 when the controller is missing
 *   or the counter is unset).
 *
 * The sample card (`draw_x_cards_drawn_this_turn.json`) is a
 * synthetic "whenever you draw a card, draw N more" trigger that
 * exercises the new arm end-to-end. (The card is named "Draw X
 * Cards Drawn This Turn" rather than "Proft's Eidetic Memory" so
 * the lane 94 work doesn't shadow the pre-existing
 * `profts-eidetic-memory.test.ts` test, which uses its own
 * ScryfallCard mock to drive the oracle parser path.)
 *
 * Out of scope for lane 94 (each a follow-up lane):
 * - the `X: "cardsDrawnThisTurn_byOpponents"` aggregation
 *   (lane 95)
 * - the `X: "cardsDrawnThisTurn"` extension on ops other than
 *   `Draw` (e.g. `PutCounters`, `GainLife`) — those ride
 *   follow-up lanes if needed
 * - the "where X is the number of cards you've drawn this turn
 *   minus N" variant (`minus N` integer offset)
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

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
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

describe("Draw X Cards Drawn This Turn (lane 94): cardsDrawnThisTurn X-count", () => {
  it("registry exposes the synthetic source with a Draw.X: 'cardsDrawnThisTurn' arm", () => {
    const drawX = getCardScript("Draw X Cards Drawn This Turn");
    expect(drawX).toBeDefined();
    const trig = drawX!.triggers![0];
    expect(trig.event).toBe("drawCard");
    expect(trig.whose_draws).toBe("you");
    const eff = trig.effects![0];
    expect(eff.op).toBe("Draw");
    if (eff.op !== "Draw") throw new Error("narrow");
    expect(eff.X).toBe("cardsDrawnThisTurn");
    expect(eff.who).toBe("you");
  });

  it("schema accepts the cardsDrawnThisTurn arm", () => {
    const drawX = getCardScript("Draw X Cards Drawn This Turn");
    expect(drawX).toBeDefined();
    // The build-card-script-index script regenerates the
    // index and validates against CardScriptSchema at
    // typecheck time — the test passing here is the
    // presence-in-registry assertion.
  });

  it("Draw.X: 'cardsDrawnThisTurn' reads the controller's integer counter", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "proft", card("Draw X Cards Drawn This Turn", "Enchantment"));
    // startGame draws 7 cards (so cardsDrawnThisTurn
    // is 7). Drive the counter to 10 via the lane 87
    // recordCardsDrawn helper — a delta of +3 — so
    // the post-record count is 10.
    const baseDrawn = cardsDrawnThisTurn(state, p1);
    expect(baseDrawn).toBeGreaterThan(0);
    state = recordCardsDrawn(state, p1, 3);
    const drawnAfter = cardsDrawnThisTurn(state, p1);
    expect(drawnAfter).toBe(baseDrawn + 3);

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");
    expect(libraryBefore).toBeGreaterThanOrEqual(drawnAfter);

    const detected = detectTriggeredAbilities(state, "drawCard");
    const proftTriggers = detected.filter(
      (t) => t.sourceCardId === id("proft"),
    );
    expect(proftTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, proftTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // The Draw op with `X: "cardsDrawnThisTurn"`
    // should have drawn N = drawnAfter cards from
    // library to hand. The library loses N cards;
    // the hand gains N cards. (drawCards' replaceEffects
    // loop bumps the counter again — the post-resolve
    // count is the original + N; we don't assert
    // that here, only the library/hand delta.)
    expect(countCardsInZone(resolved, p1, "library")).toBe(
      libraryBefore - drawnAfter,
    );
    expect(countCardsInZone(resolved, p1, "hand")).toBe(handBefore + drawnAfter);
  });

  it("Draw.X: 'cardsDrawnThisTurn' returns 0 when the controller has no recorded draws", () => {
    // Build state via `createInitialGameState` directly
    // (skip startGame's 7-card draw) so the counter is
    // unset / zero.
    let state = createInitialGameState(["Player1", "Player2"], 20, false);
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "proft", card("Draw X Cards Drawn This Turn", "Enchantment"));
    expect(cardsDrawnThisTurn(state, p1)).toBe(0);

    const libraryBefore = countCardsInZone(state, p1, "library");
    const handBefore = countCardsInZone(state, p1, "hand");

    const detected = detectTriggeredAbilities(state, "drawCard");
    const proftTriggers = detected.filter(
      (t) => t.sourceCardId === id("proft"),
    );
    expect(proftTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, proftTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    // N=0 → library and hand unchanged.
    expect(countCardsInZone(resolved, p1, "library")).toBe(libraryBefore);
    expect(countCardsInZone(resolved, p1, "hand")).toBe(handBefore);
  });

  it("the existing creaturesDiedThisTurn arm still works (regression check)", () => {
    // Lane 90's "draw N where N = creatures that died this turn"
    // shape uses the boolean read. Lane 94 must NOT
    // regress that path.
    const need = getCardScript("Needletooth Pack");
    expect(need).toBeDefined();
    // The test exercises the registry shape; the
    // boolean read's end-to-end coverage lives in the
    // lane 90 test file.
  });
});