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

import type { ScryfallCard } from "@/app/actions";
import { CardInstance, CardInstanceId, PlayerId } from "./types";

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
  CHARACTERISTIC_DEFINING = "7a",
  /** 7b: Effects that set P/T to a specific value (CR 613.8b) */
  SET = "7b",
  /** 7c: Effects from counters (CR 613.8c) */
  COUNTERS = "7c",
  /** 7d: Effects that switch power and toughness (CR 613.8d) */
  SWITCH = "7d",
  /** 7e: All other P/T modifying effects (CR 613.8e) */
  MODIFY = "7e",
}

/**
 * CR 613.8 Layer 7 sublayer dependency graph
 *
 * Dependencies per CR 613.8 (earlier sublayer depends on later ones):
 * - 7a (CDA) depends on 7b, 7c, 7d, 7e (must apply before them, later effects can modify it)
 * - 7b (Set P/T) depends on 7c, 7d, 7e (must apply before them)
 * - 7c (Counters) depends on 7d, 7e (must apply before them)
 * - 7d (Switch P/T) depends on 7e (must apply before it)
 * - 7e (Modify P/T) depends on nothing
 *
 * In dependency graph terms: earlier -> later (earlier can reach later)
 * This creates a partial order: 7a -> 7b -> 7c -> 7d -> 7e
 */
export const LAYER_7_SUBLAYER_DEPENDENCIES: ReadonlyMap<
  PowerToughnessSublayer,
  PowerToughnessSublayer[]
> = new Map([
  // CR 613.8: Earlier sublayers must apply BEFORE later ones (dependence flows down)
  // 7a (CDA) depends on nothing - applies first, later effects can modify it
  [PowerToughnessSublayer.CHARACTERISTIC_DEFINING, []],
  // 7b (Set P/T) depends on 7c, 7d, 7e - must apply before counters/switch/modify
  [
    PowerToughnessSublayer.SET,
    [
      PowerToughnessSublayer.COUNTERS,
      PowerToughnessSublayer.SWITCH,
      PowerToughnessSublayer.MODIFY,
    ],
  ],
  // 7c (Counters) depends on 7d, 7e - must apply before switch/modify
  [
    PowerToughnessSublayer.COUNTERS,
    [PowerToughnessSublayer.SWITCH, PowerToughnessSublayer.MODIFY],
  ],
  // 7d (Switch P/T) depends on 7e - must apply before modify
  [PowerToughnessSublayer.SWITCH, [PowerToughnessSublayer.MODIFY]],
  // 7e (Modify P/T) depends on nothing - applies last
  [PowerToughnessSublayer.MODIFY, []],
]);

/**
 * Get the sublayers that a given sublayer depends on (CR 613.8)
 * A sublayer "depends on" sublayers that apply after it (later in order).
 * This is the reverse of the application order.
 */
export function getSublayerDependencies(
  sublayer: PowerToughnessSublayer,
): PowerToughnessSublayer[] {
  const sublayerOrder = [
    PowerToughnessSublayer.CHARACTERISTIC_DEFINING, // 7a - applies first
    PowerToughnessSublayer.SET, // 7b - applies second
    PowerToughnessSublayer.COUNTERS, // 7c - applies third
    PowerToughnessSublayer.SWITCH, // 7d - applies fourth
    PowerToughnessSublayer.MODIFY, // 7e - applies last
  ];

  const sublayerIndex = sublayerOrder.indexOf(sublayer);

  // 7e (last) and invalid sublayers depend on nothing
  if (sublayerIndex >= sublayerOrder.length - 1) {
    return [];
  }

  // This sublayer depends on all sublayers that come AFTER it (higher index)
  // because those apply later and can modify the result
  return sublayerOrder.slice(sublayerIndex + 1);
}

/**
 * Get the sublayers that must apply before a given sublayer (reverse dependencies)
 * These are the sublayers that depend on this one.
 */
export function getSublayersDependingOn(
  sublayer: PowerToughnessSublayer,
): PowerToughnessSublayer[] {
  const sublayerOrder = [
    PowerToughnessSublayer.CHARACTERISTIC_DEFINING, // 7a - applies first
    PowerToughnessSublayer.SET, // 7b - applies second
    PowerToughnessSublayer.COUNTERS, // 7c - applies third
    PowerToughnessSublayer.SWITCH, // 7d - applies fourth
    PowerToughnessSublayer.MODIFY, // 7e - applies last
  ];

  const sublayerIndex = sublayerOrder.indexOf(sublayer);

  // 7a (first) or invalid - nothing depends on it (everything else is later)
  if (sublayerIndex <= 0) {
    return [];
  }

  // All sublayers that come BEFORE this one (lower index) depend on it
  // because this sublayer applies later and can modify their results
  return sublayerOrder.slice(0, sublayerIndex);
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
  | "copy"
  | "control_change"
  | "text_change"
  | "type_change"
  | "color_change"
  | "ability_grant"
  | "ability_remove"
  | "power_set"
  | "power_modify"
  | "toughness_set"
  | "toughness_modify"
  | "power_toughness_switch"
  | "characteristic_defining"
  | "counter";

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
  dependencyType: "after" | "before" | "same_layer";
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
  /**
   * Origin layer for color changes (CR 613.4/613.5 exception)
   * When a type-changing effect also changes color simultaneously,
   * the color change origin layer is tracked to ensure proper layer ordering.
   * Per CR 613.5: if an effect changes color AND type simultaneously,
   * the color change happens in Layer 4 and type change in Layer 4.
   * Per CR 613.4: if a Layer 3 text-changing effect changes color
   * and type simultaneously, the color change happens in Layer 4.
   */
  colorChangeOriginLayer?: Layer;
  /** Granted abilities */
  grantedAbilities?: string[];
  /** Removed abilities */
  removedAbilities?: string[];
  /** Power set value (Layer 7b) */
  powerSet?: number;
  /** Toughness set value (Layer 7b) */
  toughnessSet?: number;
  /**
   * Power from Characteristic-Defining Ability (Layer 7a - CR 613.8a)
   * CDAs set P/T before Layer 7b effects, but Layer 7b effects can override them (CR 613.8b)
   */
  powerCDA?: number;
  /**
   * Toughness from Characteristic-Defining Ability (Layer 7a - CR 613.8a)
   * CDAs set P/T before Layer 7b effects, but Layer 7b effects can override them (CR 613.8b)
   */
  toughnessCDA?: number;
  /** Whether power/toughness are switched */
  switched?: boolean;
  /** Controller ID (Layer 2 - CR 613.3) */
  controllerId?: PlayerId;
  /**
   * Controller history stack for gain-control effects (Layer 2 - CR 613.3)
   * When multiple control-changing effects apply, we track each controller change
   * so they can be properly removed in reverse order.
   * Each entry is { controllerId, sourceCardId } for proper cleanup.
   */
  controllerHistory?: Array<{
    controllerId: PlayerId;
    sourceCardId: CardInstanceId;
  }>;
  /** Card ID that this card copies (Layer 1 - CR 613.2) */
  copiedFromId?: CardInstanceId;
  /**
   * Card data copied from the source card (Layer 1 - CR 613.2)
   * When a copy effect applies, we store the copied card's data here
   * so we can use it to resolve effective characteristics.
   */
  copiedCardData?: ScryfallCard;
  /**
   * Whether this copy effect is from mutate (CR 702.140)
   * Mutate creates a merged permanent that copies the target but gains the mutate card's abilities.
   */
  isMutateCopy?: boolean;
  /**
   * For mutate copy effects: whether the resulting permanent is a creature.
   * Per CR 702.140: if the target is a creature, the result is a creature.
   * If the target is not a creature, the result is not a creature.
   */
  mutateResultIsCreature?: boolean;
}

/**
 * Internal interface for card instance with effective colors
 * Used by color-changing effects to communicate color changes
 */
interface CardInstanceWithEffectiveColors extends CardInstance {
  /** Internal property set by color-changing effects */
  _effectiveColors?: string[];
}

/**
 * Resolve the copy chain for a card (CR 613.2 - Layer 1)
 *
 * When a card copies another card that is itself copying a third card,
 * we need to resolve the ultimate source of the copy effect.
 *
 * Per CR 707.2: When copying an object, you copy the copiable values
 * of that object as resolved, which includes any copy effects affecting it.
 *
 * @param cardId - The card ID to resolve the copy chain for
 * @param layerSystem - The layer system instance
 * @param visited - Set of already-visited card IDs (for cycle detection)
 * @returns The ultimate card being copied, or undefined if not copying
 */
export function resolveCopyChain(
  cardId: CardInstanceId,
  layerSystem: LayerSystem,
  visited: Set<CardInstanceId> = new Set(),
):
  | { cardId: CardInstanceId; cardData: ScryfallCard; isMutated: boolean }
  | undefined {
  // Cycle detection
  if (visited.has(cardId)) {
    // Found a cycle - return the card as-is to avoid infinite loop
    // Per CR 613.2, timestamp ordering handles which copy effect applies
    const card = layerSystem.getCardInstanceById(cardId);
    if (card) {
      return { cardId, cardData: card.cardData, isMutated: card.isMutated };
    }
    return undefined;
  }

  visited.add(cardId);

  const overrides = layerSystem.getOverrides(cardId);

  // If this card has a copy effect applied, follow the chain
  if (overrides.copiedFromId) {
    const copiedCard = layerSystem.getCardInstanceById(overrides.copiedFromId);
    if (copiedCard) {
      // Recursively resolve the chain
      const resolved = resolveCopyChain(
        overrides.copiedFromId,
        layerSystem,
        visited,
      );
      if (resolved) {
        return resolved;
      }
    }
    // Fallback: return the directly copied card
    return {
      cardId: overrides.copiedFromId,
      cardData: (overrides.copiedCardData ?? copiedCard?.cardData)!,
      isMutated: copiedCard?.isMutated || false,
    };
  }

  // This card is not copying anything - return its own data
  const card = layerSystem.getCardInstanceById(cardId);
  if (card) {
    return { cardId, cardData: card.cardData, isMutated: card.isMutated };
  }

  return undefined;
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
   * Card instances map for copy effect resolution (Layer 1 - CR 613.2)
   * This allows the layer system to look up card data when resolving copy effects.
   */
  private cardInstances: Map<CardInstanceId, CardInstance> = new Map();

  /**
   * Cache for effective characteristics per card.
   * Maps card ID to cached result with state hash for invalidation.
   */
  private effectiveCharacteristicsCache: Map<
    CardInstanceId,
    {
      stateHash: string;
      characteristics: ReturnType<LayerSystem["getEffectiveCharacteristics"]>;
    }
  > = new Map();

  /**
   * Compute a state hash based on all registered effects, dependencies, and overrides.
   * This hash uniquely identifies the current state that affects card characteristics.
   * Cache entries are invalidated when the state hash changes.
   */
  computeStateHash(): string {
    const stateParts: string[] = [];

    // Add effect signatures (layer, sublayer, source, timestamp)
    for (const effect of this.effects) {
      stateParts.push(
        `e:${effect.layer}:${effect.sublayer || ""}:${effect.sourceCardId}:${effect.controllerId}:${effect.timestamp}`,
      );
    }

    // Add dependencies
    for (const dep of this.dependencies) {
      stateParts.push(
        `d:${dep.effectId}:${dep.dependsOnId}:${dep.dependencyType}`,
      );
    }

    // Add overrides
    for (const [cardId, override] of this.overrides) {
      stateParts.push(`o:${cardId}:${JSON.stringify(override)}`);
    }

    // Add CDAs
    for (const cda of this.cdas) {
      stateParts.push(`cda:${cda.oracleId}`);
    }

    // Simple hash using JSON stringify (sufficient for game state)
    // In production, a more sophisticated hash could be used
    return JSON.stringify(stateParts);
  }

  /**
   * Invalidate cache entries for a specific card, or all cards if no card ID provided.
   * @param cardId - Optional card ID to invalidate. If not provided, all cache entries are cleared.
   */
  private invalidateCache(cardId?: CardInstanceId): void {
    if (cardId !== undefined) {
      this.effectiveCharacteristicsCache.delete(cardId);
    } else {
      this.effectiveCharacteristicsCache.clear();
    }
  }

  /**
   * Register a new continuous effect
   * @param effect - The continuous effect to register
   */
  registerEffect(effect: ContinuousEffect): void {
    this.effects.push(effect);
    this.sortEffects();
    this.invalidateCache();
  }

  /**
   * Remove effects from a specific source (e.g., when a card leaves battlefield)
   * @param sourceCardId - The ID of the source card
   */
  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter((e) => e.sourceCardId !== sourceCardId);
    // Also clear overrides from this source
    // In a full implementation, we'd track which effect created which override
    // For now, overrides are cleared when effects are removed via clearOverrides()
    this.invalidateCache();
  }

  /**
   * Register a characteristic-defining ability
   * @param cda - The characteristic-defining ability
   */
  registerCDA(cda: CharacteristicDefiningAbility): void {
    this.cdas.push(cda);
    this.sortEffects();
    this.invalidateCache();
  }

  /**
   * Add dependency between effects (CR 613.7)
   * @param dependency - The dependency relationship
   * @returns true if dependency was added, false if it would create a cycle
   */
  addDependency(dependency: EffectDependency): boolean {
    // Use enhanced cycle detection that considers Layer 7 sublayers
    if (
      this.wouldCreateCycleWithSublayers(
        dependency.effectId,
        dependency.dependsOnId,
      )
    ) {
      console.warn(
        `[LayerSystem] Rejected dependency ${dependency.effectId} -> ${dependency.dependsOnId}: would create cycle (CR 613.7c/613.8)`,
      );
      return false;
    }
    this.dependencies.push(dependency);
    // Re-sort effects to account for the new dependency
    this.sortEffects();
    this.invalidateCache();
    return true;
  }

  /**
   * Check if adding a dependency between Layer 7 sublayers would create a cycle
   * considering both explicit dependencies and the implicit sublayer ordering (CR 613.8)
   *
   * The implicit sublayer ordering creates a partial order:
   * 7a -> 7b -> 7c -> 7d -> 7e
   * (7a applies first, then 7b, etc.)
   *
   * This means if we have effects in different sublayers:
   * - An effect in an earlier sublayer (e.g., 7a) depending on one in a later sublayer (e.g., 7e)
   *   would NOT create a cycle via sublayer ordering alone.
   * - But two effects in the SAME sublayer creating mutual dependencies WOULD create a cycle.
   *
   * @param effectId - The effect that would depend on another
   * @param dependsOnId - The effect it would depend on
   * @returns true if adding the dependency would create a cycle
   */
  wouldCreateCycleWithSublayers(
    effectId: string,
    dependsOnId: string,
  ): boolean {
    // Self-referential dependency is a cycle
    if (effectId === dependsOnId) {
      return true;
    }

    const effect = this.effects.find((e) => e.id === effectId);
    const dependsOn = this.effects.find((e) => e.id === dependsOnId);

    // If either effect is not found, fall back to basic cycle check
    if (!effect || !dependsOn) {
      return this.wouldCreateCycle(effectId, dependsOnId);
    }

    // If both effects are in Layer 7, we need to check for same-sublayer cycles
    if (
      effect.layer === Layer.POWER_TOUGHNESS &&
      dependsOn.layer === Layer.POWER_TOUGHNESS
    ) {
      // Same sublayer: mutual dependency is a cycle
      if (effect.sublayer === dependsOn.sublayer) {
        // Check if the dependency already exists in the opposite direction
        const existingReverseDep = this.dependencies.find(
          (d) => d.effectId === dependsOnId && d.dependsOnId === effectId,
        );
        if (existingReverseDep) {
          // Mutual dependency in same sublayer - cycle
          return true;
        }
      }
    }

    // For different sublayers or non-Layer-7 effects, use standard cycle detection
    return this.wouldCreateCycle(effectId, dependsOnId);
  }

  /**
   * Check if adding a dependency would create a cycle using DFS (CR 613.7c)
   * @param effectId - The effect that would depend on another
   * @param dependsOnId - The effect it would depend on
   * @returns true if adding the dependency would create a cycle
   */
  wouldCreateCycle(effectId: string, dependsOnId: string): boolean {
    // Self-referential dependency is a cycle
    if (effectId === dependsOnId) {
      return true;
    }

    // Build adjacency list from existing dependencies
    const adjacencyList = new Map<string, string[]>();

    for (const dep of this.dependencies) {
      if (!adjacencyList.has(dep.effectId)) {
        adjacencyList.set(dep.effectId, []);
      }
      adjacencyList.get(dep.effectId)!.push(dep.dependsOnId);
    }

    // If we're adding edge: effectId -> dependsOnId
    // We need to check if there's already a path from dependsOnId to effectId
    // If so, adding this edge would create a cycle

    // DFS from dependsOnId to see if we can reach effectId
    const visited = new Set<string>();
    const stack = [dependsOnId];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (current === effectId) {
        // Found a path from dependsOnId back to effectId
        // Adding effectId -> dependsOnId would complete a cycle
        return true;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const neighbors = adjacencyList.get(current) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    return false;
  }

  /**
   * Remove dependencies for an effect
   * @param effectId - The ID of the effect
   */
  removeDependencies(effectId: string): void {
    this.dependencies = this.dependencies.filter(
      (d) => d.effectId !== effectId && d.dependsOnId !== effectId,
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
    this.invalidateCache(cardId);
  }

  /**
   * Check if an effect depends on another effect
   * @param effect - The effect to check
   * @param otherEffect - The potential dependency
   */
  dependsOn(effect: ContinuousEffect, otherEffect: ContinuousEffect): boolean {
    const dependency = this.dependencies.find((d) => d.effectId === effect.id);
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
    const layerEffects = this.effects.filter((e) => e.layer === layer);

    // For Layer 7, also filter by sublayer
    const sortedEffects =
      layer === Layer.POWER_TOUGHNESS
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
   * Uses caching to avoid recomputing characteristics for the same state.
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
    controllerId?: PlayerId;
  } {
    const currentStateHash = this.computeStateHash();
    const cached = this.effectiveCharacteristicsCache.get(card.id);

    // Check if we have a valid cached result for this card and state
    if (cached && cached.stateHash === currentStateHash) {
      return cached.characteristics;
    }

    // Compute characteristics from scratch
    const modified = this.applyEffects(card);
    const cardData = modified.cardData;
    const overrides = this.getOverrides(card.id);

    // Handle Layer 1 copy effect (CR 613.2)
    // Per CR 707.2: When copying an object, you copy the copiable values of that object.
    // This includes resolving copy-of-copy chains (CR 613.2a)
    let effectiveCardData = cardData;
    let isMutatedCopy = false;
    let mutateResultIsCreature = false;

    if (overrides.copiedFromId) {
      // Resolve the full copy chain to find the ultimate source
      // Per CR 613.2a: copy effects that copy other copy effects are resolved in order
      const resolved = resolveCopyChain(card.id, this);
      if (resolved) {
        effectiveCardData = resolved.cardData;
        isMutatedCopy = resolved.isMutated && (overrides.isMutateCopy || false);
        mutateResultIsCreature = overrides.mutateResultIsCreature || false;
      } else {
        // Fallback to stored copiedCardData
        effectiveCardData = overrides.copiedCardData || cardData;
      }
    }

    // Calculate effective power/toughness considering Layer 7 sublayers
    const { power, toughness } = this.calculateEffectivePT(card, modified);

    // Handle mutate (CR 702.140)
    // Per CR 702.140: Mutate creates a merged permanent. If the target is a creature,
    // the result is a creature with the target's base characteristics plus the mutate card's abilities.
    // If the target is not a creature, the result is not a creature.
    let effectiveName = effectiveCardData.name;
    let effectiveTypes: string[] = [];
    let effectiveSubtypes: string[] = [];
    let effectiveSupertypes: string[] = [];
    let effectiveText = effectiveCardData.oracle_text || "";
    let effectiveManaCost = effectiveCardData.mana_cost || "";

    if (isMutatedCopy) {
      // Mutate combines the mutate card's abilities with the target's characteristics
      // The result uses the target's name, types, and base characteristics,
      // but gains the mutate card's abilities (oracle text)
      const originalCard = this.getCardInstanceById(card.id);
      if (originalCard) {
        // Use target's name and types (the "base" of the merge)
        effectiveName = effectiveCardData.name;
        const typeLineParts = effectiveCardData.type_line?.split(" — ") || [];
        effectiveTypes = typeLineParts[0]?.split(" ") || [];
        effectiveSubtypes = typeLineParts[1]?.split(" ") || [];

        // Supertypes come from the type line before the dash
        effectiveSupertypes = effectiveTypes.filter(
          (t) =>
            t === "Basic" ||
            t === "Legendary" ||
            t === "Snow" ||
            t === "World" ||
            t === "Ongoing" ||
            t === "Elite" ||
            t === "Host",
        );

        // Mutate cards typically have text describing the mutate ability
        // The result gains the mutate card's abilities in addition to the target's
        const mutateAbilityText = originalCard.cardData.oracle_text || "";
        const targetText = effectiveCardData.oracle_text || "";
        effectiveText = targetText
          ? `${targetText} ${mutateAbilityText}`
          : mutateAbilityText;

        // Mana cost combines the mutate card's cost with the target's cost
        const mutateCost = originalCard.cardData.mana_cost || "";
        effectiveManaCost = mutateCost || effectiveManaCost;
      }
    } else {
      // Normal copy - use the copied card's characteristics
      const typeLineParts = effectiveCardData.type_line?.split(" — ") || [];
      effectiveTypes = overrides.types || typeLineParts[0]?.split(" ") || [];
      effectiveSubtypes =
        overrides.subtypes || typeLineParts[1]?.split(" ") || [];
      effectiveSupertypes = overrides.supertypes || [];
    }

    // Per CR 613.4/613.5 exception: type/text changes that also change color
    // are handled by the colorChangeOriginLayer flag

    const characteristics = {
      name:
        modified.isFaceDown && modified.tokenData
          ? modified.tokenData.name
          : effectiveName,
      types: overrides.types || effectiveTypes,
      subtypes: overrides.subtypes || effectiveSubtypes,
      supertypes: effectiveSupertypes,
      text: overrides.text || effectiveText,
      manaCost: effectiveManaCost,
      color: this.getEffectiveColor(card),
      power,
      toughness,
      oracleText: overrides.text || effectiveText,
      grantedAbilities: overrides.grantedAbilities || [],
      removedAbilities: overrides.removedAbilities || [],
      controllerId: overrides.controllerId || modified.controllerId,
    };

    // Cache the result
    this.effectiveCharacteristicsCache.set(card.id, {
      stateHash: currentStateHash,
      characteristics,
    });

    return characteristics;
  }

  /**
   * Calculate effective power and toughness considering Layer 7 sublayers
   */
  private calculateEffectivePT(
    card: CardInstance,
    modified: CardInstance,
  ): { power: number | null; toughness: number | null } {
    const overrides = this.getOverrides(card.id);
    let cardData = modified.cardData;

    // Handle Layer 1 copy effect (CR 613.2)
    // Per CR 707.2: copy effects copy P/T as copiable values
    // Per CR 613.2a: copy-of-copy chains are resolved in layer order
    if (overrides.copiedFromId) {
      const resolved = resolveCopyChain(card.id, this);
      if (resolved) {
        cardData = resolved.cardData;
      } else if (overrides.copiedCardData) {
        cardData = overrides.copiedCardData;
      }
    }

    // Get base P/T from card data
    let basePower = 0;
    let baseToughness = 0;

    if (cardData.power) {
      const powerStr = cardData.power;
      if (powerStr === "*" || powerStr.includes("*")) {
        basePower = 0; // Variable P/T, would need CDA evaluation
      } else {
        basePower = parseInt(powerStr, 10) || 0;
      }
    }

    if (cardData.toughness) {
      const toughnessStr = cardData.toughness;
      if (toughnessStr === "*" || toughnessStr.includes("*")) {
        baseToughness = 0;
      } else {
        baseToughness = parseInt(toughnessStr, 10) || 0;
      }
    }

    // Layer 7a: Characteristic-Defining Abilities (CR 613.8a)
    // CDAs set base P/T before Layer 7b effects
    // Per CR 613.8a: CDAs are applied first in Layer 7
    let effectivePower = basePower;
    let effectiveToughness = baseToughness;

    // Apply CDA values if present (CR 613.8a)
    if (overrides.powerCDA !== undefined) {
      effectivePower = overrides.powerCDA;
    }
    if (overrides.toughnessCDA !== undefined) {
      effectiveToughness = overrides.toughnessCDA;
    }

    // Layer 7b: P/T setting effects override Layer 7a CDAs (CR 613.8b)
    // Per CR 613.8b: "Effects that set power or toughness to a specific value
    // override [Layer 7a] for that characteristic"
    if (overrides.powerSet !== undefined) {
      effectivePower = overrides.powerSet;
    }
    if (overrides.toughnessSet !== undefined) {
      effectiveToughness = overrides.toughnessSet;
    }

    let power = effectivePower;
    let toughness = effectiveToughness;

    // Layer 7c: Effects from counters (CR 613.8c)
    // +1/+1 and -1/-1 counters are applied in this sublayer
    const plusOneCounters =
      card.counters.find((c) => c.type === "+1/+1")?.count || 0;
    const minusOneCounters =
      card.counters.find((c) => c.type === "-1/-1")?.count || 0;
    // Per CR 704.5q, +1/+1 and -1/-1 counters cancel each other out
    // The net effect is applied in Layer 7c
    const netCounterBonus = plusOneCounters - minusOneCounters;
    power += netCounterBonus;
    toughness += netCounterBonus;

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
      // Per CR 613.5 exception: If an effect changes both color AND type
      // simultaneously, the color change happens in Layer 4.
      // Per CR 613.4 exception: If a Layer 3 text-changing effect changes
      // both color AND type simultaneously, the color change happens in Layer 4.
      // In both cases, the color was already set by the type/text-changing effect,
      // and we should return it immediately without applying Layer 5 effects.
      if (overrides.colorChangeOriginLayer) {
        return [...overrides.colors];
      }
      return [...overrides.colors];
    }

    // Start with base color from card data (considering copy effects)
    let colors: string[] = [];
    let cardData = modified.cardData;

    // Handle Layer 1 copy effect (CR 613.2)
    // Per CR 707.2: copy effects copy color as a copiable value
    // Per CR 613.2a: copy-of-copy chains are resolved in layer order
    if (overrides.copiedFromId) {
      const resolved = resolveCopyChain(card.id, this);
      if (resolved) {
        cardData = resolved.cardData;
      } else if (overrides.copiedCardData) {
        cardData = overrides.copiedCardData;
      }
    }

    if (cardData.colors) {
      colors = [...cardData.colors];
    }

    // Apply color-changing effects (Layer 5)
    const colorEffects = this.effects.filter(
      (e) => e.layer === Layer.COLOR_CHANGING && e.canApply(modified),
    );

    for (const effect of colorEffects) {
      if (effect.canApply(modified)) {
        const result = effect.apply(
          modified,
        ) as CardInstanceWithEffectiveColors;
        // The effect should set colors directly via _effectiveColors
        if (result._effectiveColors) {
          colors = result._effectiveColors;
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
    this.effectiveCharacteristicsCache.clear();
  }

  /**
   * Register a card instance for copy effect resolution (CR 613.2)
   * This allows the layer system to look up card data when resolving copy effects.
   * @param card - The card instance to register
   */
  registerCardInstance(card: CardInstance): void {
    this.cardInstances.set(card.id, card);
  }

  /**
   * Unregister a card instance (e.g., when it leaves the battlefield)
   * @param cardId - The ID of the card to unregister
   */
  unregisterCardInstance(cardId: CardInstanceId): void {
    this.cardInstances.delete(cardId);
  }

  /**
   * Get a card instance by ID for copy effect resolution
   * @param cardId - The ID of the card to look up
   * @returns The card instance or undefined if not found
   */
  getCardInstanceById(cardId: CardInstanceId): CardInstance | undefined {
    return this.cardInstances.get(cardId);
  }
}

// ============================================================
// Effect Factory Functions
// ============================================================

/**
 * Create a copy effect (Layer 1 - CR 613.2)
 * Copy effects are applied first and cause the object to copy characteristics
 * from another card (CR 613.2a-613.2j)
 *
 * Per CR 707.2: When copying an object, you copy:
 * - Name
 * - Mana cost
 * - Card types (including supertypes and subtypes)
 * - Oracle text
 * - Power/toughness
 * - Color
 * - Color indicator
 * - Expansion symbol, art, illustration credit (for display only)
 *
 * Copy effects do NOT copy:
 * - Abilities (these are separate effects in Layer 6)
 * - Controller (controlled separately in Layer 2)
 * - Current zone and game state
 * - Timestamps and counters
 */
export function createCopyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  copiedCardId: CardInstanceId,
  description: string,
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `copy-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.COPY_EFFECTS,
    effectType: "copy",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: (card) => card.id === sourceCardId,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      // Per CR 613.2: Copy effects cause the object to copy the other's characteristics
      // We store the copiedFromId for later resolution when getting effective characteristics
      // Per CR 613.2a: Copy effects that copy other copy effects are resolved in layer order
      overrides.copiedFromId = copiedCardId;

      // Look up the copied card's data as a fallback
      // The full copy chain resolution happens in getEffectiveCharacteristics via resolveCopyChain
      // We store the immediate copied card's base data as a fallback for edge cases
      const copiedCard = ls.getCardInstanceById(copiedCardId);
      if (copiedCard) {
        overrides.copiedCardData = copiedCard.cardData;
      }

      // Copy effect copies all characteristics from the copied card
      // But does NOT copy abilities, controllers, or other game-specific state
      // Per CR 613.2: copy effects only copy characteristics (name, types, text, P/T, etc.)

      return { ...card, _copiedFrom: copiedCardId };
    },
  };
}

/**
 * Create a mutate copy effect (CR 702.140 - Layer 1)
 *
 * When a creature with mutate resolves and targets another creature:
 * - If the target is a creature, the result is a single merged creature
 * - The merged creature has the target's base characteristics (name, types, P/T)
 * - The merged creature gains the mutate card's abilities in addition to the target's
 * - The result is a creature (since the target is a creature)
 *
 * When the target is NOT a creature:
 * - The result is not a creature
 * - The mutate effect essentially creates a copy with the mutate abilities added
 *
 * Per CR 702.140:
 * - Mutate combines the mutate card with the target into a single permanent
 * - The copiable values of the result are determined by the target
 * - But the result also has the mutate card's ability text merged
 */
export function createMutateCopyEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  copiedCardId: CardInstanceId,
  description: string,
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `mutate-copy-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.COPY_EFFECTS,
    effectType: "copy",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: (card) => card.id === sourceCardId,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      // Per CR 613.2 and CR 702.140: Copy the target's characteristics
      overrides.copiedFromId = copiedCardId;
      overrides.isMutateCopy = true;

      // Look up the copied card's data
      const copiedCard = ls.getCardInstanceById(copiedCardId);
      if (copiedCard) {
        overrides.copiedCardData = copiedCard.cardData;

        // Per CR 702.140: If the target is a creature, the result is a creature
        // Check if the target has the creature type
        const targetTypeLine = copiedCard.cardData.type_line || "";
        const isTargetCreature = targetTypeLine.includes("Creature");
        overrides.mutateResultIsCreature = isTargetCreature;
      }

      // The mutate card's abilities will be combined with the target's
      // This is handled in getEffectiveCharacteristics

      return {
        ...card,
        _copiedFrom: copiedCardId,
        isMutated: true,
        mutateBaseId: copiedCardId,
      };
    },
  };
}

/**
 * Create a control-changing effect (Layer 2 - CR 613.3)
 * Changes who controls the permanent
 * Per CR 613.3: Control-changing effects are applied by timestamp order
 */
export function createControlChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  newControllerId: PlayerId,
  description: string,
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `control-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.CONTROL_CHANGING,
    effectType: "control_change",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: (card) => card.controllerId === controllerId,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      // Track controller history for proper removal (CR 613.3)
      // When control changes, we push the new controller onto the history stack
      if (!overrides.controllerHistory) {
        // Initialize with the original controller (from the card)
        overrides.controllerHistory = [
          { controllerId: card.controllerId, sourceCardId: card.id },
        ];
      }

      // Push the new controller onto the history
      overrides.controllerHistory.push({
        controllerId: newControllerId,
        sourceCardId,
      });

      // Set current controller
      overrides.controllerId = newControllerId;

      return { ...card, controllerId: newControllerId };
    },
  };
}

/**
 * Create a text-changing effect (Layer 3 - CR 613.4)
 * Changes the oracle text of a card (e.g., Mind Bend, Volrath's Shapeshifter)
 *
 * Per CR 613.4 exception: If a Layer 3 text-changing effect also changes
 * type and/or color simultaneously, the type change happens in Layer 4
 * and color change happens in Layer 4 (not Layer 5 as usual).
 */
export function createTextChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  newText: string,
  description: string,
  _addTypes?: boolean,
  _layerSystemInstance?: LayerSystem,
  /**
   * Types to set when text-changing effect also changes type simultaneously.
   * Per CR 613.4 exception: if a Layer 3 effect changes type and color,
   * type is applied in Layer 4.
   */
  _types?: string[],
  /**
   * Colors to set when text-changing effect also changes color simultaneously.
   * Per CR 613.4 exception: if a Layer 3 effect changes color and type,
   * the color change is applied in Layer 4 (not Layer 5).
   */
  _colors?: string[],
): ContinuousEffect {
  return {
    id: `text-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.TEXT_CHANGING,
    effectType: "text_change",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = _layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);
      overrides.text = newText;

      // Handle simultaneous type/color change (CR 613.4 exception)
      if (_types && _types.length > 0) {
        overrides.types = _types;
      }
      if (_colors !== undefined) {
        overrides.colors = _colors;
        overrides.colorChangeOriginLayer = Layer.TEXT_CHANGING;
      }

      return { ...card };
    },
  };
}

/**
 * Create a type-changing effect (Layer 4 - CR 613.5)
 * Changes the card types, subtypes, and/or supertypes (e.g., Dryad of the Ilysian Grove)
 *
 * Per CR 613.5 exception: If an effect changes both color AND type simultaneously,
 * the color change happens in Layer 4 (not Layer 5 as usual).
 */
export function createTypeChangeEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  types: string[],
  subtypes: string[] = [],
  supertypes: string[] = [],
  description: string,
  addTypes: boolean = false, // If true, adds to existing types; if false, replaces
  layerSystemInstance?: LayerSystem,
  /**
   * Colors to set when type-changing effect also changes color simultaneously.
   * Per CR 613.5 exception: if a Layer 4 effect changes color and type,
   * the color change is applied in Layer 4 (not Layer 5).
   */
  _colors?: string[],
): ContinuousEffect {
  return {
    id: `type-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.TYPE_CHANGING,
    effectType: "type_change",
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
        overrides.subtypes = [
          ...new Set([...(overrides.subtypes || []), ...subtypes]),
        ];
        overrides.supertypes = [
          ...new Set([...(overrides.supertypes || []), ...supertypes]),
        ];
      } else {
        // Replace types
        overrides.types = types;
        overrides.subtypes = subtypes;
        overrides.supertypes = supertypes;
      }

      // Handle simultaneous color change (CR 613.5 exception)
      // Per CR 613.5: if an effect changes color AND type simultaneously,
      // the color change happens in Layer 4 (not Layer 5 as usual)
      if (_colors !== undefined) {
        overrides.colors = _colors;
        overrides.colorChangeOriginLayer = Layer.TYPE_CHANGING;
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `color-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.COLOR_CHANGING,
    effectType: "color_change",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (addColors) {
        overrides.colors = [
          ...new Set([...(overrides.colors || []), ...colors]),
        ];
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `ability-grant-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.ABILITY,
    effectType: "ability_grant",
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `ability-remove-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.ABILITY,
    effectType: "ability_remove",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      if (removeAll) {
        // Mark that all abilities should be removed
        overrides.removedAbilities = ["*"];
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `pt-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: "power_set",
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `p-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: "power_set",
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `t-set-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SET,
    effectType: "toughness_set",
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
  description: string,
): ContinuousEffect {
  return {
    id: `pt-mod-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.MODIFY,
    effectType: "power_modify",
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
  description: string,
): ContinuousEffect {
  return {
    id: `p-mod-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.MODIFY,
    effectType: "power_modify",
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
  description: string,
): ContinuousEffect {
  return {
    id: `t-mod-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.MODIFY,
    effectType: "toughness_modify",
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `pt-switch-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.SWITCH,
    effectType: "power_toughness_switch",
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
  layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `cda-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
    effectType: "characteristic_defining",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      const ls = layerSystemInstance || getLayerSystemInstance();
      const overrides = ls.getOverrides(card.id);

      // CR 613.8a: CDAs set P/T in Layer 7a
      // CR 613.8b: Effects that set P/T to a specific value (Layer 7b) override Layer 7a CDAs
      // Store CDA P/T separately so Layer 7b can override it
      if (typeof cda.power === "number") {
        overrides.powerCDA = cda.power;
      }
      if (typeof cda.toughness === "number") {
        overrides.toughnessCDA = cda.toughness;
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

/**
 * Create a counter effect (Layer 7c - CR 613.8c)
 * Handles +1/+1 and -1/-1 counters that modify P/T
 * Note: Counters are typically managed directly on CardInstance.counters,
 * but this effect type is used for effects that interact with counters
 */
export function createCounterEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  _counterType: "+1/+1" | "-1/-1" | string,
  _count: number,
  description: string,
  _layerSystemInstance?: LayerSystem,
): ContinuousEffect {
  return {
    id: `counter-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    layer: Layer.POWER_TOUGHNESS,
    sublayer: PowerToughnessSublayer.COUNTERS,
    effectType: "counter",
    description,
    timestamp: Date.now(),
    priority: 0,
    canApply: () => true,
    apply: (card) => {
      // Counter effects are handled by reading card.counters directly in calculateEffectivePT
      // This effect type exists for completeness and for effects that specifically
      // interact with counters (e.g., "double all +1/+1 counters")
      return { ...card };
    },
  };
}

/**
 * Get the effective power of a card after all layer effects have been applied.
 * This should be used for combat damage calculation per CR 506-510.
 *
 * @param card - The card instance
 * @param layerSystem - The layer system instance to use
 * @returns The effective power after layer 7 effects are resolved
 */
export function getEffectivePower(
  card: CardInstance,
  layerSystem: LayerSystem,
): number {
  const characteristics = layerSystem.getEffectiveCharacteristics(card);
  return characteristics.power ?? 0;
}

/**
 * Get the effective toughness of a card after all layer effects have been applied.
 * This should be used for combat damage calculation per CR 506-510.
 *
 * @param card - The card instance
 * @param layerSystem - The layer system instance to use
 * @returns The effective toughness after layer 7 effects are resolved
 */
export function getEffectiveToughness(
  card: CardInstance,
  layerSystem: LayerSystem,
): number {
  const characteristics = layerSystem.getEffectiveCharacteristics(card);
  return characteristics.toughness ?? 0;
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
