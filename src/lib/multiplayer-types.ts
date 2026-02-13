/**
 * Multiplayer type definitions for lobby management and game hosting
 */

export type GameFormat = 'commander' | 'standard' | 'modern' | 'pioneer' | 'legacy' | 'vintage' | 'pauper';
export type PlayerCount = '2' | '3' | '4';
export type LobbyStatus = 'waiting' | 'ready' | 'in-progress';
export type PlayerStatus = 'not-ready' | 'ready' | 'host';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  deckId?: string;
  deckName?: string;
  deckFormat?: string; // Format the deck was built for
  deckValidationErrors?: string[]; // Validation errors for the selected deck
  joinedAt: number;
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
}

export interface LobbySettings {
  allowSpectators: boolean;
  password?: string;
  isPublic: boolean;
  timerEnabled: boolean;
  timerMinutes?: number;
}

export interface LobbyMessage {
  type: 'player-joined' | 'player-left' | 'player-ready' | 'player-not-ready' | 'game-starting' | 'chat' | 'error';
  data: unknown;
  senderId?: string;
  timestamp: number;
}

export interface HostGameConfig {
  name: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  settings: LobbySettings;
}
