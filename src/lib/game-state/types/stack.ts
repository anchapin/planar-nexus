/**
 * Stack types (CR 405/608): stack objects, effects, targets, choices, and alternative costs.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from './card-data';
import { CardInstanceId } from './cards';
import { ChoiceOption } from './choices';
import { DungeonId, DungeonRoomId } from './dungeon';
import { PlayerId } from './players';

/**
 * Unique identifier for an ability or effect on the stack
 */
export type StackObjectId = string;

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
  /** Whether kicker was paid (CR 702.85). Backward-compat shim; prefer
   *  `timesKicked` for new code. `true` iff `timesKicked > 0`. */
  wasKicked?: boolean;
  /**
   * Number of times the kicker cost (CR 702.85) was paid on this spell.
   * For single-kicker cards, this is 0 or 1. For multikicker cards
   * (e.g. "Multikicker {1}"), this may be any non-negative integer
   * bounded by the controller's available mana. Used at resolution time
   * to scale the additional effect N times. */
  timesKicked?: number;
  /** Buyback return zone (if used) */
  buybackReturnZone?: string;
  /** Bestow attachment target (if cast as aura) */
  bestowTarget?: CardInstanceId;
  /**
   * Mutate merge target (CR 702.140). Set on a spell's StackObject when it
   * is cast for its mutate cost. On resolution, the spell merges onto this
   * target non-Human creature (handled by `applyMutate` in mutate.ts). If
   * the target has left the battlefield by resolution time, the spell
   * resolves as a normal creature entering the battlefield (CR 702.140f
   * fallback).
   */
  mutateTargetCreatureId?: CardInstanceId;
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

