/**
 * MTG Layer System for Continuous Effects
 * 
 * Implements the Magic: The Gathering layer system as described in CR 613.
 * Layers are applied in order, with sublayers for effects within each layer.
 * 
 * Layer Order:
 * - Layer 1: Copy effects
 * - Layer 2: Control-changing effects
 * - Layer 3: Text-changing effects
 * - Layer 4: Type-changing effects
 * - Layer 5: Color-changing effects
 * - Layer 6: Ability-granting and ability-removing effects
 * - Layer 7: Power and toughness changing effects
 */

import { CardInstance, CardInstanceId, PlayerId, ScryfallCard } from './types';

/**
 * Layer types in order of application
 */
export enum Layer {
  /** Layer 1: Copy effects (clone, copy, etc.) */
  COPY_EFFECTS = 1,
  /** Layer 2: Control-changing effects */
  CONTROL_CHANGING = 2,
  /** Layer 3: Text-changing effects */
  TEXT_CHANGING = 3,
  /** Layer 4: Type-changing effects */
  TYPE_CHANGING = 4,
  /** Layer 5: Color-changing effects */
  COLOR_CHANGING = 5,
  /** Layer 6: Ability-granting and ability-removing effects */
  ABILITY = 6,
  /** Layer 7: Power and toughness changing effects */
  POWER_TOUGHNESS = 7,
}

/**
 * Sublayers for Layer 7 (Power/Toughness)
 */
export enum PowerToughnessSublayer {
  /** 7a: Characteristic-defining abilities */
  CHARACTERISTIC_DEFINING = '7a',
  /** 7b: P/T setting effects */
  SET = '7b',
  /** 7c: P/T counters */
  COUNTERS = '7c',
  /** 7d: P/T switching */
  SWITCH = '7d',
  /** 7e: Other modifications */
  MODIFY = '7e',
}

/**
 * A continuous effect that applies to a card
 */
export interface ContinuousEffect {
  /** Unique identifier */
  id: string;
  /** Layer this effect applies in */
  layer: Layer;
  /** Sublayer (for Layer 7) */
  sublayer?: PowerToughnessSublayer;
  /** ID of the source card */
  sourceCardId: CardInstanceId;
  /** Controller of the effect */
  controllerId: PlayerId;
  /** Type of effect */
  effectType: ContinuousEffectType;
  /** Description for debugging */
  description: string;
  /** Timestamp for ordering effects in same layer */
  timestamp: number;
  /** Priority within layer (lower = earlier) */
  priority: number;
  /** Effect application function */
  apply: (card: CardInstance) => CardInstance;
  /** Can this effect apply to the given card */
  canApply: (card: CardInstance) => boolean;
}

/**
 * Types of continuous effects
 */
export type ContinuousEffectType = 
  | 'copy'
  | 'control_change'
  | 'text_change'
  | 'type_change'
  | 'color_change'
  | 'ability_grant'
  | 'ability_remove'
  | 'power_set'
  | 'power_modify'
  | 'toughness_set'
  | 'toughness_modify'
  | 'power_toughness_switch'
  | 'characteristic_defining';

/**
 * Characteristic-defining ability (CDA) - applies in Layer 7a
 */
export interface CharacteristicDefiningAbility {
  /** Oracle ID */
  oracleId: string;
  /** Defines power (or function) */
  power?: number | ((card: CardInstance) => number);
  /** Defines toughness (or function) */
  toughness?: number | ((card: CardInstance) => number);
  /** Defines color */
  color?: string[];
  /** Defines types */
  types?: string[];
  /** Defines text */
  text?: string;
}

/**
 * Dependencies between effects
 */
export interface EffectDependency {
  /** The effect that depends on another */
  effectId: string;
  /** The effect it depends on */
  dependsOnId: string;
  /** Type of dependency */
  dependencyType: 'after' | 'before' | 'same_layer';
}

/**
 * Manages all continuous effects and applies them in correct order
 */
export class LayerSystem {
  private effects: ContinuousEffect[] = [];
  private dependencies: EffectDependency[] = [];
  private cdas: CharacteristicDefiningAbility[] = [];

  /**
   * Register a new continuous effect
   */
  registerEffect(effect: ContinuousEffect): void {
    this.effects.push(effect);
    this.sortEffects();
  }

  /**
   * Remove effects from a specific source
   */
  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter(e => e.sourceCardId !== sourceCardId);
  }

  /**
   * Register a characteristic-defining ability
   */
  registerCDA(cda: CharacteristicDefiningAbility): void {
    this.cdas.push(cda);
    this.sortEffects();
  }

  /**
   * Add dependency between effects
   */
  addDependency(dependency: EffectDependency): void {
    this.dependencies.push(dependency);
  }

  /**
   * Sort effects by layer and timestamp
   */
  private sortEffects(): void {
    this.effects.sort((a, b) => {
      // First sort by layer
      if (a.layer !== b.layer) {
        return a.layer - b.layer;
      }
      
      // Then by sublayer (for Layer 7)
      if (a.layer === Layer.POWER_TOUGHNESS && a.sublayer && b.sublayer) {
        const sublayerOrder = [
          PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
          PowerToughnessSublayer.SET,
          PowerToughnessSublayer.COUNTERS,
          PowerToughnessSublayer.SWITCH,
          PowerToughnessSublayer.MODIFY,
        ];
        const aIndex = sublayerOrder.indexOf(a.sublayer);
        const bIndex = sublayerOrder.indexOf(b.sublayer);
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
      
      // Then by timestamp
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      
      // Then by priority
      return a.priority - b.priority;
    });
  }

  /**
   * Apply all continuous effects to a card
   * Returns a new CardInstance with all modifications applied
   */
  applyEffects(card: CardInstance): CardInstance {
    let modifiedCard = { ...card };

    // Apply effects layer by layer
    for (let layer = 1; layer <= 7; layer++) {
      modifiedCard = this.applyLayer(modifiedCard, layer as Layer);
    }

    return modifiedCard;
  }

  /**
   * Apply effects from a specific layer
   */
  private applyLayer(card: CardInstance, layer: Layer): CardInstance {
    let result = { ...card };

    // Get effects for this layer
    const layerEffects = this.effects.filter(e => e.layer === layer);

    // For Layer 7, also filter by sublayer
    const sortedEffects = layer === Layer.POWER_TOUGHNESS
      ? this.sortLayer7Effects(layerEffects)
      : layerEffects;

    for (const effect of sortedEffects) {
      if (effect.canApply(result)) {
        result = effect.apply(result);
      }
    }

    return result;
  }

  /**
   * Sort Layer 7 effects by sublayer
   */
  private sortLayer7Effects(effects: ContinuousEffect[]): ContinuousEffect[] {
    const sublayerOrder = [
      PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
      PowerToughnessSublayer.SET,
      PowerToughnessSublayer.COUNTERS,
      PowerToughnessSublayer.SWITCH,
      PowerToughnessSublayer.MODIFY,
    ];

    return effects.sort((a, b) => {
      const aIndex = a.sublayer ? sublayerOrder.indexOf(a.sublayer) : 999;
      const bIndex = b.sublayer ? sublayerOrder.indexOf(b.sublayer) : 999;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Get effective characteristics of a card
   */
  getEffectiveCharacteristics(card: CardInstance): {
    name: string;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    text: string;
    manaCost: string;
    color: string[];
    power: number | null;
    toughness: number | null;
    oracleText: string;
  } {
    const modified = this.applyEffects(card);
    const cardData = modified.cardData;

    return {
      name: modified.isFaceDown && modified.tokenData 
        ? modified.tokenData.name 
        : cardData.name,
      types: cardData.type_line?.split(' — ')[0]?.split(' ') || [],
      subtypes: cardData.type_line?.split(' — ')[1]?.split(' ') || [],
      supertypes: [],
      text: cardData.oracle_text || '',
      manaCost: cardData.mana_cost || '',
      color: this.getEffectiveColor(card),
      power: modified.powerModifier !== undefined ? modified.powerModifier : null,
      toughness: modified.toughnessModifier !== undefined ? modified.toughnessModifier : null,
      oracleText: cardData.oracle_text || '',
    };
  }

  /**
   * Get effective color of a card
   */
  getEffectiveColor(card: CardInstance): string[] {
    const modified = this.applyEffects(card);
    
    // Start with base color from card data
    let colors: string[] = [];
    if (modified.cardData.colors) {
      colors = [...modified.cardData.colors];
    }

    // Apply color-changing effects (Layer 5)
    const colorEffects = this.effects.filter(
      e => e.layer === Layer.COLOR_CHANGING && e.canApply(modified)
    );

    for (const effect of colorEffects) {
      const result = effect.apply(modified);
      // The effect should set colors directly
      if ((result as any)._effectiveColors) {
        colors = (result as any)._effectiveColors;
      }
    }

    return colors;
  }

  /**
   * Get all active effects
   */
  getEffects(): ContinuousEffect[] {
    return [...this.effects];
  }

  /**
   * Clear all effects (for new game)
   */
  clear(): void {
    this.effects = [];
    this.dependencies = [];
    this.cdas = [];
  }
}

// ============================================================
// Effect Factory Functions
// ============================================================

/**
 * Create a copy effect (Layer 1)
 */
export function createCopyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  copiedCardId: CardInstanceId,
  description: string
): ContinuousEffect {
  return {
    id: `copy-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.COPY_EFFECTS,
    effectType: 'copy',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: (card) => card.id === sourceCardId,
    apply: (card) => ({
      ...card,
      // Copy characteristics from the copied card
      // This would reference the copied card's data
    }),
  };
}

/**
 * Create a control-changing effect (Layer 2)
 */
export function createControlChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  newControllerId: PlayerId,
  description: string
): ContinuousEffect {
  return {
    id: `control-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.CONTROL_CHANGING,
    effectType: 'control_change',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: (card) => card.controllerId === controllerId,
    apply: (card) => ({
      ...card,
      controllerId: newControllerId,
    }),
  };
}

/**
 * Create a type-changing effect (Layer 4)
 */
export function createTypeChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  types: string[],
  subtypes: string[],
  description: string
): ContinuousEffect {
  return {
    id: `type-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.TYPE_CHANGING,
    effectType: 'type_change',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      // Type changes would modify the effective types
      // This requires storing the override separately
    }),
  };
}

/**
 * Create a color-changing effect (Layer 5)
 */
export function createColorChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  colors: string[],
  description: string
): ContinuousEffect {
  return {
    id: `color-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.COLOR_CHANGING,
    effectType: 'color_change',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      _effectiveColors: colors,
    } as any),
  };
}

/**
 * Create an ability-granting effect (Layer 6)
 */
export function createAbilityGrantEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  ability: string,
  description: string
): ContinuousEffect {
  return {
    id: `ability-grant-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.ABILITY,
    effectType: 'ability_grant',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      // Grant ability - would need ability tracking on card
    }),
  };
}

/**
 * Create a power/toughness setting effect (Layer 7b)
 */
export function createPowerToughnessSetEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  power: number,
  toughness: number,
  description: string
): ContinuousEffect {
  return {
    id: `pt-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: 'power_set',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      powerModifier: power,
      toughnessModifier: toughness,
    }),
  };
}

/**
 * Create a power/toughness modification effect (Layer 7e)
 */
export function createPowerToughnessModifyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  powerDelta: number,
  toughnessDelta: number,
  description: string
): ContinuousEffect {
  return {
    id: `pt-mod-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.MODIFY,
    effectType: 'power_modify',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      powerModifier: (card.powerModifier || 0) + powerDelta,
      toughnessModifier: (card.toughnessModifier || 0) + toughnessDelta,
    }),
  };
}

/**
 * Create a characteristic-defining ability effect (Layer 7a)
 */
export function createCharacteristicDefiningAbility(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  cda: CharacteristicDefiningAbility,
  description: string
): ContinuousEffect {
  return {
    id: `cda-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
    effectType: 'characteristic_defining',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      let result = { ...card };
      if (typeof cda.power === 'number') {
        result.powerModifier = cda.power;
      }
      if (typeof cda.toughness === 'number') {
        result.toughnessModifier = cda.toughness;
      }
      return result;
    },
  };
}

// ============================================================
// Global instance
// ============================================================

export const layerSystem = new LayerSystem();
