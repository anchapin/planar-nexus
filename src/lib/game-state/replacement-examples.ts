/**
 * Example Card Implementations - Replacement and Prevention Effects
 * 
 * This file demonstrates how to implement cards with replacement and prevention effects
 * using the ReplacementEffectManager system.
 * 
 * Examples include:
 * - Furnace of Rath (damage doubling)
 * - Fog (damage prevention)
 * - Alhammarret's Archive (life gain doubling)
 * - Veiled Sentry (cast as though flash)
 * - Nefarox, Overlord of Grixis (draw replacement)
 * - Regeneration effects
 */

import {
  replacementEffectManager,
  ReplacementAbility,
  createPreventionShield,
  createDamageReplacementEffect,
  createLifeGainReplacementEffect,
  createDrawReplacementEffect,
  createDestroyReplacementEffect,
  createAsThoughEffect,
  AsThoughType,
} from './replacement-effects';
import { CardInstanceId, PlayerId, GameState } from './types';

/**
 * Furnace of Rath
 * "If damage would be dealt to any permanent or player, it deals double that damage instead."
 * CR 614.7 example
 */
export function registerFurnaceOfRath(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const effect = createDamageReplacementEffect(
    sourceCardId,
    controllerId,
    'Furnace of Rath: Damage is doubled',
    (amount) => amount * 2,
    5, // Layer 5 - general replacement
    false
  );
  replacementEffectManager.registerEffect(effect);
}

/**
 * Fog
 * "Prevent all combat damage that would be dealt this turn."
 */
export function registerFog(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const { ability, shield } = createPreventionShield(
    sourceCardId,
    controllerId,
    '*', // All targets - would need special handling
    999, // Prevent a very large amount
    'Fog: Prevent all combat damage',
    'until_end_of_turn',
    ['combat'] // Only combat damage
  );
  
  replacementEffectManager.registerEffect(ability);
  // Note: For "all targets", you'd need to register shields for each potential target
}

/**
 * Holy Day
 * "Prevent all damage that would be dealt this turn."
 */
export function registerHolyDay(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const { ability, shield } = createPreventionShield(
    sourceCardId,
    controllerId,
    '*',
    999,
    'Holy Day: Prevent all damage',
    'until_end_of_turn'
    // No damageTypes = all damage
  );
  
  replacementEffectManager.registerEffect(ability);
}

/**
 * Alhammarret's Archive
 * "If you would gain life, you gain twice that much life instead."
 */
export function registerAlhammarretsArchive(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const effect = createLifeGainReplacementEffect(
    sourceCardId,
    controllerId,
    "Alhammarret's Archive: Double life gain",
    (amount) => amount * 2,
    (targetId) => targetId === controllerId // Only applies to controller
  );
  replacementEffectManager.registerEffect(effect);
}

/**
 * Nefarox, Overlord of Grixis
 * "If you would draw a card, draw two cards instead."
 * (Simplified version for demonstration)
 */
export function registerNefarox(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const effect = createDrawReplacementEffect(
    sourceCardId,
    controllerId,
    'Nefarox: Draw two cards instead of one',
    (amount) => amount + 1 // Draw one additional card
  );
  replacementEffectManager.registerEffect(effect);
}

/**
 * Veiled Sentry
 * "You may cast spells as though they had flash."
 */
export function registerVeiledSentry(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const effect = createAsThoughEffect(
    sourceCardId,
    controllerId,
    'cast_flash',
    'Veiled Sentry: Cast spells as though they had flash',
    undefined,
    'permanent'
  );
  replacementEffectManager.registerAsThoughEffect(effect);
}

/**
 * Leonin Abunas
 * "Artifacts you control can't be the target of spells or abilities your opponents control."
 * This is implemented as an "as though" effect that changes targeting rules
 */
export function registerLeoninAbunas(sourceCardId: CardInstanceId, controllerId: PlayerId): void {
  const effect = createAsThoughEffect(
    sourceCardId,
    controllerId,
    'target_anything',
    'Leonin Abunas: Artifacts can\'t be targeted by opponents',
    (state, playerId) => {
      // This would check if the target is an artifact controlled by the effect's controller
      // and if the source is controlled by an opponent
      return true; // Simplified
    },
    'permanent'
  );
  replacementEffectManager.registerAsThoughEffect(effect);
}

/**
 * Regeneration Effect
 * "The next time this creature would be destroyed this turn, it isn't. Instead, tap it,
 * remove all damage from it, and remove it from combat."
 */
export function registerRegenerationShield(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  targetCreatureId: CardInstanceId
): void {
  const effect = createDestroyReplacementEffect(
    sourceCardId,
    controllerId,
    `Regeneration shield for creature`,
    (event) => ({
      ...event,
      type: 'tap', // Instead of destroy, tap the creature
      amount: 0,
      context: { ...event.context, regenerated: true },
    }),
    (targetId) => targetId === targetCreatureId
  );
  replacementEffectManager.registerEffect(effect);
}

/**
 * Pariah
 * "All damage that would be dealt to you is dealt to this creature instead."
 */
export function registerPariah(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  creatureId: CardInstanceId
): void {
  const effect: ReplacementAbility = {
    id: `pariah-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'damage_replacement',
    description: 'Pariah: Redirect damage to this creature',
    layer: 4,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (event) => event.type === 'damage' && event.targetId === controllerId,
    apply: (event) => ({
      modified: true,
      modifiedEvent: {
        ...event,
        targetId: creatureId, // Redirect to the creature
      },
      description: 'Damage redirected to Pariah creature',
      instead: true,
    }),
  };
  replacementEffectManager.registerEffect(effect);
}

/**
 * Shiny Impetus (example of "as though" for attacking)
 * "Target creature can attack as though it had haste."
 */
export function registerShinyImpetus(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  targetCreatureId: CardInstanceId
): void {
  const effect = createAsThoughEffect(
    sourceCardId,
    controllerId,
    'attack_haste',
    'Shiny Impetus: Creature can attack as though it had haste',
    (state, playerId) => {
      // Would check if the creature is the target
      return true;
    },
    'until_end_of_turn'
  );
  replacementEffectManager.registerAsThoughEffect(effect);
}

/**
 * Circle of Protection: Black
 * "You may pay 1. If you do, prevent all damage from black sources this turn."
 */
export function registerCircleOfProtectionBlack(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  paidMana: boolean
): void {
  if (!paidMana) return;
  
  const { ability, shield } = createPreventionShield(
    sourceCardId,
    controllerId,
    controllerId,
    999,
    'Circle of Protection: Black',
    'until_end_of_turn'
    // Would need additional filtering for black sources
  );
  
  replacementEffectManager.registerEffect(ability);
  replacementEffectManager.addPreventionShield(controllerId, shield);
}

/**
 * Effect Removal - called when a permanent leaves the battlefield
 */
export function unregisterEffects(sourceCardId: CardInstanceId): void {
  replacementEffectManager.removeEffectsFromSource(sourceCardId);
}

/**
 * Check if a player can cast spells as though they had flash
 * Helper function for the game engine
 */
export function canCastAsThoughFlash(playerId: PlayerId, gameState: GameState): boolean {
  return replacementEffectManager.checkAsThoughEffect(playerId, 'cast_flash', gameState);
}

/**
 * Check if a creature can attack as though it had haste
 * Helper function for the game engine
 */
export function canAttackAsThoughHaste(playerId: PlayerId, gameState: GameState): boolean {
  return replacementEffectManager.checkAsThoughEffect(playerId, 'attack_haste', gameState);
}

/**
 * Check if a creature can block flying creatures
 * Helper function for the game engine
 */
export function canBlockFlyingAsThoughReach(playerId: PlayerId, gameState: GameState): boolean {
  return replacementEffectManager.checkAsThoughEffect(playerId, 'block_flying', gameState);
}
