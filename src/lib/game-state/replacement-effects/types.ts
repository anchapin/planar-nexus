/**
 * Replacement and Prevention Effects System
 *
 * Implements MTG rules for replacement and prevention effects as described in CR 614-616.
 * - Replacement effects (CR 614.1): Modify how an event happens ("If X would happen, instead Y")
 * - Prevention effects (CR 614.2): Prevent damage, life loss, etc. from happening
 * - "As though" effects (CR 609): Allow players to ignore restrictions or follow different rules
 *
 * Key Rules:
 * - CR 614.5: Some effects replace damage with life loss or other outcomes
 * - CR 614.7: If an event is replaced, it never happens
 * - CR 614.9: Some effects say "instead" - these are replacement effects
 * - CR 614.10: Some effects say "prevent" - these are prevention effects
 * - CR 616: Multiple replacement/prevention effects use APNAP ordering
 *
 * @module replacement-effects
 */

import type { CardInstanceId, PlayerId, GameState } from "../types";

/**
 * Types of replacement/prevention effects
 */
export type ReplacementEffectType =
  | "damage_replacement" // Replace damage with something else
  | "damage_prevention" // Prevent damage
  | "life_gain_replacement" // Modify life gain (e.g., double it)
  | "life_loss_replacement" // Modify life loss
  | "draw_replacement" // Replace card draw
  | "counter_movement" // Replace counter placement
  | "token_creation" // Modify token creation
  | "destroy_replacement" // Replace destruction (e.g., regenerate)
  | "exile_replacement" // Replace exile
  | "counters" // Add/remove counters
  | "as_though" // "As though" effects
  | "sacrifice_replacement" // Replace sacrifice
  | "command_zone_replacement" // Commander redirect (CR 903.9)
  | "land_enter_replacement"; // Replace how a land enters (e.g., enters tapped)

/**
 * A replacement or prevention ability
 */
export interface ReplacementAbility {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  effectType: ReplacementEffectType;
  description: string;
  apply: (event: ReplacementEvent) => ReplacementResult;
  canApply: (event: ReplacementEvent) => boolean;
  layer: number;
  sublayer?: string;
  duration?: "until_end_of_turn" | "until_end_of_next_turn" | "permanent";
  preventionAmount?: number;
  timestamp: number;
  isSelfReplacement?: boolean;
  isInstead?: boolean;
}

/**
 * "As though" effect - allows a player to ignore restrictions or follow different rules
 * CR 609: "As Though"
 */
export interface AsThoughEffect {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  asThoughType: AsThoughType;
  description: string;
  condition?: (state: GameState, playerId: PlayerId) => boolean;
  duration?: "until_end_of_turn" | "permanent";
  timestamp: number;
}

export type AsThoughType =
  | "cast_flash"
  | "attack_haste"
  | "block_flying"
  | "play_land_anytime"
  | "spend_mana_any_color"
  | "target_anything"
  | "range_infinite"
  | "card_type_change";

export type ReplacementEventType =
  | "damage"
  | "life_gain"
  | "life_loss"
  | "draw_card"
  | "move_to_graveyard"
  | "exile"
  | "destroy"
  | "create_token"
  | "add_counter"
  | "remove_counter"
  | "sacrifice"
  | "tap"
  | "untap"
  | "put_into_hand" // CR 903.9a — commander bounced to hand
  | "put_into_library" // CR 903.9a — commander shuffled into library
  | "landEnterBattlefield"; // CR 614.1 — replacement effects for land entering battlefield

export interface ReplacementEvent {
  type: ReplacementEventType;
  timestamp: number;
  sourceId?: CardInstanceId;
  targetId?: CardInstanceId | PlayerId;
  amount: number;
  isCombatDamage?: boolean;
  damageTypes?: ("combat" | "noncombat" | "damage" | "lethal")[];
  hasLifelink?: boolean;
  hasDeathtouch?: boolean;
  entersTapped?: boolean; // CR 614.1 — for landEnterBattlefield events
  context?: Record<string, unknown>;
}

export interface ReplacementResult {
  modified: boolean;
  modifiedEvent?: ReplacementEvent;
  description: string;
  instead?: boolean;
  skipEvent?: boolean;
}

export interface PreventionShield {
  sourceId: CardInstanceId;
  amount: number;
  damageTypes?: string[];
  expiresAt?: number;
  controllerId: PlayerId;
}

export interface APNAPOrder {
  activePlayerId: PlayerId;
  playerOrder: PlayerId[];
}

/** Waiting-choice discriminator for CR 616.1 replacement effect selection. */
export const REPLACEMENT_CHOICE_TYPE = "choose_replacement" as const;

/**
 * Result of a replacement-effect-processing pass.
 *
 * When `requiresChoice` is true, the caller should present a
 * `WaitingChoice` of type {@link REPLACEMENT_CHOICE_TYPE} to the player
 * identified by `affectedPlayerId` (CR 616.1 — the affected player or the
 * controller of the affected permanent chooses which replacement/prevention
 * effect applies). After the player picks, call
 * {@link ReplacementEffectManager.resolveReplacementChoice} with the picked
 * effect id and `appliedEffectIds` to resume processing.
 *
 * When `requiresChoice` is false, the resolved event in `event` is final and
 * should be applied to the game state directly.
 */
export interface ReplacementProcessingOutcome {
  event: ReplacementEvent;
  appliedEffects: ReplacementAbility[];
  requiresChoice: boolean;
  candidates?: ReplacementAbility[];
  affectedPlayerId?: PlayerId;
  /** True when the caller requested auto-resolution via the AI heuristic. */
  autoResolved?: boolean;
}
