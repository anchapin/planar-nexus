/**
 * Player types: the Player interface and their mana pool.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { DungeonId, DungeonProgress } from './dungeon';

/**
 * Unique identifier for a player
 */
export type PlayerId = string;

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

  // Spectacle tracking (CR 702.135)
  /**
   * Total life this player has LOST this turn (damage + non-damage life loss).
   * CR 702.135a: Spectacle may be cast for its spectacle cost "if an opponent
   * has lost life this turn" — this counter is what the spectacle gate reads.
   * Reset to 0 at the start of each turn (mirrors `landsPlayedThisTurn` /
   * `foretoldThisTurn` / `spellsCastThisTurn`). Optional so legacy Player
   * literals default to "no life lost yet" (read with `?? 0`).
   *
   * Note: only actual life loss counts (CR 118.3). Life SET effects (e.g.
   * "your life total becomes 5") and life-payment-that-isnt-loss (e.g. "pay
   * 2 life" on some cards is "loss"; on others is a cost — engine currently
   * treats both as loss, which is conservative for spectacle). The counter is
   * incremented by `dealDamageToPlayer` and `loseLife` in `player-actions.ts`.
   */
  lastTurnLifeLost?: number;

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

