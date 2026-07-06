/**
 * React hook for managing lobby state in multiplayer
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GameLobby, Player, HostGameConfig, PlayerStatus, TeamId, Team, TeamSettings, LobbyState, ReadyCheckKind, ReadyCheckSession, SeatHold } from '@/lib/multiplayer-types';
import { lobbyManager, KickPeerResult, LobbyBanScope, LobbyBanEntry, BeginReadyCheckResult, RecordReadyResponseResult, LOBBY_READY_CHECK_WINDOW_MS, LOBBY_LATE_JOINER_READY_CHECK_MS, LOBBY_SEAT_HOLD_DURATION_MS } from '@/lib/lobby-manager';
import { formatGameCode } from '@/lib/game-code-generator';
import { validateDeckForLobby } from '@/lib/format-validator';
import { getGameModeConfig } from '@/lib/game-mode';
import type { SavedDeck } from '@/app/actions';

export interface UseLobbyReturn {
  lobby: GameLobby | null;
  isHost: boolean;
  isLoading: boolean;
  error: string | null;
  createLobby: (config: HostGameConfig, hostName: string) => void;
  addPlayer: (playerName: string) => Player | null;
  removePlayer: (playerId: string) => boolean;
  updatePlayerStatus: (playerId: string, status: PlayerStatus) => boolean;
  updatePlayerDeck: (playerId: string, deckId: string, deckName: string, deck?: SavedDeck) => { success: boolean; isValid: boolean; errors: string[] };
  canStartGame: boolean;
  canForceStart: boolean;
  startGame: () => boolean;
  forceStartGame: () => boolean;
  closeLobby: () => void;
  getGameCode: () => string;
  validateDeckForFormat: (deck: SavedDeck) => { isValid: boolean; errors: string[] };
  // Team management
  isTeamMode: boolean;
  assignPlayerToTeam: (playerId: string, teamId: TeamId) => boolean;
  autoAssignTeams: () => void;
  getPlayerTeam: (playerId: string) => Team | undefined;
  getTeamPlayers: (teamId: TeamId) => Player[];
  areTeamsValid: boolean;
  updateTeamSettings: (settings: Partial<TeamSettings>) => boolean;
  updateTeamName: (teamId: TeamId, name: string) => boolean;
  canAttackPlayer: (attackerId: string, defenderId: string) => boolean;
  // Issue #1257 — host moderation (kick, ban, pause). Host-only actions;
  // the UI hides the controls for non-hosts (see `isHost` above).
  kickPeer: (peerId: string, reason?: string) => KickPeerResult;
  banPeer: (peerId: string, scope?: LobbyBanScope, reason?: string) => boolean;
  isPeerBanned: (peerId: string) => boolean;
  unbanPeer: (peerId: string) => boolean;
  getBanList: () => Array<LobbyBanEntry & { remainingMs: number }>;
  isPaused: boolean;
  pauseGame: () => { pausedAt: number };
  resumeGame: () => { pausedDurationMs: number };
  getPauseElapsedMs: () => number;
  // Issue #1255 — lobby state machine + ready-check + seat-hold helpers.
  // The host page uses these to render the per-peer ready indicator and
  // the 10 s countdown; the late-joiner check is opened by `joinMidGame`
  // when a peer joins an in-progress game.
  lobbyState: LobbyState;
  activeReadyCheck: Readonly<ReadyCheckSession> | null;
  readyCheckWindowMs: { full: number; lateJoiner: number };
  seatHoldDurationMs: number;
  beginReadyCheck: (kind?: ReadyCheckKind, targetPeerIds?: string[]) => BeginReadyCheckResult;
  recordReadyResponse: (sessionId: string, peerId: string, ready: boolean) => RecordReadyResponseResult;
  cancelReadyCheck: (reason?: string) => { cancelled: boolean; reason?: string };
  advanceToStarting: (options?: { force?: boolean }) => boolean;
  startInGame: () => boolean;
  endGame: () => boolean;
  evaluateReadyCheck: () => ReturnType<typeof lobbyManager.evaluateReadyCheck>;
  holdSeatForRejoin: (peerId: string, originalName: string) => SeatHold;
  releaseSeatHold: (peerId: string) => boolean;
  isSeatHeld: (peerId: string) => boolean;
  getActiveSeatHolds: () => Array<SeatHold & { remainingMs: number }>;
  joinMidGame: (playerName: string) => {
    accepted: boolean;
    player?: Player;
    readyCheckSessionId?: string;
    reason?: string;
    heldFor?: string;
  };
}

export function useLobby(): UseLobbyReturn {
  const router = useRouter();
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);

  // Load existing lobby on mount
  useEffect(() => {
    const existingLobby = lobbyManager.getCurrentLobby();
    if (existingLobby) {
      setLobby(existingLobby);
      setIsHost(true); // If we have a stored lobby, we're the host
    }
  }, []);

  const createLobby = useCallback((config: HostGameConfig, hostName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const newLobby = lobbyManager.createLobby(config, hostName);
      setLobby(newLobby);
      setIsHost(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addPlayer = useCallback((playerName: string) => {
    const player = lobbyManager.addPlayer(playerName);
    if (player) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return player;
  }, []);

  const removePlayer = useCallback((playerId: string) => {
    const success = lobbyManager.removePlayer(playerId);
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const updatePlayerStatus = useCallback((playerId: string, status: PlayerStatus) => {
    const success = lobbyManager.updatePlayerStatus(playerId, status);
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const updatePlayerDeck = useCallback((playerId: string, deckId: string, deckName: string, deck?: SavedDeck) => {
    const result = lobbyManager.updatePlayerDeck(playerId, deckId, deckName, deck);
    if (result.success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return result;
  }, []);

  const canStartGame = lobby ? lobbyManager.canStartGame() : false;

  const canForceStart = lobby ? lobbyManager.canForceStart() : false;

  const startGame = useCallback(() => {
    if (!lobby) return false;
    // Issue #1255 — `canStartGame` is now gated on the state machine
    // being in `STARTING`. The host must first call `beginReadyCheck`
    // and either reach quorum or the 15 s window must expire before
    // `startGame` will flip the lobby to `IN_GAME`.
    if (!canStartGame) return false;
    const success = lobbyManager.startInGame();
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
      router.push('/game-board');
      return true;
    }
    return false;
  }, [lobby, canStartGame, router]);

  const forceStartGame = useCallback(() => {
    if (!lobby || !canForceStart) return false;
    // Issue #1255 — force-start bypasses the ready check. The host still
    // gets to `IN_GAME` via the state machine (force-advance through
    // `STARTING`).
    const advanced = lobbyManager.advanceToStarting({ force: true });
    if (!advanced) return false;
    const success = lobbyManager.startInGame();
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
      router.push('/game-board');
      return true;
    }
    return false;
  }, [lobby, canForceStart, router]);

  const closeLobby = useCallback(() => {
    lobbyManager.closeLobby();
    setLobby(null);
    setIsHost(false);
  }, []);

  const getGameCode = useCallback(() => {
    return lobby ? formatGameCode(lobby.gameCode) : '';
  }, [lobby]);

  const validateDeckForFormat = useCallback((deck: SavedDeck) => {
    if (!lobby) return { isValid: false, errors: ['No lobby found'] };

    const validation = validateDeckForLobby(deck, lobby.format);
    return {
      isValid: validation.isValid && validation.canPlay,
      errors: [...validation.errors, ...validation.warnings],
    };
  }, [lobby]);

  // Team management functions
  const isTeamMode = lobby ? getGameModeConfig(lobby.gameMode).isTeamMode : false;

  const assignPlayerToTeam = useCallback((playerId: string, teamId: TeamId) => {
    const success = lobbyManager.assignPlayerToTeam(playerId, teamId);
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const autoAssignTeams = useCallback(() => {
    lobbyManager.autoAssignTeams();
    setLobby(lobbyManager.getCurrentLobby());
  }, []);

  const getPlayerTeam = useCallback((playerId: string) => {
    return lobbyManager.getPlayerTeam(playerId);
  }, []);

  const getTeamPlayers = useCallback((teamId: TeamId) => {
    return lobbyManager.getTeamPlayers(teamId);
  }, []);

  const areTeamsValid = lobby ? lobbyManager.areTeamsValid() : true;

  const updateTeamSettings = useCallback((settings: Partial<TeamSettings>) => {
    const success = lobbyManager.updateTeamSettings(settings);
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const updateTeamName = useCallback((teamId: TeamId, name: string) => {
    const success = lobbyManager.updateTeamName(teamId, name);
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const canAttackPlayer = useCallback((attackerId: string, defenderId: string) => {
    return lobbyManager.canAttackPlayer(attackerId, defenderId);
  }, []);

  // Issue #1257 — host moderation (kick, ban, pause). The transport
  // (`p2p-game-connection.ts`) is the envelope; the lobby manager owns the
  // policy + ban list + pause clock. The UI calls these from the host page.
  const [isPausedState, setIsPausedState] = useState(lobbyManager.isPaused());

  const kickPeer = useCallback((peerId: string, reason?: string) => {
    const result = lobbyManager.kickPeer(peerId, reason);
    if (result.removed || result.banned) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return result;
  }, []);

  const banPeer = useCallback(
    (peerId: string, scope: LobbyBanScope = "session", reason?: string) => {
      const result = lobbyManager.banPeer(peerId, scope, reason);
      return result.added;
    },
    [],
  );

  const isPeerBanned = useCallback((peerId: string) => {
    return lobbyManager.isPeerBanned(peerId);
  }, []);

  const unbanPeer = useCallback((peerId: string) => {
    return lobbyManager.unbanPeer(peerId);
  }, []);

  const getBanList = useCallback(() => {
    return lobbyManager.getBanList();
  }, []);

  const pauseGame = useCallback(() => {
    const result = lobbyManager.pauseGame();
    setIsPausedState(lobbyManager.isPaused());
    return result;
  }, []);

  const resumeGame = useCallback(() => {
    const result = lobbyManager.resumeGame();
    setIsPausedState(lobbyManager.isPaused());
    return result;
  }, []);

  const getPauseElapsedMs = useCallback(() => {
    return lobbyManager.getPauseElapsedMs();
  }, []);

  // Issue #1255 — state machine + ready-check + seat-hold helpers. The
  // hook mirrors the lobby manager's API surface and re-renders the
  // `lobby` snapshot when the underlying state changes so React UI
  // updates after each transition.
  const beginReadyCheck = useCallback(
    (kind: ReadyCheckKind = 'full', targetPeerIds?: string[]) => {
      const result = lobbyManager.beginReadyCheck(kind, targetPeerIds);
      if (result.started) {
        setLobby(lobbyManager.getCurrentLobby());
      }
      return result;
    },
    [],
  );

  const recordReadyResponse = useCallback(
    (sessionId: string, peerId: string, ready: boolean) => {
      const result = lobbyManager.recordReadyResponse(
        sessionId,
        peerId,
        ready,
      );
      if (result.accepted) {
        setLobby(lobbyManager.getCurrentLobby());
      }
      return result;
    },
    [],
  );

  const cancelReadyCheck = useCallback((reason?: string) => {
    const result = lobbyManager.cancelReadyCheck(reason);
    setLobby(lobbyManager.getCurrentLobby());
    return result;
  }, []);

  const advanceToStarting = useCallback(
    (options?: { force?: boolean }) => {
      const success = lobbyManager.advanceToStarting(options);
      if (success) {
        setLobby(lobbyManager.getCurrentLobby());
      }
      return success;
    },
    [],
  );

  const startInGame = useCallback(() => {
    const success = lobbyManager.startInGame();
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const endGame = useCallback(() => {
    const success = lobbyManager.endGame();
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return success;
  }, []);

  const evaluateReadyCheck = useCallback(
    () => lobbyManager.evaluateReadyCheck(),
    [],
  );

  const holdSeatForRejoin = useCallback(
    (peerId: string, originalName: string) => {
      const hold = lobbyManager.holdSeatForRejoin(peerId, originalName);
      setLobby(lobbyManager.getCurrentLobby());
      return hold;
    },
    [],
  );

  const releaseSeatHold = useCallback((peerId: string) => {
    const released = lobbyManager.releaseSeatHold(peerId);
    if (released) {
      setLobby(lobbyManager.getCurrentLobby());
    }
    return released;
  }, []);

  const isSeatHeld = useCallback((peerId: string) => {
    return lobbyManager.isSeatHeld(peerId);
  }, []);

  const getActiveSeatHolds = useCallback(() => {
    return lobbyManager.getActiveSeatHolds();
  }, []);

  const joinMidGame = useCallback((playerName: string) => {
    const result = lobbyManager.joinMidGame(playerName);
    setLobby(lobbyManager.getCurrentLobby());
    return result;
  }, []);

  const lobbyState: LobbyState = lobbyManager.getLobbyState();
  const activeReadyCheck = lobbyManager.getActiveReadyCheck();

  return {
    lobby,
    isHost,
    isLoading,
    error,
    createLobby,
    addPlayer,
    removePlayer,
    updatePlayerStatus,
    updatePlayerDeck,
    canStartGame,
    canForceStart,
    startGame,
    forceStartGame,
    closeLobby,
    getGameCode,
    validateDeckForFormat,
    // Team management
    isTeamMode,
    assignPlayerToTeam,
    autoAssignTeams,
    getPlayerTeam,
    getTeamPlayers,
    areTeamsValid,
    updateTeamSettings,
    updateTeamName,
    canAttackPlayer,
    // Issue #1257 — host moderation
    kickPeer,
    banPeer,
    isPeerBanned,
    unbanPeer,
    getBanList,
    isPaused: isPausedState,
    pauseGame,
    resumeGame,
    getPauseElapsedMs,
    // Issue #1255 — state machine + ready-check + seat-hold
    lobbyState,
    activeReadyCheck,
    readyCheckWindowMs: {
      full: LOBBY_READY_CHECK_WINDOW_MS,
      lateJoiner: LOBBY_LATE_JOINER_READY_CHECK_MS,
    },
    seatHoldDurationMs: LOBBY_SEAT_HOLD_DURATION_MS,
    beginReadyCheck,
    recordReadyResponse,
    cancelReadyCheck,
    advanceToStarting,
    startInGame,
    endGame,
    evaluateReadyCheck,
    holdSeatForRejoin,
    releaseSeatHold,
    isSeatHeld,
    getActiveSeatHolds,
    joinMidGame,
  };
}
