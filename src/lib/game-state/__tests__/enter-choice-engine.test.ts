/**
 * `enter_choice` engine arm — predicate + ETB-pipeline checks
 * (Wave 4.7 follow-up lane 47, #2707, #2594 follow-up).
 *
 * After Wave 4.7 follow-up lanes 43–46, the engine's
 * `enter_choice` arm is exercised by real cards (Heraldic
 * Banner, Diamond Mare, Adaptive Automaton), the `kind:
 * "creature_type"` dispatch by the lane 44 dedicated test,
 * and the data-driven `drafted-scripts.test.ts` smoke test
 * picks every scripted card up automatically. The historic
 * Test Goggles synthetic card added no unique coverage once
 * the real cards existed, so it was removed in this lane.
 *
 * This file ports the engine-arm-specific assertions that
 * the deleted `enter-choice.test.ts` was the only place to
 * find:
 *
 * 1. `hasEnterChoice` predicate truthy/falsy for a real card
 *    (Heraldic Banner) and a vanilla card with no script.
 * 2. `fireEntersTriggers` surfaces an `enter_choice`
 *    `waitingChoice` for a Banner entering via the ETB
 *    pipeline (the land-play / token / moveCardToZone path).
 * 3. `fireEntersTriggers` does NOT surface a choice for a
 *    card without `enter_choice`.
 *
 * End-to-end cast-and-resolve coverage lives in
 * `heraldic-banner-anthem.test.ts` ("casting the Banner
 * surfaces the enter choice; resolving applies the
 * anthem") and the creature-type path in
 * `enter-choice-creature-type.test.ts` ("resolveEnterChoice
 * stamps chosenCreatureType for a curated creature type").
 * Resolving through `resolveWaitingChoice` is a thin wrapper
 * tested in `resolveWaitingChoice`'s own test file; it isn't
 * ported here to avoid duplicating coverage.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import {
  ENTER_CHOICE_TYPE,
  hasEnterChoice,
} from "../keyword-actions/enter-choice";
import { fireEntersTriggers } from "../keyword-actions/enters";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Artifact",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zone}`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("enter_choice engine arm — predicate + ETB pipeline (Wave 4.7 follow-up lane 47)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 4 });
  });

  it("hasEnterChoice is true for a real card with enter_choice (Heraldic Banner)", () => {
    const bannerId = put(
      state,
      alice,
      "battlefield",
      card({ name: "Heraldic Banner" }),
    );
    expect(hasEnterChoice(state.cards.get(bannerId)!)).toBe(true);
  });

  it("hasEnterChoice is false for a card without a script", () => {
    const vanillaId = put(state, alice, "battlefield", {
      ...card({ name: "Vanilla" }),
    });
    expect(hasEnterChoice(state.cards.get(vanillaId)!)).toBe(false);
  });

  it("fireEntersTriggers surfaces an enter_choice waitingChoice for a Banner entering via ETB", () => {
    // Skip the cast path: place the card directly and run
    // fireEntersTriggers to mirror the land-play / token /
    // moveCardToZone ETB flow.
    const bannerId = put(
      state,
      alice,
      "battlefield",
      card({ name: "Heraldic Banner" }),
    );
    const after = fireEntersTriggers(state, bannerId);
    expect(after.waitingChoice).not.toBeNull();
    expect(after.waitingChoice!.type).toBe(ENTER_CHOICE_TYPE);
    expect(after.waitingChoice!.playerId).toBe(alice);
    expect(after.waitingChoice!.choices.map((c) => c.value)).toEqual([
      "W",
      "U",
      "B",
      "R",
      "G",
    ]);
  });

  it("fireEntersTriggers does not surface a choice for a card without enter_choice", () => {
    const vanilla = card({ name: "Vanilla" });
    const vanillaId = put(state, alice, "battlefield", vanilla);
    const after = fireEntersTriggers(state, vanillaId);
    expect(after.waitingChoice).toBeNull();
  });
});
