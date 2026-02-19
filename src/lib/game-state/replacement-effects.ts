/**
 * Replacement and Prevention Effects System
 * 
 * Implements MTG rules for replacement and prevention effects as described in CR 614-616.
 * - Replacement effects (CR 614.1): Modify how an event happens ("If X would happen, instead Y")
 * - Prevention effects (CR 614.2): Prevent damage, life loss, etc. from happening
 * - "As though" effects (CR 609): Allow players to ignore restrictions or follow different rules
 * 
 * Key Rules:
 * - CR 614.5: Some effects replace damage with life loss or other outcomes
 * - CR 614.7: If an event is replaced, it never happens
 * - CR 614.9: Some effects say "instead" - these are replacement effects
 * - CR 614.10: Some effects say "prevent" - these are prevention effects
 * - CR 616: Multiple replacement/prevention effects use APNAP ordering
 * 
 * @module replacement-effects
 */

import { CardInstanceId, PlayerId, GameState } from './types';

/**
 * Types of replacement/prevention effects
 */
export type ReplacementEffectType = 
  | 'damage_replacement'        // Replace damage with something else
  | 'damage_prevention'         // Prevent damage
  | 'life_gain_replacement'     // Modify life gain (e.g., double it)
  | 'life_loss_replacement'     // Modify life loss
  | 'draw_replacement'          // Replace card draw
  | 'counter_movement'          // Replace counter placement
  | 'token_creation'            // Modify token creation
  | 'destroy_replacement'       // Replace destruction (e.g., regenerate)
  | 'exile_replacement'         // Replace exile
  | 'counters'                  // Add/remove counters
  | 'as_though'                 // "As though" effects
  | 'sacrifice_replacement';    // Replace sacrifice

/**
 * A replacement or prevention ability
 */
export interface ReplacementAbility {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  effectType: ReplacementEffectType;
  description: string;
  apply: (event: ReplacementEvent) => ReplacementResult;
  canApply: (event: ReplacementEvent) => boolean;
  layer: number;
  sublayer?: string;
  duration?: 'until_end_of_turn' | 'until_end_of_next_turn' | 'permanent';
  preventionAmount?: number;
  timestamp: number;
  isSelfReplacement?: boolean;
  isInstead?: boolean;
}

/**
 * "As though" effect - allows a player to ignore restrictions or follow different rules
 * CR 609: "As Though"
 */
export interface AsThoughEffect {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  asThoughType: AsThoughType;
  description: string;
  condition?: (state: GameState, playerId: PlayerId) => boolean;
  duration?: 'until_end_of_turn' | 'permanent';
  timestamp: number;
}

export type AsThoughType =
  | 'cast_flash'
  | 'attack_haste'
  | 'block_flying'
  | 'play_land_anytime'
  | 'spend_mana_any_color'
  | 'target_anything'
  | 'range_infinite'
  | 'card_type_change';

export type ReplacementEventType = 
  | 'damage' | 'life_gain' | 'life_loss' | 'draw_card'
  | 'move_to_graveyard' | 'exile' | 'destroy' | 'create_token'
  | 'add_counter' | 'remove_counter' | 'sacrifice' | 'tap' | 'untap';

export interface ReplacementEvent {
  type: ReplacementEventType;
  timestamp: number;
  sourceId?: CardInstanceId;
  targetId?: CardInstanceId | PlayerId;
  amount: number;
  isCombatDamage?: boolean;
  damageTypes?: ('combat' | 'noncombat' | 'damage' | 'lethal')[];
  hasLifelink?: boolean;
  hasDeathtouch?: boolean;
  context?: Record<string, unknown>;
}

export interface ReplacementResult {
  modified: boolean;
  modifiedEvent?: ReplacementEvent;
  description: string;
  instead?: boolean;
  skipEvent?: boolean;
}

export interface PreventionShield {
  sourceId: CardInstanceId;
  amount: number;
  damageTypes?: string[];
  expiresAt?: number;
  controllerId: PlayerId;
}

export interface APNAPOrder {
  activePlayerId: PlayerId;
  playerOrder: PlayerId[];
}

export class ReplacementEffectManager {
  private effects: ReplacementAbility[] = [];
  private asThoughEffects: AsThoughEffect[] = [];
  private preventionShields: Map<string, PreventionShield[]> = new Map();
  private currentTurn: number = 0;

  setCurrentTurn(turn: number): void { this.currentTurn = turn; }

  registerEffect(effect: ReplacementAbility): void {
    this.effects.push(effect);
    this.sortEffects();
  }

  registerAsThoughEffect(effect: AsThoughEffect): void {
    this.asThoughEffects.push(effect);
  }

  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter(e => e.sourceCardId !== sourceCardId);
    this.asThoughEffects = this.asThoughEffects.filter(e => e.sourceCardId !== sourceCardId);
    for (const [key, shields] of this.preventionShields.entries()) {
      const validShields = shields.filter(s => s.sourceId !== sourceCardId);
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
      }
    }
  }

  resetExpiredEffects(currentTime: number, turnNumber: number): void {
    this.currentTurn = turnNumber;
    for (const [key, shields] of this.preventionShields.entries()) {
      const validShields = shields.filter(s => !s.expiresAt || s.expiresAt > currentTime);
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
      }
    }
    this.asThoughEffects = this.asThoughEffects.filter(e => e.duration !== 'until_end_of_turn');
  }

  getPreventionShields(targetId: string | PlayerId): PreventionShield[] {
    return this.preventionShields.get(String(targetId)) || [];
  }

  addPreventionShield(targetId: string | PlayerId, shield: PreventionShield): void {
    const key = String(targetId);
    const existing = this.preventionShields.get(key) || [];
    existing.push(shield);
    this.preventionShields.set(key, existing);
  }

  usePreventionShield(targetId: string | PlayerId, amount: number): number {
    const key = String(targetId);
    const shields = this.preventionShields.get(key);
    if (!shields || shields.length === 0) return 0;

    let remaining = amount;
    const validShields: PreventionShield[] = [];

    for (const shield of shields) {
      if (remaining <= 0) {
        validShields.push({ ...shield });
        continue;
      }
      if (shield.amount >= remaining) {
        const newShield = { ...shield, amount: shield.amount - remaining };
        remaining = 0;
        if (newShield.amount > 0) validShields.push(newShield);
      } else {
        remaining -= shield.amount;
      }
    }

    if (validShields.length === 0) {
      this.preventionShields.delete(key);
    } else {
      this.preventionShields.set(key, validShields);
    }
    return amount - remaining;
  }

  processEvent(event: ReplacementEvent, apnapOrder?: APNAPOrder, gameState?: GameState): ReplacementEvent {
    let currentEvent = { ...event };
    const appliedEffectIds = new Set<string>();
    let possibleEffects = this.getApplicableEffects(currentEvent, gameState);

    while (possibleEffects.length > 0) {
      const effectToApply = this.chooseBestEffect(possibleEffects, currentEvent, apnapOrder);
      if (!effectToApply) break;

      const result = effectToApply.apply(currentEvent);
      if (result.modified && result.modifiedEvent) {
        currentEvent = { ...result.modifiedEvent };
        appliedEffectIds.add(effectToApply.id);
        if (result.skipEvent) {
          currentEvent.amount = 0;
          break;
        }
      }
      possibleEffects = this.getApplicableEffects(currentEvent, gameState)
        .filter(e => !appliedEffectIds.has(e.id));
    }

    if (currentEvent.type === 'damage' && currentEvent.amount > 0 && currentEvent.targetId) {
      const prevented = this.usePreventionShield(currentEvent.targetId, currentEvent.amount);
      if (prevented > 0) currentEvent.amount -= prevented;
    }
    return currentEvent;
  }

  private getApplicableEffects(event: ReplacementEvent, gameState?: GameState): ReplacementAbility[] {
    return this.effects.filter(e => {
      const typeMatches = this.effectTypeMatches(e.effectType, event.type);
      return typeMatches && e.canApply(event);
    });
  }

  private chooseBestEffect(effects: ReplacementAbility[], event: ReplacementEvent, apnapOrder?: APNAPOrder): ReplacementAbility | null {
    if (effects.length === 0) return null;
    const sorted = [...effects].sort((a, b) => {
      if (a.isSelfReplacement && !b.isSelfReplacement) return -1;
      if (!a.isSelfReplacement && b.isSelfReplacement) return 1;
      if (apnapOrder && event.targetId) {
        const aIndex = apnapOrder.playerOrder.indexOf(a.controllerId);
        const bIndex = apnapOrder.playerOrder.indexOf(b.controllerId);
        if (aIndex !== -1 && bIndex !== -1 && aIndex !== bIndex) return aIndex - bIndex;
      }
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
    return sorted[0];
  }

  private effectTypeMatches(effectType: ReplacementEffectType, eventType: ReplacementEventType): boolean {
    const mapping: Record<ReplacementEventType, ReplacementEffectType[]> = {
      'damage': ['damage_replacement', 'damage_prevention'],
      'life_gain': ['life_gain_replacement'],
      'life_loss': ['life_loss_replacement'],
      'draw_card': ['draw_replacement'],
      'move_to_graveyard': ['destroy_replacement'],
      'exile': ['exile_replacement'],
      'destroy': ['destroy_replacement'],
      'create_token': ['token_creation'],
      'add_counter': ['counter_movement', 'counters'],
      'remove_counter': ['counters'],
      'sacrifice': ['sacrifice_replacement'],
      'tap': [], 'untap': [],
    };
    return mapping[eventType]?.includes(effectType) || false;
  }

  checkAsThoughEffect(playerId: PlayerId, asThoughType: AsThoughType, gameState: GameState): boolean {
    return this.asThoughEffects.some(effect =>
      effect.controllerId === playerId &&
      effect.asThoughType === asThoughType &&
      (!effect.condition || effect.condition(gameState, playerId))
    );
  }

  getAsThoughEffects(playerId: PlayerId, gameState: GameState): AsThoughEffect[] {
    return this.asThoughEffects.filter(effect =>
      effect.controllerId === playerId &&
      (!effect.condition || effect.condition(gameState, playerId))
    );
  }

  private sortEffects(): void {
    this.effects.sort((a, b) => {
      if (a.isSelfReplacement && !b.isSelfReplacement) return -1;
      if (!a.isSelfReplacement && b.isSelfReplacement) return 1;
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
  }

  createAPNAPOrder(activePlayerId: PlayerId, allPlayerIds: PlayerId[]): APNAPOrder {
    const activeIndex = allPlayerIds.indexOf(activePlayerId);
    if (activeIndex === -1) return { activePlayerId, playerOrder: allPlayerIds };
    const playerOrder = [activePlayerId, ...allPlayerIds.slice(activeIndex + 1), ...allPlayerIds.slice(0, activeIndex)];
    return { activePlayerId, playerOrder };
  }

  reset(): void {
    this.effects = [];
    this.asThoughEffects = [];
    this.preventionShields.clear();
    this.currentTurn = 0;
  }
}

// Factory Functions

export function createPreventionShield(
  sourceCardId: CardInstanceId, controllerId: PlayerId, targetId: string | PlayerId,
  amount: number, description: string, duration?: 'until_end_of_turn' | 'until_end_of_next_turn' | 'permanent',
  damageTypes?: string[]
): { ability: ReplacementAbility; shield: PreventionShield } {
  const timestamp = Date.now();
  const ability: ReplacementAbility = {
    id: `prevent-${sourceCardId}-${timestamp}`, sourceCardId, controllerId,
    effectType: 'damage_prevention', description, layer: 1, timestamp, duration, preventionAmount: amount,
    canApply: (e) => e.type === 'damage' && e.targetId === targetId &&
      (!damageTypes || !e.damageTypes || e.damageTypes.some(t => damageTypes.includes(t))),
    apply: () => ({ modified: false, description: 'Prevention shield will apply' }),
  };
  const shield: PreventionShield = {
    sourceId: sourceCardId, amount, damageTypes, controllerId,
    expiresAt: duration === 'until_end_of_turn' ? timestamp + 300000 : undefined,
  };
  return { ability, shield };
}

export function createDamageReplacementEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  layer: number = 5, isSelfReplacement: boolean = false
): ReplacementAbility {
  return {
    id: `dmg-replace-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    effectType: 'damage_replacement', description, layer, timestamp: Date.now(),
    isSelfReplacement, isInstead: true,
    canApply: (e) => e.type === 'damage',
    apply: (e) => ({ modified: true, modifiedEvent: { ...e, amount: replacementFn(e.amount, e) }, description, instead: true }),
  };
}

export function createLifeGainReplacementEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean
): ReplacementAbility {
  return {
    id: `life-replace-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    effectType: 'life_gain_replacement', description, layer: 5, timestamp: Date.now(), isInstead: true,
    canApply: (e) => e.type === 'life_gain' && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({ modified: true, modifiedEvent: { ...e, amount: replacementFn(e.amount, e) }, description, instead: true }),
  };
}

export function createLifeLossReplacementEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean
): ReplacementAbility {
  return {
    id: `loss-replace-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    effectType: 'life_loss_replacement', description, layer: 5, timestamp: Date.now(), isInstead: true,
    canApply: (e) => e.type === 'life_loss' && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({ modified: true, modifiedEvent: { ...e, amount: replacementFn(e.amount, e) }, description, instead: true }),
  };
}

export function createDrawReplacementEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number
): ReplacementAbility {
  return {
    id: `draw-replace-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    effectType: 'draw_replacement', description, layer: 5, timestamp: Date.now(), isInstead: true,
    canApply: (e) => e.type === 'draw_card',
    apply: (e) => ({ modified: true, modifiedEvent: { ...e, amount: replacementFn(e.amount, e) }, description, instead: true }),
  };
}

export function createDestroyReplacementEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, description: string,
  replacementFn: (event: ReplacementEvent) => ReplacementEvent | null,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean
): ReplacementAbility {
  return {
    id: `destroy-replace-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    effectType: 'destroy_replacement', description, layer: 3, timestamp: Date.now(), isInstead: true,
    canApply: (e) => (e.type === 'destroy' || e.type === 'move_to_graveyard') && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => {
      const modified = replacementFn(e);
      return modified ? { modified: true, modifiedEvent: modified, description, instead: true } : { modified: false, description: 'Cannot apply' };
    },
  };
}

export function createAsThoughEffect(
  sourceCardId: CardInstanceId, controllerId: PlayerId, asThoughType: AsThoughType,
  description: string, condition?: (state: GameState, playerId: PlayerId) => boolean,
  duration?: 'until_end_of_turn' | 'permanent'
): AsThoughEffect {
  return {
    id: `as-though-${sourceCardId}-${Date.now()}`, sourceCardId, controllerId,
    asThoughType, description, condition, duration, timestamp: Date.now(),
  };
}

export const replacementEffectManager = new ReplacementEffectManager();
