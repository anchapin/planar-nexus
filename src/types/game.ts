import { ScryfallCard } from "@/app/actions";

/**
 * Game state types for the Planar Nexus game board
 */

export type PlayerCount = 1 | 2 | 4;

export type GameFormat = "commander" | "standard" | "modern" | "pioneer" | "legacy" | "vintage" | "pauper";

export type TurnPhase = "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end";

export type ZoneType = "battlefield" | "hand" | "graveyard" | "exile" | "library" | "commandZone" | "companion" | "stack" | "sideboard" | "anticipate";

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
}
