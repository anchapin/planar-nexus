/**
 * Ashroot Animist — literal `{X}`-cost activated ability (lane 2 of #2559).
 *
 * Ashroot Animist reads: "{X}{G}{G}, {T}: Put X +1/+1 counters on target
 * creature you control. Draw X cards. Activate only as a sorcery." It is
 * the canonical case for `amount: "X"` flowing from an *activated* ability
 * cost (`{X}`) into both `PutCounters.amount` and `Draw.amount` (each
 * already `xAmount`-typed in the schema).
 *
 * Engine plumbing for triggered/activated X was shipped in PR #2570
 * (#2559 lane 1). This test pins the end-to-end X-substitution at the
 * effect-resolver boundary so a future schema or interpreter regression
 * that drops the X substitution surfaces here.
 *
 * We call `resolveScriptedEffects` directly (with `stackObject.variableValues
 * .X` set) to test the substitution layer. The full activation flow
 * (mana/tap validation, `card.xValue` propagation) is covered by other
 * tests in `spell-casting/` and `abilities/`. This lane-parity test
 * mirrors `redcap-gutter-dweller-x-count.test.ts` and
 * `avenger-of-zendikar-lands-x-count.test.ts`.
 */
import { getCardScript } from "../index";
import type { CardEffect } from "../schema";
import { resolveScriptedEffects } from "../interpret";
import { createCardInstance } from "../../card-instance";
import { createInitialGameState, startGame } from "../../game-state";
import { ZoneType, getZoneKey } from "../../types/zones";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
} from "../../types";

let P1: PlayerId;
let P2: PlayerId;

function card(name: string, typeLine: string): ScryfallCard {
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
  zone: ZoneType = ZoneType.BATTLEFIELD,
): GameState {
  const zoneKey = getZoneKey(playerId, zone);
  const cards = new Map(state.cards);
  cards.set(
    cardId as CardInstanceId,
    createCardInstance(data, playerId, playerId, {
      id: cardId as CardInstanceId,
      currentZoneKey: zoneKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(zoneKey);
  if (!z) return state;
  zones.set(zoneKey, { ...z, cardIds: [...z.cardIds, cardId as CardInstanceId] });
  return { ...state, cards, zones };
}

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  const started = startGame(base);
  [P1, P2] = Array.from(started.players.keys());
  return started;
}

function countCardsInZone(
  state: GameState,
  playerId: PlayerId,
  zone: ZoneType,
): number {
  const z = state.zones.get(getZoneKey(playerId, zone));
  return z?.cardIds.length ?? 0;
}

function countCounters(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
): number {
  const ci = state.cards.get(cardId);
  if (!ci?.counters) return 0;
  return ci.counters
    .filter((c) => c.type === counterType)
    .reduce((sum, c) => sum + c.count, 0);
}

describe("Ashroot Animist (lane 2, #2559): literal X-cost activated ability", () => {
  it("registry exposes Ashroot Animist with a literal-X-cost activated ability", () => {
    const ash = getCardScript("Ashroot Animist");
    expect(ash).toBeDefined();
    const ab = ash!.activated![0];
    expect(ab.cost.mana).toBe("{X}{G}{G}");
    expect(ab.cost.tap).toBe(true);
    const effects = ab.effects ?? [];
    expect(effects).toHaveLength(2);
    expect(effects[0].op).toBe("PutCounters");
    expect(effects[1].op).toBe("Draw");
    if (effects[0].op !== "PutCounters") throw new Error("narrow");
    if (effects[1].op !== "Draw") throw new Error("narrow");
    expect(effects[0].amount).toBe("X");
    expect(effects[1].amount).toBe("X");
    expect(effects[0].counter).toBe("+1/+1");
    expect(effects[1].who).toBe("you");
  });

  it("substitutes X=3 into both PutCounters.amount and Draw.amount", () => {
    let state = startTwoPlayerState();
    const libraryBefore = countCardsInZone(state, P1, ZoneType.LIBRARY);
    const handBefore = countCardsInZone(state, P1, ZoneType.HAND);

    state = put(state, P1, "ashroot", card("Ashroot Animist", "Creature — Elf Druid"));
    state = put(state, P1, "target", card("Target Creature", "Creature"));

    const ash = getCardScript("Ashroot Animist")!;
    const effects = ash.activated![0].effects as readonly CardEffect[];

    const target: Target = {
      type: "card",
      targetId: "target",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ashroot" as CardInstanceId,
      targets: [target],
      variableValues: new Map([["X", 3]]),
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    // PutCounters.amount "X" → 3 +1/+1 counters on the target creature.
    expect(countCounters(resolved, "target" as CardInstanceId, "+1/+1")).toBe(3);
    // Draw.amount "X" → 3 cards moved from library to hand.
    expect(countCardsInZone(resolved, P1, ZoneType.LIBRARY)).toBe(libraryBefore - 3);
    expect(countCardsInZone(resolved, P1, ZoneType.HAND)).toBe(handBefore + 3);
  });

  it("X=0 (no X paid) substitutes 0 (CR 107.3 default)", () => {
    let state = startTwoPlayerState();
    const libraryBefore = countCardsInZone(state, P1, ZoneType.LIBRARY);
    const handBefore = countCardsInZone(state, P1, ZoneType.HAND);

    state = put(state, P1, "ashroot", card("Ashroot Animist", "Creature — Elf Druid"));
    state = put(state, P1, "target", card("Target Creature", "Creature"));

    const ash = getCardScript("Ashroot Animist")!;
    const effects = ash.activated![0].effects as readonly CardEffect[];

    const target: Target = {
      type: "card",
      targetId: "target",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ashroot" as CardInstanceId,
      targets: [target],
      variableValues: new Map(), // empty → CR 107.3 default of 0
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    expect(countCounters(resolved, "target" as CardInstanceId, "+1/+1")).toBe(0);
    expect(countCardsInZone(resolved, P1, ZoneType.LIBRARY)).toBe(libraryBefore);
    expect(countCardsInZone(resolved, P1, ZoneType.HAND)).toBe(handBefore);
  });

  it("X=5 substitutes 5 into both effects (canonical X-cost scaling)", () => {
    let state = startTwoPlayerState();
    const libraryBefore = countCardsInZone(state, P1, ZoneType.LIBRARY);

    state = put(state, P1, "ashroot", card("Ashroot Animist", "Creature — Elf Druid"));
    state = put(state, P1, "target", card("Target Creature", "Creature"));

    const ash = getCardScript("Ashroot Animist")!;
    const effects = ash.activated![0].effects as readonly CardEffect[];

    const target: Target = {
      type: "card",
      targetId: "target",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ashroot" as CardInstanceId,
      targets: [target],
      variableValues: new Map([["X", 5]]),
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    expect(countCounters(resolved, "target" as CardInstanceId, "+1/+1")).toBe(5);
    expect(countCardsInZone(resolved, P1, ZoneType.LIBRARY)).toBe(libraryBefore - 5);
  });
});