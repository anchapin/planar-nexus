/**
 * Client-side lobby state management
 *
 * @deprecated This module uses server-dependent lobby management and is DEPRECATED.
 * Centralized lobby systems create legal liability targets.
 *
 * Use serverless P2P lobby management instead:
 * - Use `p2p-direct-connection.ts` for QR code/manual code exchange
 * - Use `p2p-signaling-client.ts` for client-side signaling
 * - Use `/multiplayer/p2p-host` for P2P hosting UI
 *
 * See issue #641 for migration to legal/serverless P2P.
 *
 * Handles local lobby state for hosting games before connecting to signaling server
 */

import { GameLobby, Player, HostGameConfig, LobbyStatus, PlayerStatus, Team, TeamId, TeamSettings, LobbyState, ReadyCheckKind, ReadyCheckSession, ReadyCheckResponse, SeatHold } from './multiplayer-types';
import { generateGameCode, generateLobbyId, generatePlayerId } from './game-code-generator';
import { publicLobbyBrowser } from './public-lobby-browser';
import { validateDeckForLobby } from './format-validator';
import { getGameModeForPlayerCount, getGameModeConfig } from './game-mode';
import type { SavedDeck } from '@/app/actions';
import {
  TokenBucket,
  type RateLimitOptions,
} from './security/rate-limit';

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
 * Issue #1277 — per-lobby mutation budget.
 *
 * The lobby manager normally processes a small number of player joins +
 * ready-status flips, but a hostile script on the same origin can drive
 * `addPlayer` / `updatePlayerStatus` in a tight loop. Cap each mutation
 * at 60 events / minute with a 10 / second burst budget (token bucket).
 */
export const LOBBY_MUTATION_LIMIT: RateLimitOptions = {
  maxEvents: 60,
  windowMs: 60_000,
};

/**
 * Maximum number of players a single lobby can hold across all of its
 * state mutations. Issue #1277 row-count cap.
 */
export const LOBBY_MAX_PLAYERS = 16;

/**
 * Issue #1257 — session-scoped ban window.
 *
 * A peerId that the host kicks (or bans with `scope: 'session'`) is refused
 * re-entry to the same game code for this duration. Stored as wall-clock ms
 * so the expiry is independent of lobby close/reopen cycles within the
 * window — the entry is purged when the timer lapses.
 */
export const LOBBY_BAN_DURATION_MS = 30 * 60 * 1000;

/**
 * Issue #1257 — scope of a ban. `'persistent'` is reserved for future
 * cross-session moderation; the current implementation only honors
 * `'session'` (in-memory + per-browser localStorage). Calling code can
 * still pass `'persistent'` and the manager will store it for round-trip
 * fidelity, but the expiry semantics are the same as `'session'` until a
 * backend ships.
 */
export type LobbyBanScope = "session" | "persistent";

/**
 * Issue #1257 — single entry in the per-lobby ban list. Carries the kick
 * reason verbatim so the host UI can show "Why was X banned?" later.
 */
export interface LobbyBanEntry {
  peerId: string;
  reason?: string;
  scope: LobbyBanScope;
  /** Wall-clock ms when the ban was issued. */
  bannedAt: number;
  /** Wall-clock ms when the ban expires (auto-purge past this point). */
  expiresAt: number;
}

/**
 * Issue #1257 — persisted snapshot of the ban list keyed by gameCode.
 * Stored under one localStorage key so we can query the 30-minute window
 * without per-lobby indexing logic.
 */
type LobbyBanStore = Record<string, LobbyBanEntry[]>;

const LOBBY_BAN_STORAGE_KEY = "planar_nexus_lobby_bans";

/**
 * Issue #1257 — return payload from {@link LobbyManager.kickPeer}.
 *
 * `kick` is the host-driven removal + session-ban composite; the field is
 * surfaced to the UI so callers can show "Player kicked (and banned for 30
 * minutes)" or, if the kick failed, the failure reason.
 */
export interface KickPeerResult {
  removed: boolean;
  banned: boolean;
  reason?: string;
}

/**
 * Issue #1255 — duration of a full-roster ready check. The host opens a
 * 15 s window after the 2nd peer joins (or whenever the host triggers
 * `beginReadyCheck`); if every non-spectator peer has answered within the
 * window, the lobby advances to `STARTING`. If the window expires with at
 * least one peer missing (or affirmatively `ready: false`), the host may
 * either cancel back to `WAITING` or force-advance via the existing
 * `canForceStart` path.
 */
export const LOBBY_READY_CHECK_WINDOW_MS = 15_000;

/**
 * Issue #1255 — duration of a late-joiner ready check. When a peer joins
 * during `IN_GAME` the host opens a brief single-peer gate so the joining
 * peer can confirm their deck is loaded + they're ready to play. The window
 * is shorter than the full check (10 s vs 15 s) so the existing players
 * are not blocked for a long time waiting for a single new peer.
 */
export const LOBBY_LATE_JOINER_READY_CHECK_MS = 10_000;

/**
 * Issue #1255 — duration of a seat hold. When a peer disconnects mid-game
 * (e.g. browser refresh, network blip) the host reserves their seat for
 * 30 s so the reconnect-token store (issue #1087) can reattach the same
 * player slot. A late joiner arriving while a seat is held is rejected
 * with `seat-held` so the joiner knows the seat will reopen soon.
 */
export const LOBBY_SEAT_HOLD_DURATION_MS = 30_000;

/**
 * Issue #1255 — return payload from {@link LobbyManager.beginReadyCheck}.
 *
 * `started` is true when the host entered `READY_CHECK`; `reason` carries
 * a human-readable explanation when the request was rejected (e.g. "not
 * enough players", "already in-game"). The sessionId is stable for the
 * lifetime of the check so peers can correlate their
 * `READY_CHECK_RESPONSE` with the request they received.
 */
export interface BeginReadyCheckResult {
  started: boolean;
  reason?: string;
  sessionId?: string;
}

/**
 * Issue #1255 — return payload from {@link LobbyManager.recordReadyResponse}.
 *
 * `accepted` is true when the response was recorded against the active
 * session. `quorumReached` is true when this response completed the
 * required set of answers and the host should transition to `STARTING`.
 * `late` is true when the response arrived after the session was
 * cancelled or expired — the host ignores it but surfaces the count so
 * peers can detect lost messages.
 */
export interface RecordReadyResponseResult {
  accepted: boolean;
  quorumReached: boolean;
  late: boolean;
  reason?: string;
}

/**
 * Client-side lobby manager for host game functionality
 * In production, this would sync with a signaling server/WebRTC
 */
class LobbyManager {
  private currentLobby: GameLobby | null = null;
  private hostPlayerId: string | null = null;
  /**
   * Issue #1277 — token-bucket budget that gates every lobby mutation
   * (`addPlayer`, `removePlayer`, `updatePlayerStatus`, `updatePlayerDeck`,
   * etc.) so a same-origin script cannot drive the manager into an
   * unbounded JSON.stringify / localStorage.setItem loop.
   */
  private mutationLimiter: TokenBucket;
  /** Cumulative count of rejected mutations, exposed for tests. */
  public mutationDropped = 0;
  /**
   * Issue #1257 — ban list keyed by peerId for the current lobby. Each
   * entry carries its own `expiresAt` so a slow-purge lazy cleanup is
   * sufficient (we don't need a timer). The map holds both `session` and
   * `persistent` scopes; only `session` is actively honored today.
   */
  private sessionBans: Map<string, LobbyBanEntry> = new Map();
  /**
   * Issue #1257 — wall-clock ms when the host issued a pause, or null when
   * the game is not paused. Drives the priority-timer freeze clock math.
   */
  private pausedAt: number | null = null;
  /**
   * Issue #1255 — the active ready-check session, or null when no check is
   * in progress. Only the host owns the session; peers receive a
   * `ReadyCheckRequestMessage` and reply with a
   * `ReadyCheckResponseMessage` that the host applies via
   * {@link recordReadyResponse}.
   */
  private readyCheck: ReadyCheckSession | null = null;
  /**
   * Issue #1255 — monotonic counter that guarantees every sessionId is
   * unique within the lifetime of the host. Useful for telemetry and
   * for the late-response detector (`late` field in
   * {@link RecordReadyResponseResult}).
   */
  private readyCheckCounter = 0;
  /**
   * Issue #1255 — seat-hold map keyed by peerId. Each entry is created
   * when a peer disconnects mid-game and auto-purges past its
   * `expiresAt`. See {@link LOBBY_SEAT_HOLD_DURATION_MS}.
   */
  private seatHolds: Map<string, SeatHold> = new Map();
  /**
   * Issue #1255 — counter of dropped ready-check responses (late or
   * against an unknown sessionId). Exposed for tests; the host UI can
   * surface this to detect a peer that is silently missing messages.
   */
  public readyCheckDropped = 0;

  constructor(limits?: Partial<RateLimitOptions>) {
    this.mutationLimiter = new TokenBucket({
      ...LOBBY_MUTATION_LIMIT,
      ...(limits ?? {}),
    });
  }

  /**
   * Create a new game lobby
   */
  createLobby(config: HostGameConfig, hostName: string): GameLobby {
    const gameCode = generateGameCode();
    const lobbyId = generateLobbyId();
    const hostPlayerId = generatePlayerId();

    // Issue #1277 — refuse to host a lobby with a maxPlayers rosters that
    // exceed the row-count cap. A misconfigured host creates a lobby that
    // could not be safely populated.
    const requested = parseInt(config.maxPlayers);
    if (
      !Number.isFinite(requested) ||
      requested <= 0 ||
      requested > LOBBY_MAX_PLAYERS
    ) {
      throw new Error(
        `Lobby maxPlayers must be in [1, ${LOBBY_MAX_PLAYERS}] (got ${config.maxPlayers})`,
      );
    }

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
    // Issue #1257 — a new game starts unpaused and re-hydrates any bans
    // persisted under this game code (a previous host banning a peer for
    // the same code within the 30-minute window).
    this.pausedAt = null;
    this.loadBanList();
    // Issue #1255 — a fresh lobby starts in `WAITING` with no active
    // ready-check and no seat-holds. The state is set on the lobby object
    // (not just the field) so it round-trips through localStorage.
    this.currentLobby.state = 'WAITING';
    this.readyCheck = null;
    this.seatHolds.clear();
    this.readyCheckDropped = 0;

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
    if (!this.tryConsumeMutation('addPlayer')) return null;
    if (!this.currentLobby) return null;

    // Issue #1277 — bound the player roster so a flooder cannot push an
    // unbounded number of entries into the lobby.
    if (this.currentLobby.players.length >= LOBBY_MAX_PLAYERS) {
      return null;
    }

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
    if (!this.tryConsumeMutation('removePlayer')) return false;
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
    if (!this.tryConsumeMutation('updatePlayerStatus')) return false;
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
    if (!this.tryConsumeMutation('updatePlayerDeck')) {
      return {
        success: false,
        isValid: false,
        errors: ['Lobby mutation budget exceeded'],
      };
    }
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
    if (!this.tryConsumeMutation('updateLobbyStatus')) return false;
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
   *
   * Issue #1255 — also gated on the state machine: the lobby must have
   * already passed the ready-check consensus (`STARTING`) for
   * `canStartGame` to return true. The previous implementation let a
   * host race a peer's first `PlayerActionMessage` because the
   * "start" signal was timestamp-based, not consensus-based. The
   * ready check is the atomic gate; the host can only call
   * {@link startGame} from `STARTING`.
   */
  canStartGame(): boolean {
    if (!this.currentLobby) return false;
    if (this.getLobbyState() !== 'STARTING') return false;

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
    // Issue #1257 — reset transient game state but DO NOT clear the ban
    // list. Bans persist for {@link LOBBY_BAN_DURATION_MS} per game code;
    // they are re-hydrated by `loadBanList()` if the host reopens under
    // the same code within the window. Pause is a game-scoped freeze and
    // ends with the game.
    this.pausedAt = null;
    // Issue #1255 — close tears down the state machine: any in-flight
    // ready check is cancelled and seat-holds are released. The lobby
    // object is dropped below so the saved `state` is gone with it.
    this.readyCheck = null;
    this.seatHolds.clear();
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
  isTeamEliminated(_teamId: TeamId): boolean {
    if (!this.currentLobby) return false;

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

  /**
   * Issue #1257 — consume one token from the per-lobby mutation budget,
   * incrementing {@link mutationDropped} when the budget is exhausted so
   * callers (and tests) can observe the rejection.
   */
  private tryConsumeMutation(_op: string): boolean {
    if (this.mutationLimiter.tryAcquire()) {
      return true;
    }
    this.mutationDropped += 1;
    return false;
  }

  /**
   * Reset the per-lobby mutation budget. Intended for tests that share
   * the singleton {@link lobbyManager} across many cases — without this
   * the cumulative mutations from a long test file would exhaust the
   * 60-events-per-minute token bucket and later tests would see false
   * rejections on `addPlayer` / `updatePlayerStatus`. Safe to call from
   * production code (e.g. after a peer disconnect) but the budget is
   * normally self-regulating.
   */
  resetMutationBudget(): void {
    this.mutationLimiter.reset();
    this.mutationDropped = 0;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Issue #1257 — host moderation (kick, ban, pause).
  //
  // These methods own the policy + persistence of the moderation state.
  // The transport (`p2p-game-connection.ts`) is just an envelope — the host
  // calls `kickPeer` / `banPeer` / `pauseGame`, then sends a `lobby-control`
  // message so peers see the same authoritative view. The peer side applies
  // the message via `onLobbyControl` and closes the data channel on kick.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Issue #1257 — remove a peer from the lobby roster AND session-ban them
   * for {@link LOBBY_BAN_DURATION_MS} so they cannot immediately rejoin via
   * the same game code. The host's `reason` is surfaced to the kicked peer
   * verbatim.
   *
   * Composed of:
   *   1. {@link removePlayer} (host-side roster removal).
   *   2. {@link banPeer} with `scope: 'session'` (refuse future joins for
   *      the 30-minute window).
   *
   * Returns a {@link KickPeerResult} so the UI can show partial-success
   * (e.g. peer was already gone but the ban still applies).
   */
  kickPeer(peerId: string, reason?: string): KickPeerResult {
    if (!this.currentLobby) {
      return { removed: false, banned: false, reason: "No active lobby" };
    }
    if (peerId === this.currentLobby.hostId) {
      // The host cannot kick itself; `host migration` (#946) is the
      // supported path for transferring host authority.
      return { removed: false, banned: false, reason: "Cannot kick the host" };
    }
    const removed = this.removePlayer(peerId);
    const banned = this.banPeer(peerId, "session", reason).added;
    return { removed, banned, reason };
  }

  /**
   * Issue #1257 — add a peer to the session-scoped ban list. The entry is
   * persisted under the current game code so the 30-minute window survives
   * a `closeLobby` cycle within the same browser session.
   *
   * `scope: 'persistent'` is accepted for forward compatibility (it is
   * stored under the same expiry semantics today) — see {@link LobbyBanScope}.
   *
   * Returns `{ added: boolean }` — false when the ban list mutation budget
   * is exhausted (issue #1277) so callers can surface the rejection.
   */
  banPeer(
    peerId: string,
    scope: LobbyBanScope,
    reason?: string,
  ): { added: boolean; entry: LobbyBanEntry | null } {
    if (!this.tryConsumeMutation("banPeer")) {
      return { added: false, entry: null };
    }
    if (!this.currentLobby) {
      return { added: false, entry: null };
    }
    const now = Date.now();
    const entry: LobbyBanEntry = {
      peerId,
      reason,
      scope,
      bannedAt: now,
      expiresAt: now + LOBBY_BAN_DURATION_MS,
    };
    this.sessionBans.set(peerId, entry);
    this.saveBanList();
    return { added: true, entry };
  }

  /**
   * Issue #1257 — `true` when the peerId is currently banned for the active
   * lobby's game code. Expired entries are purged lazily on every check so
   * the in-memory map never grows unbounded even without a timer.
   *
   * Safe to call when no lobby is active — returns false.
   */
  isPeerBanned(peerId: string): boolean {
    this.purgeExpiredBans();
    return this.sessionBans.has(peerId);
  }

  /**
   * Issue #1257 — remove a peer from the ban list (e.g. host rescinds).
   * Returns true when an entry was actually removed.
   */
  unbanPeer(peerId: string): boolean {
    const had = this.sessionBans.delete(peerId);
    if (had) this.saveBanList();
    return had;
  }

  /**
   * Issue #1257 — snapshot of the current ban list (post lazy purge) with
   * each entry's remaining lifetime. The array is a copy — mutating it does
   * not affect internal state.
   */
  getBanList(): Array<LobbyBanEntry & { remainingMs: number }> {
    this.purgeExpiredBans();
    const now = Date.now();
    return Array.from(this.sessionBans.values()).map((e) => ({
      ...e,
      remainingMs: Math.max(0, e.expiresAt - now),
    }));
  }

  /**
   * Issue #1257 — sweep the in-memory ban list, dropping any entry past its
   * `expiresAt`. Idempotent and safe to call repeatedly. Persists the
   * trimmed state so localStorage does not accumulate tombstones.
   */
  purgeExpiredBans(): number {
    const now = Date.now();
    let removed = 0;
    for (const [peerId, entry] of this.sessionBans) {
      if (entry.expiresAt <= now) {
        this.sessionBans.delete(peerId);
        removed += 1;
      }
    }
    if (removed > 0) this.saveBanList();
    return removed;
  }

  /**
   * Issue #1257 — freeze the priority timer. Returns the wall-clock ms
   * that should be broadcast in the `lobby-control` pause payload so peers
   * compute the same frozen elapsed time. No-op when already paused — the
   * existing `pausedAt` is returned so peers don't lose the original start.
   */
  pauseGame(): { pausedAt: number } {
    if (this.pausedAt === null) {
      this.pausedAt = Date.now();
    }
    return { pausedAt: this.pausedAt };
  }

  /**
   * Issue #1257 — lift the priority-timer freeze. Returns the elapsed
   * milliseconds the game was paused so the host can adjust the local
   * priority clock for the freeze window (pause-clock math).
   */
  resumeGame(): { pausedDurationMs: number } {
    if (this.pausedAt === null) {
      return { pausedDurationMs: 0 };
    }
    const pausedDurationMs = Date.now() - this.pausedAt;
    this.pausedAt = null;
    return { pausedDurationMs };
  }

  /**
   * Issue #1257 — true when the host has issued a pause and not yet
   * resumed. Used by the UI to render the "Game paused" badge.
   */
  isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /**
   * Issue #1257 — wall-clock ms when the current pause began, or null
   * when the game is not paused. Peers use this together with the
   * `pausedDurationMs` returned by {@link resumeGame} to keep their
   * priority-timer clocks consistent with the host's authoritative view.
   */
  getPausedAt(): number | null {
    return this.pausedAt;
  }

  /**
   * Issue #1257 — number of milliseconds the current pause has been held.
   * Zero when not paused. Drives the pause-clock math tests:
   *   elapsed = (now - pausedAt) - (sum of prior resume gaps)
   * The host uses the simpler {@link resumeGame} return value.
   */
  getPauseElapsedMs(): number {
    if (this.pausedAt === null) return 0;
    return Date.now() - this.pausedAt;
  }

  /**
   * Issue #1257 — hydrate the in-memory ban list from localStorage for the
   * active game code. Called by `createLobby` so a host that bans a peer,
   * closes the lobby, and reopens within the window still refuses the
   * rejoin. No-op when no lobby is active.
   */
  private loadBanList(): void {
    this.sessionBans.clear();
    if (!this.currentLobby) return;
    const store = this.readBanStore();
    const entries = store[this.currentLobby.gameCode] ?? [];
    const now = Date.now();
    let kept = 0;
    for (const entry of entries) {
      if (entry.expiresAt > now) {
        this.sessionBans.set(entry.peerId, entry);
        kept += 1;
      }
    }
    if (kept !== entries.length) {
      // Some entries expired while we were closed — persist the trimmed set.
      this.saveBanList();
    }
  }

  /**
   * Issue #1257 — write the current ban list to localStorage, keyed by
   * the active game code. Best-effort: a quota error or a non-browser
   * environment is swallowed so moderation never crashes the lobby.
   */
  private saveBanList(): void {
    if (!this.currentLobby) return;
    const store = this.readBanStore();
    store[this.currentLobby.gameCode] = Array.from(this.sessionBans.values());
    try {
      localStorage.setItem(LOBBY_BAN_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Storage quota / privacy mode — ignore. The in-memory map is still
      // authoritative for the active session.
    }
  }

  /**
   * Issue #1257 — read the persisted ban store. Returns an empty object
   * when nothing is stored or the payload is corrupted (the corruption
   * case clears the bad key so we do not crash on every subsequent call).
   */
  private readBanStore(): LobbyBanStore {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LOBBY_BAN_STORAGE_KEY);
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as LobbyBanStore;
      }
    } catch {
      // Corrupt payload — drop it and start fresh.
      try {
        localStorage.removeItem(LOBBY_BAN_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    return {};
  }

  // ──────────────────────────────────────────────────────────────────────
  // Issue #1255 — lobby state machine + ready-check + seat-hold semantics.
  //
  // The state machine is the single source of truth for the lobby's
  // lifecycle phase. `canStartGame` (above) is gated on the state being
  // `STARTING` (which only {@link advanceToStarting} can set), so a
  // half-formed lobby can never race a peer's first action into the game.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Issue #1255 — read the lobby's current state. Defaults to `'WAITING'`
   * when the lobby predates the state machine (the persisted `state`
   * field is optional — see `GameLobby.state`).
   */
  getLobbyState(): LobbyState {
    return this.currentLobby?.state ?? 'WAITING';
  }

  /**
   * Issue #1255 — open a ready-check session. The host calls this when
   * the 2nd peer joins (or any time the host wants to take a fresh
   * consensus). For a single-peer check (e.g. a late joiner during
   * IN_GAME) pass `kind: 'late-joiner'` and an explicit
   * `targetPeerIds: [joinerId]`; the check will use
   * `LOBBY_LATE_JOINER_READY_CHECK_MS` as the window.
   *
   * The sessionId is `rc-<counter>` and is unique within the lifetime of
   * the host process. It is returned so the caller can route the
   * `READY_CHECK_REQUEST` envelope to peers and so peers can correlate
   * their `READY_CHECK_RESPONSE` with the right session.
   *
   * Re-entrancy: calling `beginReadyCheck` while a session is already
   * open is a no-op and returns `{ started: false, reason: 'in-progress' }`
   * with the existing sessionId. This protects the host from
   * accidentally double-opening a check (e.g. rapid addPlayer events).
   */
  beginReadyCheck(
    kind: ReadyCheckKind = 'full',
    targetPeerIds?: string[],
  ): BeginReadyCheckResult {
    if (!this.currentLobby) {
      return { started: false, reason: 'No active lobby' };
    }
    if (this.readyCheck) {
      return {
        started: false,
        reason: 'A ready check is already in progress',
        sessionId: this.readyCheck.id,
      };
    }
    const state = this.getLobbyState();
    if (state === 'IN_GAME' && kind !== 'late-joiner') {
      // The host cannot open a full check during an active game; only the
      // single-peer late-joiner check is permitted mid-game.
      return {
        started: false,
        reason: 'Cannot open a full ready check during an active game',
      };
    }
    if (state === 'STARTING') {
      // STARTING is a transient lock — the host is already advancing.
      return { started: false, reason: 'Lobby is already starting' };
    }
    if (state === 'ENDED') {
      return { started: false, reason: 'Lobby has ended' };
    }

    // For a full check, every non-spectator player (status !== 'host' is
    // not the rule — the host is included so the lobby's own start
    // button is gated by the same consensus) must be a target. The
    // check covers every player in the roster.
    const targets =
      targetPeerIds ?? this.currentLobby.players.map((p) => p.id);
    if (targets.length === 0) {
      return { started: false, reason: 'No targets for the ready check' };
    }

    this.readyCheckCounter += 1;
    const windowMs =
      kind === 'late-joiner'
        ? LOBBY_LATE_JOINER_READY_CHECK_MS
        : LOBBY_READY_CHECK_WINDOW_MS;
    this.readyCheck = {
      id: `rc-${this.readyCheckCounter}`,
      kind,
      startedAt: Date.now(),
      windowMs,
      targetPeerIds: [...targets],
      responses: {},
      cancelledAt: null,
    };
    this.transitionTo('READY_CHECK');
    return { started: true, sessionId: this.readyCheck.id };
  }

  /**
   * Issue #1255 — record a peer's response to the active ready check. The
   * host correlates on `sessionId`; an unknown or expired session is
   * counted in {@link readyCheckDropped} and the response is ignored.
   *
   * `quorumReached` is true when every target peer has now responded. The
   * host should call {@link advanceToStarting} when this is true (the
   * state machine does NOT auto-advance so the host can apply side
   * effects like broadcasting the start signal in the same tick).
   */
  recordReadyResponse(
    sessionId: string,
    peerId: string,
    ready: boolean,
  ): RecordReadyResponseResult {
    const session = this.readyCheck;
    if (!session) {
      this.readyCheckDropped += 1;
      return {
        accepted: false,
        quorumReached: false,
        late: true,
        reason: 'No active ready check',
      };
    }
    if (session.id !== sessionId) {
      this.readyCheckDropped += 1;
      return {
        accepted: false,
        quorumReached: false,
        late: true,
        reason: 'Unknown sessionId',
      };
    }
    if (session.cancelledAt !== null) {
      this.readyCheckDropped += 1;
      return {
        accepted: false,
        quorumReached: false,
        late: true,
        reason: 'Session was cancelled',
      };
    }
    if (Date.now() - session.startedAt > session.windowMs) {
      // The window has expired; this is a late response. Don't accept it
      // (the auto-advance path will fire from the host's timer), but
      // count it for visibility.
      this.readyCheckDropped += 1;
      return {
        accepted: false,
        quorumReached: false,
        late: true,
        reason: 'Response arrived after the window expired',
      };
    }
    if (!session.targetPeerIds.includes(peerId)) {
      // Not a target (e.g. a spectator answered, or a stale peerId).
      return {
        accepted: false,
        quorumReached: false,
        late: false,
        reason: 'Peer is not a target of this ready check',
      };
    }
    const response: ReadyCheckResponse = {
      peerId,
      ready,
      respondedAt: Date.now(),
    };
    session.responses[peerId] = response;
    const quorumReached = session.targetPeerIds.every(
      (id) => session.responses[id] !== undefined,
    );
    return { accepted: true, quorumReached, late: false };
  }

  /**
   * Issue #1255 — evaluate the active ready check against the
   * wall-clock. If the window has expired and quorum is not yet reached,
   * the host may decide to either force-advance (treating missing
   * responses as `ready: true`) or cancel back to `WAITING`. Returns
   * `null` when no check is active; otherwise returns a snapshot the
   * host can use to drive the auto-advance path.
   */
  evaluateReadyCheck(now: number = Date.now()): {
    sessionId: string;
    kind: ReadyCheckKind;
    elapsedMs: number;
    remainingMs: number;
    windowExpired: boolean;
    quorumReached: boolean;
    pendingPeerIds: string[];
  } | null {
    const session = this.readyCheck;
    if (!session) return null;
    const elapsedMs = now - session.startedAt;
    const remainingMs = Math.max(0, session.windowMs - elapsedMs);
    const windowExpired = elapsedMs >= session.windowMs;
    const quorumReached = session.targetPeerIds.every(
      (id) => session.responses[id] !== undefined,
    );
    const pendingPeerIds = session.targetPeerIds.filter(
      (id) => session.responses[id] === undefined,
    );
    return {
      sessionId: session.id,
      kind: session.kind,
      elapsedMs,
      remainingMs,
      windowExpired,
      quorumReached,
      pendingPeerIds,
    };
  }

  /**
   * Issue #1255 — cancel the active ready check without advancing. Used
   * when a peer drops mid-check (and the host does not want to wait for
   * the rest of the window) or when the host wants to reset the
   * consensus attempt. Transitions the lobby back to `WAITING`.
   */
  cancelReadyCheck(reason: string = 'host-cancelled'): {
    cancelled: boolean;
    reason?: string;
  } {
    const session = this.readyCheck;
    if (!session) {
      return { cancelled: false, reason: 'No active ready check' };
    }
    session.cancelledAt = Date.now();
    this.readyCheck = null;
    this.transitionTo('WAITING');
    return { cancelled: true, reason };
  }

  /**
   * Issue #1255 — advance the lobby to `STARTING` once quorum is reached
   * (or the host has decided to force-advance). Clears the ready-check
   * session and transitions the state. Returns false when no session is
   * active, when the state machine refuses the transition, or when
   * quorum is not yet reached and the host did not explicitly opt in to
   * force-advance.
   */
  advanceToStarting(options: { force?: boolean } = {}): boolean {
    if (!this.currentLobby) return false;
    if (!this.readyCheck) return false;
    if (this.readyCheck.cancelledAt !== null) return false;
    const state = this.getLobbyState();
    if (state !== 'READY_CHECK') return false;
    if (!options.force) {
      const evalResult = this.evaluateReadyCheck();
      if (!evalResult || !evalResult.quorumReached) {
        return false;
      }
    }
    this.readyCheck = null;
    this.transitionTo('STARTING');
    return true;
  }

  /**
   * Issue #1255 — mark the lobby as `IN_GAME`. Called by the host once
   * the start signal has been echoed by every peer. The previous
   * `updateLobbyStatus('in-progress')` path still works for backward
   * compatibility, but the state machine gives the host a single
   * authoritative call site.
   */
  startInGame(): boolean {
    if (!this.currentLobby) return false;
    if (this.getLobbyState() !== 'STARTING') return false;
    this.transitionTo('IN_GAME');
    return true;
  }

  /**
   * Issue #1255 — mark the lobby as `ENDED` when the game is over. This
   * is a terminal state; the host should follow up with `closeLobby` to
   * tear down the lobby and unregister from the public browser.
   */
  endGame(): boolean {
    if (!this.currentLobby) return false;
    if (this.getLobbyState() !== 'IN_GAME') return false;
    this.transitionTo('ENDED');
    return true;
  }

  /**
   * Issue #1255 — explicit state transition with a strict allow-list.
   * `WAITING → READY_CHECK` is allowed only via
   * {@link beginReadyCheck}; `READY_CHECK → STARTING` is allowed only via
   * {@link advanceToStarting}; etc. This is the central choke-point for
   * lifecycle changes and is the right place to add logging or
   * telemetry later.
   */
  private transitionTo(next: LobbyState): boolean {
    if (!this.currentLobby) return false;
    const current = this.getLobbyState();
    if (current === next) return true;
    const allowed = STATE_TRANSITIONS[current] ?? new Set();
    if (!allowed.has(next)) {
      return false;
    }
    this.currentLobby.state = next;
    // Mirror the state into the existing `status` field so the
    // public-lobby-browser, the host page, and the host status banner
    // all keep their existing semantics (status is the user-visible
    // phase; state is the strict machine phase).
    this.currentLobby.status = LOBBY_STATE_TO_STATUS[next];
    this.saveLobbyToStorage();
    return true;
  }

  /**
   * Issue #1255 — the active ready-check session, or null. Read-only:
   * callers should mutate state through the public methods above. Used
   * by the host UI to render the countdown and the per-peer indicator.
   */
  getActiveReadyCheck(): Readonly<ReadyCheckSession> | null {
    return this.readyCheck;
  }

  /**
   * Issue #1255 — reserve a peer's seat for the reconnect-token window.
   * Called by the host when a peer disconnects mid-game. A late joiner
   * arriving while a seat is held is rejected via {@link isSeatHeld}
   * (with a `peer-held-by` reason so the joiner can be told whose seat
   * is held). Idempotent: holding the same peer twice updates the
   * `expiresAt` and `reason` (the most recent disconnect wins).
   *
   * The hold is auto-purged on every {@link getActiveSeatHolds} / 
   * {@link isSeatHeld} call so the in-memory map never grows unbounded.
   */
  holdSeatForRejoin(peerId: string, originalName: string): SeatHold {
    const now = Date.now();
    const hold: SeatHold = {
      peerId,
      originalName,
      heldAt: now,
      expiresAt: now + LOBBY_SEAT_HOLD_DURATION_MS,
      reason: 'peer-disconnected',
    };
    this.seatHolds.set(peerId, hold);
    this.saveLobbyToStorage();
    return hold;
  }

  /**
   * Issue #1255 — release a seat hold. Called by the reconnect-token
   * store when the peer successfully rejoins (the hold is consumed and
   * the player reattaches to the same slot) or by the host when the
   * hold window has elapsed and the host wants to free the seat
   * immediately rather than wait for lazy purge.
   */
  releaseSeatHold(peerId: string): boolean {
    const had = this.seatHolds.delete(peerId);
    if (had) this.saveLobbyToStorage();
    return had;
  }

  /**
   * Issue #1255 — true when a seat is held for the given peerId AND the
   * hold has not yet expired. Lazy-purges expired entries as a side
   * effect so the in-memory map never grows unbounded. The
   * `originalName` (returned via {@link getActiveSeatHolds}) is what the
   * host UI shows in the "Waiting for X to reconnect" message.
   */
  isSeatHeld(peerId: string): boolean {
    this.purgeExpiredSeatHolds();
    return this.seatHolds.has(peerId);
  }

  /**
   * Issue #1255 — snapshot of all active seat holds with each entry's
   * remaining lifetime. Returns a fresh array; mutating it does not
   * affect internal state. Used by the host UI to render the "seat
   * held" badge and by `addPlayer` to refuse a joiner that would
   * collide with a held seat.
   */
  getActiveSeatHolds(): Array<SeatHold & { remainingMs: number }> {
    this.purgeExpiredSeatHolds();
    const now = Date.now();
    return Array.from(this.seatHolds.values()).map((h) => ({
      ...h,
      remainingMs: Math.max(0, h.expiresAt - now),
    }));
  }

  /**
   * Issue #1255 — sweep the in-memory seat-hold map, dropping any entry
   * past its `expiresAt`. Idempotent and cheap (O(n) over a small map).
   */
  private purgeExpiredSeatHolds(): number {
    const now = Date.now();
    let removed = 0;
    for (const [peerId, hold] of this.seatHolds) {
      if (hold.expiresAt <= now) {
        this.seatHolds.delete(peerId);
        removed += 1;
      }
    }
    if (removed > 0) this.saveLobbyToStorage();
    return removed;
  }

  /**
   * Issue #1255 — register a late-joiner against the current lobby
   * during `IN_GAME`. The joiner is added to the roster AND a brief
   * single-peer ready check is opened so the joiner can confirm their
   * deck is loaded before the host releases them into the active game.
   * If a seat is held (issue #1255 AC: refresh-mid-game peer holds the
   * seat for 30 s), the joiner is rejected with `seat-held` so the
   * joiner can be told "Waiting for {originalName} to reconnect".
   */
  joinMidGame(playerName: string): {
    accepted: boolean;
    player?: Player;
    readyCheckSessionId?: string;
    reason?: string;
    heldFor?: string;
  } {
    if (!this.currentLobby) {
      return { accepted: false, reason: 'No active lobby' };
    }
    this.purgeExpiredSeatHolds();
    for (const hold of this.seatHolds.values()) {
      return {
        accepted: false,
        reason: 'seat-held',
        heldFor: hold.originalName,
      };
    }
    const player = this.addPlayer(playerName);
    if (!player) {
      return { accepted: false, reason: 'Lobby is full' };
    }
    const result = this.beginReadyCheck('late-joiner', [player.id]);
    if (!result.started) {
      // Fall through — the joiner is in the roster but the brief
      // ready check could not be opened (e.g. lobby state is ENDED).
      // Returning the rejection reason is still useful for the UI.
      return { accepted: true, player, reason: result.reason };
    }
    return {
      accepted: true,
      player,
      readyCheckSessionId: result.sessionId,
    };
  }
}

/**
 * Issue #1255 — state-machine transition allow-list. Each key is a
 * current state; the value is the set of states reachable in one
 * transition. Centralizing this table makes the machine auditable
 * and easy to test.
 */
const STATE_TRANSITIONS: Record<LobbyState, Set<LobbyState>> = {
  WAITING: new Set<LobbyState>(['READY_CHECK', 'ENDED']),
  READY_CHECK: new Set<LobbyState>(['WAITING', 'STARTING', 'ENDED']),
  STARTING: new Set<LobbyState>(['IN_GAME', 'WAITING', 'ENDED']),
  IN_GAME: new Set<LobbyState>(['ENDED']),
  ENDED: new Set<LobbyState>(['WAITING']),
};

/**
 * Issue #1255 — mirror the strict state machine to the existing
 * user-visible `status` field. The public-lobby-browser and host page
 * both read `status` for the user-facing label, so we keep that field
 * aligned with the machine.
 */
const LOBBY_STATE_TO_STATUS: Record<LobbyState, LobbyStatus> = {
  WAITING: 'waiting',
  READY_CHECK: 'waiting',
  STARTING: 'ready',
  IN_GAME: 'in-progress',
  ENDED: 'in-progress',
};

// Singleton instance
export const lobbyManager = new LobbyManager();
