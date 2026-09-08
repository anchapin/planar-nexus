/**
 * Zone-removal keyword actions (CR 701): destroy, exile, sacrifice, regenerate, and generic zone moves.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId, Target, Zone } from '../types';
import { addCounters, removeCounters, hasCounter, initializePlaneswalkerLoyalty } from '../card-instance';
import { KeywordActionResult } from './shared';

/**
 * Check if a card has indestructible
 */
export function hasIndestructible(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const keywords = card.cardData.keywords || [];

  return (
    keywords.includes("Indestructible") || oracleText.includes("indestructible")
  );
}

/**
 * Check if a card can be regenerated (has regenerate ability)
 */
export function canBeRegenerated(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  return oracleText.includes("regenerate");
}

/**
 * Destroy a permanent
 * Handles indestructible and regeneration
 */
export function destroyCard(
  state: GameState,
  cardId: CardInstanceId,
  ignoreIndestructible: boolean = false,
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

  // Check for indestructible
  if (!ignoreIndestructible && hasIndestructible(card)) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is indestructible and cannot be destroyed`,
    };
  }

  // Check for replacement effects (e.g., "If a creature would be destroyed, exile it instead")
  const replacementEvent = {
    type: "destroy" as const,
    amount: 0,
    timestamp: Date.now(),
    targetId: cardId,
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);

  if (processedEvent.type === "exile") {
    // Replacement effect changed destroy to exile
    return exileCard(state, cardId);
  }

  // CR 701.13: If the permanent has a regeneration shield, consume exactly one
  // shield INSTEAD of destroying it — the permanent is tapped, all damage is
  // removed, and it stays on the battlefield (never moved to the graveyard).
  // Bypassed when ignoreIndestructible is set, matching the "cannot be
  // replaced" destroy contract used by the state-based annihilate paths.
  if (!ignoreIndestructible) {
    const shieldResult = consumeRegenerationShield(state, cardId);
    if (shieldResult.hasShield) {
      const shieldedCard = shieldResult.state.cards.get(cardId);
      if (shieldedCard) {
        const regeneratedCard = {
          ...shieldedCard,
          damage: 0,
          isTapped: true,
        };
        const regeneratedCards = new Map(shieldResult.state.cards);
        regeneratedCards.set(cardId, regeneratedCard);
        return {
          success: true,
          state: {
            ...shieldResult.state,
            cards: regeneratedCards,
            lastModifiedAt: Date.now(),
          },
          description: `${shieldedCard.cardData.name} regenerates (shield consumed)`,
          affectedCards: [cardId],
        };
      }
    }
  }

  // Move card to graveyard
  return moveCardToZone(state, cardId, "graveyard");
}

/**
 * Exile a card
 * Can be face-up or face-down
 */
export function exileCard(
  state: GameState,
  cardId: CardInstanceId,
  faceDown: boolean = false,
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

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache existed)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine exile zone (player's exile or shared exile)
  const exileZoneKey = card.controllerId
    ? `${card.controllerId}-exile`
    : "exile";

  const exileZone = state.zones.get(exileZoneKey);

  if (!exileZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Exile zone not found`,
    };
  }

  // Update card state
  const updatedCard = {
    ...card,
    isFaceDown: faceDown,
    attachedToId: null, // Detach from any attachments
    attachedCardIds: [], // Remove any attachments
    currentZoneKey: exileZoneKey,
  };

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedExileZone = {
    ...exileZone,
    cardIds: [...exileZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(exileZoneKey, updatedExileZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const faceDownText = faceDown ? " face down" : "";

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Exiled ${card.cardData.name}${faceDownText}`,
    affectedCards: [cardId],
  };
}

/**
 * Sacrifice a permanent
 * The controller of the sacrificed card chooses what to sacrifice
 */
export function sacrificeCard(
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

  // Move to graveyard (sacrificed cards go to owner's graveyard)
  return moveCardToZone(state, cardId, "graveyard");
}

// ---------------------------------------------------------------------------
// Blitz (CR 702.150)
//
// Blitz is an alternative cost. When a creature is cast for its blitz cost it
// gains haste, a "When this creature dies, draw a card" triggered ability, and
// a delayed "sacrifice it at the beginning of the next end step" trigger. The
// `blitz` marker on the CardInstance (set in spell-casting at resolution) is
// the single source of truth; the helpers below consume it so the effects fire
// exactly once and only for creatures actually cast via the blitz cost.
// ---------------------------------------------------------------------------

/**
 * Regenerate a permanent
 * Creates a "regeneration shield" that prevents destruction
 */
export function regenerateCard(
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

  // Check if the card has regenerate ability
  // In a full implementation, this would check if the ability was activated
  // For now, we allow regeneration if the card could theoretically have it

  // Remove all damage
  const updatedCard = {
    ...card,
    damage: 0,
    isTapped: false, // Untap the card
  };

  // Add regeneration shield counter (using a special counter type)
  const updatedCardWithShield = addCounters(
    updatedCard,
    "regeneration-shield",
    1,
  );

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCardWithShield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Regenerated ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Check and consume regeneration shield
 * Called when a card would be destroyed
 */
export function consumeRegenerationShield(
  state: GameState,
  cardId: CardInstanceId,
): { hasShield: boolean; state: GameState } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { hasShield: false, state };
  }

  if (hasCounter(card, "regeneration-shield")) {
    // Remove one regeneration shield
    const updatedCard = removeCounters(card, "regeneration-shield", 1);
    const updatedCards = new Map(state.cards);
    updatedCards.set(cardId, updatedCard);

    return {
      hasShield: true,
      state: {
        ...state,
        cards: updatedCards,
        lastModifiedAt: Date.now(),
      },
    };
  }

  return { hasShield: false, state };
}

/**
 * Move a card to a specific zone
 */
export function moveCardToZone(
  state: GameState,
  cardId: CardInstanceId,
  targetZoneType: "graveyard" | "exile" | "hand" | "library" | "battlefield",
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

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache exists)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine target zone
  let targetZoneKey: string;

  if (targetZoneType === "library") {
    // Libraries are always player's own
    targetZoneKey = `${card.ownerId}-library`;
  } else if (targetZoneType === "graveyard") {
    // Graveyards are owner's
    targetZoneKey = `${card.ownerId}-graveyard`;
  } else if (targetZoneType === "exile") {
    // Exile can be controller's or shared
    targetZoneKey = card.controllerId ? `${card.controllerId}-exile` : "exile";
  } else if (targetZoneType === "hand") {
    targetZoneKey = `${card.controllerId}-hand`;
  } else if (targetZoneType === "battlefield") {
    targetZoneKey = `${card.controllerId}-battlefield`;
  } else {
    return {
      success: false,
      state,
      description: "",
      error: `Invalid target zone: ${targetZoneType}`,
    };
  }

  const targetZone = state.zones.get(targetZoneKey);

  if (!targetZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Target zone ${targetZoneKey} not found`,
    };
  }

  // Handle special cases
  let updatedCard = { ...card };

  if (targetZoneType === "graveyard" || targetZoneType === "library") {
    // Reset certain states when moving to graveyard or library
    updatedCard = {
      ...card,
      isTapped: false,
      isFaceDown: false,
      attachedToId: null,
      attachedCardIds: [],
      damage: 0,
      counters: [], // Remove counters
    };
  } else if (targetZoneType === "battlefield") {
    // Set summoning sickness for permanents entering battlefield
    updatedCard = {
      ...card,
      hasSummoningSickness: true,
      enteredBattlefieldTimestamp: Date.now(),
    };
    // Initialize loyalty counters for planeswalkers (CR 306.5b)
    updatedCard = initializePlaneswalkerLoyalty(updatedCard);
  }

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedTargetZone = {
    ...targetZone,
    cardIds: [...targetZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(targetZoneKey, updatedTargetZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const zoneNames: Record<string, string> = {
    graveyard: "graveyard",
    exile: "exile",
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
  };

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Moved ${card.cardData.name} to ${zoneNames[targetZoneType]}`,
    affectedCards: [cardId],
  };
}

