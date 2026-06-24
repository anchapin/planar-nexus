/**
 * Multiplayer type definitions for lobby management and game hosting
 */

export type GameFormat = 'commander' | 'standard' | 'modern' | 'pioneer' | 'legacy' | 'vintage' | 'pauper';
export type PlayerCount = '2' | '3' | '4';
export type LobbyStatus = 'waiting' | 'ready' | 'in-progress';
export type PlayerStatus = 'not-ready' | 'ready' | 'host';
export type GameMode = '1v1' | '2v2' | 'ffa' | 'commander-1v1' | 'commander-ffa';

// Team-related types for 2v2 mode
export type TeamId = 'team-a' | 'team-b';

export interface Team {
  id: TeamId;
  name: string;
  color: string; // CSS color for visual distinction
  playerIds: string[];
  // Shared life total for Two-Headed Giant variant
  sharedLifeTotal?: number;
}

export interface TeamAssignment {
  playerId: string;
  teamId: TeamId;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  deckId?: string;
  deckName?: string;
  deckFormat?: string; // Format the deck was built for
  deckValidationErrors?: string[]; // Validation errors for the selected deck
  joinedAt: number;
  // Team assignment for 2v2 mode
  teamId?: TeamId;
}

export interface GameLobby {
  id: string;
  gameCode: string;
  name: string;
  hostId: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  players: Player[];
  status: LobbyStatus;
  createdAt: number;
  settings: LobbySettings;
  gameMode: GameMode;
  // Teams for 2v2 mode
  teams?: Team[];
  // 2v2 specific settings
  teamSettings?: TeamSettings;
}

export interface TeamSettings {
  sharedLife: boolean; // Two-Headed Giant variant (shared life total)
  sharedBlockers: boolean; // Teammates can block together
  teamChat: boolean; // Private chat between teammates
  startingLifePerTeam: number; // Default 30 for Two-Headed Giant
}

export interface LobbySettings {
  allowSpectators: boolean;
  password?: string;
  isPublic: boolean;
  timerEnabled: boolean;
  timerMinutes?: number;
}

export interface LobbyMessage {
  type: 'player-joined' | 'player-left' | 'player-ready' | 'player-not-ready' | 'game-starting' | 'chat' | 'host-migration' | 'error';
  data: unknown;
  senderId?: string;
  timestamp: number;
}

/**
 * Host-migration announcement (issue #916). Broadcast when the authoritative
 * host leaves so a remaining peer can be promoted and the game continues.
 * Re-exported from the host-migration module for convenience.
 */
export interface HostMigrationLobbyMessage extends LobbyMessage {
  type: 'host-migration';
  data: {
    migrationId: string;
    previousHostId: string;
    newHostId: string;
    remainingPeers: string[];
    gameState: unknown;
    reason: 'host-disconnected' | 'host-left';
  };
}

export interface HostGameConfig {
  name: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  settings: LobbySettings;
  gameMode?: GameMode;
}
