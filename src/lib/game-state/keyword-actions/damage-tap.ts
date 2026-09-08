/**
 * Damage and tap/untap keyword actions: direct card damage plus tap/untap.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId } from '../types';
import { getToughness } from '../card-instance';
import { shouldPreventDamageToTarget, hasDeathtouch } from '../evergreen-keywords';
import { KeywordActionResult } from './shared';

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

  // Apply damage
  let updatedCard = {
    ...card,
    damage: card.damage + actualDamage,
  };

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
  if (sourceId) {
    const sourceCard = state.cards.get(sourceId);
    if (sourceCard) {
      const sourceHasDeathtouch = hasDeathtouch(sourceCard);

      if (sourceHasDeathtouch && actualDamage > 0) {
        // With deathtouch, any amount of damage is lethal
        // CR 702.2b: Any nonzero amount of combat damage from a deathtouch source is lethal
        const lethalDamage = getToughness(card);
        updatedCard = {
          ...updatedCard,
          damage: Math.max(updatedCard.damage, lethalDamage),
        };
      }
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
    description: `${card.cardData.name} dealt ${actualDamage} ${damageType}`,
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

