/**
 * Avenger of Zendikar — `CreateToken.X: "landsYouControl"`
 * (lane 114 piece 2/2, #2614 follow-up).
 *
 * Avenger of Zendikar (DSC 186, Zendikar Rising): "When
 * Avenger of Zendikar enters the battlefield, create
 * X 0/1 green Plant creature tokens, where X is the
 * number of lands you control."
 *
 * The smallest pick-up-able piece ships the
 * `CreateToken.X: "landsYouControl"` arm — parallel
 * to the lane 97 `yourCreatures` arm. The v1
 * minimum is a synthetic test card that exercises
 * the new arm end-to-end; the real Avenger of
 * Zendikar JSON (with the "landfall" half) ships
 * in a follow-up sub-piece.
 *
 * The engine consumer lives in
 * `resolveCreateTokenAmount` (the lane 97 helper,
 * extended with a fourth `landsYouControl` arm).
 * The new arm counts the controller's lands on
 * the battlefield; it mirrors the static-anthem
 * `computeX(..., "lands")` path in
 * `keyword-actions/scripted-statics.ts`.
 *
 * Out of scope for lane 114 piece 2/2 (each a
 * follow-up lane):
 *   - the real Avenger of Zendikar JSON (with
 *     the "Landfall — you may put a +1/+1 counter
 *     on each Plant you control" half — needs a
 *     `target: "each_creature"` mode on
 *     `PutCounters` with a `subtype` filter).
 *   - the existing-cards `lands` and `yourCreatures`
 *     combined X-count variants.
 */
import { getCardScript } from "../index";
import { resolveScriptedAbility } from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
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

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  return startGame(base);
}

function countTokenCards(
  state: GameState,
  playerId: PlayerId,
): number {
  // Count card instances that are 0/1 green Plant
  // creatures (the synthetic token). Reuses the
  // `currentZoneKey` membership on the controller's
  // battlefield.
  const bf = state.zones.get(`${playerId}-battlefield`);
  if (!bf) return 0;
  let n = 0;
  for (const cid of bf.cardIds) {
    const ci = state.cards.get(cid);
    if (!ci) continue;
    const tl = (ci.cardData.type_line ?? "").toLowerCase();
    if (!tl.includes("creature")) continue;
    if (!tl.includes("plant")) continue;
    n += 1;
  }
  return n;
}

describe("Create X Your Lands Plants (lane 114 piece 2/2): CreateToken.X = landsYouControl", () => {
  it("registry exposes the synthetic source with a CreateToken.X: 'landsYouControl' arm", () => {
    const drawX = getCardScript("Create X Your Lands Plants");
    expect(drawX).toBeDefined();
    const trig = drawX!.triggers![0];
    expect(trig.event).toBe("etb");
    const eff = trig.effects![0];
    expect(eff.op).toBe("CreateToken");
    if (eff.op !== "CreateToken") throw new Error("narrow");
    expect(eff.X).toBe("landsYouControl");
    expect(eff.count).toBe(1);
    expect(eff.power).toBe(0);
    expect(eff.toughness).toBe(1);
    expect(eff.color).toBe("green");
    expect(eff.subtypes).toEqual(["Plant"]);
  });

  it("CreateToken.X: 'landsYouControl' counts the controller's lands (4 lands → 4 tokens)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    // Put the synthetic source + 4 lands on p1's
    // battlefield (so p1 controls 4 lands total).
    // The trigger card itself is NOT a land
    // (it's an Enchantment in the synthetic card).
    state = put(state, p1, "source", card("Create X Your Lands Plants", "Enchantment"));
    state = put(state, p1, "forest1", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "forest2", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mountain1", card("Mountain", "Basic Land — Mountain"));
    state = put(state, p1, "plains1", card("Plains", "Basic Land — Plains"));
    // p2 has 0 lands.
    const detected = detectTriggeredAbilities(state, "entersBattlefield");
    const sourceTriggers = detected.filter(
      (t) => t.sourceCardId === id("source"),
    );
    expect(sourceTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, sourceTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // The X-arm resolved to 4 (p1's 4 lands).
    // 4 new Plant tokens land on p1's battlefield.
    expect(countTokenCards(resolved, p1)).toBe(4);
  });

  it("CreateToken.X: 'landsYouControl' returns 0 when the controller has no lands", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    // Only the source card (an Enchantment — not a
    // land) is on the battlefield. The controller
    // has 0 lands → X resolves to 0 → no tokens.
    state = put(state, p1, "source", card("Create X Your Lands Plants", "Enchantment"));

    const detected = detectTriggeredAbilities(state, "entersBattlefield");
    const sourceTriggers = detected.filter(
      (t) => t.sourceCardId === id("source"),
    );
    expect(sourceTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, sourceTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    expect(countTokenCards(resolved, p1)).toBe(0);
  });

  it("CreateToken.X: 'landsYouControl' excludes the opponent's lands", () => {
    // 2-player game: p1 has 2 lands, p2 has 5 lands.
    // The source is p1's. X resolves to 2 (p1's
    // count, NOT p1+p2=7).
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "source", card("Create X Your Lands Plants", "Enchantment"));
    state = put(state, p1, "forest1", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mountain1", card("Mountain", "Basic Land — Mountain"));
    state = put(state, p2, "land1", card("Plains", "Basic Land — Plains"));
    state = put(state, p2, "land2", card("Plains", "Basic Land — Plains"));
    state = put(state, p2, "land3", card("Plains", "Basic Land — Plains"));
    state = put(state, p2, "land4", card("Plains", "Basic Land — Plains"));
    state = put(state, p2, "land5", card("Plains", "Basic Land — Plains"));

    const detected = detectTriggeredAbilities(state, "entersBattlefield");
    const sourceTriggers = detected.filter(
      (t) => t.sourceCardId === id("source"),
    );
    const { state: stacked } = putTriggersOnStack(state, sourceTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // Only p1's 2 lands count → 2 tokens.
    expect(countTokenCards(resolved, p1)).toBe(2);
  });

  it("CreateToken.X: 'landsYouControl' excludes lands in non-battlefield zones", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "source", card("Create X Your Lands Plants", "Enchantment"));
    // 1 land on the battlefield, 1 land in the
    // hand, 1 land in the graveyard. Only the
    // battlefield one counts.
    state = put(state, p1, "forest1", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "forest2", card("Forest", "Basic Land — Forest"), "hand");
    state = put(state, p1, "forest3", card("Forest", "Basic Land — Forest"), "graveyard");

    const detected = detectTriggeredAbilities(state, "entersBattlefield");
    const sourceTriggers = detected.filter(
      (t) => t.sourceCardId === id("source"),
    );
    const { state: stacked } = putTriggersOnStack(state, sourceTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    expect(countTokenCards(resolved, p1)).toBe(1);
  });
});
