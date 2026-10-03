import type { CardInstanceId, PlayerId, GameState } from "../types";

export type TriggerEvent =
  | "landfall"
  | "entersBattlefield"
  | "leavesBattlefield"
  | "damageDealt"
  | "dealsCombatDamageToPlayer"
  | "dies"
  | "creatureDies"
  | "attacked"
  | "blocked"
  | "phaseChange"
  | "drawCard"
  | "cast"
  | "lifeGain"
  | "lifeLost"
  | "beginningOfTurn"
  | "endOfTurn"
  | "spellCast"
  | "upkeep"
  | "untapStep"
  | "beginningOfCombat"
  | "phaseEnds"
  | "turnEnds"
  | "turnBegins"
  | "cleanupStep"
  | "stateTrigger"
  | "abilityActivated";

export interface TriggerContext {
  sourceCardId?: CardInstanceId;
  damageAmount?: number;
  damageTarget?: PlayerId | CardInstanceId;
  lifeLostPlayer?: PlayerId;
  lifeLostAmount?: number;
  spellCardId?: CardInstanceId;
  /** Landfall: the land that entered and the player who controls it. */
  landCardId?: CardInstanceId;
  landControllerId?: PlayerId;
  /**
   * Enters the battlefield: the permanent that entered. When set, "this
   * creature enters" triggers fire only for that permanent and "another ..."
   * triggers only for the others (CR 603.6a).
   */
  enteringCardId?: CardInstanceId;
}

export interface ActivateAbilityResult {
  success: boolean;
  state: GameState;
  description: string;
  error?: string;
}

export interface TriggeredAbilityResult {
  abilities: TriggeredAbilityInstance[];
  state: GameState;
}

export interface TriggeredAbilityInstance {
  id: string;
  sourceCardId: CardInstanceId;
  triggeringPlayerId: PlayerId;
  triggerCondition: string;
  effect: string;
  timestamp: number;
  sourceCardTimestamp: number;
  context?: TriggerContext;
  interveningIf?: string;
}

export interface LoyaltyAbility {
  cost: number;
  effect: string;
}
