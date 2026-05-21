/**
 * Linked Effects System (CR 607)
 *
 * Linked effects occur when a card has two abilities where one creates an object
 * that the other references. Examples:
 * - "When ~ deals damage, you gain that much life" (damage -> life link)
 * - "When you copy a card, the copy gets counter X" (copy -> counter link)
 *
 * When the first ability resolves, it creates the linked object and records the link ID.
 * When the second ability resolves, it looks up the linked object to apply its effect.
 */

import type {
  CardInstanceId,
  GameState,
  LinkedEffect,
  LinkedEffectRegistry,
  PlayerId,
} from "./types";

/**
 * Generate a unique linked effect ID
 */
export function generateLinkedEffectId(): string {
  return `linked-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new linked effect
 * CR 607.2: When the first ability resolves, the link is established
 */
export function createLinkedEffect(
  sourceCardId: CardInstanceId,
  firstAbilityId: string,
  secondAbilityId: string,
  linkType: "damage_life" | "copy_counter",
  options?: {
    damageAmount?: number;
    copiedCardId?: CardInstanceId;
  },
): LinkedEffect {
  return {
    id: generateLinkedEffectId(),
    sourceCardId,
    firstAbilityId,
    secondAbilityId,
    linkType,
    damageAmount: options?.damageAmount,
    copiedCardId: options?.copiedCardId,
    timestamp: Date.now(),
  };
}

/**
 * Register a linked effect in the game state
 */
export function registerLinkedEffect(
  state: GameState,
  linkedEffect: LinkedEffect,
): GameState {
  const registry = state.linkedEffectRegistry;
  const newEffects = [...registry.effects, linkedEffect];

  // Update bySourceCard map
  const newBySourceCard = new Map(registry.bySourceCard);
  const existing = newBySourceCard.get(linkedEffect.sourceCardId) || [];
  newBySourceCard.set(linkedEffect.sourceCardId, [...existing, linkedEffect]);

  return {
    ...state,
    linkedEffectRegistry: {
      effects: newEffects,
      bySourceCard: newBySourceCard,
    },
    lastModifiedAt: Date.now(),
  };
}

/**
 * Remove linked effects from a source card
 * Called when the source card leaves the battlefield or is otherwise removed
 */
export function removeLinkedEffectsFromSource(
  state: GameState,
  sourceCardId: CardInstanceId,
): GameState {
  const registry = state.linkedEffectRegistry;

  // Filter out effects from this source
  const newEffects = registry.effects.filter(
    (e) => e.sourceCardId !== sourceCardId,
  );

  // Rebuild bySourceCard map
  const newBySourceCard = new Map<CardInstanceId, LinkedEffect[]>();
  for (const effect of newEffects) {
    const existing = newBySourceCard.get(effect.sourceCardId) || [];
    newBySourceCard.set(effect.sourceCardId, [...existing, effect]);
  }

  return {
    ...state,
    linkedEffectRegistry: {
      effects: newEffects,
      bySourceCard: newBySourceCard,
    },
    lastModifiedAt: Date.now(),
  };
}

/**
 * Get linked effects for a specific source card
 */
export function getLinkedEffectsForSource(
  state: GameState,
  sourceCardId: CardInstanceId,
): LinkedEffect[] {
  return state.linkedEffectRegistry.bySourceCard.get(sourceCardId) || [];
}

/**
 * Get a specific linked effect by ID
 */
export function getLinkedEffectById(
  state: GameState,
  linkedEffectId: string,
): LinkedEffect | undefined {
  return state.linkedEffectRegistry.effects.find((e) => e.id === linkedEffectId);
}

/**
 * Find a linked effect by the second ability ID
 * Used when the second ability resolves to find its linked object
 */
export function findLinkedEffectBySecondAbility(
  state: GameState,
  sourceCardId: CardInstanceId,
  secondAbilityId: string,
): LinkedEffect | undefined {
  const effects = getLinkedEffectsForSource(state, sourceCardId);
  return effects.find((e) => e.secondAbilityId === secondAbilityId);
}

/**
 * Update a linked effect (e.g., set damage amount after damage is dealt)
 */
export function updateLinkedEffect(
  state: GameState,
  linkedEffectId: string,
  updates: Partial<Pick<LinkedEffect, "damageAmount" | "copiedCardId">>,
): GameState {
  const registry = state.linkedEffectRegistry;

  const newEffects = registry.effects.map((e) =>
    e.id === linkedEffectId ? { ...e, ...updates } : e,
  );

  // Rebuild bySourceCard map
  const newBySourceCard = new Map<CardInstanceId, LinkedEffect[]>();
  for (const effect of newEffects) {
    const existing = newBySourceCard.get(effect.sourceCardId) || [];
    newBySourceCard.set(effect.sourceCardId, [...existing, effect]);
  }

  return {
    ...state,
    linkedEffectRegistry: {
      effects: newEffects,
      bySourceCard: newBySourceCard,
    },
    lastModifiedAt: Date.now(),
  };
}

/**
 * Check if a card ability matches a linked effect pattern
 * Returns the type of linked effect if it matches
 */
export function detectLinkedEffectPattern(
  abilityText: string,
): "damage_life" | "copy_counter" | null {
  const lowerText = abilityText.toLowerCase();

  // Damage to life link: "when X deals damage, you gain that much life"
  // or "whenever X deals damage, you gain life equal to the damage dealt"
  if (
    (lowerText.includes("deals damage") || lowerText.includes("deal damage")) &&
    (lowerText.includes("gain life") || lowerText.includes("you gain that much life"))
  ) {
    return "damage_life";
  }

  // Copy to counter link: "when you copy" and "counter" or "gets" pattern
  // Example: "when you copy a card, the copy has [something]"
  if (
    lowerText.includes("when you copy") ||
    (lowerText.includes("copy") && lowerText.includes("gets ") && lowerText.includes("counter"))
  ) {
    return "copy_counter";
  }

  return null;
}

/**
 * Handle linked effect when first ability resolves
 * Called when the first ability (the one that creates the object) resolves
 */
export function handleFirstAbilityResolution(
  state: GameState,
  sourceCardId: CardInstanceId,
  firstAbilityId: string,
  secondAbilityId: string,
  linkType: "damage_life" | "copy_counter",
  options?: {
    damageAmount?: number;
    copiedCardId?: CardInstanceId;
  },
): GameState {
  const linkedEffect = createLinkedEffect(
    sourceCardId,
    firstAbilityId,
    secondAbilityId,
    linkType,
    options,
  );

  return registerLinkedEffect(state, linkedEffect);
}

/**
 * Handle linked effect when second ability resolves
 * Returns the linked effect data and updated state
 */
export function handleSecondAbilityResolution(
  state: GameState,
  sourceCardId: CardInstanceId,
  secondAbilityId: string,
): {
  state: GameState;
  linkedEffect: LinkedEffect | null;
  error?: string;
} {
  const linkedEffect = findLinkedEffectBySecondAbility(
    state,
    sourceCardId,
    secondAbilityId,
  );

  if (!linkedEffect) {
    return {
      state,
      linkedEffect: null,
      error: "No linked effect found for this ability",
    };
  }

  // Remove the linked effect after the second ability resolves (one-time link)
  const newRegistry = {
    effects: state.linkedEffectRegistry.effects.filter(
      (e) => e.id !== linkedEffect.id,
    ),
    bySourceCard: new Map(state.linkedEffectRegistry.bySourceCard),
  };

  // Update the bySourceCard map
  const sourceEffects = newRegistry.bySourceCard.get(sourceCardId) || [];
  const updatedSourceEffects = sourceEffects.filter((e) => e.id !== linkedEffect.id);
  if (updatedSourceEffects.length > 0) {
    newRegistry.bySourceCard.set(sourceCardId, updatedSourceEffects);
  } else {
    newRegistry.bySourceCard.delete(sourceCardId);
  }

  return {
    state: {
      ...state,
      linkedEffectRegistry: newRegistry,
      lastModifiedAt: Date.now(),
    },
    linkedEffect,
  };
}

/**
 * Get linked effect data for damage-to-life effects
 * Returns the damage amount that was dealt
 */
export function getLinkedDamageAmount(
  state: GameState,
  linkedEffect: LinkedEffect,
): number | undefined {
  if (linkedEffect.linkType !== "damage_life") {
    return undefined;
  }
  return linkedEffect.damageAmount;
}

/**
 * Get linked effect data for copy-to-counter effects
 * Returns the copied card ID
 */
export function getLinkedCopiedCard(
  state: GameState,
  linkedEffect: LinkedEffect,
): CardInstanceId | undefined {
  if (linkedEffect.linkType !== "copy_counter") {
    return undefined;
  }
  return linkedEffect.copiedCardId;
}

/**
 * Apply a linked damage-to-life effect
 * When the second ability resolves, the player gains life equal to the damage dealt
 */
export function applyLinkedLifeGain(
  state: GameState,
  playerId: PlayerId,
  linkedEffect: LinkedEffect,
): GameState {
  if (linkedEffect.linkType !== "damage_life" || !linkedEffect.damageAmount) {
    return state;
  }

  const player = state.players.get(playerId);
  if (!player) return state;

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    life: player.life + linkedEffect.damageAmount,
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Clean up expired or used linked effects
 * Called during cleanup phase
 */
export function cleanupLinkedEffects(state: GameState): GameState {
  // For now, linked effects are removed after the second ability resolves
  // This function can be extended for duration-based effects if needed
  return state;
}