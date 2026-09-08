/**
 * Game-state root types: GameState, the action algebra (GameAction/ActionData/ActionType).
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ReplacementEffectManager } from '../replacement-effects';
import type { LayerSystem } from '../layer-system';
import { CardInstance, CardInstanceId } from './cards';
import { WaitingChoice } from './choices';
import { Combat } from './combat';
import { LinkedEffectRegistry } from './linked-effects';
import { Player, PlayerId } from './players';
import { StackObject } from './stack';
import { Turn } from './turn';
import { Zone } from './zones';

/**
 * The complete game state
 */
export interface GameState {
  /** Unique game identifier */
  gameId: string;
  /** All players in the game */
  players: Map<PlayerId, Player>;
  /** All card instances */
  cards: Map<CardInstanceId, CardInstance>;
  /** All zones */
  zones: Map<string, Zone>;
  /** Objects currently on the stack */
  stack: StackObject[];
  /** Current turn state */
  turn: Turn;
  /** Combat state */
  combat: Combat;
  /** Current choice waiting for player input */
  waitingChoice: WaitingChoice | null;
  /** Player who has priority */
  priorityPlayerId: PlayerId | null;
  /** Number of consecutive passes */
  consecutivePasses: number;
  /** Game status */
  status: "not_started" | "in_progress" | "paused" | "completed";
  /** Winner(s) of the game */
  winners: PlayerId[];
  /** How the game ended */
  endReason: string | null;
  /** Game format (e.g., "standard", "commander", "historic") */
  format: string;
  /** Timestamp when game was created */
  createdAt: number;
  /** Timestamp when game was last modified */
  lastModifiedAt: number;
  /** Replacement effect manager for this game instance */
  replacementEffectManager: ReplacementEffectManager;
  /** Layer system for this game instance */
  layerSystem: LayerSystem;
  /** Linked effect registry for this game instance */
  linkedEffectRegistry: LinkedEffectRegistry;
  /**
   * Corpse keyword delayed-trigger queue (CR 702.168).
   *
   * When a creature with a Corpse ability dies, `processCorpseOnDeath` appends
   * its card ID here and surfaces a `corpse_offer` `waitingChoice` to its
   * controller. Because the engine surfaces one choice at a time, additional
   * corpses that die while an offer is already pending remain queued here and
   * are surfaced (in FIFO order) once the prior offer is resolved via
   * `resolveCorpseChoice`. A card ID is removed from this queue only when its
   * offer is resolved (paid or declined). Optional so legacy state literals
   * default to "no pending offers" (read with `?? []`).
   */
  pendingCorpseOffers?: CardInstanceId[];

  /**
   * Tribute keyword ETB-trigger queue (CR 702.101).
   *
   * When a creature with a Tribute ability enters the battlefield,
   * `processTributeOnEtb` appends its card ID here and surfaces a
   * `tribute_offer` `waitingChoice` to the chosen opponent. Because the engine
   * surfaces one choice at a time, additional tributes that enter while an
   * offer is already pending remain queued here and are surfaced (in FIFO
   * order) once the prior offer is resolved via `resolveTributeChoice`. A card
   * ID is removed from this queue only when its offer is resolved (paid or
   * declined). Optional so legacy state literals default to "no pending
   * offers" (read with `?? []`).
   */
  pendingTributeOffers?: CardInstanceId[];
}

/**
 * An action that can be performed in the game
 */
export interface GameAction {
  /** Type of action */
  type: ActionType;
  /** Player performing the action */
  playerId: PlayerId;
  /** Timestamp when action was performed */
  timestamp: number;
  /** Action-specific data */
  data: ActionData;
}

/**
 * Union of possible action-specific data structures
 */
export type ActionData =
  | { cardId: CardInstanceId; targetId?: string | PlayerId } // cast_spell, play_land, activate_ability
  | {
      attackers: Array<{
        cardId: CardInstanceId;
        defenderId: PlayerId | CardInstanceId;
      }>;
    } // declare_attackers
  | { blockers: Array<{ cardId: CardInstanceId; attackerId: CardInstanceId }> } // declare_blockers
  | { amount: number; targetId: string | PlayerId; sourceId?: CardInstanceId } // deal_damage, gain_life
  | { counterType: string; amount: number; cardId: CardInstanceId } // add_counter, remove_counter
  | { choiceValue: string | number | boolean } // for making a choice
  | Record<string, unknown>;

/**
 * Types of game actions
 *
 * Note: Action type names use MTG terminology internally. Use translateAction() from
 * terminology-translation.ts for user-facing display.
 */
export type ActionType =
  | "cast_spell"
  | "activate_ability"
  | "pass_priority"
  | "declare_attackers"
  | "declare_blockers"
  | "play_land"
  | "draw_card"
  | "discard_card"
  | "cycle_card"
  | "tap_card"
  | "untap_card"
  | "destroy_card"
  | "exile_card"
  | "sacrifice_card"
  | "create_token"
  | "add_counter"
  | "remove_counter"
  | "move_card"
  | "gain_life"
  | "lose_life"
  | "venture_into_dungeon"
  | "deal_damage"
  | "pay_mana"
  | "add_mana"
  | "mulligan"
  | "concede"
  | "undo";

// ============================================================================
// AI-Specific Unified Types
// ============================================================================
// These types provide a simplified interface for AI decision-making while
// maintaining compatibility with the engine's detailed GameState format.
// Use conversion functions in serialization.ts to translate between formats.
// ============================================================================

