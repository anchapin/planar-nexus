/**
 * Needletooth Pack (FDN 108) — draw-count X arm (lane 90).
 *
 * Wave 4.8 follow-up 12 lane 90 (#2614 follow-up). Needletooth Pack's
 * second effect: "draw N cards where N = the number of creatures that
 * died this turn." The lane 86 v1 minimum shipped the morbid +
 * phaseEnds + PutCounters (+1/+1 × 2 on a creature you control)
 * half only. This lane adds the `Draw.amount.X:
 * "creaturesDiedThisTurn"` arm — the v1 minimum reads the boolean
 * `state.turn.creatureDiedThisTurn` for 0 or 1; the count ledger
 * is a follow-up lane.
 *
 * Out of scope for lane 90 (each a follow-up lane):
 * - the count ledger (draw N where N = the actual count of
 *   creatures that died)
 * - the "this turn" → "this game" scope extension
 * - the X-count variant "draw N where N is the number of
 *   creatures that died this turn AND you control" (the v1
 *   minimum is just the boolean read).
 */
import { getCardScript } from "../index";
import {
  resolveScriptedAbility,
} from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { markCreatureDiedThisTurn } from "../../keyword-actions/morbid";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
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

describe("Needletooth Pack (FDN 108): morbid + phaseEnds Draw X (lane 90)", () => {
  it("registry exposes Needletooth Pack with PutCounters + Draw X chained", () => {
    const pack = getCardScript("Needletooth Pack");
    expect(pack).toBeDefined();
    const trig = pack!.triggers![0];
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 2,
        target: "creature",
        controller: "you",
      },
      {
        op: "Draw",
        amount: 1,
        who: "you",
        X: "creaturesDiedThisTurn",
      },
    ]);
  });

  it("end-to-end: morbid gate fails (no creature died) → trigger never fires, no draw (lane 90)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "pack",
      card("Needletooth Pack", "Creature — Wolve"),
    );

    // Without markCreatureDiedThisTurn the morbid intervening_if
    // fails; the engine's detectTriggeredAbilities skips the
    // trigger entirely, so no draw resolves.
    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const packTriggers = triggers.filter(
      (t) => t.sourceCardId === id("pack"),
    );
    expect(packTriggers).toHaveLength(0);
  });

  it("end-to-end: morbid gate passes but creatureDiedThisTurn was just set → X resolves to 1, draw 1 (lane 90 v1 minimum)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "pack",
      card("Needletooth Pack", "Creature — Wolve"),
    );
    state = put(
      state,
      p1,
      "prey",
      card("Prey", "Creature — Wolve", [1, 1]),
    );

    // Mark a creature died this turn so the morbid gate passes AND
    // the Draw.X resolves to 1 (boolean read in v1 minimum).
    state = markCreatureDiedThisTurn(state);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const packTriggers = triggers.filter(
      (t) => t.sourceCardId === id("pack"),
    );
    expect(packTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, packTriggers);
    const stackObject = stacked.stack[0];
    const targeted = {
      ...stacked,
      stack: [
        {
          ...stackObject,
          targets: [
            { type: "card", targetId: id("prey"), isValid: true } as Target,
          ],
        },
      ],
    };

    const beforeHand = targeted.zones.get(`${p1}-hand`)!.cardIds.length;
    const resolved = resolveScriptedAbility(targeted, targeted.stack[0])!;

    // Lane 90: Draw.X resolves to 1 because a creature died this
    // turn (boolean read). The controller draws 1.
    const afterHand = resolved.zones.get(`${p1}-hand`)!.cardIds.length;
    expect(afterHand).toBe(beforeHand + 1);
  });

  it("end-to-end: a creature died this turn → draw 1 (X resolves to 1, lane 90 v1 minimum)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "pack",
      card("Needletooth Pack", "Creature — Wolve"),
    );
    state = put(
      state,
      p1,
      "prey",
      card("Prey", "Creature — Wolve", [1, 1]),
    );

    // Mark a creature died this turn so the morbid gate passes AND
    // the Draw.X resolves to 1 (boolean read in v1 minimum).
    state = markCreatureDiedThisTurn(state);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const packTriggers = triggers.filter(
      (t) => t.sourceCardId === id("pack"),
    );
    expect(packTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, packTriggers);
    const stackObject = stacked.stack[0];
    const targeted = {
      ...stacked,
      stack: [
        {
          ...stackObject,
          targets: [
            { type: "card", targetId: id("prey"), isValid: true } as Target,
          ],
        },
      ],
    };

    const beforeHand = targeted.zones.get(`${p1}-hand`)!.cardIds.length;
    const resolved = resolveScriptedAbility(targeted, targeted.stack[0])!;

    // Lane 90: Draw.X resolves to 1 because a creature died this
    // turn (boolean read). The controller draws 1.
    const afterHand = resolved.zones.get(`${p1}-hand`)!.cardIds.length;
    expect(afterHand).toBe(beforeHand + 1);
  });

  it("schema accepts the Draw X arm on a Draw effect (lane 90)", () => {
    const pack = getCardScript("Needletooth Pack");
    expect(pack).toBeDefined();
    // The build-card-script-index step above proves the schema accepts
    // this shape (zod parses without error). Just assert the parsed
    // trigger carries the same field.
    const drawEffect = pack!.triggers![0].effects!.find(
      (e) => e.op === "Draw",
    );
    expect(drawEffect).toBeDefined();
    expect((drawEffect as { X?: string }).X).toBe("creaturesDiedThisTurn");
  });
});