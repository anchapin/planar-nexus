/**
 * Warp (CR 702.185, #2614): Nova Hellkite.
 *
 * "You may cast this card from your hand for its warp cost. Exile this
 * creature at the beginning of the next end step, then you may cast it from
 * exile on a later turn."
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { detectBlitzEndStepTriggers } from "../trigger-system/turn-triggers";
import { putTriggersOnStack } from "../trigger-system/stack-ops";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const NOVA_ORACLE =
  "Flying, haste\nWhen this creature enters, it deals 1 damage to target creature an opponent controls.\nWarp {2}{R} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)";

const scry = (
  name: string,
  type_line: string,
  mana_cost: string,
  extra: Partial<ScryfallCard> = {},
): ScryfallCard =>
  ({
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    type_line,
    oracle_text: "",
    mana_cost,
    cmc: 5,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...extra,
  }) as ScryfallCard;

describe("Warp: Nova Hellkite (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let nova: CardInstanceId;

  const place = (s: GameState, inst: CardInstance, zone: string) => {
    const cards = new Map(s.cards);
    cards.set(inst.id, { ...inst, currentZoneKey: zone });
    const zones = new Map(s.zones);
    const z = zones.get(zone)!;
    zones.set(zone, { ...z, cardIds: [...z.cardIds, inst.id] });
    return { ...s, cards, zones };
  };

  const castWarped = (s: GameState): GameState => {
    const withMana = addMana(s, p1, { generic: 2, red: 1 });
    const cast = castSpell(withMana, p1, nova, [], [], 0, false, {
      type: "warp",
    });
    expect(cast.error).toBeUndefined();
    expect(cast.success).toBe(true);
    return drain(cast.state);
  };

  // Resolve the spell and anything it put on the stack (its ETB trigger has
  // no legal target here, so it just leaves).
  const drain = (s: GameState): GameState => {
    let cur = s;
    for (let i = 0; i < 5 && cur.stack.length > 0; i++) {
      cur = resolveTopOfStack(cur);
    }
    expect(cur.stack).toHaveLength(0);
    return cur;
  };

  const runEndStep = (s: GameState): GameState => {
    const triggers = detectBlitzEndStepTriggers(s, p1);
    expect(triggers).toHaveLength(1);
    const stacked = putTriggersOnStack(s, triggers).state;
    return drain(stacked);
  };

  beforeEach(() => {
    registerCardScripts(RAW_CARD_SCRIPTS);
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = p1;
    state.stack = [];
    const inst = createCardInstance(
      scry("Nova Hellkite", "Creature — Dragon", "{3}{R}{R}", {
        oracle_text: NOVA_ORACLE,
        power: "4",
        toughness: "5",
        keywords: ["Flying", "Haste", "Warp"],
      }),
      p1,
      p1,
    );
    nova = inst.id;
    state = place(state, inst, `${p1}-hand`);
  });

  it("casts from hand for {2}{R} and enters marked for warp", () => {
    const after = castWarped(state);
    expect(after.zones.get(`${p1}-battlefield`)!.cardIds).toContain(nova);
    expect(after.cards.get(nova)!.warp).toBe(true);
    expect(after.cards.get(nova)!.currentZoneKey).toBe(`${p1}-battlefield`);
    expect(after.players.get(p1)!.manaPool.generic).toBe(0);
    expect(after.players.get(p1)!.manaPool.red).toBe(0);
  });

  it("is exiled at the beginning of the next end step", () => {
    const resolved = castWarped(state);
    const after = runEndStep(resolved);
    expect(after.zones.get(`${p1}-battlefield`)!.cardIds).not.toContain(nova);
    expect(after.zones.get(`${p1}-exile`)!.cardIds).toContain(nova);
    const card = after.cards.get(nova)!;
    expect(card.warp).toBe(false);
    expect(card.warpExiledTurn).toBe(resolved.turn.turnNumber);
  });

  it("can't be cast from exile the same turn, but can on a later turn", () => {
    const exiled = runEndStep(castWarped(state));
    const sameTurn = castSpell(
      addMana(exiled, p1, { generic: 3, red: 2 }),
      p1,
      nova,
    );
    expect(sameTurn.success).toBe(false);

    const later: GameState = {
      ...exiled,
      turn: { ...exiled.turn, turnNumber: exiled.turn.turnNumber + 2 },
    };
    const cast = castSpell(
      addMana(later, p1, { generic: 3, red: 2 }),
      p1,
      nova,
    );
    expect(cast.error).toBeUndefined();
    expect(cast.success).toBe(true);
    const after = resolveTopOfStack(cast.state);
    expect(after.zones.get(`${p1}-battlefield`)!.cardIds).toContain(nova);
    // Cast normally from exile: no warp marker, so it stays.
    expect(after.cards.get(nova)!.warp).not.toBe(true);
    expect(detectBlitzEndStepTriggers(after, p1)).toHaveLength(0);
  });

  it("cast for its normal cost has no warp end-step trigger", () => {
    const cast = castSpell(
      addMana(state, p1, { generic: 3, red: 2 }),
      p1,
      nova,
    );
    expect(cast.success).toBe(true);
    const after = resolveTopOfStack(cast.state);
    expect(after.cards.get(nova)!.warp).not.toBe(true);
    expect(detectBlitzEndStepTriggers(after, p1)).toHaveLength(0);
  });

  it("warp can't be used from exile", () => {
    const exiled = runEndStep(castWarped(state));
    const later: GameState = {
      ...exiled,
      turn: { ...exiled.turn, turnNumber: exiled.turn.turnNumber + 2 },
    };
    const cast = castSpell(
      addMana(later, p1, { generic: 2, red: 1 }),
      p1,
      nova,
      [],
      [],
      0,
      false,
      { type: "warp" },
    );
    expect(cast.success).toBe(false);
  });
});
