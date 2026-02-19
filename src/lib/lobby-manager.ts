/**
 * Client-side lobby state management
 * Handles local lobby state for hosting games before connecting to signaling server
 */

import { GameLobby, Player, HostGameConfig, LobbyStatus, PlayerStatus, GameMode, Team, TeamId, TeamSettings } from './multiplayer-types';
import { generateGameCode, generateLobbyId, generatePlayerId } from './game-code-generator';
import { publicLobbyBrowser } from './public-lobby-browser';
import { validateDeckForLobby } from './format-validator';
import { getGameModeForPlayerCount, getGameModeConfig, GAME_MODES } from './game-mode';
import type { SavedDeck } from '@/app/actions';

// Default team configurations
const DEFAULT_TEAMS: Team[] = [
  {
    id: 'team-a',
    name: 'Team Alpha',
    color: '#3b82f6', // Blue
    playerIds: [],
  },
  {
    id: 'team-b',
    name: 'Team Beta',
    color: '#ef4444', // Red
    playerIds: [],
  },
];

const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  sharedLife: true,
  sharedBlockers: true,
  teamChat: true,
  startingLifePerTeam: 30,
};

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

    // Determine game mode based on player count and format
    const gameMode = config.gameMode || getGameModeForPlayerCount(
      parseInt(config.maxPlayers),
      config.format
    );

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
      gameMode,
    };

    this.currentLobby = lobby;
    this.hostPlayerId = hostPlayerId;

    // Initialize teams for team-based modes
    const modeConfig = getGameModeConfig(gameMode);
    if (modeConfig.isTeamMode) {
      this.initializeTeams();
    }

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

  /**
   * Initialize teams for 2v2 mode
   */
  initializeTeams(): void {
    if (!this.currentLobby) return;
    
    const modeConfig = getGameModeConfig(this.currentLobby.gameMode);
    if (!modeConfig.isTeamMode) return;

    // Initialize teams with empty player IDs
    this.currentLobby.teams = DEFAULT_TEAMS.map(team => ({
      ...team,
      playerIds: [],
      sharedLifeTotal: modeConfig.sharedLife ? modeConfig.startingLife : undefined,
    }));

    // Build team settings with proper defaults for team mode
    const teamSettings: TeamSettings = { ...DEFAULT_TEAM_SETTINGS };
    if (modeConfig.sharedLife !== undefined) {
      teamSettings.sharedLife = modeConfig.sharedLife;
    }
    if (modeConfig.sharedBlockers !== undefined) {
      teamSettings.sharedBlockers = modeConfig.sharedBlockers;
    }
    if (modeConfig.teamChat !== undefined) {
      teamSettings.teamChat = modeConfig.teamChat;
    }
    if (modeConfig.startingLife !== undefined) {
      teamSettings.startingLifePerTeam = modeConfig.startingLife;
    }
    this.currentLobby.teamSettings = teamSettings;

    this.saveLobbyToStorage();
  }

  /**
   * Assign a player to a team
   */
  assignPlayerToTeam(playerId: string, teamId: TeamId): boolean {
    if (!this.currentLobby || !this.currentLobby.teams) return false;

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (!player) return false;

    // Remove player from any existing team
    this.currentLobby.teams.forEach(team => {
      team.playerIds = team.playerIds.filter(id => id !== playerId);
    });

    // Add player to new team
    const targetTeam = this.currentLobby.teams.find(t => t.id === teamId);
    if (!targetTeam) return false;

    // Check if team is full (max 2 players per team in 2v2)
    if (targetTeam.playerIds.length >= 2) return false;

    targetTeam.playerIds.push(playerId);
    player.teamId = teamId;

    this.saveLobbyToStorage();
    return true;
  }

  /**
   * Remove a player from their team
   */
  removePlayerFromTeam(playerId: string): boolean {
    if (!this.currentLobby || !this.currentLobby.teams) return false;

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (!player) return false;

    // Remove player from their team
    this.currentLobby.teams.forEach(team => {
      team.playerIds = team.playerIds.filter(id => id !== playerId);
    });

    player.teamId = undefined;
    this.saveLobbyToStorage();
    return true;
  }

  /**
   * Auto-assign players to teams (for quick start)
   */
  autoAssignTeams(): void {
    if (!this.currentLobby || !this.currentLobby.teams) return;

    // Initialize teams first if needed
    if (this.currentLobby.teams.length === 0) {
      this.initializeTeams();
    }

    // Clear existing assignments
    this.currentLobby.teams.forEach(team => {
      team.playerIds = [];
    });
    this.currentLobby.players.forEach(player => {
      player.teamId = undefined;
    });

    // Assign players alternately to teams
    this.currentLobby.players.forEach((player, index) => {
      const teamId: TeamId = index % 2 === 0 ? 'team-a' : 'team-b';
      this.assignPlayerToTeam(player.id, teamId);
    });

    this.saveLobbyToStorage();
  }

  /**
   * Get a player's team
   */
  getPlayerTeam(playerId: string): Team | undefined {
    if (!this.currentLobby || !this.currentLobby.teams) return undefined;
    
    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (!player || !player.teamId) return undefined;
    
    return this.currentLobby.teams.find(t => t.id === player.teamId);
  }

  /**
   * Get all players on a team
   */
  getTeamPlayers(teamId: TeamId): Player[] {
    if (!this.currentLobby) return [];
    
    return this.currentLobby.players.filter(p => p.teamId === teamId);
  }

  /**
   * Check if teams are valid (all players assigned, teams balanced)
   */
  areTeamsValid(): boolean {
    if (!this.currentLobby || !this.currentLobby.teams) return false;

    const modeConfig = getGameModeConfig(this.currentLobby.gameMode);
    if (!modeConfig.isTeamMode) return true;

    // All players must be assigned to a team
    const allAssigned = this.currentLobby.players.every(p => p.teamId);
    if (!allAssigned) return false;

    // Teams must be balanced (equal or off by 1)
    const teamSizes = this.currentLobby.teams.map(t => t.playerIds.length);
    const sizeDiff = Math.abs(teamSizes[0] - teamSizes[1]);
    
    return sizeDiff <= 1;
  }

  /**
   * Update team settings
   */
  updateTeamSettings(settings: Partial<TeamSettings>): boolean {
    if (!this.currentLobby) return false;

    // Merge with existing settings or use defaults
    const currentSettings = this.currentLobby.teamSettings ?? DEFAULT_TEAM_SETTINGS;
    this.currentLobby.teamSettings = {
      sharedLife: settings.sharedLife ?? currentSettings.sharedLife,
      sharedBlockers: settings.sharedBlockers ?? currentSettings.sharedBlockers,
      teamChat: settings.teamChat ?? currentSettings.teamChat,
      startingLifePerTeam: settings.startingLifePerTeam ?? currentSettings.startingLifePerTeam,
    };

    this.saveLobbyToStorage();
    return true;
  }

  /**
   * Update team name
   */
  updateTeamName(teamId: TeamId, name: string): boolean {
    if (!this.currentLobby || !this.currentLobby.teams) return false;

    const team = this.currentLobby.teams.find(t => t.id === teamId);
    if (!team) return false;

    team.name = name;
    this.saveLobbyToStorage();
    return true;
  }

  /**
   * Check if a player can attack another player (team rules)
   */
  canAttackPlayer(attackerId: string, defenderId: string): boolean {
    if (!this.currentLobby) return true;

    const modeConfig = getGameModeConfig(this.currentLobby.gameMode);
    if (!modeConfig.isTeamMode) return true;

    const attacker = this.currentLobby.players.find(p => p.id === attackerId);
    const defender = this.currentLobby.players.find(p => p.id === defenderId);

    if (!attacker || !defender) return true;

    // Cannot attack teammates
    if (attacker.teamId && defender.teamId && attacker.teamId === defender.teamId) {
      return false;
    }

    return true;
  }

  /**
   * Get the opponent team for a player
   */
  getOpponentTeam(playerId: string): Team | undefined {
    if (!this.currentLobby || !this.currentLobby.teams) return undefined;

    const player = this.currentLobby.players.find(p => p.id === playerId);
    if (!player || !player.teamId) return undefined;

    return this.currentLobby.teams.find(t => t.id !== player.teamId);
  }

  /**
   * Check if a team has lost (all players eliminated)
   */
  isTeamEliminated(teamId: TeamId): boolean {
    if (!this.currentLobby) return false;

    const teamPlayers = this.getTeamPlayers(teamId);
    // This would need to be connected to actual game state
    // For now, return false as placeholder
    return false;
  }

  /**
   * Get winning team if game is over
   */
  getWinningTeam(): Team | undefined {
    if (!this.currentLobby || !this.currentLobby.teams) return undefined;

    // This would need to be connected to actual game state
    // For now, return undefined as placeholder
    return undefined;
  }
}

// Singleton instance
export const lobbyManager = new LobbyManager();
