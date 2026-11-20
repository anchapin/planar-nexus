import type { CardInstanceId, PlayerId, GameState } from "../types";
// Type-only import: erased at runtime, so this does NOT introduce a runtime
// module cycle (the trigger-system types module imports the abilities barrel
// for value exports). The enum stays the single source of truth for the
// detector-side `triggerType` values (issue #2874).
import type { TriggerConditionType } from "../trigger-system/types";

export type TriggerEvent =
  | "landfall"
  | "chapter"
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
  | "targeted"
  | "crime";

export interface TriggerContext {
  sourceCardId?: CardInstanceId;
  /**
   * Which trigger condition produced this context. The detector side
   * (`TriggerDetectionContext`, issue #2874) always sets it; it stays
   * optional here because non-detector producers (granted triggers,
   * scripted triggers) have no single trigger condition.
   */
  triggerType?: TriggerConditionType;
  /**
   * Saga chapters (CR 714.2b): the lore count before and after lore
   * counters were added to `sourceCardId`.
   */
  loreFrom?: number;
  loreTo?: number;
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
  /**
   * drawCard (CR 121.2, #2614 follow-up lane 87): the player whose draw
   * fired the trigger. Set by `drawCards` for every card draw, on the
   * context passed to `detectTriggeredAbilities`. The `LoseLife.who:
   * "drawer"` op routes to this player.
   */
  drawingPlayerId?: PlayerId;
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
  /**
   * Wave 4.8 follow-up 3 lane 65 (#2614 follow-up): the
   * granted-trigger bag for a triggered ability whose
   * source is an attached Aura's `static.grants.triggers`
   * (CR 603.2 grant semantics). The trigger fires when
   * the ENCHANTED CARD (the dying card) matches the
   * event, and the resolver routes the effect's
   * `who: "you"` to the enchanted card's controller
   * (parallel to a normal self-dies trigger on the
   * enchanted card). The `grantedSourceControllerId` is
   * the Aura's controller at refresh time — used for
   * "grants to a specific player" style effects that
   * point at the Aura's controller. Undefined on
   * ordinary scripted triggers.
   */
  grantedEffects?: Array<{ op: string; [k: string]: unknown }>;
  grantedSourceControllerId?: PlayerId;
}

export interface LoyaltyAbility {
  cost: number;
  effect: string;
}
