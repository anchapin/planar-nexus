/**
 * React hook for managing lobby state in multiplayer
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GameLobby, Player, HostGameConfig, PlayerStatus, TeamId, Team, TeamSettings } from '@/lib/multiplayer-types';
import { lobbyManager } from '@/lib/lobby-manager';
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
    if (!lobby || !canStartGame) return false;

    const success = lobbyManager.updateLobbyStatus('in-progress');
    if (success) {
      setLobby(lobbyManager.getCurrentLobby());
      router.push('/game-board');
      return true;
    }
    return false;
  }, [lobby, canStartGame, router]);

  const forceStartGame = useCallback(() => {
    if (!lobby || !canForceStart) return false;

    const success = lobbyManager.updateLobbyStatus('in-progress');
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
  };
}
