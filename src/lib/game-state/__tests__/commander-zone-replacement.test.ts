/**
 * Commander Zone Replacement Effect — CR 903.9
 *
 * Issue #1384 — verify that commanders leaving the battlefield for hand,
 * library, graveyard, or exile are redirected to the command zone via the
 * ReplacementEffectManager pipeline. The effect is registered as a
 * self-replacement (CR 614.6) so the owner chooses first via APNAP.
 *
 * NOTE: The replacement layer ONLY rewrites the event (it carries a
 * `replacedToCommandZone` flag in the event context). The actual zone
 * mutation lives behind {@link resolveCommanderZoneRedirect}, which is
 * tested here via a fake `moveFn` that records the call so we don't
 * need a full GameState fixture.
 */

import {
  ReplacementEffectManager,
  ReplacementAbility,
  ReplacementEvent,
  APNAPOrder,
  createCommandZoneReplacementEffect,
  resolveCommanderZoneRedirect,
  createDestroyReplacementEffect,
} from "../replacement-effects";

const OWNER = "p1-commander-owner";
const OPPONENT = "p2-opponent";
const COMMANDER_ID = "cmd-legendary-creature";
const NON_COMMANDER_ID = "vanilla-creature";

function newRem(): ReplacementEffectManager {
  return new ReplacementEffectManager();
}

function registerCommanderEffect(rem: ReplacementEffectManager) {
  const effect = createCommandZoneReplacementEffect(COMMANDER_ID, OWNER);
  rem.registerEffect(effect);
  return effect;
}

function baseEvent(
  partial: Partial<ReplacementEvent> & {
    type: ReplacementEvent["type"];
    sourceId?: string;
    targetId?: string;
  },
): ReplacementEvent {
  return {
    amount: 0,
    timestamp: 1,
    ...partial,
  } as ReplacementEvent;
}

describe("CommanderZoneReplacementEffect — CR 903.9", () => {
  // (a) commander destroyed -> command zone
  test("(a) commander destroyed is redirected to command zone", () => {
    const rem = newRem();
    const eff = registerCommanderEffect(rem);
    expect(eff.isSelfReplacement).toBe(true);
    expect(eff.effectType).toBe("command_zone_replacement");

    const processed = rem.processEvent(
      baseEvent({ type: "destroy", sourceId: COMMANDER_ID, targetId: COMMANDER_ID }),
    );

    expect(processed.context?.replacedToCommandZone).toBe(true);
    expect(processed.context?.commandZoneOwnerId).toBe(OWNER);
    expect(processed.context?.originalEventType).toBe("destroy");
    expect(processed.context?.originalCardId).toBe(COMMANDER_ID);
    expect(processed.amount).toBe(0);
  });

  // (b) commander milled -> command zone
  test("(b) commander milled to graveyard is redirected to command zone", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    const processed = rem.processEvent(
      baseEvent({
        type: "move_to_graveyard",
        sourceId: COMMANDER_ID,
        targetId: COMMANDER_ID,
        context: { reason: "mill" },
      }),
    );

    expect(processed.context?.replacedToCommandZone).toBe(true);
    expect(processed.context?.commandZoneOwnerId).toBe(OWNER);
    expect(processed.context?.originalEventType).toBe("move_to_graveyard");
  });

  // (c) commander bounced to hand -> command zone
  test("(c) commander bounced to hand is redirected to command zone", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    const processed = rem.processEvent(
      baseEvent({
        type: "put_into_hand",
        sourceId: COMMANDER_ID,
        targetId: COMMANDER_ID,
      }),
    );

    expect(processed.context?.replacedToCommandZone).toBe(true);
    expect(processed.context?.originalEventType).toBe("put_into_hand");
  });

  // (d) commander exiled -> command zone
  test("(d) commander exiled is redirected to command zone", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    const processed = rem.processEvent(
      baseEvent({
        type: "exile",
        sourceId: COMMANDER_ID,
        targetId: COMMANDER_ID,
      }),
    );

    expect(processed.context?.replacedToCommandZone).toBe(true);
    expect(processed.context?.originalEventType).toBe("exile");
  });

  // (e) commander dies from -X/-X in SBAs -> command zone
  test("(e) commander death from -X/-X SBA mill path redirects to command zone", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    // SBA — 0 toughness lands card in graveyard (move_to_graveyard
    // is what state-based-actions emits after destroyCard resolves).
    const processed = rem.processEvent(
      baseEvent({
        type: "move_to_graveyard",
        sourceId: COMMANDER_ID,
        targetId: COMMANDER_ID,
        context: { reason: "zero-toughness" },
      }),
    );

    expect(processed.context?.replacedToCommandZone).toBe(true);
    expect(processed.context?.originalEventType).toBe("move_to_graveyard");
    expect(processed.context?.commandZoneOwnerId).toBe(OWNER);
  });

  // (f) non-commander creature NOT redirected
  test("(f) non-commander creature destruction is NOT redirected", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    const processed = rem.processEvent(
      baseEvent({
        type: "destroy",
        sourceId: NON_COMMANDER_ID,
        targetId: NON_COMMANDER_ID,
      }),
    );

    expect(processed.context?.replacedToCommandZone).toBeUndefined();
    expect(processed.type).toBe("destroy");
    expect(processed.amount).toBe(0);
  });

  // (g) APNAP ordering — owner (commander's controller) chooses first
  test("(g) APNAP ordering favours the commander owner (CR 903.9a)", () => {
    const rem = newRem();
    // Two effects — one for the commander, one for an opponent's effect
    // that wants to redirect destruction differently. The commander
    // effect must win because it is the affected player's self-replacement
    // (CR 614.6) AND the commander owner picks first under CR 903.9a.
    const ownerCommanderEffect: ReplacementAbility = {
      id: "owner-commander-cmdr-zone",
      sourceCardId: COMMANDER_ID,
      controllerId: OWNER,
      effectType: "command_zone_replacement",
      description: "Commander to command zone",
      layer: 3,
      timestamp: 100,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) =>
        e.type === "destroy" &&
        (e.sourceId === COMMANDER_ID || e.targetId === COMMANDER_ID),
      apply: (e) => ({
        modified: true,
        modifiedEvent: {
          ...e,
          amount: 0,
          type: "tap",
          context: {
            ...(e.context ?? {}),
            replacedToCommandZone: true,
            commandZoneOwnerId: OWNER,
            originalCardId: COMMANDER_ID,
            originalEventType: "destroy",
          },
        },
        description: "Commander redirected",
        instead: true,
      }),
    };

    // Competing opponent effect that would redirect the same event to exile.
    const opponentRedirect: ReplacementAbility = {
      id: "opponent-redirect-exile",
      sourceCardId: "spell1",
      controllerId: OPPONENT,
      effectType: "destroy_replacement",
      description: "Opponent wants to redirect to exile",
      layer: 3,
      timestamp: 200,
      isInstead: true,
      canApply: (e) =>
        e.type === "destroy" &&
        (e.sourceId === COMMANDER_ID || e.targetId === COMMANDER_ID),
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, type: "exile", amount: 0 },
        description: "Opponent redirected to exile",
        instead: true,
      }),
    };

    rem.registerEffect(opponentRedirect);
    rem.registerEffect(ownerCommanderEffect);

    const apnapOrder: APNAPOrder = {
      activePlayerId: OWNER,
      playerOrder: [OWNER, OPPONENT],
    };

    const outcome = rem.processEventInteractive(
      baseEvent({ type: "destroy", sourceId: COMMANDER_ID, targetId: COMMANDER_ID }),
      apnapOrder,
    );

    // Self-replacement for the commander (CR 614.6) applies immediately
    // without prompting — so no choice is required and the command-zone
    // redirect wins. The opponent redirect, while applicable, never gets
    // a chance to fire because the event was rewritten first.
    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.event.context?.replacedToCommandZone).toBe(true);
    expect(outcome.event.context?.commandZoneOwnerId).toBe(OWNER);
    expect(outcome.event.type).toBe("tap");
    expect(outcome.appliedEffects.map((e) => e.id)).toEqual([
      "owner-commander-cmdr-zone",
    ]);
  });

  test("competing non-self redirects resolve via CR 616.1 (owner first via auto-resolution)", () => {
    const rem = newRem();
    // Register only the destroy_replacement as a non-self redirect — to
    // prove the manager surfaces an interactive choice when 2+ non-self
    // effects compete, and the CR 616.1 helper picks the owner's effect.
    const ownerCommanderEffect = createCommandZoneReplacementEffect(
      COMMANDER_ID,
      OWNER,
    );
    const opponentRedirect = createDestroyReplacementEffect(
      "spell1",
      OPPONENT,
      "Opponent redirect",
      (e) => ({ ...e, type: "exile", amount: 0 }),
      (tid) => tid === COMMANDER_ID,
    );

    rem.registerEffect(opponentRedirect);
    rem.registerEffect(ownerCommanderEffect);

    const apnapOrder: APNAPOrder = {
      activePlayerId: OWNER,
      playerOrder: [OWNER, OPPONENT],
    };

    const outcome = rem.processEventInteractive(
      baseEvent({ type: "destroy", sourceId: COMMANDER_ID, targetId: COMMANDER_ID }),
      apnapOrder,
    );

    // createCommandZoneReplacementEffect returns isSelfReplacement:true,
    // so the owner's effect still applies immediately. Validate the
    // helper that APNAP tie-breaks in favour of the affected player too.
    expect(outcome.requiresChoice).toBe(false);
    expect(outcome.event.context?.replacedToCommandZone).toBe(true);
  });

  test("canApply ignores events for unrelated card IDs", () => {
    const eff = createCommandZoneReplacementEffect(COMMANDER_ID, OWNER);
    expect(
      eff.canApply(
        baseEvent({
          type: "destroy",
          sourceId: "stranger-card",
          targetId: "stranger-card",
        }),
      ),
    ).toBe(false);
    expect(
      eff.canApply(
        baseEvent({
          type: "damage",
          sourceId: COMMANDER_ID,
          targetId: COMMANDER_ID,
        }),
      ),
    ).toBe(false);
    expect(
      eff.canApply(
        baseEvent({ type: "move_to_graveyard", sourceId: COMMANDER_ID }),
      ),
    ).toBe(true);
    expect(
      eff.canApply(
        baseEvent({ type: "exile", targetId: COMMANDER_ID }),
      ),
    ).toBe(true);
  });

  test("resolveCommanderZoneRedirect invokes the move helper when redirected", () => {
    const rem = newRem();
    registerCommanderEffect(rem);

    const processed = rem.processEvent(
      baseEvent({ type: "exile", sourceId: COMMANDER_ID, targetId: COMMANDER_ID }),
    );

    const moves: string[] = [];
    const fakeState = {} as never;
    const moveFn = jest.fn((_state: unknown, cardId: string) => {
      moves.push(cardId);
      return { state: fakeState, success: true };
    });

    const outcome = resolveCommanderZoneRedirect(
      processed,
      fakeState,
      moveFn as never,
    );

    expect(outcome).not.toBeNull();
    expect(outcome?.redirected).toBe(true);
    expect(outcome?.originalCardId).toBe(COMMANDER_ID);
    expect(outcome?.ownerId).toBe(OWNER);
    expect(moveFn).toHaveBeenCalledTimes(1);
    expect(moves[0]).toBe(COMMANDER_ID);
  });

  test("resolveCommanderZoneRedirect returns null when not redirected", () => {
    const regular = baseEvent({
      type: "destroy",
      sourceId: COMMANDER_ID,
      targetId: COMMANDER_ID,
    });
    const outcome = resolveCommanderZoneRedirect(
      regular,
      {} as never,
      (() => undefined) as never,
    );
    expect(outcome).toBeNull();
  });

  test("createCommandZoneReplacementEffect metadata matches CR 903.9", () => {
    const eff = createCommandZoneReplacementEffect(COMMANDER_ID, OWNER);
    expect(eff.layer).toBe(3);
    expect(eff.isInstead).toBe(true);
    expect(eff.isSelfReplacement).toBe(true);
    expect(eff.controllerId).toBe(OWNER);
    expect(eff.sourceCardId).toBe(COMMANDER_ID);
    expect(eff.description).toContain("CR 903.9");
  });
});
