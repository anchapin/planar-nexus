import type { CardInstanceId, PlayerId, GameState } from "../types";

export type TriggerEvent =
  | "entersBattlefield"
  | "leavesBattlefield"
  | "damageDealt"
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
