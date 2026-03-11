import { ScryfallCard } from "@/app/actions";

/**
 * Game state types for the Planar Nexus game board
 */

export type PlayerCount = 1 | 2 | 4;

export type GameFormat = "commander" | "standard" | "modern" | "pioneer" | "legacy" | "vintage" | "pauper";

export type TurnPhase = "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end";

export type ZoneType = "battlefield" | "hand" | "graveyard" | "exile" | "library" | "commandZone" | "companion" | "stack" | "sideboard" | "anticipate";

// Team-related types for 2v2 mode
export type TeamId = 'team-a' | 'team-b';

export interface TeamState {
  id: TeamId;
  name: string;
  color: string;
  playerIds: string[];
  // Shared life total for Two-Headed Giant variant
  sharedLifeTotal?: number;
  // Track if team has been eliminated
  isEliminated?: boolean;
}

export interface CardState {
  id: string;
  card: ScryfallCard;
  zone: ZoneType;
  playerId: string;
  tapped?: boolean;
  faceDown?: boolean;
  counters?: number;
  power?: number;
  toughness?: number;
  // For attachments (auras, equipment, etc.)
  attachedTo?: string;
  // For tokens
  isToken?: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  lifeTotal: number;
  poisonCounters: number;
  // Commander-specific
  commanderDamage?: { [playerId: string]: number };
  hand: CardState[];
  battlefield: CardState[];
  graveyard: CardState[];
  exile: CardState[];
  library: CardState[];
  commandZone: CardState[];
  // Player metadata
  isCurrentTurn: boolean;
  hasPriority: boolean;
  landsPlayedThisTurn: number;
  // Team assignment for 2v2 mode
  teamId?: TeamId;
}

export interface GameState {
  id: string;
  format: GameFormat;
  playerCount: PlayerCount;
  players: PlayerState[];
  currentTurnPlayerIndex: number;
  currentPhase: TurnPhase;
  turnNumber: number;
  stack: CardState[];
  // Team mode fields
  isTeamMode?: boolean;
  teams?: TeamState[];
  // Team settings
  teamSettings?: {
    sharedLife: boolean;
    sharedBlockers: boolean;
    teamChat: boolean;
  };
}
