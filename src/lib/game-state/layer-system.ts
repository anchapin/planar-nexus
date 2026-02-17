/**
 * MTG Layer System for Continuous Effects
 *
 * Implements the Magic: The Gathering layer system as described in CR 613.
 * Layers are applied in order, with sublayers for effects within each layer.
 *
 * Layer Order (CR 613.1):
 * - Layer 1: Copy effects (CR 613.2)
 * - Layer 2: Control-changing effects (CR 613.3)
 * - Layer 3: Text-changing effects (CR 613.4)
 * - Layer 4: Type-changing effects (CR 613.5)
 * - Layer 5: Color-changing effects (CR 613.6)
 * - Layer 6: Ability-granting and ability-removing effects (CR 613.7)
 * - Layer 7: Power and toughness changing effects (CR 613.8)
 *   - 7a: Characteristic-defining abilities
 *   - 7b: Effects that set P/T to a specific value
 *   - 7c: Effects that modify P/T (counters)
 *   - 7d: Effects that switch power and toughness
 *   - 7e: Effects that modify P/T without setting
 *
 * @module layer-system
 */

import { CardInstance, CardInstanceId, PlayerId, ScryfallCard } from './types';

/**
 * Layer types in order of application (CR 613.1)
 */
export enum Layer {
  /** Layer 1: Copy effects (CR 613.2) */
  COPY_EFFECTS = 1,
  /** Layer 2: Control-changing effects (CR 613.3) */
  CONTROL_CHANGING = 2,
  /** Layer 3: Text-changing effects (CR 613.4) */
  TEXT_CHANGING = 3,
  /** Layer 4: Type-changing effects (CR 613.5) */
  TYPE_CHANGING = 4,
  /** Layer 5: Color-changing effects (CR 613.6) */
  COLOR_CHANGING = 5,
  /** Layer 6: Ability-granting and ability-removing effects (CR 613.7) */
  ABILITY = 6,
  /** Layer 7: Power and toughness changing effects (CR 613.8) */
  POWER_TOUGHNESS = 7,
}

/**
 * Sublayers for Layer 7 (Power/Toughness) per CR 613.8
 */
export enum PowerToughnessSublayer {
  /** 7a: Characteristic-defining abilities (CR 613.8a) */
  CHARACTERISTIC_DEFINING = '7a',
  /** 7b: Effects that set P/T to a specific value (CR 613.8b) */
  SET = '7b',
  /** 7c: Effects from counters (CR 613.8c) */
  COUNTERS = '7c',
  /** 7d: Effects that switch power and toughness (CR 613.8d) */
  SWITCH = '7d',
  /** 7e: All other P/T modifying effects (CR 613.8e) */
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
 * Dependencies between effects (CR 613.7-613.8)
 * Effects can depend on other effects within the same layer or earlier layers
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
 * Stored overrides for card characteristics after layer application
 */
export interface CardOverrides {
  /** Overridden card types */
  types?: string[];
  /** Overridden card subtypes */
  subtypes?: string[];
  /** Overridden card supertypes */
  supertypes?: string[];
  /** Overridden card text */
  text?: string;
  /** Overridden colors */
  colors?: string[];
  /** Granted abilities */
  grantedAbilities?: string[];
  /** Removed abilities */
  removedAbilities?: string[];
  /** Power set value (Layer 7b) */
  powerSet?: number;
  /** Toughness set value (Layer 7b) */
  toughnessSet?: number;
  /** Whether power/toughness are switched */
  switched?: boolean;
}

/**
 * Manages all continuous effects and applies them in correct order
 *
 * Implements the MTG layer system (CR 613) for continuous effects.
 * Effects are applied in a specific order to ensure consistent game state.
 */
export class LayerSystem {
  private effects: ContinuousEffect[] = [];
  private dependencies: EffectDependency[] = [];
  private cdas: CharacteristicDefiningAbility[] = [];
  private overrides: Map<CardInstanceId, CardOverrides> = new Map();

  /**
   * Register a new continuous effect
   * @param effect - The continuous effect to register
   */
  registerEffect(effect: ContinuousEffect): void {
    this.effects.push(effect);
    this.sortEffects();
  }

  /**
   * Remove effects from a specific source (e.g., when a card leaves battlefield)
   * @param sourceCardId - The ID of the source card
   */
  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter(e => e.sourceCardId !== sourceCardId);
    // Also clear overrides from this source
    for (const [cardId, overrides] of this.overrides.entries()) {
      // In a full implementation, we'd track which effect created which override
      // For now, we clear all overrides when effects are removed
    }
  }

  /**
   * Register a characteristic-defining ability
   * @param cda - The characteristic-defining ability
   */
  registerCDA(cda: CharacteristicDefiningAbility): void {
    this.cdas.push(cda);
    this.sortEffects();
  }

  /**
   * Add dependency between effects (CR 613.7)
   * @param dependency - The dependency relationship
   */
  addDependency(dependency: EffectDependency): void {
    this.dependencies.push(dependency);
  }

  /**
   * Remove dependencies for an effect
   * @param effectId - The ID of the effect
   */
  removeDependencies(effectId: string): void {
    this.dependencies = this.dependencies.filter(
      d => d.effectId !== effectId && d.dependsOnId !== effectId
    );
  }

  /**
   * Get or create overrides for a card
   * @param cardId - The card instance ID
   */
  getOverrides(cardId: CardInstanceId): CardOverrides {
    if (!this.overrides.has(cardId)) {
      this.overrides.set(cardId, {});
    }
    return this.overrides.get(cardId)!;
  }

  /**
   * Clear overrides for a card
   * @param cardId - The card instance ID
   */
  clearOverrides(cardId: CardInstanceId): void {
    this.overrides.delete(cardId);
  }

  /**
   * Check if an effect depends on another effect
   * @param effect - The effect to check
   * @param otherEffect - The potential dependency
   */
  dependsOn(effect: ContinuousEffect, otherEffect: ContinuousEffect): boolean {
    const dependency = this.dependencies.find(d => d.effectId === effect.id);
    if (!dependency) return false;
    return dependency.dependsOnId === otherEffect.id;
  }

  /**
   * Sort effects by layer, timestamp, and dependencies (CR 613.7-613.8)
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

      // Check dependencies (CR 613.7)
      // If a depends on b, b comes first
      if (this.dependsOn(a, b)) return 1;
      if (this.dependsOn(b, a)) return -1;

      // Then by timestamp (CR 613.6, 613.7)
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }

      // Then by priority (for tiebreaking)
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
   * @param card - The card to apply effects to
   * @param layer - The layer to apply
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
   * Sort Layer 7 effects by sublayer (CR 613.8)
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
   * Get effective characteristics of a card after all layer effects
   * @param card - The card instance
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
    grantedAbilities: string[];
    removedAbilities: string[];
  } {
    const modified = this.applyEffects(card);
    const cardData = modified.cardData;
    const overrides = this.getOverrides(card.id);

    // Calculate effective power/toughness considering Layer 7 sublayers
    const { power, toughness } = this.calculateEffectivePT(card, modified);

    return {
      name: modified.isFaceDown && modified.tokenData
        ? modified.tokenData.name
        : cardData.name,
      types: overrides.types || cardData.type_line?.split(' — ')[0]?.split(' ') || [],
      subtypes: overrides.subtypes || cardData.type_line?.split(' — ')[1]?.split(' ') || [],
      supertypes: overrides.supertypes || [],
      text: overrides.text || cardData.oracle_text || '',
      manaCost: cardData.mana_cost || '',
      color: this.getEffectiveColor(card),
      power,
      toughness,
      oracleText: overrides.text || cardData.oracle_text || '',
      grantedAbilities: overrides.grantedAbilities || [],
      removedAbilities: overrides.removedAbilities || [],
    };
  }

  /**
   * Calculate effective power and toughness considering Layer 7 sublayers
   */
  private calculateEffectivePT(card: CardInstance, modified: CardInstance): { power: number | null, toughness: number | null } {
    const overrides = this.getOverrides(card.id);
    const cardData = modified.cardData;

    // Get base P/T from card data
    let basePower = 0;
    let baseToughness = 0;

    if (cardData.power) {
      const powerStr = cardData.power;
      if (powerStr === '*' || powerStr.includes('*')) {
        basePower = 0; // Variable P/T, would need CDA evaluation
      } else {
        basePower = parseInt(powerStr, 10) || 0;
      }
    }

    if (cardData.toughness) {
      const toughnessStr = cardData.toughness;
      if (toughnessStr === '*' || toughnessStr.includes('*')) {
        baseToughness = 0;
      } else {
        baseToughness = parseInt(toughnessStr, 10) || 0;
      }
    }

    // Layer 7b: P/T setting effects override base values
    let power = overrides.powerSet !== undefined ? overrides.powerSet : basePower;
    let toughness = overrides.toughnessSet !== undefined ? overrides.toughnessSet : baseToughness;

    // Layer 7d: Switch power and toughness
    if (overrides.switched) {
      [power, toughness] = [toughness, power];
    }

    // Layer 7e: P/T modifications
    power += modified.powerModifier || 0;
    toughness += modified.toughnessModifier || 0;

    return { power, toughness };
  }

  /**
   * Get effective color of a card
   * @param card - The card instance
   */
  getEffectiveColor(card: CardInstance): string[] {
    const modified = this.applyEffects(card);
    const overrides = this.getOverrides(card.id);

    // Check for color override first
    if (overrides.colors) {
      return [...overrides.colors];
    }

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
      if (effect.canApply(modified)) {
        const result = effect.apply(modified);
        // The effect should set colors directly via _effectiveColors
        if ((result as any)._effectiveColors) {
          colors = (result as any)._effectiveColors;
        }
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
   * Get all dependencies
   */
  getDependencies(): EffectDependency[] {
    return [...this.dependencies];
  }

  /**
   * Clear all effects and overrides (for new game)
   */
  clear(): void {
    this.effects = [];
    this.dependencies = [];
    this.cdas = [];
    this.overrides.clear();
  }
}

// ============================================================
// Effect Factory Functions
// ============================================================

/**
 * Create a copy effect (Layer 1 - CR 613.2)
 * Copy effects are applied first and cause the object to copy characteristics
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
      // Copy effect would copy characteristics from the copied card
      // Full implementation would reference the copied card's data
      _copiedFrom: copiedCardId,
    }),
  };
}

/**
 * Create a control-changing effect (Layer 2 - CR 613.3)
 * Changes who controls the permanent
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
 * Create a text-changing effect (Layer 3 - CR 613.4)
 * Changes the oracle text of a card (e.g., Mind Bend, Volrath's Shapeshifter)
 */
export function createTextChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  newText: string,
  description: string,
  addTypes?: boolean,
  layerSystemInstance?: LayerSystem
): ContinuousEffect {
  return {
    id: `text-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.TEXT_CHANGING,
    effectType: 'text_change',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.text = newText;
      return { ...card };
    },
  };
}

/**
 * Create a type-changing effect (Layer 4 - CR 613.5)
 * Changes the card types, subtypes, and/or supertypes (e.g., Dryad of the Ilysian Grove)
 */
export function createTypeChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  types: string[],
  subtypes: string[] = [],
  supertypes: string[] = [],
  description: string,
  addTypes: boolean = false, // If true, adds to existing types; if false, replaces
  layerSystemInstance?: LayerSystem
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
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (addTypes) {
        // Add to existing types
        overrides.types = [...new Set([...(overrides.types || []), ...types])];
        overrides.subtypes = [...new Set([...(overrides.subtypes || []), ...subtypes])];
        overrides.supertypes = [...new Set([...(overrides.supertypes || []), ...supertypes])];
      } else {
        // Replace types
        overrides.types = types;
        overrides.subtypes = subtypes;
        overrides.supertypes = supertypes;
      }

      return { ...card };
    },
  };
}

/**
 * Create a color-changing effect (Layer 5 - CR 613.6)
 * Changes the color of a card (e.g., Painters Servant, Chromatic Armor)
 */
export function createColorChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  colors: string[],
  description: string,
  addColors: boolean = false, // If true, adds to existing colors; if false, replaces
  layerSystemInstance?: LayerSystem
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
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (addColors) {
        overrides.colors = [...new Set([...(overrides.colors || []), ...colors])];
      } else {
        overrides.colors = colors;
      }

      return { ...card };
    },
  };
}

/**
 * Create an ability-granting effect (Layer 6 - CR 613.7)
 * Grants abilities to a card (e.g., "Creatures you control have flying")
 */
export function createAbilityGrantEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  ability: string,
  description: string,
  layerSystemInstance?: LayerSystem
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
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (!overrides.grantedAbilities) {
        overrides.grantedAbilities = [];
      }
      if (!overrides.grantedAbilities.includes(ability)) {
        overrides.grantedAbilities.push(ability);
      }

      return { ...card };
    },
  };
}

/**
 * Create an ability-removing effect (Layer 6 - CR 613.7)
 * Removes abilities from a card (e.g., "Target creature loses all abilities")
 */
export function createAbilityRemoveEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  ability: string,
  description: string,
  removeAll: boolean = false,
  layerSystemInstance?: LayerSystem
): ContinuousEffect {
  return {
    id: `ability-remove-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.ABILITY,
    effectType: 'ability_remove',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (removeAll) {
        // Mark that all abilities should be removed
        overrides.removedAbilities = ['*'];
      } else {
        if (!overrides.removedAbilities) {
          overrides.removedAbilities = [];
        }
        if (!overrides.removedAbilities.includes(ability)) {
          overrides.removedAbilities.push(ability);
        }
      }

      return { ...card };
    },
  };
}

/**
 * Create a power/toughness setting effect (Layer 7b - CR 613.8b)
 * Sets P/T to a specific value (e.g., "Target creature is 0/1")
 */
export function createPowerToughnessSetEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  power: number,
  toughness: number,
  description: string,
  layerSystemInstance?: LayerSystem
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
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.powerSet = power;
      overrides.toughnessSet = toughness;
      return { ...card };
    },
  };
}

/**
 * Create a power setting effect only (Layer 7b - CR 613.8b)
 */
export function createPowerSetEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  power: number,
  description: string,
  layerSystemInstance?: LayerSystem
): ContinuousEffect {
  return {
    id: `p-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: 'power_set',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.powerSet = power;
      return { ...card };
    },
  };
}

/**
 * Create a toughness setting effect only (Layer 7b - CR 613.8b)
 */
export function createToughnessSetEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  toughness: number,
  description: string,
  layerSystemInstance?: LayerSystem
): ContinuousEffect {
  return {
    id: `t-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: 'toughness_set',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.toughnessSet = toughness;
      return { ...card };
    },
  };
}

/**
 * Create a power/toughness modification effect (Layer 7e - CR 613.8e)
 * Modifies P/T by a delta (e.g., "Creatures you control get +2/+2")
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
 * Create a power modification effect only (Layer 7e - CR 613.8e)
 */
export function createPowerModifyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  powerDelta: number,
  description: string
): ContinuousEffect {
  return {
    id: `p-mod-${sourceCardId}-${Date.now()}`,
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
    }),
  };
}

/**
 * Create a toughness modification effect only (Layer 7e - CR 613.8e)
 */
export function createToughnessModifyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  toughnessDelta: number,
  description: string
): ContinuousEffect {
  return {
    id: `t-mod-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.MODIFY,
    effectType: 'toughness_modify',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => ({
      ...card,
      toughnessModifier: (card.toughnessModifier || 0) + toughnessDelta,
    }),
  };
}

/**
 * Create a power/toughness switch effect (Layer 7d - CR 613.8d)
 * Switches power and toughness (e.g., Inside Out)
 */
export function createPowerToughnessSwitchEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  layerSystemInstance?: LayerSystem
): ContinuousEffect {
  return {
    id: `pt-switch-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SWITCH,
    effectType: 'power_toughness_switch',
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.switched = true;
      return { ...card };
    },
  };
}

/**
 * Create a characteristic-defining ability effect (Layer 7a - CR 613.8a)
 * CDAs define characteristics and apply before other P/T effects
 */
export function createCharacteristicDefiningAbility(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  cda: CharacteristicDefiningAbility,
  description: string,
  layerSystemInstance?: LayerSystem
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
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (typeof cda.power === 'number') {
        overrides.powerSet = cda.power;
      }
      if (typeof cda.toughness === 'number') {
        overrides.toughnessSet = cda.toughness;
      }
      if (cda.color) {
        overrides.colors = cda.color;
      }
      if (cda.types) {
        overrides.types = cda.types;
      }

      return { ...card };
    },
  };
}

// ============================================================
// Global instance
// ============================================================

export const layerSystem = new LayerSystem();

/**
 * Get the global layer system instance
 * This is a helper function for effect factories to access the layer system
 */
export function getLayerSystemInstance(): LayerSystem {
  return layerSystem;
}
