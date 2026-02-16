/**
 * Replacement and Prevention Effects System
 * 
 * Implements MTG rules for replacement and prevention effects as described in CR 614.
 * - Replacement effects (CR 614.1): Modify how an event happens
 * - Prevention effects (CR 614.2): Prevent damage, etc. from happening
 */

import { CardInstance, Player, GameState, ZoneType, CardInstanceId, PlayerId } from './types';

/**
 * Types of replacement/prevention effects
 */
export type ReplacementEffectType = 
  | 'damage_replacement'
  | 'damage_prevention'
  | 'life_gain_replacement'
  | 'life_loss_replacement'
  | 'draw_replacement'
  | 'counter_movement'
  | 'token_creation'
  | 'destroy_replacement'
  | 'exile_replacement'
  | 'counters';

/**
 * A replacement or prevention ability
 */
export interface ReplacementAbility {
  /** Unique identifier for this ability */
  id: string;
  /** ID of the card/source that has this ability */
  sourceCardId: CardInstanceId;
  /** ID of the controller of the source */
  controllerId: PlayerId;
  /** Type of effect */
  effectType: ReplacementEffectType;
  /** Text description for debugging */
  description: string;
  /** The replacement function - returns modified event or null if cannot apply */
  apply: (event: ReplacementEvent) => ReplacementResult;
  /** Can this effect apply to the given event */
  canApply: (event: ReplacementEvent) => boolean;
  /** Layer for ordering (614.1a) - lower = applies earlier */
  layer: number;
  /** Sublayer for ordering within layer */
  sublayer?: string;
  /** Duration of prevention effect (for prevention shields) */
  duration?: 'until_end_of_turn' | 'until_end_of_next_turn' | 'permanent';
  /** Amount this can prevent (for prevention effects) */
  preventionAmount?: number;
  /** Has this prevention effect been used this turn */
  usedThisTurn?: number;
}

/**
 * Events that can be replaced or prevented
 */
export type ReplacementEventType = 
  | 'damage'
  | 'life_gain'
  | 'life_loss'
  | 'draw_card'
  | 'move_to_graveyard'
  | 'exile'
  | 'destroy'
  | 'create_token'
  | 'add_counter'
  | 'remove_counter';

/**
 * Generic replacement event structure
 */
export interface ReplacementEvent {
  type: ReplacementEventType;
  /** Timestamp for ordering */
  timestamp: number;
  /** The source of the event (e.g., attacking creature) */
  sourceId?: CardInstanceId;
  /** The target of the event */
  targetId?: CardInstanceId | PlayerId;
  /** Amount (damage, life, etc.) */
  amount: number;
  /** Whether damage is combat damage */
  isCombatDamage?: boolean;
  /** Damage types */
  damageTypes?: ('combat' | 'noncombat' | 'damage' | 'lethal')[];
  /** Whether this is from a source with lifelink */
  hasLifelink?: boolean;
  /** Whether this is from a source with deathtouch */
  hasDeathtouch?: boolean;
}

/**
 * Result of applying a replacement effect
 */
export interface ReplacementResult {
  /** Whether the event was modified */
  modified: boolean;
  /** The modified event (if modified) */
  modifiedEvent?: ReplacementEvent;
  /** Description of what happened */
  description: string;
  /** Prevention shields remaining (for prevention effects) */
  preventionShields?: PreventionShield[];
  /** Whether to apply a different effect instead */
  instead?: boolean;
}

/**
 * Prevention shield - tracks remaining prevention
 */
export interface PreventionShield {
  /** ID of the shield source */
  sourceId: CardInstanceId;
  /** How much damage this shield can prevent */
  amount: number;
  /** What types of damage this applies to */
  damageTypes?: string[];
  /** When the shield expires */
  expiresAt?: number;
}

/**
 * Manages all replacement and prevention effects in the game
 */
export class ReplacementEffectManager {
  private effects: ReplacementAbility[] = [];
  private preventionShields: Map<string, PreventionShield[]> = new Map();

  /**
   * Register a new replacement or prevention ability
   */
  registerEffect(effect: ReplacementAbility): void {
    this.effects.push(effect);
    // Sort by layer for consistent ordering
    this.effects.sort((a, b) => a.layer - b.layer);
  }

  /**
   * Remove effects from a specific source (when card leaves battlefield)
   */
  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter(e => e.sourceCardId !== sourceCardId);
  }

  /**
   * Reset prevention effects that expire
   */
  resetExpiredEffects(gameState: GameState): void {
    const now = Date.now();
    // Remove expired prevention shields
    for (const [key, shields] of this.preventionShields.entries()) {
      const validShields = shields.filter(s => !s.expiresAt || s.expiresAt > now);
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
      }
    }
    
    // Reset per-turn usage for prevention effects
    for (const effect of this.effects) {
      if (effect.effectType === 'damage_prevention' && effect.usedThisTurn !== undefined) {
        // Effects that can only be used once per turn reset here
        // (e.g., "prevent the next 1 damage")
      }
    }
  }

  /**
   * Get active prevention shields for a target
   */
  getPreventionShields(targetId: string | PlayerId): PreventionShield[] {
    return this.preventionShields.get(String(targetId)) || [];
  }

  /**
   * Add a prevention shield
   */
  addPreventionShield(targetId: string | PlayerId, shield: PreventionShield): void {
    const key = String(targetId);
    const existing = this.preventionShields.get(key) || [];
    existing.push(shield);
    this.preventionShields.set(key, existing);
  }

  /**
   * Use part of a prevention shield
   */
  usePreventionShield(targetId: string | PlayerId, amount: number): number {
    const key = String(targetId);
    const shields = this.preventionShields.get(key);
    if (!shields || shields.length === 0) return 0;

    let remaining = amount;
    const validShields: PreventionShield[] = [];

    for (const shield of shields) {
      if (remaining <= 0) {
        validShields.push(shield);
        continue;
      }
      
      if (shield.amount >= remaining) {
        shield.amount -= remaining;
        remaining = 0;
        if (shield.amount > 0) {
          validShields.push(shield);
        }
      } else {
        remaining -= shield.amount;
        // Shield fully used, don't add to valid
      }
    }

    this.preventionShields.set(key, validShields);
    return amount - remaining;
  }

  /**
   * Process an event through all applicable replacement/prevention effects
   * Applies them in the correct order (CR 614.3)
   */
  processEvent(event: ReplacementEvent): ReplacementResult {
    let currentEvent = event;
    let lastDescription = '';

    // Filter effects that can apply to this event type
    const applicableEffects = this.effects.filter(e => {
      // Check if effect type matches
      const typeMatches = this.effectTypeMatches(e.effectType, event.type);
      return typeMatches && e.canApply(event);
    });

    for (const effect of applicableEffects) {
      const result = effect.apply(currentEvent);
      if (result.modified) {
        if (result.modifiedEvent) {
          currentEvent = result.modifiedEvent;
        }
        lastDescription = result.description;
        
        // If "instead" applies, stop processing other replacement effects
        if (result.instead) {
          break;
        }
      }
    }

    return {
      modified: currentEvent.amount !== event.amount || currentEvent !== event,
      modifiedEvent: currentEvent,
      description: lastDescription,
    };
  }

  /**
   * Check if effect type matches event type
   */
  private effectTypeMatches(effectType: ReplacementEffectType, eventType: ReplacementEventType): boolean {
    const mapping: Record<ReplacementEventType, ReplacementEffectType[]> = {
      'damage': ['damage_replacement', 'damage_prevention'],
      'life_gain': ['life_gain_replacement'],
      'life_loss': ['life_loss_replacement'],
      'draw_card': ['draw_replacement'],
      'move_to_graveyard': ['destroy_replacement', 'counter_movement'],
      'exile': ['exile_replacement', 'counter_movement'],
      'destroy': ['destroy_replacement'],
      'create_token': ['token_creation'],
      'add_counter': ['counters'],
      'remove_counter': ['counters'],
    };
    
    return mapping[eventType]?.includes(effectType) ?? false;
  }

  /**
   * Get all registered effects
   */
  getEffects(): ReplacementAbility[] {
    return [...this.effects];
  }

  /**
   * Clear all effects (for new game)
   */
  clear(): void {
    this.effects = [];
    this.preventionShields.clear();
  }
}

// ============================================================
// Common Replacement Effect Factories
// ============================================================

/**
 * Create a damage prevention effect (e.g., "If damage would be dealt to you, prevent it")
 */
export function createDamagePreventionEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  amount: number,
  description: string,
  duration?: 'until_end_of_turn' | 'until_end_of_next_turn' | 'permanent'
): ReplacementAbility {
  return {
    id: `prevention-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'damage_prevention',
    description,
    layer: 0,
    preventionAmount: amount,
    duration,
    canApply: (event) => event.type === 'damage' && event.targetId === controllerId,
    apply: (event) => {
      // Check for existing prevention shields first
      const shields = replacementEffectManager.getPreventionShields(String(controllerId));
      if (shields.length > 0) {
        const prevented = replacementEffectManager.usePreventionShield(controllerId, event.amount);
        return {
          modified: true,
          modifiedEvent: { ...event, amount: event.amount - prevented },
          description: `Prevented ${prevented} damage`,
        };
      }

      // Apply fresh prevention
      const toPrevent = Math.min(event.amount, amount);
      const remaining = event.amount - toPrevent;
      
      // Create a prevention shield if duration is set
      if (duration && remaining > 0) {
        const expiresAt = duration === 'permanent' 
          ? undefined 
          : Date.now() + (duration === 'until_end_of_turn' ? 24 * 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000);
        
        replacementEffectManager.addPreventionShield(controllerId, {
          sourceId: sourceCardId,
          amount: remaining,
          expiresAt,
        });
      }

      return {
        modified: toPrevent > 0,
        modifiedEvent: { ...event, amount: remaining },
        description: `Prevented ${toPrevent} damage`,
      };
    },
  };
}

/**
 * Create a damage redirection effect (e.g., "If a source would deal damage to you, it deals that damage to target creature instead")
 */
export function createDamageRedirectionEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  redirectToId: CardInstanceId | PlayerId,
  description: string
): ReplacementAbility {
  return {
    id: `redirect-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'damage_replacement',
    description,
    layer: 0,
    canApply: (event) => event.type === 'damage' && event.targetId === controllerId,
    apply: (event) => ({
      modified: true,
      modifiedEvent: { ...event, targetId: redirectToId },
      description,
      instead: true,
    }),
  };
}

/**
 * Create a life gain replacement effect (e.g., "If you would gain life, you get that much +1 instead")
 */
export function createLifeGainReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  modifier: number,
  description: string
): ReplacementAbility {
  return {
    id: `life-gain-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'life_gain_replacement',
    description,
    layer: 0,
    canApply: (event) => event.type === 'life_gain',
    apply: (event) => ({
      modified: true,
      modifiedEvent: { ...event, amount: event.amount + modifier },
      description,
      instead: true,
    }),
  };
}

/**
 * Create a destroy replacement effect (e.g., "If a creature would be destroyed, exile it instead")
 */
export function createDestroyReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  replacementAction: 'exile' | 'tap' | 'shuffle_into_library',
  description: string
): ReplacementAbility {
  return {
    id: `destroy-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'destroy_replacement',
    description,
    layer: 0,
    canApply: (event) => event.type === 'destroy',
    apply: (event) => ({
      modified: true,
      modifiedEvent: { ...event, type: replacementAction === 'exile' ? 'exile' : 'move_to_graveyard' },
      description,
      instead: true,
    }),
  };
}

/**
 * Create a replacement effect for drawing cards (e.g., "If you would draw a card, draw two instead")
 */
export function createDrawReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  multiplier: number,
  description: string
): ReplacementAbility {
  return {
    id: `draw-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: 'draw_replacement',
    description,
    layer: 0,
    canApply: (event) => event.type === 'draw_card',
    apply: (event) => ({
      modified: true,
      modifiedEvent: { ...event, amount: event.amount * multiplier },
      description,
      instead: true,
    }),
  };
}

// ============================================================
// Global instance for use throughout the game
// ============================================================

export const replacementEffectManager = new ReplacementEffectManager();
