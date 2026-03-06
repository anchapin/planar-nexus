/**
 * Generic Card Game Framework Core Types
 *
 * This module provides framework-agnostic type definitions for card game state management.
 * These types are designed to support multiple game systems (MTG, Hearthstone, etc.)
 * through abstraction and configuration.
 *
 * @module generic-types
 */

/**
 * Unique identifier for a card instance in the game
 */
export type CardInstanceId = string;

/**
 * Unique identifier for a player
 */
export type PlayerId = string;

/**
 * Unique identifier for an object on the stack
 */
export type StackObjectId = string;

/**
 * Generic card data interface
 * Game systems should extend this with their specific card properties
 */
export interface CardData {
  /** Unique identifier for this card definition */
  id: string;
  /** Display name */
  name: string;
  /** Card types (creature, sorcery, etc.) */
  types: string[];
  /** Subtypes (if any) */
  subtypes?: string[];
  /** Supertypes (legendary, basic, etc.) */
  supertypes?: string[];
  /** Cost to play this card */
  cost?: string;
  /** Oracle text/rules text */
  text?: string;
  /** Power (for creatures) */
  power?: number;
  /** Toughness (for creatures) */
  toughness?: number;
  /** Any additional game-system-specific data */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a single physical card in play
 * Tracks the dynamic state of a card during gameplay
 */
export interface CardInstance {
  id: CardInstanceId;
  /** The definition of this card */
  cardData: CardData;
  /** Current face index for double-faced/transform cards */
  currentFaceIndex: number;
  /** Whether this card is face down */
  isFaceDown: boolean;
  /** Current controller of this card */
  controllerId: PlayerId;
  /** Original owner of this card */
  ownerId: PlayerId;

  // State flags
  /** Whether the permanent is tapped */
  isTapped: boolean;
  /** Whether the permanent is flipped */
  isFlipped: boolean;
  /** Whether the permanent is turned face up (was face down) */
  isTurnedFaceUp: boolean;
  /** Whether the permanent is phased out */
  isPhasedOut: boolean;
  /** Whether the permanent has summoning sickness (or equivalent) */
  hasSummoningSickness: boolean;

  // Counters and modifications
  /** Counters on this card */
  counters: Counter[];
  /** Damage marked on this card */
  damage: number;
  /** Toughness modifications from effects */
  toughnessModifier: number;
  /** Power modifications from effects */
  powerModifier: number;

  // Attachments and relationships
  /** ID of card this is attached to */
  attachedToId: CardInstanceId | null;
  /** IDs of cards attached to this */
  attachedCardIds: CardInstanceId[];

  // Timestamps for ordering
  /** When this permanent entered the battlefield */
  enteredBattlefieldTimestamp: number;
  /** When this card became attached */
  attachedTimestamp: number | null;

  // Token-specific
  /** Whether this is a token */
  isToken: boolean;
  /** For tokens, a copy of the token's defining characteristics */
  tokenData: CardData | null;
}

/**
 * A counter on a card
 */
export interface Counter {
  /** Type of counter */
  type: string;
  /** Number of counters of this type */
  count: number;
}

/**
 * Generic zone types
 * Game systems can extend this with their specific zones
 */
export type ZoneType =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "stack"
  | "leader" // Generic "command" zone
  | "sideboard"
  | "anticipate";

/**
 * A specific location containing cards
 */
export interface Zone {
  /** Type of zone */
  type: ZoneType;
  /** ID of the player who owns this zone (null for shared zones) */
  playerId: PlayerId | null;
  /** Ordered list of card IDs in this zone */
  cardIds: CardInstanceId[];
  /** Whether this zone is revealed to all players */
  isRevealed: boolean;
  /** Which players can see this zone (empty = all can see) */
  visibleTo: PlayerId[];
}

/**
 * Resource pool (generic equivalent of mana pool)
 * Game systems can define their own resource structure
 */
export interface ResourcePool {
  /** Resource type to amount mapping */
  resources: Map<string, number>;
}

/**
 * Generic player interface
 */
export interface Player {
  /** Unique player identifier */
  id: PlayerId;
  /** Display name */
  name: string;
  /** Current life total (or equivalent health) */
  health: number;
  /** Current poison counters (or equivalent alternative win condition) */
  poisonCounters: number;
  /** Leader damage dealt by each leader */
  leaderDamage: Map<PlayerId, number>;
  /** Maximum hand size */
  maxHandSize: number;
  /** Current hand size modifier */
  currentHandSizeModifier: number;
  /** Whether player has lost the game */
  hasLost: boolean;
  /** Reason for loss (if any) */
  lossReason: string | null;

  // Source cards played this turn (generic "lands")
  /** Number of sources played this turn */
  sourcesPlayedThisTurn: number;
  /** Maximum sources that can be played this turn */
  maxSourcesPerTurn: number;

  // Resource pool
  /** Available resources */
  resources: ResourcePool;

  // Leader-specific (generic "commander")
  /** Whether this player is in the leader zone */
  isInLeaderZone: boolean;
  /** Experience counters (or equivalent) */
  experienceCounters: number;
  /** Number of times leader has been cast from leader zone */
  leaderCastCount: number;

  // State tracking
  /** Whether player has passed priority this phase */
  hasPassedPriority: boolean;
  /** Whether player has activated a resource ability this stack item */
  hasActivatedResourceAbility: boolean;
  /** Whether player gets an additional combat phase */
  additionalCombatPhase: boolean;
  /** Whether player gets an additional main phase */
  additionalMainPhase: boolean;

  // Multiplayer game options
  /** Whether this player has offered a draw */
  hasOfferedDraw: boolean;
  /** Whether this player has accepted a draw offer */
  hasAcceptedDraw: boolean;
}

/**
 * Generic turn phase
 * Game systems should extend this with their specific phases
 */
export enum Phase {
  UNTAP = "untap",
  UPKEEP = "upkeep",
  DRAW = "draw",
  PRECOMBAT_MAIN = "precombat_main",
  BEGIN_COMBAT = "begin_combat",
  DECLARE_ATTACKERS = "declare_attackers",
  DECLARE_BLOCKERS = "declare_blockers",
  COMBAT_DAMAGE_FIRST_STRIKE = "combat_damage_first_strike",
  COMBAT_DAMAGE = "combat_damage",
  END_COMBAT = "end_combat",
  POSTCOMBAT_MAIN = "postcombat_main",
  END = "end",
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
  /** Turn number */
  turnNumber: number;
  /** Number of extra turns */
  extraTurns: number;
  /** Whether this is the first turn */
  isFirstTurn: boolean;
  /** Timestamp when turn started */
  startedAt: number;
}

/**
 * An object on the stack (spell or ability)
 */
export interface StackObject {
  /** Unique identifier */
  id: StackObjectId;
  /** Type of stack object */
  type: "spell" | "ability";
  /** ID of the card being cast or source of ability */
  sourceCardId: CardInstanceId | null;
  /** ID of player who cast this */
  controllerId: PlayerId;
  /** Display name */
  name: string;
  /** Text of this spell/ability */
  text: string;
  /** Cost (for spells) */
  cost: string | null;
  /** Target(s) */
  targets: Target[];
  /** Modes chosen (for modal spells) */
  chosenModes: string[];
  /** Values for variables (X, Y, etc.) */
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
  /** ID of player or card being attacked */
  defenderId: PlayerId | CardInstanceId;
  /** Whether this creature is attacking a card (e.g., planeswalker) */
  isAttackingCard: boolean;
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
  /** Order of blockers */
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
  /** Game format */
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
 */
export type ActionType =
  | "cast_spell"
  | "activate_ability"
  | "pass_priority"
  | "declare_attackers"
  | "declare_blockers"
  | "play_source" // Generic "play_land"
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
  | "gain_health" // Generic "gain_life"
  | "lose_health" // Generic "lose_life"
  | "deal_damage"
  | "pay_resource" // Generic "pay_mana"
  | "add_resource" // Generic "add_mana"
  | "mulligan"
  | "concede"
  | "undo";

/**
 * Game system configuration
 * Defines how the generic framework maps to a specific game system
 */
export interface GameSystemConfig {
  /** System name (e.g., "mtg", "hearthstone") */
  name: string;
  /** Leader damage threshold (e.g., 21 for MTG Commander) */
  leaderDamageThreshold?: number;
  /** Default starting health */
  startingHealth: number;
  /** Default hand size */
  startingHandSize: number;
  /** Default sources per turn */
  maxSourcesPerTurn: number;
  /** Zone type mappings */
  zoneMappings?: Map<string, string>;
  /** Card type mappings */
  typeMappings?: Map<string, string[]>;
}
