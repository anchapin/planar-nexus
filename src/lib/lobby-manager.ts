/**
 * Client-side lobby state management
 * Handles local lobby state for hosting games before connecting to signaling server
 */

import { GameLobby, Player, HostGameConfig, LobbyStatus, PlayerStatus } from './multiplayer-types';
import { generateGameCode, generateLobbyId, generatePlayerId } from './game-code-generator';
import { publicLobbyBrowser } from './public-lobby-browser';

/**
 * Client-side lobby manager for host game functionality
 * In production, this would sync with a signaling server/WebRTC
 */
class LobbyManager {
  private currentLobby: GameLobby | null = null;
  private hostPlayerId: string | null = null;

  /**
   * Create a new game lobby
   */
  createLobby(config: HostGameConfig, hostName: string): GameLobby {
    const gameCode = generateGameCode();
    const lobbyId = generateLobbyId();
    const hostPlayerId = generatePlayerId();

    const hostPlayer: Player = {
      id: hostPlayerId,
      name: hostName,
      status: 'host',
      joinedAt: Date.now(),
    };

    const lobby: GameLobby = {
      id: lobbyId,
      gameCode,
      name: config.name,
      hostId: hostPlayerId,
      format: config.format,
      maxPlayers: config.maxPlayers,
      players: [hostPlayer],
      status: 'waiting',
      createdAt: Date.now(),
      settings: config.settings,
    };

    this.currentLobby = lobby;
    this.hostPlayerId = hostPlayerId;

    // Store in localStorage for persistence
    this.saveLobbyToStorage();

    // Register public game if applicable
    if (config.settings.isPublic) {
      const hostPlayer = lobby.players.find(p => p.id === hostPlayerId);
      publicLobbyBrowser.registerPublicGame({
        id: lobby.id,
        gameCode: lobby.gameCode,
        name: lobby.name,
        hostName: hostPlayer?.name || 'Host',
        format: lobby.format,
        maxPlayers: lobby.maxPlayers,
        currentPlayers: lobby.players.length,
        status: lobby.status === 'in-progress' ? 'in-progress' : 'waiting',
        isPublic: config.settings.isPublic,
        hasPassword: !!config.settings.password,
        allowSpectators: config.settings.allowSpectators,
        createdAt: lobby.createdAt,
      });
    }

    return lobby;
  }

  /**
   * Get the current lobby (if hosting)
   */
  getCurrentLobby(): GameLobby | null {
    if (!this.currentLobby) {
      // Try to load from storage
      this.loadLobbyFromStorage();
    }
    return this.currentLobby;
  }

  /**
   * Add a player to the lobby (simulated for host view)
   */
  addPlayer(playerName: string): Player | null {
    if (!this.currentLobby) return null;

    // Check if lobby is full
    const maxPlayers = parseInt(this.currentLobby.maxPlayers);
    if (this.currentLobby.players.length >= maxPlayers) {
      return null;
    }

    const newPlayer: Player = {
      id: generatePlayerId(),
      name: playerName,
      status: 'not-ready',
      joinedAt: Date.now(),
    };

    this.currentLobby.players.push(newPlayer);
    this.saveLobbyToStorage();

    // Update public game if applicable
    if (this.currentLobby.settings.isPublic) {
      publicLobbyBrowser.updatePublicGame(this.currentLobby.id, {
        currentPlayers: this.currentLobby.players.length,
      });
    }

    return newPlayer;
  }

  /**
   * Remove a player from the lobby
   */
  removePlayer(playerId: string): boolean {
    if (!this.currentLobby) return false;

    // Cannot remove host
    if (playerId === this.currentLobby.hostId) return false;

    const initialLength = this.currentLobby.players.length;
    this.currentLobby.players = this.currentLobby.players.filter(p => p.id !== playerId);

    if (this.currentLobby.players.length < initialLength) {
      this.saveLobbyToStorage();

      // Update public game if applicable
      if (this.currentLobby.settings.isPublic) {
        publicLobbyBrowser.updatePublicGame(this.currentLobby.id, {
          currentPlayers: this.currentLobby.players.length,
        });
      }

      return true;
    }

    return false;
  }

  /**
   * Update player ready status
   */
  updatePlayerStatus(playerId: string, status: PlayerStatus): boolean {
    if (!this.currentLobby) return false;

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (player) {
      player.status = status;
      this.saveLobbyToStorage();
      return true;
    }

    return false;
  }

  /**
   * Update player deck selection
   */
  updatePlayerDeck(playerId: string, deckId: string, deckName: string): boolean {
    if (!this.currentLobby) return false;

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (player) {
      player.deckId = deckId;
      player.deckName = deckName;
      this.saveLobbyToStorage();
      return true;
    }

    return false;
  }

  /**
   * Update lobby status
   */
  updateLobbyStatus(status: LobbyStatus): boolean {
    if (!this.currentLobby) return false;

    this.currentLobby.status = status;
    this.saveLobbyToStorage();

    // Update public game if applicable
    if (this.currentLobby.settings.isPublic) {
      publicLobbyBrowser.updatePublicGame(this.currentLobby.id, {
        status: status === 'in-progress' ? 'in-progress' : 'waiting',
      });
    }

    return true;
  }

  /**
   * Check if all players are ready
   */
  allPlayersReady(): boolean {
    if (!this.currentLobby) return false;

    const maxPlayers = parseInt(this.currentLobby.maxPlayers);
    if (this.currentLobby.players.length < maxPlayers) return false;

    return this.currentLobby.players.every(
      p => p.status === 'ready' || p.status === 'host'
    );
  }

  /**
   * Check if lobby can start
   */
  canStartGame(): boolean {
    if (!this.currentLobby) return false;

    const maxPlayers = parseInt(this.currentLobby.maxPlayers);
    const hasEnoughPlayers = this.currentLobby.players.length >= 2;
    const allReady = this.allPlayersReady();

    return hasEnoughPlayers && allReady;
  }

  /**
   * Close and destroy the current lobby
   */
  closeLobby(): void {
    // Unregister from public browser if applicable
    if (this.currentLobby?.settings.isPublic) {
      publicLobbyBrowser.unregisterPublicGame(this.currentLobby.id);
    }

    this.currentLobby = null;
    this.hostPlayerId = null;
    localStorage.removeItem('planar_nexus_current_lobby');
  }

  /**
   * Save lobby to localStorage for persistence
   */
  private saveLobbyToStorage(): void {
    if (this.currentLobby) {
      localStorage.setItem('planar_nexus_current_lobby', JSON.stringify(this.currentLobby));
    }
  }

  /**
   * Load lobby from localStorage
   */
  private loadLobbyFromStorage(): void {
    const stored = localStorage.getItem('planar_nexus_current_lobby');
    if (stored) {
      try {
        this.currentLobby = JSON.parse(stored);
      } catch (e) {
        console.error('Failed to load lobby from storage:', e);
        localStorage.removeItem('planar_nexus_current_lobby');
      }
    }
  }

  /**
   * Get the host player ID
   */
  getHostPlayerId(): string | null {
    return this.hostPlayerId;
  }
}

// Singleton instance
export const lobbyManager = new LobbyManager();
