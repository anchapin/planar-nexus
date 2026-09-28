/**
 * Damage and tap/untap keyword actions: direct card damage plus tap/untap.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 *
 * Issue #2351: this is the single shared damage pipeline for the engine, and
 * it now also owns the CR 702.90c infect -> -1/-1 counter conversion. Infect
 * used to be a special case hardcoded in `combat/resolution.ts`, which meant
 * non-combat damage did not convert (CR 702.90e) and infect damage skipped
 * protection and the whole replacement pipeline. See the `dealDamageToCard`
 * body for the full rationale.
 */
import type { GameState, CardInstanceId } from "../types";
import { getToughness, isCreature, addCounters } from "../card-instance";
import {
  shouldPreventDamageToTarget,
  hasDeathtouch,
  hasInfect,
} from "../evergreen-keywords";
import { KeywordActionResult } from "./shared";

/**
 * Deal damage to a card (creature, planeswalker)
 */
export function dealDamageToCard(
  state: GameState,
  cardId: CardInstanceId,
  damage: number,
  isCombatDamage: boolean = false,
  sourceId?: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // CR 702.16C: Check if damage should be prevented due to protection
  // Protection from a color prevents all damage from sources of that color
  if (sourceId) {
    const source = state.cards.get(sourceId);
    if (source && shouldPreventDamageToTarget(card, source)) {
      return {
        success: true,
        state,
        description: `Damage prevented by protection from ${card.cardData.oracle_text?.match(/protection from (\w+)/)?.[1] || "color"}`,
      };
    }
  }

  // Check for prevention effects
  const replacementEvent = {
    type: "damage" as const,
    timestamp: Date.now(),
    sourceId,
    targetId: cardId,
    amount: damage,
    isCombatDamage,
    damageTypes: (isCombatDamage ? ["combat"] : ["noncombat"]) as (
      "combat" | "noncombat"
    )[],
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  // CR 616.1 — Use the interactive path so competing replacement /
  // prevention effects surface a choice for the affected player's
  // controller instead of being silently auto-resolved.
  const interactiveOutcome = rem.processEventInteractive(
    replacementEvent,
    apnapOrder,
    {
      affectedPlayerId: card.controllerId,
    },
  );

  if (interactiveOutcome.requiresChoice && interactiveOutcome.candidates) {
    const waitingChoice = rem.createReplacementWaitingChoice(
      interactiveOutcome.candidates,
      card.controllerId,
      "Multiple damage replacement effects could apply. Choose one:",
    );
    return {
      success: true,
      state: {
        ...state,
        waitingChoice,
        lastModifiedAt: Date.now(),
      },
      description: `Awaiting replacement effect choice from controller of ${card.cardData.name}`,
      affectedCards: [cardId],
    };
  }

  const processedEvent = interactiveOutcome.event;
  const actualDamage = processedEvent.amount;

  // CR 702.90c: damage dealt by a source with infect to a **creature** is dealt
  // as that many -1/-1 counters *instead of* being marked on that creature.
  // The conversion lives here, in the single shared damage pipeline, rather
  // than in the combat resolver (issue #2351) for two reasons:
  //
  //   1. CR 702.90e — "The infect rules function no matter what zone an object
  //      with infect deals damage from" — so non-combat damage (Tainted
  //      Strike, Blightsteel Colossus's activation, Corpsejack Menace) converts
  //      too, not just combat damage.
  //   2. It must sit *after* the prevention / replacement pipeline above. The
  //      old combat-only branch called `addCounters` directly and so bypassed
  //      `shouldPreventDamageToTarget` and `processEventInteractive` entirely;
  //      a red infect attacker landed 2 counters on a "protection from red"
  //      blocker. Ruling: "Damage from a source with infect can be prevented
  //      or redirected."
  //
  // Scope: only creatures (702.90c). Damage to a player becomes poison counters
  // (702.90b) and is handled in `combat/resolution.ts`, which is where players
  // (not cards) are resolved. Damage to a planeswalker is normal damage, and
  // damage to a non-creature permanent is normal damage — neither is covered by
  // 702.90b/c.
  const sourceCard = sourceId ? state.cards.get(sourceId) : undefined;
  const sourceHasInfect = sourceCard ? hasInfect(sourceCard) : false;
  const infectConvertsToCounters =
    sourceHasInfect && actualDamage > 0 && isCreature(card);

  // Apply damage, or place -1/-1 counters for an infect source
  let updatedCard = infectConvertsToCounters
    ? addCounters(card, "-1/-1", actualDamage)
    : { ...card, damage: card.damage + actualDamage };

  // Planeswalker damage reduces loyalty (CR 119.3c)
  const isPlaneswalker = card.cardData.type_line
    ?.toLowerCase()
    .includes("planeswalker");
  if (isPlaneswalker) {
    const loyaltyCounter = updatedCard.counters?.find(
      (c) => c.type === "loyalty",
    );
    if (loyaltyCounter) {
      const currentLoyalty = loyaltyCounter.count || 0;
      const newLoyalty = currentLoyalty - actualDamage;
      updatedCard = {
        ...updatedCard,
        counters:
          updatedCard.counters
            ?.filter((c) => c.type !== "loyalty")
            .concat([{ type: "loyalty", count: newLoyalty }]) || [],
      };
    }
  }

  // Check for deathtouch on the source - lethal damage is 1 or more
  // CR 702.2b: Any nonzero amount of combat damage assigned by a source with deathtouch is considered lethal damage
  //
  // Issue #2351: gated on `!infectConvertsToCounters`. CR 702.90c says infect
  // damage "isn't marked on that creature", so marking lethal damage on top of
  // the -1/-1 counters double-counts it and destroys a legal permanent — a 1/1
  // with infect+deathtouch killed a 4/4 blocker holding two +1/+1 counters,
  // where one -1/-1 counter should have left a 3/3.
  if (sourceCard) {
    const sourceHasDeathtouch = hasDeathtouch(sourceCard);

    if (sourceHasDeathtouch && actualDamage > 0 && !infectConvertsToCounters) {
      // With deathtouch, any amount of damage is lethal
      // CR 702.2b: Any nonzero amount of combat damage from a deathtouch source is lethal
      const lethalDamage = getToughness(card);
      updatedCard = {
        ...updatedCard,
        damage: Math.max(updatedCard.damage, lethalDamage),
      };
    }
  }

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const damageType = isCombatDamage ? "combat damage" : "damage";

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    // CR 702.90c: an infect source dealt no damage at all here — it placed
    // counters — so describe it as such rather than as damage dealt.
    description: infectConvertsToCounters
      ? `${card.cardData.name} dealt ${actualDamage} infect damage (${actualDamage} -1/-1 counters)`
      : `${card.cardData.name} dealt ${actualDamage} ${damageType}`,
    affectedCards: [cardId],
  };
}

/**
 * Tap a card
 */
export function tapCardAction(
  state: GameState,
  cardId: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  if (card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already tapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: true,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Tapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Untap a card
 */
export function untapCardAction(
  state: GameState,
  cardId: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  if (!card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already untapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: false,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Untapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}
