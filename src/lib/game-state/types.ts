/**
 * Core type definitions for the Planar Nexus game state engine.
 * These types represent the complete state of a tabletop card game.
 *
 * ISSUE #435: Generic Card Game Framework Core
 * ============================================
 * This module provides a generic abstraction layer for card game state management.
 * While internal implementation may use MTG-like terminology for backward compatibility
 * and clarity, all user-facing text should use generic terminology via the
 * translation layer (see terminology-translation.ts).
 *
 * Generic Terminology Mapping:
 * - Commander → Legendary Leader
 * - Mana → Resource
 * - Lands → Sources
 * - Mana Pool → Resource Pool
 * - Mana Cost → Resource Cost
 * - Planeswalker → Champion
 * - Summoning Sickness → Deployment Restriction
 * - Tap/Untap → Activate/Deactivate
 *
 * Design Principles:
 * 1. Internal types use MTG-like terminology for familiarity and backward compatibility
 * 2. All user-facing text uses generic terminology via translation layer
 * 3. Framework supports different game systems through abstraction layer
 * 4. Core mechanics are game-agnostic (zones, phases, actions, etc.)
 */

import { ScryfallCard } from "@/app/actions";

// Re-export ScryfallCard for use in other game-state modules
export type { ScryfallCard } from "@/app/actions";

/**
 * Unique identifier for a card instance in the game
 */
export type CardInstanceId = string;

/**
 * Unique identifier for a player
 */
export type PlayerId = string;

/**
 * Unique identifier for an ability or effect on the stack
 */
export type StackObjectId = string;

/**
 * Generic resource pool interface
 * This abstraction allows different game systems to define their own resource systems
 * while maintaining compatibility with the core game state management.
 *
 * For MTG-like games: mana pool (colorless, white, blue, black, red, green, generic)
 * For other systems: could be action points, energy, stamina, etc.
 */
export interface ResourcePool {
  /** Type of resource system (e.g., 'mana', 'energy', 'action-points') */
  type: string;
  /** Total resources available */
  total: number;
  /** Resource breakdown by category/type */
  resources: Map<string, number>;
  /** Maximum resources allowed */
  maximum: number;
}

/**
 * Generic resource cost interface
 * Abstracts the cost system for different game systems
 */
export interface ResourceCost {
  /** Type of resource required */
  resourceType: string;
  /** Amount required */
  amount: number;
  /** Specific requirements (e.g., colors for mana) */
  requirements: Map<string, number>;
}

/**
 * Legendary leader interface
 * Generic abstraction for commander-style game modes
 * Supports different implementations of leader-based formats
 */
export interface LegendaryLeader {
  /** Unique identifier for this leader */
  id: CardInstanceId;
  /** Leader name */
  name: string;
  /** Player who owns this leader */
  ownerId: PlayerId;
  /** Color/identity requirements */
  identity: string[];
  /** Damage dealt by this leader to each opponent */
  damageDealt: Map<PlayerId, number>;
  /** Cast count (for commander format) */
  castCount: number;
  /** Whether this leader is in the reserve zone */
  isInReserveZone: boolean;
}

/**
 * Represents a single physical card in play
 * Unlike ScryfallCard which defines card types, this tracks game state
 */
export interface CardInstance {
  id: CardInstanceId;
  /** The oracle definition of this card */
  oracleId: string;
  /** Card face data - imported from Scryfall */
  cardData: ScryfallCard;
  /** Current face for double-faced/transform cards */
  currentFaceIndex: number;
  /** Whether this card is face down (for morph, manifest, etc.) */
  isFaceDown: boolean;
  /** Current controller of this card */
  controllerId: PlayerId;
  /** Original owner of this card */
  ownerId: PlayerId;

  // State flags
  /** Whether the permanent is activated (internally tracked as "tapped" for compatibility) */
  isTapped: boolean;
  /** Whether the permanent is flipped (flip cards) */
  isFlipped: boolean;
  /** Whether the permanent is turned face up (was face down) */
  isTurnedFaceUp: boolean;
  /** Whether the permanent is phased out */
  isPhasedOut: boolean;
  /** Whether the permanent has deployment restriction (internally tracked as "summoning sickness") */
  hasSummoningSickness: boolean;

  // Counters and modifications
  /** Markers on this card (p1p1, +1/+1, charge, etc.) */
  counters: Counter[];
  /** Damage marked on this creature (0 for non-creatures) */
  damage: number;
  /** Toughness modifications from effects */
  toughnessModifier: number;
  /** Power modifications from effects */
  powerModifier: number;

  // Attachments and relationships
  /** ID of card this is attached to (for Equipment, Auras, Fortifications) */
  attachedToId: CardInstanceId | null;
  /** IDs of cards attached to this (for creatures with Equipment/Auras) */
  attachedCardIds: CardInstanceId[];

  // Timestamps for ordering
  /** When this permanent entered the play area (for timestamp ordering) */
  enteredBattlefieldTimestamp: number;
  /** When this card became attached to its current attachment */
  attachedTimestamp: number | null;

  // Token-specific
  /** Whether this is a token */
  isToken: boolean;
  /** For tokens, a copy of the token's defining characteristics */
  tokenData: ScryfallCard | null;
}

/**
 * A marker on a card (internally referred to as "counter" for compatibility)
 */
export interface Counter {
  /** Type of marker (e.g., "+1/+1", "charge", "feit", "verse", "time", "blood") */
  type: string;
  /** Number of markers of this type */
  count: number;
}

/**
 * A zone where cards can exist
 *
 * Note: Zone type names use MTG terminology internally for backward compatibility.
 * Use translateZone() from terminology-translation.ts for user-facing display.
 */
export type ZoneType =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "stack"
  | "command"
  | "sideboard"
  | "anticipate";

/**
 * A specific location containing cards
 */
export interface Zone {
  /** Type of zone */
  type: ZoneType;
  /** ID of the player who owns this zone (null for shared zones like stack) */
  playerId: PlayerId | null;
  /** Ordered list of card IDs in this zone */
  cardIds: CardInstanceId[];
  /** Whether this zone is revealed to all players */
  isRevealed: boolean;
  /** Which players can see this zone (empty = all can see, populated = restricted) */
  visibleTo: PlayerId[];
}

/**
 * A player in the game
 *
 * ISSUE #435: Generic Card Game Framework Core
 * This interface represents a generic player that can participate in different game systems.
 * Some fields are specific to certain game modes (e.g., commander/leader damage).
 */
export interface Player {
  /** Unique player identifier */
  id: PlayerId;
  /** Display name */
  name: string;
  /** Current life total */
  life: number;
  /** Current poison counters */
  poisonCounters: number;

  /**
   * Legendary leader damage tracking
   * Maps attacker ID to damage dealt
   * Displayed as: "Legendary Leader Damage" (via translation layer)
   * Internal: "Commander Damage" (for backward compatibility)
   */
  commanderDamage: Map<PlayerId, number>;

  /** Maximum hand size */
  maxHandSize: number;
  /** Current hand size (for effects that modify it) */
  currentHandSizeModifier: number;
  /** Whether player has lost the game */
  hasLost: boolean;
  /** Reason for loss (if any) */
  lossReason: string | null;

  // Resource sources played this turn
  /**
   * Number of resource sources played this turn
   * Displayed as: "Sources Played"
   * Internal: "Lands Played" (for backward compatibility)
   */
  landsPlayedThisTurn: number;
  /**
   * Maximum resource sources that can be played this turn
   * Displayed as: "Max Sources Per Turn"
   * Internal: "Max Lands Per Turn" (for backward compatibility)
   */
  maxLandsPerTurn: number;

  // Resource pool
  /**
   * Available resources for this player
   * Displayed as: "Resource Pool" (via translation layer)
   * Internal: "Mana Pool" (for backward compatibility)
   */
  manaPool: ManaPool;

  // Legendary leader format-specific
  /**
   * Whether this player's leader is in the reserve zone
   * Displayed as: "In Reserve Zone"
   * Internal: "In Command Zone" (for backward compatibility)
   */
  isInCommandZone: boolean;
  /** Experience counters (for legendary leader format) */
  experienceCounters: number;
  /**
   * Number of times this player has cast their leader from reserve zone
   * Displayed as: "Leader Cast Count"
   * Internal: "Commander Cast Count" (for backward compatibility)
   */
  commanderCastCount: number;

  // State tracking
  /** Priority pass tracking - whether player has passed priority this phase */
  hasPassedPriority: boolean;
  /** Whether player has activated a resource ability this stack item */
  hasActivatedManaAbility: boolean;
  /** Whether player gets an additional combat phase this turn */
  additionalCombatPhase: boolean;
  /** Whether player gets an additional main phase this turn */
  additionalMainPhase: boolean;

  // Multiplayer game options
  /** Whether this player has offered a draw */
  hasOfferedDraw: boolean;
  /** Whether this player has accepted a draw offer */
  hasAcceptedDraw: boolean;
}

/**
 * Mana pool tracking (internally referred to as "mana", displayed as "resource")
 *
 * This is a specific implementation of the ResourcePool interface for MTG-like games.
 * In the generic framework, this represents one possible resource system implementation.
 *
 * Display terminology: "Resource" (via translation layer)
 * Internal terminology: "Mana" (for backward compatibility)
 */
export interface ManaPool {
  /** Colorless mana */
  colorless: number;
  /** White mana */
  white: number;
  /** Blue mana */
  blue: number;
  /** Black mana */
  black: number;
  /** Red mana */
  red: number;
  /** Green mana */
  green: number;
  /** Generic mana that can be paid with any color */
  generic: number;
}

/**
 * A turn phase or step
 *
 * ISSUE #435: Generic Card Game Framework Core
 * This enum defines the standard turn structure for a card game.
 * While internally named with MTG terminology, these phases represent
 * a generic turn structure that can be adapted for different game systems.
 *
 * Display translations (via terminology-translation.ts):
 * - untap → Reactivation
 * - upkeep → Maintenance
 * - draw → Draw
 * - precombat_main → Pre-Combat Main
 * - begin_combat → Begin Combat
 * - declare_attackers → Declare Attackers
 * - declare_blockers → Declare Blockers
 * - combat_damage_first_strike → First Strike Damage
 * - combat_damage → Combat Damage
 * - end_combat → End Combat
 * - postcombat_main → Post-Combat Main
 * - end → End
 * - cleanup → Cleanup
 */
export enum Phase {
  /** Untap step (displayed as "Reactivation") */
  UNTAP = "untap",
  /** Upkeep step (displayed as "Maintenance") */
  UPKEEP = "upkeep",
  /** Draw step */
  DRAW = "draw",
  /** Pre-combat main phase */
  PRECOMBAT_MAIN = "precombat_main",
  /** Beginning of combat step */
  BEGIN_COMBAT = "begin_combat",
  /** Declare attackers step */
  DECLARE_ATTACKERS = "declare_attackers",
  /** Declare blockers step */
  DECLARE_BLOCKERS = "declare_blockers",
  /** Combat damage first strike */
  COMBAT_DAMAGE_FIRST_STRIKE = "combat_damage_first_strike",
  /** Combat damage normal */
  COMBAT_DAMAGE = "combat_damage",
  /** End of combat step */
  END_COMBAT = "end_combat",
  /** Post-combat main phase */
  POSTCOMBAT_MAIN = "postcombat_main",
  /** End step */
  END = "end",
  /** Cleanup step */
  CLEANUP = "cleanup",
}

/**
 * Turn structure
 */
export interface Turn {
  /** ID of the active player */
  activePlayerId: PlayerId;
  /** Current phase */
  currentPhase: Phase;
  /** Turn number (starts at 1) */
  turnNumber: number;
  /** Number of extra turns this player has after this one */
  extraTurns: number;
  /** Whether this is the first turn of the game (skip draw and main phase) */
  isFirstTurn: boolean;
  /** Timestamp when turn started */
  startedAt: number;
}

/**
 * An object on the stack (card effect or ability)
 *
 * ISSUE #435: Generic Card Game Framework Core
 * This interface represents objects on the action stack, which is a generic concept
 * for resolving card effects and abilities in a defined order.
 *
 * Display translations (via terminology-translation.ts):
 * - spell → card effect
 * - mana cost → resource cost
 *
 * Internal type names use MTG terminology for backward compatibility.
 */
export interface StackObject {
  /** Unique identifier */
  id: StackObjectId;
  /** Type of stack object */
  type: "spell" | "ability";
  /** ID of the card being cast (for spells) or source of ability */
  sourceCardId: CardInstanceId | null;
  /** ID of player who cast this */
  controllerId: PlayerId;
  /** Display name of this spell/ability */
  name: string;
  /** Oracle text of this spell/ability */
  text: string;
  /**
   * Resource cost for this effect
   * Displayed as: "Resource Cost" (via translation layer)
   * Internal: "Mana Cost" (for backward compatibility)
   */
  manaCost: string | null;
  /** Target(s) of this spell/ability */
  targets: Target[];
  /** Modes chosen (for modal spells) */
  chosenModes: string[];
  /** Values for X, Y, etc. */
  variableValues: Map<string, number>;
  /** Whether this has been countered */
  isCountered: boolean;
  /** Timestamp when added to stack */
  timestamp: number;
}

/**
 * A target for a spell or ability
 */
export interface Target {
  /** Type of target */
  type: "card" | "player" | "stack" | "zone";
  /** ID of the target */
  targetId: string;
  /** Whether the target is valid */
  isValid: boolean;
}

/**
 * Combat state
 */
export interface Combat {
  /** Whether currently in combat phase */
  inCombatPhase: boolean;
  /** Attacking creatures */
  attackers: Attacker[];
  /** Blocking creatures - Map from attacker ID to blockers */
  blockers: Map<CardInstanceId, Blocker[]>;
  /** Remaining combat phases to process */
  remainingCombatPhases: number;
}

/**
 * An attacking creature
 */
export interface Attacker {
  /** ID of the attacking creature */
  cardId: CardInstanceId;
  /** ID of player or planeswalker being attacked */
  defenderId: PlayerId | CardInstanceId;
  /** Whether this creature is attacking a planeswalker (displayed as "champion") */
  isAttackingPlaneswalker: boolean;
  /** Damage that will be dealt */
  damageToDeal: number;
  /** Whether this creature has first strike */
  hasFirstStrike: boolean;
  /** Whether this creature has double strike */
  hasDoubleStrike: boolean;
}

/**
 * A blocking creature
 */
export interface Blocker {
  /** ID of the blocking creature */
  cardId: CardInstanceId;
  /** ID of the attacker being blocked */
  attackerId: CardInstanceId;
  /** Damage that will be dealt */
  damageToDeal: number;
  /** Order of blockers (for multiple blockers) */
  blockerOrder: number;
  /** Whether this creature has first strike */
  hasFirstStrike: boolean;
  /** Whether this creature has double strike */
  hasDoubleStrike: boolean;
}

/**
 * Choice that needs to be made
 */
export interface WaitingChoice {
  /** Type of choice needed */
  type:
    | "choose_targets"
    | "choose_mode"
    | "choose_value"
    | "choose_cards"
    | "yes_no"
    | "payment"
    | "attackers"
    | "blockers"
    | "ordering"
    | "priority";
  /** ID of player who needs to make this choice */
  playerId: PlayerId;
  /** ID of the stack object this choice is for */
  stackObjectId: StackObjectId | null;
  /** Prompt text to display */
  prompt: string;
  /** Available choices */
  choices: ChoiceOption[];
  /** Minimum number of choices to make */
  minChoices: number;
  /** Maximum number of choices to make */
  maxChoices: number;
  /** Timestamp when this choice was presented */
  presentedAt: number;
}

/**
 * An option in a choice
 */
export interface ChoiceOption {
  /** Display text */
  label: string;
  /** Value of this option */
  value: string | number | boolean;
  /** Whether this option is valid */
  isValid: boolean;
}

/**
 * The complete game state
 *
 * ISSUE #435: Generic Card Game Framework Core
 * This interface represents the complete state of a card game.
 * It is designed to be generic and extensible to support different game systems.
 *
 * Format Examples (internal names, displayed via translation):
 * - "legendary-commander" → "Legendary Commander" (leader-based format)
 * - "constructed-core" → "Constructed Core" (standard format)
 * - "constructed-legacy" → "Constructed Legacy" (expanded format)
 *
 * Display translations for format-specific terms:
 * - commander → legendary leader
 * - mana → resource
 * - lands → sources
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
  /**
   * Game format identifier
   * Displayed via getFormatDisplayName() from game-rules.ts
   */
  format: string;
  /** Timestamp when game was created */
  createdAt: number;
  /** Timestamp when game was last modified */
  lastModifiedAt: number;
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
  data: Record<string, unknown>;
}

/**
 * Types of game actions
 *
 * ISSUE #435: Generic Card Game Framework Core
 * This enum defines the standard actions that can be performed in a card game.
 * While internally named with MTG terminology, these actions represent
 * generic game mechanics that can be adapted for different game systems.
 *
 * Display translations (via terminology-translation.ts):
 * - cast_spell → Play card effect
 * - activate_ability → Activate ability
 * - play_land → Play source
 * - tap_card → Activate card
 * - untap_card → Deactivate card
 * - exile_card → Send to void
 * - pay_mana → Pay resource
 * - add_mana → Add resource
 *
 * Internal type names use MTG terminology for backward compatibility.
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
  | "deal_damage"
  | "pay_mana"
  | "add_mana"
  | "mulligan"
  | "concede"
  | "undo";
