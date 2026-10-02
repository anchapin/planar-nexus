/**
 * Crew keyword ability (issue #2300, Standard remainder slice).
 */
import {
  activateCrew,
  canCrew,
  clearCrewedVehicles,
  getCrewPower,
  resolveCrew,
} from "../keyword-actions";
import { resolveEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance, isCreature } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function card(name: string, typeLine: string, oracle: string, power?: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "{2}",
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power,
    toughness: power,
  } as unknown as ScryfallCard;
}

const VEHICLE = card(
  "Test Vehicle",
  "Artifact — Vehicle",
  "Trample\nCrew 3",
  "5",
);
const BEAR = card("Bear", "Creature — Bear", "", "2");
const ELF = card("Elf", "Creature — Elf", "", "1");
const ROCK = card("Rock", "Artifact", "", undefined);

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  extra: Record<string, unknown> = {},
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), {
    ...createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
    ...extra,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("crew", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p1, "vehicle", VEHICLE);
    state = put(state, p1, "bear", BEAR);
    state = put(state, p1, "elf", ELF, { hasSummoningSickness: true });
    state = put(state, p1, "rock", ROCK);
    state = { ...state, priorityPlayerId: p1 };
  });

  it("reads the crew number from oracle text", () => {
    expect(getCrewPower(state.cards.get(id("vehicle"))!)).toBe(3);
    expect(getCrewPower(state.cards.get(id("bear"))!)).toBeNull();
  });

  it("a Vehicle is not a creature until it is crewed", () => {
    expect(isCreature(state.cards.get(id("vehicle"))!)).toBe(false);
  });

  it("taps the crew and puts the crew ability on the stack", () => {
    const result = activateCrew(state, p1, id("vehicle"), [
      id("bear"),
      id("elf"),
    ]);
    expect(result.success).toBe(true);
    expect(result.state.cards.get(id("bear"))!.isTapped).toBe(true);
    expect(result.state.cards.get(id("elf"))!.isTapped).toBe(true);
    expect(result.state.stack).toHaveLength(1);
    expect(result.state.stack[0].effects).toEqual([
      { effectType: "crew", vehicleId: id("vehicle") },
    ]);
    // Still not a creature until the ability resolves.
    expect(isCreature(result.state.cards.get(id("vehicle"))!)).toBe(false);
  });

  it("lets a summoning-sick creature crew", () => {
    const st = put(state, p1, "bigSick", BEAR, { hasSummoningSickness: true });
    const st2 = put(st, p1, "elf2", ELF, { hasSummoningSickness: true });
    expect(
      canCrew(st2, p1, id("vehicle"), [id("bigSick"), id("elf2")]).canCrew,
    ).toBe(true);
  });

  it("rejects crew with too little total power", () => {
    const check = canCrew(state, p1, id("vehicle"), [id("bear")]);
    expect(check.canCrew).toBe(false);
    expect(check.reason).toMatch(/total power 3/);
  });

  it("rejects tapped, non-creature, duplicate, self and opposing crew", () => {
    const tapped = put(state, p1, "tappedBear", BEAR, { isTapped: true });
    expect(
      canCrew(tapped, p1, id("vehicle"), [id("tappedBear"), id("elf")]).canCrew,
    ).toBe(false);
    expect(
      canCrew(state, p1, id("vehicle"), [id("bear"), id("rock")]).canCrew,
    ).toBe(false);
    expect(
      canCrew(state, p1, id("vehicle"), [id("bear"), id("bear")]).canCrew,
    ).toBe(false);
    expect(
      canCrew(state, p1, id("vehicle"), [id("vehicle"), id("bear")]).canCrew,
    ).toBe(false);
    const theirs = put(state, p2, "theirBear", BEAR);
    expect(
      canCrew(theirs, p1, id("vehicle"), [id("bear"), id("theirBear")]).canCrew,
    ).toBe(false);
  });

  it("requires priority", () => {
    const st = { ...state, priorityPlayerId: p2 };
    expect(
      canCrew(st, p1, id("vehicle"), [id("bear"), id("elf")]).canCrew,
    ).toBe(false);
  });

  it("makes the Vehicle a creature on resolution, with its own power", () => {
    const activated = activateCrew(state, p1, id("vehicle"), [
      id("bear"),
      id("elf"),
    ]).state;
    const resolved = resolveEffect(
      activated,
      { effectType: "crew", vehicleId: id("vehicle") },
      id("vehicle"),
    );
    expect(resolved.success).toBe(true);
    const vehicle = resolved.state.cards.get(id("vehicle"))!;
    expect(vehicle.crewedUntilEndOfTurn).toBe(true);
    expect(isCreature(vehicle)).toBe(true);
  });

  it("does nothing if the Vehicle left the battlefield", () => {
    const zones = new Map(state.zones);
    const key = `${p1}-battlefield`;
    const z = zones.get(key)!;
    zones.set(key, {
      ...z,
      cardIds: z.cardIds.filter((c) => c !== id("vehicle")),
    });
    expect(resolveCrew({ ...state, zones }, id("vehicle")).success).toBe(false);
  });

  it("ends the creature effect at end of turn", () => {
    const crewed = resolveCrew(state, id("vehicle")).state;
    const cleared = clearCrewedVehicles(crewed);
    expect(isCreature(cleared.cards.get(id("vehicle"))!)).toBe(false);
  });
});
