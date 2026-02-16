/**
 * Client-side lobby state management
 * Handles local lobby state for hosting games before connecting to signaling server
 */

import { GameLobby, Player, HostGameConfig, LobbyStatus, PlayerStatus } from './multiplayer-types';
import { generateGameCode, generateLobbyId, generatePlayerId } from './game-code-generator';
import { publicLobbyBrowser } from './public-lobby-browser';
import { validateDeckForLobby } from './format-validator';
import type { SavedDeck } from '@/app/actions';

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
        settings: {
          timerEnabled: config.settings.timerEnabled,
          timerMinutes: config.settings.timerMinutes,
        },
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
   * Update player deck selection with format validation
   */
  updatePlayerDeck(
    playerId: string,
    deckId: string,
    deckName: string,
    deck?: SavedDeck
  ): { success: boolean; isValid: boolean; errors: string[] } {
    if (!this.currentLobby) {
      return { success: false, isValid: false, errors: ['Lobby not found'] };
    }

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, isValid: false, errors: ['Player not found'] };
    }

    // Update deck info
    player.deckId = deckId;
    player.deckName = deckName;
    player.deckFormat = deck?.format;

    // Validate deck against lobby format
    if (deck) {
      const validation = validateDeckForLobby(deck, this.currentLobby.format);
      player.deckValidationErrors = [...validation.errors, ...validation.warnings];
      this.saveLobbyToStorage();
      return {
        success: true,
        isValid: validation.isValid && validation.canPlay,
        errors: player.deckValidationErrors,
      };
    }

    this.saveLobbyToStorage();
    return { success: true, isValid: true, errors: [] };
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
   * Check if all joined players are ready (even if lobby not full)
   */
  allJoinedPlayersReady(): boolean {
    if (!this.currentLobby) return false;
    if (this.currentLobby.players.length < 2) return false;

    return this.currentLobby.players.every(
      p => p.status === 'ready' || p.status === 'host'
    );
  }

  /**
   * Check if lobby can start
   * Now includes format validation check
   */
  canStartGame(): boolean {
    if (!this.currentLobby) return false;

    const maxPlayers = parseInt(this.currentLobby.maxPlayers);
    const hasEnoughPlayers = this.currentLobby.players.length >= 2;
    const allReady = this.allPlayersReady();

    // Check that all players have valid decks for the format
    const allDecksValid = this.currentLobby.players.every(player => {
      // Players must have a deck selected
      if (!player.deckId) return false;

      // Players must not have validation errors
      const hasErrors = player.deckValidationErrors && player.deckValidationErrors.length > 0;
      return !hasErrors;
    });

    return hasEnoughPlayers && allReady && allDecksValid;
  }

  /**
   * Check if host can force start (even if not all ready)
   * Host can start with any number of ready players who have valid decks
   */
  canForceStart(): boolean {
    if (!this.currentLobby) return false;

    const hasEnoughPlayers = this.currentLobby.players.length >= 2;
    
    // At least some players must be ready
    const hasReadyPlayers = this.currentLobby.players.some(
      p => p.status === 'ready' || p.status === 'host'
    );

    // All ready players must have valid decks
    const allReadyPlayersHaveDecks = this.currentLobby.players
      .filter(p => p.status === 'ready' || p.status === 'host')
      .every(player => {
        if (!player.deckId) return false;
        const hasErrors = player.deckValidationErrors && player.deckValidationErrors.length > 0;
        return !hasErrors;
      });

    return hasEnoughPlayers && hasReadyPlayers && allReadyPlayersHaveDecks;
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
