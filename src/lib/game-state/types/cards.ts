/**
 * Card identity types: the card instance shape, counters, and untap modifiers.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from './card-data';
import { PlayerId } from './players';

/**
 * Unique identifier for a card instance in the game
 */
export type CardInstanceId = string;

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

  // Renown keyword (CR 702.100)
  /**
   * Whether this permanent has become renowned (CR 702.100b).
   *
   * Set to `true` exactly once, the first time this creature's Renown ability
   * resolves. Per CR 702.100b the renowned flag persists for the rest of the
   * game for THIS card instance — it is never reset by removing the +1/+1
   * counters and it blocks Renown from re-triggering even after a flicker /
   * zone-change that returns the same card instance to the battlefield. The
   * flag is the authoritative intervening-if guard for "if it isn't renowned"
   * on the trigger-system side.
   *
   * Optional so legacy state literals default to "not yet renowned" (read
   * with `?? false`).
   */
  renowned?: boolean;

  // Tribute keyword (CR 702.101)
  /**
   * Whether the Tribute cost for this permanent was paid as it entered the
   * battlefield (CR 702.101b).
   *
   * Set during `resolveTributeChoice`: `true` when the chosen opponent paid
   * the cost (and the secondary "tribute wasn't paid" triggered ability is
   * suppressed), `false` when they declined (and the secondary ability fires
   * normally). Undefined before the choice resolves. Persisted on the card so
   * the suppression survives any later state recomputation.
   */
  tributePaid?: boolean;

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

