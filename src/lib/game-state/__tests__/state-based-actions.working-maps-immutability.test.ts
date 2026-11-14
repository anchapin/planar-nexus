/**
 * checkStateBasedActions — working-map identity / input-immutability proof
 * for the CR 704.5d token-cease block (issue #2936).
 *
 * The SBA pass owns ONE working copy of the card map (#2419 / #2884 — see
 * `sba-pass-cards.ts`): the helpers mutate it in place through
 * `acquireCardMap` and the pass publishes that one map at the end.
 *
 * The 704.5d token-cease block used to break that contract. As soon as ANY
 * token existed it copied the whole card map AND the whole zones map and
 * published those copies. The published copy was not pass-owned, so every
 * later `acquireCardMap` call in the same pass copied the map AGAIN, and
 * the `finally` at the end of the pass released a map that was no longer
 * the published one.
 *
 * The contract this file pins (mirroring
 * `activated.working-maps-immutability.test.ts` from #2927 and
 * `combat.players-immutability.test.ts` from #2923):
 *
 *  - the caller's input cards / zones maps are NEVER mutated (same size,
 *    same entry objects, the token still in its zone in the input);
 *  - a pass whose only tokens are on the battlefield publishes exactly ONE
 *    new card-map identity — the pass's own working map — and no zones
 *    copy at all;
 *  - a token that really ceases is deleted from the PASS-OWNED map, so a
 *    later same-pass `acquireCardMap` effect (CR 704.5q counter
 *    annihilation) observes the ceased state and does not copy the map
 *    again.
 */

import { checkStateBasedActions } from "../state-based-actions";
import * as sbaPassCards from "../sba-pass-cards";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance, createToken } from "../card-instance";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const TOKEN_CARD: ScryfallCard = {
  id: "token-soldier-2936",
  name: "Soldier",
  type_line: "Token Creature — Soldier",
  mana_cost: "",
  cmc: 0,
  colors: ["W"],
  color_identity: ["W"],
  oracle_text: "",
  power: "1",
  toughness: "1",
  keywords: [],
  legalities: { standard: "legal", commander: "legal" },
  layout: "token",
  card_faces: undefined,
} as ScryfallCard;

const CREATURE_CARD: ScryfallCard = {
  id: "mock-counter-creature-2936",
  name: "Counter Bearer",
  type_line: "Creature — Test",
  mana_cost: "{1}",
  cmc: 2,
  colors: ["R"],
  color_identity: ["R"],
  oracle_text: "",
  power: "2",
  toughness: "2",
  keywords: [],
  legalities: { standard: "legal", commander: "legal" },
  layout: "normal",
  card_faces: undefined,
} as ScryfallCard;

type ZoneName = "battlefield" | "graveyard" | "exile" | "hand";

/**
 * Run one SBA pass with the pass-owned map machinery observed.
 *
 * `createPassCardMap` is the single entry point of the pass (#2419), so the
 * map it returns IS the pass's one working map — spying on it is how the
 * test observes the map identity the pass publishes.
 */
function observePass(state: GameState, tokenId?: CardInstanceId) {
  const createSpy = jest.spyOn(sbaPassCards, "createPassCardMap");
  const originalAcquire = sbaPassCards.acquireCardMap;
  const acquired: Array<{
    map: Map<CardInstanceId, CardInstance>;
    hasToken: boolean;
  }> = [];
  jest
    .spyOn(sbaPassCards, "acquireCardMap")
    .mockImplementation((s: GameState) => {
      const map = originalAcquire(s);
      acquired.push({
        map,
        hasToken: tokenId ? map.has(tokenId) : false,
      });
      return map;
    });

  const result = checkStateBasedActions(state);
  const workingMap = createSpy.mock.results[0]?.value as
    | Map<CardInstanceId, CardInstance>
    | undefined;

  return { result, workingMap, acquired };
}

describe("checkStateBasedActions working maps (#2936)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Two players, so no win condition fires and the pass stays quiet. */
  function setup() {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    return { state, p1, p2 };
  }

  /** Put a token directly into one of the player's zones. */
  function putToken(state: GameState, playerId: PlayerId, zone: ZoneName) {
    const token = createToken(TOKEN_CARD, playerId, playerId);
    const zoneKey = `${playerId}-${zone}`;
    const zoneState = state.zones.get(zoneKey)!;
    state.cards.set(token.id, token);
    state.zones.set(zoneKey, {
      ...zoneState,
      cardIds: [...zoneState.cardIds, token.id],
    });
    return token;
  }

  /** Put a creature with +1/+1 and -1/-1 counters on the battlefield. */
  function putCounterCreature(state: GameState, playerId: PlayerId) {
    const zoneKey = `${playerId}-battlefield`;
    const instance = createCardInstance(CREATURE_CARD, playerId, playerId, {
      currentZoneKey: zoneKey,
    });
    // `createCardInstance` always starts a card with no counters, so the
    // +1/+1 / -1/-1 pair is set explicitly here.
    const withCounters: CardInstance = {
      ...instance,
      counters: [
        { type: "+1/+1", count: 1 },
        { type: "-1/-1", count: 1 },
      ],
    };
    state.cards.set(withCounters.id, withCounters);
    const zoneState = state.zones.get(zoneKey)!;
    state.zones.set(zoneKey, {
      ...zoneState,
      cardIds: [...zoneState.cardIds, withCounters.id],
    });
    return withCounters;
  }

  it("publishes only the one working card map when no token ceases", () => {
    const { state, p1 } = setup();
    const token = putToken(state, p1, "battlefield");

    const inputCards = state.cards;
    const inputZones = state.zones;
    const inputToken = inputCards.get(token.id)!;
    const inputBattlefield = inputZones.get(`${p1}-battlefield`)!;

    const { result, workingMap } = observePass(state, token.id);

    // Input maps: never mutated.
    expect(inputCards.size).toBe(state.cards.size);
    expect(inputCards.get(token.id)).toBe(inputToken);
    expect(inputZones.get(`${p1}-battlefield`)).toBe(inputBattlefield);
    expect(inputBattlefield.cardIds).toContain(token.id);

    // Exactly one new card-map identity is published: the pass's own
    // working map. No extra copy is published for the token block.
    expect(workingMap).toBeDefined();
    expect(result.state.cards).toBe(workingMap);
    expect(result.state.cards).not.toBe(inputCards);

    // No zone changed, so the zones map is published untouched.
    expect(result.state.zones).toBe(inputZones);

    // The token on the battlefield still exists (CR 704.5d does not apply).
    expect(result.state.cards.has(token.id)).toBe(true);
    expect(result.state.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      token.id,
    );
    expect(result.descriptions.join(" ")).not.toContain("ceases to exist");
    expect(result.actionsPerformed).toBe(false);
  });

  it("deletes a ceased token from the pass-owned map so a later same-pass effect observes it", () => {
    const { state, p1 } = setup();
    const token = putToken(state, p1, "graveyard");
    const creature = putCounterCreature(state, p1);

    const inputCards = state.cards;
    const inputZones = state.zones;
    const inputGraveyard = inputZones.get(`${p1}-graveyard`)!;

    const { result, workingMap, acquired } = observePass(state, token.id);

    // The token still ceases to exist exactly as before (CR 704.5d).
    expect(result.actionsPerformed).toBe(true);
    expect(result.descriptions.join(" ")).toContain(
      "ceases to exist (token, CR 704.5d)",
    );
    expect(result.state.zones.get(`${p1}-graveyard`)!.cardIds).not.toContain(
      token.id,
    );
    expect(result.state.cards.has(token.id)).toBe(false);

    // The deletion went into the PASS-OWNED map, and that map is the one
    // the pass publishes — no extra copy is published for the token block.
    expect(workingMap).toBeDefined();
    expect(result.state.cards).toBe(workingMap);
    expect(result.state.cards).not.toBe(inputCards);
    expect(workingMap!.has(token.id)).toBe(false);

    // The later same-pass effect (CR 704.5q counter annihilation) ran
    // against the map that already lost the token: it observed the ceased
    // state and it did not copy the map again.
    expect(acquired.length).toBeGreaterThan(0);
    expect(acquired.every((entry) => entry.map === workingMap)).toBe(true);
    expect(acquired.some((entry) => entry.hasToken === false)).toBe(true);

    // ... and the annihilation itself happened on the published map.
    const publishedCreature = result.state.cards.get(creature.id)!;
    expect(publishedCreature.counters).toEqual([]);
    expect(result.descriptions.join(" ")).toContain(
      "Removed 1 +1/+1 and 1 -1/-1 counters",
    );

    // Input maps: never mutated.
    expect(inputCards.has(token.id)).toBe(true);
    expect(inputCards.get(creature.id)!.counters).toHaveLength(2);
    expect(inputZones.get(`${p1}-graveyard`)).toBe(inputGraveyard);
    expect(inputGraveyard.cardIds).toContain(token.id);
  });
});
