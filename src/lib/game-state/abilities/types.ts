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
  | "abilityActivated"
  | "targeted";

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
  /**
   * Dies (CR 603.10a): the creature that died. Detection runs on the state
   * just before it left the battlefield, so "this creature dies" still sees it.
   */
  dyingCardId?: CardInstanceId;
  /** Attacks (CR 508.1m): one declared attacker, whom it attacks, and how many attacked. */
  attackerId?: CardInstanceId;
  attackDefenderId?: PlayerId | CardInstanceId;
  attackerCount?: number;
  /** Upkeep (CR 503.1a): whose upkeep it is. */
  upkeepPlayerId?: PlayerId;
  /** Cast (CR 601.2i): who cast the spell (the spell is `spellCardId`). */
  castingPlayerId?: PlayerId;
  /**
   * Targeted (#2614 Surrak): the creature (permanent or creature spell)
   * that became a target, and the controller of the targeting spell or
   * ability.
   */
  targetedCardId?: CardInstanceId;
  targetingPlayerId?: PlayerId;
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
