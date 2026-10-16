/**
 * Wave 4.8 follow-up 21 lane 61 sub-piece piece 2/N
 * (#2614 follow-up): the
 * `redirect.to: "any_zone"` death-replacement
 * family. The drafter writes a free-form
 * destination ("if [thing] would die, its
 * owner may put it into their hand, library,
 * graveyard, or exile instead"); the engine
 * consult surfaces a `redirect_zone_choice`
 * WaitingChoice on the controller and routes
 * the chosen zone through the standard
 * `moveCardToZoneWithoutTriggers` helper.
 *
 * The follow-up 20 piece 1
 * (`redirect.to: "library_top" | "library_bottom"`)
 * shipped a position-aware variant of the
 * library-redirect; this piece closes the
 * controller-driven side of the family. The
 * schema already accepted `any_zone` (the
 * lane 61a enum wired it through); the
 * factory accept-list and the engine
 * consult needed updating.
 *
 * Test scope:
 *  1. Schema accepts `redirect.to: "any_zone"`
 *     on `ReplacementEffectSchema`.
 *  2. Schema parses the synthetic card
 *     (`Redirect Any Zone On Die`).
 *  3. End-to-end: a creature controlled by
 *     the script's owner dies →
 *     `redirect_zone_choice` WaitingChoice
 *     is surfaced with the four valid
 *     zones.
 *  4. Picking "hand" routes the dying card
 *     to owner's hand (dies triggers do NOT
 *     fire).
 *  5. Picking "library" routes the dying
 *     card to owner's library via the
 *     standard `moveCardToZoneWithoutTriggers`
 *     helper (top-of-library, the
 *     `addCardToZone` default).
 *  6. Picking "exile" routes the dying
 *     card to owner's exile correctly.
 *  7. Schema gate: `redirect.to: "any_zone"`
 *     on a non-death-replacement event
 *     parses, but the factory refuses
 *     non-`would_die` events (the
 *     v1 minimum restricts to `would_die`;
 *     `would_be_destroyed` parses in the
 *     schema but the factory returns
 *     null). This pins the
 *     death-replacement-only scope.
 */
import {
  destroyCard,
  moveCardToZone,
  REDIRECT_ZONE_CHOICE_TYPE,
  resolveRedirectZoneChoice,
} from "../keyword-actions/removal";
import { createCardInstance } from "../card-instance";
import { createInitialGameState, startGame } from "../game-state";
import {
  buildScriptedDeathReplacementEffect,
  getCardScript,
} from "../card-scripts";
import { ReplacementEffectSchema } from "../card-scripts/schema";
import { resolveWaitingChoice } from "../spell-casting/choices";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

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

describe("Lane 61 sub-piece (follow-up 21 piece 2/N): redirect.to:any_zone zone-choice waitingChoice", () => {
  it("schema accepts redirect.to: 'any_zone' on ReplacementEffectSchema", () => {
    // The enum was extended to include
    // "any_zone" as a literal. The schema
    // parses the value without error.
    const parsed = ReplacementEffectSchema.parse({
      text: "if [thing] would die, its owner may put it into their hand, library, graveyard, or exile instead.",
      event: "would_die",
      applies_to: { type: "creature", controller: "you" },
      redirect: { to: "any_zone", controller_choice: true },
    });
    expect(parsed.redirect.to).toBe("any_zone");
    expect(parsed.redirect.controller_choice).toBe(true);
  });

  it("registry exposes Redirect Any Zone On Die with any_zone redirect + controller_choice marker", () => {
    // The runtime script index strips the
    // `oracle` field (see
    // `scripts/build-card-script-index.ts` —
    // it ships in the client bundle, the
    // full JSON stays on disk). We assert
    // the in-memory shape directly: the
    // replacement effect has `to:
    // "any_zone"` and `controller_choice:
    // true`.
    const script = getCardScript("Redirect Any Zone On Die");
    expect(script).toBeDefined();
    const re = script!.replacement_effects![0];
    expect(re.event).toBe("would_die");
    expect(re.applies_to.type).toBe("creature");
    expect(re.applies_to.controller).toBe("you");
    expect(re.redirect.to).toBe("any_zone");
    expect(re.redirect.controller_choice).toBe(true);
  });

  it("factory builds a valid ReplacementAbility for any_zone", () => {
    // The factory's accept-list was extended
    // to include "any_zone" (the lane 61a v1
    // minimum only accepted exile / hand /
    // sacrifice / battlefield_tapped /
    // battlefield_untapped / life_loss /
    // library_top / library_bottom). The
    // apply() stamps redirectToZone:
    // "any_zone" on the event's context.
    const script = getCardScript("Redirect Any Zone On Die");
    expect(script).toBeDefined();
    const re = script!.replacement_effects![0];
    const state = startTwoPlayerState();
    const effect = buildScriptedDeathReplacementEffect(
      id("any-zone-source"),
      "alice" as PlayerId,
      re,
      state,
    );
    expect(effect).not.toBeNull();
    expect(effect!.effectType).toBe("death_replacement");
    expect(effect!.sourceCardId).toBe(id("any-zone-source"));

    const event = {
      type: "would_die" as const,
      timestamp: Date.now(),
      targetId: id("creature"),
      sourceId: id("any-zone-source"),
      controllerId: "alice" as PlayerId,
      amount: 0,
    };
    const applied = effect!.apply(event);
    expect(applied.modified).toBe(true);
    expect(applied.redirectToZone).toBe("any_zone");
    expect(applied.modifiedEvent?.context?.redirectToZone).toBe("any_zone");
  });

  it("end-to-end: creature the controller owns dies → redirect_zone_choice surfaced with four zones", () => {
    // Setup: a synthetic card with
    // `redirect.to: "any_zone"` is on the
    // battlefield (the source of the
    // replacement); a bear the same player
    // owns is on the battlefield (the
    // dying card). The bear has 2 toughness;
    // the destroy path kills it.
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "any-zone-source",
      card("Redirect Any Zone On Die", "Creature — Shapeshifter", [1, 1]),
    );
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    // Destroy the bear. The consult fires
    // the `redirect.to: "any_zone"`
    // replacement; a `redirect_zone_choice`
    // WaitingChoice is surfaced on the
    // controller. The bear is NOT moved
    // yet (the consult pauses on the
    // choice).
    const result = moveCardToZone(state, id("bear"), "graveyard");
    expect(result.success).toBe(true);
    expect(result.state.waitingChoice).toBeDefined();
    expect(result.state.waitingChoice?.type).toBe(REDIRECT_ZONE_CHOICE_TYPE);
    expect(result.state.waitingChoice?.playerId).toBe(p1);
    expect(result.state.waitingChoice?.choices).toHaveLength(4);
    const labels = result.state.waitingChoice!.choices.map((c) => c.label);
    expect(labels).toEqual([
      "Move to library",
      "Move to graveyard",
      "Move to exile",
      "Move to hand",
    ]);
    // The bear is still on the battlefield
    // (the consult paused).
    expect(
      result.state.zones.get(`${p1}-battlefield`)!.cardIds,
    ).toContain("bear");
    expect(
      result.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [],
    ).not.toContain("bear");
  });

  it("end-to-end: picking 'hand' routes the dying card to owner's hand (dies triggers do NOT fire)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "any-zone-source",
      card("Redirect Any Zone On Die", "Creature — Shapeshifter", [1, 1]),
    );
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const prompted = moveCardToZone(state, id("bear"), "graveyard");
    expect(prompted.state.waitingChoice?.type).toBe(REDIRECT_ZONE_CHOICE_TYPE);

    // The dying controller (p1) picks
    // "hand". Resolve via the generic
    // `resolveWaitingChoice` dispatcher;
    // the offer-resolver registry routes
    // it through `resolveRedirectZoneChoice`.
    const resolved = resolveWaitingChoice(
      prompted.state,
      p1,
      `hand:${id("bear")}`,
    );
    expect(resolved.success).toBe(true);
    // The bear is in p1's hand now.
    expect(
      resolved.state.zones.get(`${p1}-hand`)!.cardIds,
    ).toContain("bear");
    // The bear is NOT in the graveyard
    // (the any_zone redirect REPLACES
    // the death — CR 614.5 "instead").
    expect(
      resolved.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [],
    ).not.toContain("bear");
    // The bear is NOT on the battlefield
    // (the move is final).
    expect(
      resolved.state.zones.get(`${p1}-battlefield`)!.cardIds,
    ).not.toContain("bear");
    // The source of the replacement is
    // still on the battlefield (the
    // replacement applied to the bear,
    // not to itself).
    expect(
      resolved.state.zones.get(`${p1}-battlefield`)!.cardIds,
    ).toContain("any-zone-source");
    // The waitingChoice is cleared after
    // resolution.
    expect(resolved.state.waitingChoice).toBeNull();
  });

  it("end-to-end: picking 'library' routes the dying card to owner's library via the standard move helper", () => {
    // The standard `moveCardToZoneWithoutTriggers`
    // helper appends to the END of the
    // `cardIds` array (= "drawn first" = top
    // of library per CR 405.1 / `getTopCard`).
    // The any_zone "library" arm uses this
    // exact path — distinct from the
    // follow-up 20 piece 1's `library_top` /
    // `library_bottom` redirect (which uses
    // `moveCardToZoneWithPosition` to
    // honour the explicit position).
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "any-zone-source",
      card("Redirect Any Zone On Die", "Creature — Shapeshifter", [1, 1]),
    );
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const prompted = moveCardToZone(state, id("bear"), "graveyard");
    expect(prompted.state.waitingChoice?.type).toBe(REDIRECT_ZONE_CHOICE_TYPE);

    const resolved = resolveRedirectZoneChoice(
      prompted.state,
      p1,
      `library:${id("bear")}`,
    );
    expect(resolved.success).toBe(true);
    // The bear is in p1's library.
    expect(
      resolved.state.zones.get(`${p1}-library`)!.cardIds,
    ).toContain("bear");
    // The bear is NOT in the graveyard.
    expect(
      resolved.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [],
    ).not.toContain("bear");
    // The bear lands at the END of the
    // library array (= "drawn first" =
    // top of library per the standard
    // `addCardToZone` default).
    const lib = resolved.state.zones.get(`${p1}-library`)!.cardIds;
    expect(lib[lib.length - 1]).toBe("bear");
  });

  it("end-to-end: picking 'exile' routes the dying card to owner's exile", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "any-zone-source",
      card("Redirect Any Zone On Die", "Creature — Shapeshifter", [1, 1]),
    );
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const prompted = moveCardToZone(state, id("bear"), "graveyard");
    const resolved = resolveRedirectZoneChoice(
      prompted.state,
      p1,
      `exile:${id("bear")}`,
    );
    expect(resolved.success).toBe(true);
    // The bear is in p1's exile.
    expect(
      resolved.state.zones.get(`${p1}-exile`)!.cardIds,
    ).toContain("bear");
    // The bear is NOT in the graveyard
    // (the any_zone redirect replaced
    // the death).
    expect(
      resolved.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [],
    ).not.toContain("bear");
  });

  it("schema gate: any_zone on a non-`would_die` event parses but the factory refuses (death-only scope)", () => {
    // The schema is permissive — a
    // `redirect.to: "any_zone"` on a
    // `would_be_destroyed` event parses
    // (the enum doesn't gate on event
    // kind). The v1 factory, however,
    // restricts to `event: "would_die"`
    // (lane 61a's scope); non-death
    // events return null from
    // `buildScriptedDeathReplacementEffect`.
    // This pins the death-replacement-only
    // gate: non-death events silently
    // fall through the engine consult.
    const parsed = ReplacementEffectSchema.parse({
      text: "instead of being destroyed, the controller picks a zone",
      event: "would_be_destroyed",
      applies_to: { type: "creature", controller: "you" },
      redirect: { to: "any_zone", controller_choice: true },
    });
    expect(parsed.event).toBe("would_be_destroyed");
    expect(parsed.redirect.to).toBe("any_zone");

    const state = startTwoPlayerState();
    const effect = buildScriptedDeathReplacementEffect(
      id("non-death-source"),
      "alice" as PlayerId,
      parsed,
      state,
    );
    // Factory refuses: event !== "would_die".
    expect(effect).toBeNull();
  });

  it("control: destroyCard end-to-end surfaces a redirect_zone_choice and resolves cleanly", () => {
    // Mirrors the consult path used in
    // production: `destroyCard` is the
    // canonical call site for "this
    // creature dies"; the destroy path
    // routes through `moveCardToZone` and
    // the consult surfaces the
    // redirect_zone_choice WaitingChoice.
    // We then resolve via
    // `resolveWaitingChoice` (the
    // production dispatcher).
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "any-zone-source",
      card("Redirect Any Zone On Die", "Creature — Shapeshifter", [1, 1]),
    );
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const prompted = destroyCard(state, id("bear"));
    expect(prompted.success).toBe(true);
    expect(prompted.state.waitingChoice?.type).toBe(REDIRECT_ZONE_CHOICE_TYPE);

    // Pick "graveyard" via the
    // production dispatcher. The
    // resolver routes through
    // `moveCardToZoneWithoutTriggers`.
    const resolved = resolveWaitingChoice(
      prompted.state,
      p1,
      `graveyard:${id("bear")}`,
    );
    expect(resolved.success).toBe(true);
    expect(
      resolved.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [],
    ).toContain("bear");
    expect(resolved.state.waitingChoice).toBeNull();
  });
});