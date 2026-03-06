/**
 * Core type definitions for the Planar Nexus game state engine.
 * These types represent a generic card game framework that can support
 * different game systems while maintaining backward compatibility with
 * existing Magic: The Gathering implementations.
 *
 * The framework uses generic terminology that maps to game-specific terms:
 * - "Legendary Leader" → Commander (MTG), Hero/Avatar (other systems)
 * - "Resources" → Mana (MTG), Energy/Focus (other systems)
 * - "Sources" → Lands (MTG), Nodes/Generators (other systems)
 * - "Leader Zone" → Command Zone (MTG)
 */

import { ScryfallCard } from "@/app/actions";

// Re-export ScryfallCard for use in other game-state modules
export type { ScryfallCard } from "@/app/actions";

/**
 * Game system type identifier
 * Different game systems can implement their own rules while using
 * the same core framework
 */
export type GameSystemType = "generic" | "magic" | "custom";

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
  /** Whether the permanent is tapped */
  isTapped: boolean;
  /** Whether the permanent is flipped (flip cards) */
  isFlipped: boolean;
  /** Whether the permanent is turned face up (was face down) */
  isTurnedFaceUp: boolean;
  /** Whether the permanent is phased out */
  isPhasedOut: boolean;
  /** Whether the permanent has summoning sickness */
  hasSummoningSickness: boolean;

  // Counters and modifications
  /** Counters on this card (p1p1, +1/+1, charge, etc.) */
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
  /** When this permanent entered the battlefield (for timestamp ordering) */
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
 * A counter on a card
 */
export interface Counter {
  /** Type of counter (e.g., "+1/+1", "charge", "feit", "verse", "time", "blood") */
  type: string;
  /** Number of counters of this type */
  count: number;
}

/**
 * Generic zone types that can map to game-specific zones
 *
 * Generic → MTG mappings:
 * - deck → library
 * - play → battlefield
 * - discard → graveyard
 * - removed → exile
 * - leader → command (for commander/legendary leader)
 */
export type ZoneType =
  | "deck"           // Generic: Draw pile (MTG: library)
  | "hand"           // Generic: Cards in hand
  | "play"           // Generic: Active play area (MTG: battlefield)
  | "discard"        // Generic: Discard pile (MTG: graveyard)
  | "removed"        // Generic: Removed from game (MTG: exile)
  | "stack"          // Generic: Active effects/stack
  | "leader"         // Generic: Leader zone (MTG: command zone)
  | "sideboard"      // Generic: Optional extra cards
  | "anticipate";    // Generic: Looked-at but not drawn

/**
 * MTG-specific zone type aliases for backward compatibility
 * These map to the generic zone types
 */
export type MTGZoneType =
  | "library"      // Maps to "deck"
  | "battlefield"  // Maps to "play"
  | "graveyard"    // Maps to "discard"
  | "exile"        // Maps to "removed"
  | "command";     // Maps to "leader"

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
 * Generic player resource pool
 * Can represent mana (MTG), energy (other systems), or any game-specific resource
 */
export interface ResourcePool {
  /** Generic resources that can be used flexibly */
  generic: number;
  /** System-specific resources (can be color-coded, typed, etc.) */
  specific: Map<string, number>;
}

/**
 * MTG-specific mana pool type for backward compatibility
 * Maps to the generic ResourcePool
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
 * Convert MTG ManaPool to generic ResourcePool
 */
export function manaPoolToResourcePool(manaPool: ManaPool): ResourcePool {
  return {
    generic: manaPool.generic + manaPool.colorless,
    specific: new Map([
      ["white", manaPool.white],
      ["blue", manaPool.blue],
      ["black", manaPool.black],
      ["red", manaPool.red],
      ["green", manaPool.green],
    ]),
  };
}

/**
 * Convert generic ResourcePool to MTG ManaPool
 */
export function resourcePoolToManaPool(resourcePool: ResourcePool): ManaPool {
  return {
    colorless: resourcePool.generic,
    white: resourcePool.specific.get("white") || 0,
    blue: resourcePool.specific.get("blue") || 0,
    black: resourcePool.specific.get("black") || 0,
    red: resourcePool.specific.get("red") || 0,
    green: resourcePool.specific.get("green") || 0,
    generic: 0, // Already incorporated into colorless
  };
}

/**
 * Generic player statistics that can vary by game system
 */
export interface PlayerStats {
  /** Primary health/points */
  health: number;
  /** Secondary counters (poison, corruption, etc.) */
  secondaryCounters: Map<string, number>;
  /** Damage taken from leader/hero attacks */
  leaderDamage: Map<PlayerId, number>;
  /** Experience or progression counters */
  experienceCounters: number;
}

/**
 * A player in the game (generic framework)
 */
export interface Player {
  /** Unique player identifier */
  id: PlayerId;
  /** Display name */
  name: string;
  /** Game system being used */
  gameSystem: GameSystemType;
  /** Player statistics (health, counters, etc.) */
  stats: PlayerStats;
  /** Maximum hand size */
  maxHandSize: number;
  /** Current hand size modifier */
  currentHandSizeModifier: number;
  /** Whether player has lost the game */
  hasLost: boolean;
  /** Reason for loss (if any) */
  lossReason: string | null;

  // Resource source management (generic for lands, nodes, generators)
  /** Number of sources played this turn */
  sourcesPlayedThisTurn: number;
  /** Maximum sources that can be played this turn */
  maxSourcesPerTurn: number;

  // Resource pool (generic for mana, energy, etc.)
  /** Available resources */
  resourcePool: ResourcePool;

  // Leader/hero specific (generic for commander format)
  /** Whether this player is in the leader zone */
  isInLeaderZone: boolean;
  /** Number of times leader has been cast/activated */
  leaderCastCount: number;

  // State tracking
  /** Priority pass tracking - whether player has passed priority this phase */
  hasPassedPriority: boolean;
  /** Whether player has activated a resource ability this stack item */
  hasActivatedResourceAbility: boolean;
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
 * MTG-specific Player interface for backward compatibility
 * Uses MTG terminology while internally using generic framework
 */
export interface MTGPlayer extends Omit<Player, 'stats' | 'resourcePool' | 'isInLeaderZone' | 'leaderCastCount' | 'sourcesPlayedThisTurn' | 'maxSourcesPerTurn' | 'hasActivatedResourceAbility'> {
  /** Current life total (MTG-specific) */
  life: number;
  /** Current poison counters (MTG-specific) */
  poisonCounters: number;
  /** Commander damage dealt by each commander (MTG-specific) */
  commanderDamage: Map<PlayerId, number>;
  /** Number of lands played this turn (MTG-specific) */
  landsPlayedThisTurn: number;
  /** Maximum lands that can be played this turn (MTG-specific) */
  maxLandsPerTurn: number;
  /** Available mana in each color (MTG-specific) */
  manaPool: ManaPool;
  /** Whether this player is in the command zone (MTG-specific) */
  isInCommandZone: boolean;
  /** Experience counters (MTG-specific) */
  experienceCounters: number;
  /** Player has cast their commander from command zone (MTG-specific) */
  commanderCastCount: number;
  /** Whether player has activated a mana ability this stack item (MTG-specific) */
  hasActivatedManaAbility: boolean;
}

/**
 * Convert generic Player to MTG Player for backward compatibility
 */
export function playerToMTGPlayer(player: Player): MTGPlayer {
  return {
    id: player.id,
    name: player.name,
    gameSystem: "magic",
    life: player.stats.health,
    poisonCounters: player.stats.secondaryCounters.get("poison") || 0,
    commanderDamage: player.stats.leaderDamage,
    maxHandSize: player.maxHandSize,
    currentHandSizeModifier: player.currentHandSizeModifier,
    hasLost: player.hasLost,
    lossReason: player.lossReason,
    landsPlayedThisTurn: player.sourcesPlayedThisTurn,
    maxLandsPerTurn: player.maxSourcesPerTurn,
    manaPool: resourcePoolToManaPool(player.resourcePool),
    isInCommandZone: player.isInLeaderZone,
    experienceCounters: player.stats.experienceCounters,
    commanderCastCount: player.leaderCastCount,
    hasPassedPriority: player.hasPassedPriority,
    hasActivatedManaAbility: player.hasActivatedResourceAbility,
    additionalCombatPhase: player.additionalCombatPhase,
    additionalMainPhase: player.additionalMainPhase,
    hasOfferedDraw: player.hasOfferedDraw,
    hasAcceptedDraw: player.hasAcceptedDraw,
  };
}

/**
 * Convert MTG Player to generic Player
 */
export function mtgPlayerToPlayer(mtgPlayer: MTGPlayer): Player {
  const secondaryCounters = new Map<string, number>();
  secondaryCounters.set("poison", mtgPlayer.poisonCounters);

  return {
    id: mtgPlayer.id,
    name: mtgPlayer.name,
    gameSystem: "magic",
    stats: {
      health: mtgPlayer.life,
      secondaryCounters,
      leaderDamage: mtgPlayer.commanderDamage,
      experienceCounters: mtgPlayer.experienceCounters,
    },
    maxHandSize: mtgPlayer.maxHandSize,
    currentHandSizeModifier: mtgPlayer.currentHandSizeModifier,
    hasLost: mtgPlayer.hasLost,
    lossReason: mtgPlayer.lossReason,
    sourcesPlayedThisTurn: mtgPlayer.landsPlayedThisTurn,
    maxSourcesPerTurn: mtgPlayer.maxLandsPerTurn,
    resourcePool: manaPoolToResourcePool(mtgPlayer.manaPool),
    isInLeaderZone: mtgPlayer.isInCommandZone,
    leaderCastCount: mtgPlayer.commanderCastCount,
    hasPassedPriority: mtgPlayer.hasPassedPriority,
    hasActivatedResourceAbility: mtgPlayer.hasActivatedManaAbility,
    additionalCombatPhase: mtgPlayer.additionalCombatPhase,
    additionalMainPhase: mtgPlayer.additionalMainPhase,
    hasOfferedDraw: mtgPlayer.hasOfferedDraw,
    hasAcceptedDraw: mtgPlayer.hasAcceptedDraw,
  };
}


/**
 * A turn phase or step
 */
export enum Phase {
  /** Untap step */
  UNTAP = "untap",
  /** Upkeep step */
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
 * An object on the stack (spell or ability)
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
  /** Whether this creature is attacking a planeswalker */
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
 * Generic game format configuration
 */
export interface GameFormat {
  /** Format identifier */
  name: string;
  /** Game system type */
  gameSystem: GameSystemType;
  /** Maximum copies of each card (except basics/sources) */
  maxCopies: number;
  /** Minimum deck size */
  minDeckSize: number;
  /** Maximum deck size (or Infinity for no limit) */
  maxDeckSize: number;
  /** Starting health/points */
  startingHealth: number;
  /** Leader/hero damage threshold (if applicable) */
  leaderDamageThreshold: number | null;
  /** Uses sideboard/extra cards */
  usesSideboard: boolean;
  /** Sideboard size */
  sideboardSize: number;
}

/**
 * Generic game state interface
 * Supports different game systems through configurable formats
 */
export interface GameState {
  /** Unique game identifier */
  gameId: string;
  /** Game system type being used */
  gameSystem: GameSystemType;
  /** Game format configuration */
  format: GameFormat;
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
  /** Timestamp when game was created */
  createdAt: number;
  /** Timestamp when game was last modified */
  lastModifiedAt: number;
}

/**
 * MTG-specific game state for backward compatibility
 * Maintains MTG format string while using generic framework internally
 */
export interface MTGGameState extends Omit<GameState, 'format' | 'gameSystem'> {
  /** Game format (e.g., "standard", "commander", "historic") */
  format: string;
}

/**
 * Convert generic GameState to MTG GameState
 */
export function gameStateToMTGGameState(state: GameState): MTGGameState {
  return {
    ...state,
    format: state.format.name,
  };
}

/**
 * Convert MTG GameState to generic GameState
 */
export function mtgGameStateToGameState(mtgState: MTGGameState): GameState {
  return {
    ...mtgState,
    gameSystem: "magic",
    format: getMTGFormatConfig(mtgState.format),
  };
}

/**
 * Get MTG format configuration from format name
 */
function getMTGFormatConfig(formatName: string): GameFormat {
  const formatConfigs: Record<string, GameFormat> = {
    standard: {
      name: "standard",
      gameSystem: "magic",
      maxCopies: 4,
      minDeckSize: 60,
      maxDeckSize: Infinity,
      startingHealth: 20,
      leaderDamageThreshold: null,
      usesSideboard: true,
      sideboardSize: 15,
    },
    modern: {
      name: "modern",
      gameSystem: "magic",
      maxCopies: 4,
      minDeckSize: 60,
      maxDeckSize: Infinity,
      startingHealth: 20,
      leaderDamageThreshold: null,
      usesSideboard: true,
      sideboardSize: 15,
    },
    commander: {
      name: "commander",
      gameSystem: "magic",
      maxCopies: 1,
      minDeckSize: 100,
      maxDeckSize: 100,
      startingHealth: 40,
      leaderDamageThreshold: 21,
      usesSideboard: false,
      sideboardSize: 0,
    },
  };

  return formatConfigs[formatName] || formatConfigs.standard;
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
