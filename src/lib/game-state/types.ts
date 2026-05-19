/**
 * Core type definitions for the Planar Nexus game state engine.
 * These types represent the complete state of a tabletop card game.
 *
 * Note: Internal type names may reference MTG terminology for backward compatibility
 * and implementation clarity. All user-facing text should use generic terminology
 * via the translation layer (see terminology-translation.ts).
 */

import type { ScryfallCard } from "@/app/actions";

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

  // Land-specific
  /** For lands like Multiversal Passage - the chosen basic land type this land is */
  chosenBasicLandType: string | null;

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
  /** Commander damage dealt by each commander */
  commanderDamage: Map<PlayerId, number>;
  /** Maximum hand size */
  maxHandSize: number;
  /** Current hand size (for effects that modify it) */
  currentHandSizeModifier: number;
  /** Whether player has lost the game */
  hasLost: boolean;
  /** Reason for loss (if any) */
  lossReason: string | null;

  // Lands played this turn
  /** Number of lands played this turn */
  landsPlayedThisTurn: number;
  /** Maximum lands that can be played this turn */
  maxLandsPerTurn: number;

  // Mana pool (internally tracked, displayed as "energy" to users)
  /** Available mana in each color */
  manaPool: ManaPool;

  // Commander-specific
  /** Whether this player is in the command zone (for commander format) */
  isInCommandZone: boolean;
  /** Experience counters (for commander) */
  experienceCounters: number;
  /** Player has cast their commander from command zone */
  commanderCastCount: number;

  // State tracking
  /** Priority pass tracking - whether player has passed priority this phase */
  hasPassedPriority: boolean;
  /** Whether player has activated a mana ability this stack item */
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
 * Mana pool tracking (internally referred to as "mana", displayed as "energy")
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
 * Note: Phase names use MTG terminology internally. Use translatePhase() from
 * terminology-translation.ts for user-facing display.
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
 * Note: Type includes "spell" internally for compatibility, displayed as "card effect"
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
  /** Mana cost (for spells) */
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

// ============================================================================
// AI-Specific Unified Types
// ============================================================================
// These types provide a simplified interface for AI decision-making while
// maintaining compatibility with the engine's detailed GameState format.
// Use conversion functions in serialization.ts to translate between formats.
// ============================================================================

/**
 * Simplified permanent representation for AI evaluation
 * Contains only the information needed for AI decision-making
 */
export interface AIPermanent {
  /** Unique identifier for this permanent */
  id: string;
  /** Reference to the card instance in the engine */
  cardInstanceId: CardInstanceId;
  /** Card name */
  name: string;
  /** Permanent type */
  type:
    | "creature"
    | "land"
    | "artifact"
    | "enchantment"
    | "planeswalker"
    | "other";
  /** Controller player ID */
  controller: PlayerId;
  /** Whether the permanent is tapped */
  tapped: boolean;
  /** Power (for creatures) */
  power?: number;
  /** Toughness (for creatures) */
  toughness?: number;
  /** Loyalty (for planeswalkers) */
  loyalty?: number;
  /** Counters on this permanent */
  counters?: { [key: string]: number };
  /** Keywords this permanent has */
  keywords?: string[];
  /** Mana value of the card */
  manaValue?: number;
  /** Whether this permanent has summoning sickness */
  summoningSickness?: boolean;
  /** Damage marked on this creature */
  damage?: number;
}

/**
 * Simplified card in hand representation for AI evaluation
 */
export interface AIHandCard {
  /** Reference to the card instance in the engine */
  cardInstanceId: CardInstanceId;
  /** Card name */
  name: string;
  /** Card type line */
  type: string;
  /** Mana value */
  manaValue: number;
  /** Card colors */
  colors?: string[];
  /** Oracle text */
  oracleText?: string;
  /** Keywords */
  keywords?: string[];
}

/**
 * Simplified player state for AI evaluation
 */
export interface AIPlayerState {
  /** Player ID */
  id: PlayerId;
  /** Player name */
  name?: string;
  /** Current life total */
  life: number;
  /** Poison counters */
  poisonCounters: number;
  /** Commander damage dealt to each opponent */
  commanderDamage: { [playerId: string]: number };
  /** Cards in hand (simplified) */
  hand: AIHandCard[];
  /** Card IDs in graveyard */
  graveyard: string[];
  /** Card IDs in exile */
  exile: string[];
  /** Cards remaining in library */
  library: number;
  /** Permanents on battlefield */
  battlefield: AIPermanent[];
  /** Available mana pool */
  manaPool: { [color: string]: number };
  /** Lands played this turn */
  landsPlayedThisTurn?: number;
  /** Whether player has passed priority */
  hasPassedPriority?: boolean;
}

/**
 * Simplified turn information for AI evaluation
 */
export interface AITurnInfo {
  /** Current turn number */
  currentTurn: number;
  /** ID of the active player */
  currentPlayer: PlayerId;
  /** Current phase (simplified for AI) */
  phase: "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end";
  /** Current step within phase */
  step?: string;
  /** Player who currently has priority */
  priority: PlayerId;
}

/**
 * Simplified stack object for AI evaluation
 */
export interface AIStackObject {
  /** Stack object ID */
  id: string;
  /** Card instance ID (for spells) */
  cardInstanceId: string;
  /** Controller player ID */
  controller: PlayerId;
  /** Object type */
  type: "spell" | "ability";
  /** Target IDs */
  targets?: string[];
  /** Name of the spell/ability */
  name: string;
  /** Mana value */
  manaValue: number;
  /** Colors of the spell */
  colors?: string[];
}

/**
 * Simplified combat state for AI evaluation
 */
export interface AICombatState {
  /** Whether currently in combat phase */
  inCombatPhase: boolean;
  /** Attacking creatures */
  attackers: {
    cardInstanceId: string;
    defenderId: PlayerId | string;
    isAttackingPlaneswalker: boolean;
    damageToDeal: number;
    hasFirstStrike: boolean;
    hasDoubleStrike: boolean;
  }[];
  /** Blocking creatures - Map from attacker ID to blockers */
  blockers: {
    [attackerId: string]: {
      cardInstanceId: string;
      attackerId: string;
      damageToDeal: number;
      blockerOrder: number;
      hasFirstStrike: boolean;
      hasDoubleStrike: boolean;
    }[];
  };
}

/**
 * Complete AI GameState format
 * This is the unified format that AI modules should use
 */
export interface AIGameState {
  /** All players in the game */
  players: { [playerId: string]: AIPlayerState };
  /** Turn and phase information */
  turnInfo: AITurnInfo;
  /** Objects on the stack */
  stack: AIStackObject[];
  /** Combat state (optional for non-combat phases) */
  combat?: AICombatState;
  /** Command zone (for commander format) */
  commandZone?: {
    [playerId: string]: {
      commander?: AIPermanent;
      partner?: AIPermanent;
    };
  };
}

/**
 * Unified GameState type - alias for AIGameState
 * Use this type when you want to emphasize it's the unified format
 */
export type UnifiedGameState = AIGameState;

/**
 * Phase mapping from engine to AI format
 */
export const PHASE_MAPPING: Record<Phase, AITurnInfo["phase"]> = {
  [Phase.UNTAP]: "beginning",
  [Phase.UPKEEP]: "beginning",
  [Phase.DRAW]: "beginning",
  [Phase.PRECOMBAT_MAIN]: "precombat_main",
  [Phase.BEGIN_COMBAT]: "combat",
  [Phase.DECLARE_ATTACKERS]: "combat",
  [Phase.DECLARE_BLOCKERS]: "combat",
  [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: "combat",
  [Phase.COMBAT_DAMAGE]: "combat",
  [Phase.END_COMBAT]: "combat",
  [Phase.POSTCOMBAT_MAIN]: "postcombat_main",
  [Phase.END]: "end",
  [Phase.CLEANUP]: "end",
};
