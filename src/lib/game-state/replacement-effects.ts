/**
 * Replacement and Prevention Effects System
 * 
 * Implements MTG rules for replacement and prevention effects as described in CR 614.
 * - Replacement effects (CR 614.1): Modify how an event happens
 * - Prevention effects (CR 614.2): Prevent damage, etc. from happening
 */

import { CardInstanceId, PlayerId } from './types';

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
  /** Timestamp for ordering multiple effects (CR 613.7) */
  timestamp: number;
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
    // Sort by layer and then timestamp for consistent ordering (CR 613)
    this.sortEffects();
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
  resetExpiredEffects(currentTime: number): void {
    // Remove expired prevention shields
    for (const [key, shields] of this.preventionShields.entries()) {
      const validShields = shields.filter(s => !s.expiresAt || s.expiresAt > currentTime);
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
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
        validShields.push({ ...shield });
        continue;
      }
      
      if (shield.amount >= remaining) {
        const consumed = remaining;
        const newShield = { ...shield, amount: shield.amount - consumed };
        remaining = 0;
        if (newShield.amount > 0) {
          validShields.push(newShield);
        }
      } else {
        remaining -= shield.amount;
        // Shield fully used, don't add to valid
      }
    }

    if (validShields.length === 0) {
      this.preventionShields.delete(key);
    } else {
      this.preventionShields.set(key, validShields);
    }
    
    return amount - remaining;
  }

  /**
   * Process an event through all applicable replacement/prevention effects
   * Applies them in the correct order (CR 616)
   */
  processEvent(event: ReplacementEvent): ReplacementEvent {
    let currentEvent = { ...event };
    const appliedEffectIds = new Set<string>();

    // CR 616.1: If two or more replacement and/or prevention effects are attempting 
    // to modify the way an event affects an object or player, the affected object's 
    // controller (or its owner if it has no controller) or the affected player 
    // chooses one to apply.
    
    // For simplicity, we automatically choose based on MTG rules priorities 
    // or timestamp/layer if equal.

    let possibleEffects = this.getApplicableEffects(currentEvent);

    while (possibleEffects.length > 0) {
      // Choose the "best" effect to apply (simplified)
      // CR 616.1a-e specifies the priority of choice
      const effectToApply = this.chooseBestEffect(possibleEffects, currentEvent);
      
      if (!effectToApply) break;

      const result = effectToApply.apply(currentEvent);
      if (result.modified && result.modifiedEvent) {
        currentEvent = { ...result.modifiedEvent };
        appliedEffectIds.add(effectToApply.id);
        
        // If "instead" applies (event replaced by a different event), 
        // we might need to start over or check new applicable effects
        if (result.instead) {
          // Check if event type changed
          if (currentEvent.type !== event.type) {
            // Event type changed, we should re-evaluate all effects
          }
        }
      }

      // Re-evaluate applicable effects for the modified event
      possibleEffects = this.getApplicableEffects(currentEvent).filter(e => !appliedEffectIds.has(e.id));
    }

    // After all replacement effects, apply prevention shields for damage
    if (currentEvent.type === 'damage' && currentEvent.amount > 0 && currentEvent.targetId) {
      const prevented = this.usePreventionShield(currentEvent.targetId, currentEvent.amount);
      if (prevented > 0) {
        currentEvent.amount -= prevented;
      }
    }

    return currentEvent;
  }

  /**
   * Get all effects that can currently apply to an event
   */
  private getApplicableEffects(event: ReplacementEvent): ReplacementAbility[] {
    return this.effects.filter(e => {
      const typeMatches = this.effectTypeMatches(e.effectType, event.type);
      return typeMatches && e.canApply(event);
    });
  }

  /**
   * Simplified implementation of CR 616.1 ordering rules
   */
  private chooseBestEffect(effects: ReplacementAbility[], event: ReplacementEvent): ReplacementAbility | null {
    if (effects.length === 0) return null;
    
    // Sort by MTG priority (simplified)
    // 1. Self-replacement effects
    // 2. Effects that modify control
    // 3. Effects that modify copy
    // 4. Effects that modify zone
    // 5. Other
    
    // We use the 'layer' property to represent these priorities
    return effects[0]; // Already sorted by layer and timestamp
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
      'move_to_graveyard': ['destroy_replacement'],
      'exile': ['exile_replacement'],
      'destroy': ['destroy_replacement'],
      'create_token': ['token_creation'],
      'add_counter': ['counter_movement', 'counters'],
      'remove_counter': ['counters'],
    };

    return mapping[eventType]?.includes(effectType) || false;
  }

  /**
   * Sort effects by layer and timestamp
   */
  private sortEffects(): void {
    this.effects.sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Reset the manager (for testing)
   */
  reset(): void {
    this.effects = [];
    this.preventionShields.clear();
  }
}

// Global instance for game-wide replacement effect management
export const replacementEffectManager = new ReplacementEffectManager();
