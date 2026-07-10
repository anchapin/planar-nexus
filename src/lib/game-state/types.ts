/**
 * Core type definitions for the Planar Nexus game state engine.
 * These types represent the complete state of a tabletop card game.
 *
 * Note: Internal type names may reference MTG terminology for backward compatibility
 * and implementation clarity. All user-facing text should use generic terminology
 * via the translation layer (see terminology-translation.ts).
 */

import type { ScryfallCard } from "@/app/actions";
import type { ReplacementEffectManager } from "./replacement-effects";
import type { LayerSystem } from "./layer-system";

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

export type DungeonId = string;
export type DungeonRoomId = string;

export interface DungeonProgress {
  dungeonId: DungeonId;
  roomIndex: number;
  roomId?: DungeonRoomId;
}

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
  /**
   * Untap-modifying effect hook (CR 502.2).
   * When true, this permanent does NOT untap during its controller's untap step
   * (e.g. "This creature doesn't untap during your untap step").
   * Evaluated by the discrete untap step processor (`processUntapStep`).
   */
  doesNotUntapDuringUntapStep?: boolean;
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
  /** IDs of cards merged with this one via mutate (CR 702.140) */
  mutatedCardIds: CardInstanceId[];
  /** ID of the base creature this card is mutated onto (null if base or not mutated) */
  mutateBaseId: CardInstanceId | null;
  /** Whether this creature is part of a mutate stack */
  isMutated: boolean;
  /** ID of the component with the highest CMC (for text display) */
  highestCmcComponentId: CardInstanceId | null;

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

  // Blitz-specific (CR 702.150)
  /**
   * Whether this permanent was cast for its blitz cost this turn.
   *
   * Set on a creature as it enters the battlefield via a blitz-cost cast. While
   * true the creature gains haste, a "when this creature dies, draw a card"
   * triggered ability, and is sacrificed at the beginning of the next end step
   * (CR 702.150a). Only set when the blitz alternate cost was actually paid;
   * normal casting never sets this (CR 702.150b — blitz effects apply only to
   * the blitz-cost cast). Consumed/cleared when the creature leaves the
   * battlefield.
   */
  blitz?: boolean;

  // Foretell-specific (CR 702.142)
  /**
   * Whether this card is currently foretold: exiled face down by its owner via
   * the Foretell keyword action (CR 702.142b). While true the card lives in its
   * owner's exile zone, face down (`isFaceDown === true`), hidden from other
   * players but visible to its owner, and may be cast for its foretell cost on a
   * later turn (CR 702.142c). Cleared when the card is cast or leaves exile.
   */
  foretold?: boolean;
  /**
   * The turn number on which this card was foretold (CR 702.142b). Used to
   * enforce that a foretold card cannot be cast for its foretell cost on the
   * same turn it was foretold — only on a later turn (CR 702.142c).
   */
  foretoldTurn?: number;

  // Prototype-specific (CR 702.152)
  /** Whether this permanent is currently in prototype form */
  isPrototype: boolean;
  /** Prototype alternative power (when in prototype form) */
  prototypePower: number | null;
  /** Prototype alternative toughness (when in prototype form) */
  prototypeToughness: number | null;
  /** Prototype alternative mana cost string (when in prototype form) */
  prototypeManaCost: string | null;

  // Boast keyword (CR 702.131) - tracks if this creature attacked last turn
  /** Whether this creature attacked during the previous turn */
  attackedLastTurn: boolean;

  // Prowess keyword (CR 702.108) - +1/+1 bonus active this turn
  /**
   * Number of prowess +1/+1 bonuses currently active on this creature (CR
   * 702.108). Each time the creature's controller casts a noncreature spell,
   * a prowess trigger adds +1 to this counter (one per prowess instance, CR
   * 702.108b); the layer-7 power/toughness read path adds `prowessBoost` to
   * both power and toughness as a continuous "until end of turn" effect. It is
   * cleared during the end-of-turn cleanup (see `clearProwessBoosts`).
   */
  prowessBoost?: number;

  // Performance optimization: zone lookup cache (CR 704 - SBA performance)
  /** The zone key where this card currently resides. Updated on zone changes for O(1) lookup */
  currentZoneKey: string | null;

  // Phasing tracking (CR 702.19) - used to track that a card has been phased out even after it phases back in
  /** @internal Used by phasing system to track if a card has ever been phased out */
  _hasBeenPhasedOut?: boolean;
}

/**
 * Untap modifier hook (CR 502.2).
 *
 * Describes an effect that alters HOW or WHICH permanents untap during the
 * discrete untap step. This is the extension point for untap-modifying effects
 * such as "don't untap during your untap step" (`doesNotUntap`) or
 * "untap an additional land" (`forceUntap`). Processed by `processUntapStep`.
 */
export interface UntapModifier {
  /** Card that is the source of the modifier */
  sourceCardId: CardInstanceId;
  /** If true, the target permanent does not untap during the untap step */
  doesNotUntap?: boolean;
  /** If true, force the target permanent to untap even if another effect says otherwise */
  forceUntap?: boolean;
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
export enum ZoneType {
  LIBRARY = "library",
  HAND = "hand",
  BATTLEFIELD = "battlefield",
  GRAVEYARD = "graveyard",
  STACK = "stack",
  EXILE = "exile",
  COMMAND = "command",
  SIDEBOARD = "sideboard",
  ANTICIPATE = "anticipate",
}

/**
 * Get the zone key for a player's zone
 */
export function getZoneKey(playerId: PlayerId, zone: ZoneType): string {
  if (zone === ZoneType.STACK) {
    return ZoneType.STACK;
  }
  return `${playerId}-${zone}`;
}

/**
 * Parse a zone key and return the playerId and zone
 */
export function parseZoneKey(zoneKey: string): {
  playerId: PlayerId | null;
  zone: ZoneType;
} {
  if (zoneKey === ZoneType.STACK) {
    return { playerId: null, zone: ZoneType.STACK };
  }
  const parts = zoneKey.split("-");
  const zone = parts.pop() as ZoneType;
  const playerId = parts.join("-") as PlayerId;
  return { playerId, zone };
}

/**
 * Check if a card is on the battlefield
 * Uses O(1) cached zone key lookup for performance (CR 704 - SBA optimization)
 */
export function isOnBattlefield(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards.get(cardId);
  if (card?.currentZoneKey) {
    const zone = state.zones.get(card.currentZoneKey);
    return (zone?.type ?? null) === ZoneType.BATTLEFIELD;
  }
  // Fallback: search all zones (for cards created before cache existed)
  for (const zone of state.zones.values()) {
    if (zone.type === ZoneType.BATTLEFIELD && zone.cardIds.includes(cardId)) {
      return true;
    }
  }
  return false;
}

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

  // Foretell tracking (CR 702.142b)
  /**
   * Number of cards this player has foretold this turn. CR 702.142b allows a
   * player to foretell at most one card each turn. Reset to 0 at the start of
   * each turn (mirrors `landsPlayedThisTurn`). Optional so legacy Player
   * literals default to "no foretells yet" (read with `?? 0`).
   */
  foretoldThisTurn?: number;

  // Storm tracking (CR 702.41)
  /**
   * Number of spells this player has CAST this turn. CR 702.41a bases the storm
   * count on "spells cast before it this turn", so this counter is the source
   * of the storm count. Reset to 0 at the start of each turn (mirrors
   * `landsPlayedThisTurn` / `foretoldThisTurn`). Optional so legacy Player
   * literals default to "no spells cast yet" (read with `?? 0`).
   *
   * Note: a spell COPY is not "cast" (CR 707.10) and so does NOT increment this
   * counter — only `castSpell` does. This is what stops storm copies from
   * recursively re-triggering storm.
   */
  spellsCastThisTurn?: number;

  dungeonProgress?: DungeonProgress | null;
  completedDungeonIds?: DungeonId[];

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

  // Monarchy (CR 704.5p)
  /** Whether this player is the monarch */
  isMonarch: boolean;
  /**
   * Most recent opponent player who dealt COMBAT damage to this player.
   * Used by the CR 704.5p state-based action to transfer the monarchy.
   * Reset to `null` when no opponent has dealt combat damage yet this turn.
   *
   * Optional so legacy Player literals default to "no recent combat damage
   * source" (read with `?? null`).
   */
  lastCombatDamageFromPlayer?: PlayerId | null;
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
  /** Alternative costs used for this spell (e.g., Flashback, Buyback) */
  alternativeCostsUsed?: string[];
  /** Whether kicker was paid */
  wasKicked?: boolean;
  /** Buyback return zone (if used) */
  buybackReturnZone?: string;
  /** Bestow attachment target (if cast as aura) */
  bestowTarget?: CardInstanceId;
  /**
   * Target card IDs for which the ward cost (CR 702.21) has been paid by this
   * spell/ability's controller. On resolution, any warded opponent target NOT
   * in this list causes this spell/ability to be countered.
   */
  wardPaidTargetIds?: string[];
  /**
   * Split second (CR 702.60).
   *
   * Set on a spell's StackObject when its Oracle text contains "Split second".
   * Functions only while the spell is on the stack: while any object with
   * `splitSecond === true` is on the stack, players can't cast other spells or
   * activate abilities that aren't mana abilities (CR 702.60b). Triggered
   * abilities and special actions remain legal (CR 702.60b/c). Multiple
   * instances are redundant (CR 702.60c).
   */
  splitSecond?: boolean;
  /**
   * Storm (CR 702.41).
   *
   * Set on a spell's StackObject when its Oracle text contains "Storm". Storm
   * is a triggered ability that fires "when you cast this spell": on cast, the
   * engine creates one copy of the spell for each spell cast before it this
   * turn (see `detectStormTrigger` in trigger-system.ts and `copySpellOnStack`
   * in spell-casting.ts). Targets may be reselected for each copy (CR 702.41a /
   * CR 707.10d). Multiple instances are redundant (CR 702.41c).
   */
  storm?: boolean;
  /**
   * Whether this stack object is a COPY of a spell rather than a spell that was
   * cast (CR 707.10). Copies share the original's characteristics — name,
   * oracle text, mana cost, targets, chosen modes, X values, controller — with
   * no cost paid, but are not themselves "cast": they do not increment the
   * storm count and do not trigger "when you cast" abilities. On resolution a
   * permanent copy becomes a token (CR 707.10d / CR 111) and an instant/sorcery
   * copy simply ceases to exist (see `resolveCopyCompletion`).
   */
  isCopy?: boolean;
  /**
   * Intervening "if" clause (CR 603.4).
   *
   * Set on a triggered ability's StackObject when its Oracle text is of the form
   * "When/Whenever/At [trigger], if [condition], [effect]". The condition must be
   * true when the ability is put on the stack AND is re-checked when it would
   * resolve; if it is no longer true the ability is removed from the stack and
   * does nothing (it "fizzles"). See `resolveTopOfStack` in spell-casting.ts and
   * `evaluateInterveningIfClause` in abilities.ts.
   */
  interveningIf?: string;
  /** Structured effects to resolve (CR 608) */
  effects?: StackEffect[];
}

/**
 * A choice that can be made for a stack item
 * Used in target selection and other decision points
 */
export interface Choice {
  /** Unique identifier for this choice */
  id: string;
  /** Type of choice */
  type: "target" | "mode" | "value" | "payment" | "yes_no";
  /** Description of the choice */
  label: string;
  /** Available options for this choice */
  options: ChoiceOption[];
  /** Whether this choice is required */
  isRequired: boolean;
  /** Minimum number of selections required */
  minSelections: number;
  /** Maximum number of selections allowed */
  maxSelections: number;
}

/**
 * A mode for modal spells (e.g., "Deal 3 damage" or "Draw 2 cards")
 */
export interface Mode {
  /** Unique identifier for this mode */
  id: string;
  /** Description of what this mode does */
  label: string;
  /** Oracle text for this mode */
  text: string;
  /** Mana cost for this specific mode (if different from base) */
  manaCost?: string;
  /** Whether this mode has been selected */
  isSelected: boolean;
}

/**
 * An alternative cost that can be paid instead of the normal cost
 * Examples: Flashback, Escape, Affinity, Landfall
 */
export interface AlternativeCost {
  /** Unique identifier for this alternative cost */
  id: string;
  /** Name of the alternative cost (e.g., "Flashback", "Escape") */
  name: string;
  /** Description of how to use this alternative cost */
  description: string;
  /** Additional cost that must be paid (e.g., "Exile this from your graveyard") */
  additionalCost?: string;
  /** Whether this alternative cost is currently active/available */
  isAvailable: boolean;
  /** Timestamps or restrictions for when this cost can be used */
  restrictions?: string[];
}

/**
 * Represents the target selection state for a stack item
 * Includes both the selected targets and available choices
 */
export interface TargetSelection {
  /** Currently selected targets */
  targets: Target[];
  /** Available choices for target selection */
  choices: Choice[];
  /** Whether target selection is complete */
  isComplete: boolean;
}

/**
 * A spell or ability on the stack with full targeting and cost information
 * This is the primary type used for stack-based mechanics
 */
export interface StackItem {
  /** Unique identifier for this stack item */
  id: StackObjectId;
  /** Type of stack object (spell or ability) */
  type: "spell" | "ability";
  /** ID of the card that created this stack item (null for abilities without a card source) */
  sourceCardId: CardInstanceId | null;
  /** Controller of this stack item */
  controllerId: PlayerId;
  /** Display name */
  name: string;
  /** Oracle text of the spell/ability */
  text: string;
  /** Mana cost as a string (e.g., "{2}{U}{R}") */
  manaCost: string | null;
  /** Target selection state */
  targetSelection: TargetSelection;
  /** Modes for modal spells (e.g., choose one of three modes) */
  modes: Mode[];
  /** Alternative costs that can be used (e.g., Flashback, Escape) */
  alternativeCosts: AlternativeCost[];
  /** X value for X-spells (null if not an X-spell or value not yet chosen) */
  xValue: number | null;
  /** Whether this has been countered */
  isCountered: boolean;
  /** Timestamp when added to the stack */
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
 * Effect types that can be resolved on the stack
 * CR 608 - Resolving Spells and Abilities
 */
export type StackEffectType =
  | "damage"
  | "life_gain"
  | "life_loss"
  | "card_draw"
  | "token_creation"
  | "counter_spell"
  | "destroy"
  | "exile"
  | "draw"
  | "createToken"
  | "gainLife"
  | "loseLife"
  | "venture_dungeon";

/**
 * Structured effect data for resolution
 * Each effect type carries the data needed to resolve that effect
 */
export type StackEffect =
  | {
      effectType: "damage";
      amount: number;
      targetId: CardInstanceId | PlayerId;
      isCombatDamage: boolean;
    }
  | { effectType: "life_gain"; amount: number; targetId: PlayerId }
  | { effectType: "life_loss"; amount: number; targetId: PlayerId }
  | { effectType: "card_draw"; amount: number; targetId: PlayerId }
  | {
      effectType: "token_creation";
      power: number;
      toughness: number;
      color: string;
      count: number;
      controllerId: PlayerId;
    }
  | { effectType: "counter_spell"; targetStackObjectId: string }
  | {
      effectType: "destroy";
      targetId: CardInstanceId;
      ignoreIndestructible: boolean;
    }
  | { effectType: "exile"; targetId: CardInstanceId }
  | { effectType: "draw"; amount: number; targetId: PlayerId }
  | {
      effectType: "createToken";
      tokenData: ScryfallCard;
      count: number;
      controllerId: PlayerId;
    }
  | { effectType: "gainLife"; amount: number; targetId: PlayerId }
  | { effectType: "loseLife"; amount: number; targetId: PlayerId }
  | {
      effectType: "venture_dungeon";
      dungeonId?: DungeonId;
      nextRoomId?: DungeonRoomId;
      targetId?: PlayerId;
    };

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
    | "priority"
    | "choose_legend"
    | "choose_replacement";
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

export interface LinkedEffect {
  /** Unique identifier for this linked effect */
  id: string;
  /** Card that created this linked effect */
  sourceCardId: CardInstanceId;
  /** ID of the first ability (creates the linked object) */
  firstAbilityId: string;
  /** ID of the second ability (uses the linked object) */
  secondAbilityId: string;
  /** Type of link (damage→life or copy→counter) */
  linkType: "damage_life" | "copy_counter";
  /** Damage amount for damage_life links */
  damageAmount?: number;
  /** Copied card ID for copy_counter links */
  copiedCardId?: CardInstanceId;
  /** When this linked effect was created */
  timestamp: number;
}

/**
 * Registry for tracking linked effects
 */
export interface LinkedEffectRegistry {
  /** All active linked effects */
  effects: LinkedEffect[];
  /** Linked effects indexed by source card ID for fast lookup */
  bySourceCard: Map<CardInstanceId, LinkedEffect[]>;
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
  /** Replacement effect manager for this game instance */
  replacementEffectManager: ReplacementEffectManager;
  /** Layer system for this game instance */
  layerSystem: LayerSystem;
  /** Linked effect registry for this game instance */
  linkedEffectRegistry: LinkedEffectRegistry;
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
    "creature" | "land" | "artifact" | "enchantment" | "planeswalker" | "other";
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
