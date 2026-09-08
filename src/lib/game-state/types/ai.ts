/**
 * AI-facing state projection types (UnifiedGameState and the AI* views) plus PHASE_MAPPING.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { CardInstanceId } from './cards';
import { PlayerId } from './players';
import { Phase } from './turn';

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

