/**
 * Core type definitions for the Planar Nexus game state engine.
 *
 * This module now uses the generic card game framework to support multiple
 * game systems. MTG-specific terminology is mapped to generic equivalents:
 * - "Commander" → "Legendary Leader"
 * - "mana" → "resources"
 * - "lands" → "sources"
 * - "command zone" → "leader zone"
 *
 * Backward compatibility is maintained through type aliases and adapters.
 */

import { ScryfallCard } from "@/app/actions";

// Re-export ScryfallCard for use in other game-state modules
export type { ScryfallCard } from "@/app/actions";

// Import generic types
export * from "./generic-types";

// ============================================================================
// BACKWARD COMPATIBILITY: Type Aliases for MTG-specific terminology
// ============================================================================

// Re-export generic types with MTG-specific names for backward compatibility

/**
 * MTG-specific zone type including "command" zone
 * This is the full MTG zone type - use this when working with MTG data
 */
export type MTGZoneType =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "stack"
  | "command" // MTG-specific "command" zone
  | "sideboard"
  | "anticipate";

/**
 * MTG Mana Pool - specialized resource pool for MTG
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
 * Backward compatibility: CardInstance with MTG-specific cardData
 * This allows existing code that expects ScryfallCard to continue working
 */
export interface MTGCardInstance {
  id: CardInstanceId;
  /** The oracle definition of this card (MTG-specific) */
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
 * Backward compatibility: Player with MTG-specific fields
 */
export interface MTGPlayer {
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

  // Mana pool
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
 * Backward compatibility: Zone with MTG-specific zone types
 */
export interface MTGZone {
  /** Type of zone */
  type: MTGZoneType;
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
 * Backward compatibility: StackObject with MTG-specific fields
 */
export interface MTGStackObject {
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
 * Backward compatibility: Attacker with MTG-specific fields
 */
export interface MTGAttacker {
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
 * MTG-specific game action types
 */
export type MTGActionType =
  | "cast_spell"
  | "activate_ability"
  | "pass_priority"
  | "declare_attackers"
  | "declare_blockers"
  | "play_land" // MTG-specific "play_land"
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
  | "gain_life" // MTG-specific "gain_life"
  | "lose_life" // MTG-specific "lose_life"
  | "deal_damage"
  | "pay_mana" // MTG-specific "pay_mana"
  | "add_mana" // MTG-specific "add_mana"
  | "mulligan"
  | "concede"
  | "undo";

/**
 * Backward compatibility: GameAction with MTG-specific types
 */
export interface MTGGameAction {
  /** Type of action */
  type: MTGActionType;
  /** Player performing the action */
  playerId: PlayerId;
  /** Timestamp when action was performed */
  timestamp: number;
  /** Action-specific data */
  data: Record<string, unknown>;
}

// ============================================================================
// DEFAULT EXPORTS - Using Generic Types
// ============================================================================

/**
 * Default CardInstance type - uses generic CardData
 * For MTG-specific usage, use MTGCardInstance
 */
export type DefaultCardInstance = CardInstance;

/**
 * Default Player type - uses generic fields
 * For MTG-specific usage, use MTGPlayer
 */
export type DefaultPlayer = Player;

/**
 * Default Zone type - uses generic ZoneType
 * For MTG-specific usage, use MTGZone
 */
export type DefaultZone = Zone;

/**
 * Default StackObject type - uses generic fields
 * For MTG-specific usage, use MTGStackObject
 */
export type DefaultStackObject = StackObject;

/**
 * Default Attacker type - uses generic fields
 * For MTG-specific usage, use MTGAttacker
 */
export type DefaultAttacker = Attacker;

/**
 * Default GameAction type - uses generic ActionType
 * For MTG-specific usage, use MTGGameAction
 */
export type DefaultGameAction = GameAction;

// ============================================================================
// TYPE ALIASES FOR EASY MIGRATION
// ============================================================================

/**
 * Type alias: Use ManaPool for MTG-specific resource operations
 */
export type ResourcePool = ManaPool;

/**
 * Type alias: Use MTGActionType for MTG-specific actions
 */
export type DefaultActionType = MTGActionType;

/**
 * Type alias: Use MTGZoneType for MTG-specific zones
 */
export type DefaultZoneType = MTGZoneType;

/**
 * Represents a single physical card in play
 * Unlike ScryfallCard which defines card types, this tracks game state
 *
 * Note: This is now an MTG-specific type. For generic usage, use CardInstance from generic-types.ts
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

  // Generic compatibility fields (for mapping to generic CardInstance)
  /** Generic card data (derived from ScryfallCard) */
  genericCardData?: CardData;
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
 * A zone where cards can exist
 * Note: This is now MTG-specific. For generic usage, use ZoneType from generic-types.ts
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
 * Note: This is now MTG-specific. For generic usage, use Zone from generic-types.ts
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
 * Note: This is now an MTG-specific type. For generic usage, use Player from generic-types.ts
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

  // Mana pool
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

  // Generic compatibility fields (mapped from generic Player)
  /** Current health (mapped from life for generic compatibility) */
  health?: number;
  /** Leader damage (mapped from commanderDamage for generic compatibility) */
  leaderDamage?: Map<PlayerId, number>;
  /** Sources played this turn (mapped from landsPlayedThisTurn for generic compatibility) */
  sourcesPlayedThisTurn?: number;
  /** Max sources per turn (mapped from maxLandsPerTurn for generic compatibility) */
  maxSourcesPerTurn?: number;
  /** Resources (mapped from manaPool for generic compatibility) */
  resources?: { resources: Map<string, number> } & ManaPool;
  /** Leader zone (mapped from isInCommandZone for generic compatibility) */
  isInLeaderZone?: boolean;
  /** Leader cast count (mapped from commanderCastCount for generic compatibility) */
  leaderCastCount?: number;
  /** Has activated resource ability (mapped from hasActivatedManaAbility for generic compatibility) */
  hasActivatedResourceAbility?: boolean;
}

/**
 * Mana pool tracking
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
 * Note: This is now MTG-specific. For generic usage, use StackObject from generic-types.ts
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

  // Generic compatibility fields
  /** Cost (mapped from manaCost for generic compatibility) */
  cost?: string | null;
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
 * Note: This is now MTG-specific. For generic usage, use Attacker from generic-types.ts
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

  // Generic compatibility fields
  /** Whether attacking a card (mapped from isAttackingPlaneswalker) */
  isAttackingCard?: boolean;
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
 * Note: This is now MTG-specific. For generic usage, use GameAction from generic-types.ts
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
 * Note: This is now MTG-specific. For generic usage, use ActionType from generic-types.ts
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
