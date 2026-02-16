/**
 * Card interaction types for the Planar Nexus game
 * Handles click interactions, ability activation, and targeting
 */

import { CardInstanceId, PlayerId, StackObjectId } from "@/lib/game-state/types";

/**
 * Types of card interactions
 */
export type CardInteractionType = 
  | "inspect"
  | "tap"
  | "untap"
  | "activate_ability"
  | "select_for_targeting"
  | "view_details";

/**
 * Interaction context - what the player is trying to do
 */
export interface InteractionContext {
  type: CardInteractionType;
  cardId?: CardInstanceId;
  abilityIndex?: number;
  sourceCardId?: CardInstanceId;
  sourceAbilityId?: StackObjectId;
  isActive: boolean;
  validTargets?: ValidTargetInfo[];
}

/**
 * Information about valid targets for an ability/spell
 */
export interface ValidTargetInfo {
  targetId: string;
  targetType: "card" | "player" | "stack" | "zone";
  isValid: boolean;
  validationReason?: string;
}

/**
 * Card ability definition
 */
export interface CardAbility {
  /** Unique identifier for the ability */
  id: string;
  /** Display name of the ability */
  name: string;
  /** Oracle text/effect description */
  text: string;
  /** Mana cost to activate (e.g., "{2}{U}") */
  manaCost?: string;
  /** Other costs (sacrifice, tap, etc.) */
  additionalCosts?: string[];
  /** Whether the ability can be activated */
  isActivatable: boolean;
  /** Reason if not activatable */
  activatableReason?: string;
  /** Whether this targets something */
  hasTargets: boolean;
  /** Target requirements */
  targetRequirements?: TargetRequirement;
  /** Loyalty cost (for planeswalkers) */
  loyaltyCost?: number;
}

/**
 * Target requirements for an ability/spell
 */
export interface TargetRequirement {
  /** Minimum number of targets required */
  minTargets: number;
  /** Maximum number of targets allowed */
  maxTargets: number;
  /** Types of valid targets */
  validTargetTypes: ("creature" | "artifact" | "enchantment" | "instant" | "sorcery" | "player" | "plane" | "planeswalker" | "battle")[];
  /** Whether you can target yourself */
  canTargetSelf: boolean;
  /** Additional targeting rules */
  rules?: string;
}

/**
 * State for the targeting system
 */
export interface TargetingState {
  /** Whether targeting mode is active */
  isActive: boolean;
  /** The card/ability that is targeting */
  sourceCardId: CardInstanceId | null;
  /** The ability being used (if applicable) */
  sourceAbilityId: StackObjectId | null;
  /** Currently selected targets */
  selectedTargets: SelectedTarget[];
  /** Maximum allowed targets */
  maxTargets: number;
  /** Minimum required targets */
  minTargets: number;
  /** Valid target types */
  validTargetTypes: string[];
  /** Whether player is a valid target */
  canTargetPlayer: boolean;
}

/**
 * A selected target
 */
export interface SelectedTarget {
  targetId: string;
  targetType: "card" | "player" | "stack" | "zone";
  playerId?: PlayerId;
}

/**
 * Click handler result
 */
export interface ClickHandlerResult {
  action: CardInteractionType;
  cardId?: CardInstanceId;
  abilityIndex?: number;
  message?: string;
}

/**
 * Context menu action
 */
export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  action: CardInteractionType;
  disabled?: boolean;
  disabledReason?: string;
  /** Submenu items */
  children?: ContextMenuAction[];
}

/**
 * Card interaction events for the game board
 */
export interface CardInteractionEvents {
  onCardClick?: (cardId: string, zone: string) => void;
  onCardDoubleClick?: (cardId: string, zone: string) => void;
  onCardRightClick?: (cardId: string, zone: string, event: React.MouseEvent) => void;
  onAbilityActivate?: (cardId: string, abilityIndex: number) => void;
  onTargetSelect?: (targetId: string, targetType: "card" | "player") => void;
  onTargetConfirm?: () => void;
  onTargetCancel?: () => void;
}

/**
 * Visual state for selected/targeted cards
 */
export type SelectionVisualState = 
  | "none"
  | "selected"
  | "targeted"
  | "valid_target"
  | "invalid_target"
  | "highlighted";
