/**
 * React hook for managing lobby state in multiplayer
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GameLobby, Player, HostGameConfig, LobbyStatus, PlayerStatus } from '@/lib/multiplayer-types';
import { lobbyManager } from '@/lib/lobby-manager';
import { formatGameCode } from '@/lib/game-code-generator';
import { validateDeckForLobby } from '@/lib/format-validator';

export interface UseLobbyReturn {
  lobby: GameLobby | null;
  isHost: boolean;
  isLoading: boolean;
  error: string | null;
  createLobby: (config: HostGameConfig, hostName: string) => void;
  addPlayer: (playerName: string) => Player | null;
  removePlayer: (playerId: string) => boolean;
  updatePlayerStatus: (playerId: string, status: PlayerStatus) => boolean;
  updatePlayerDeck: (playerId: string, deckId: string, deckName: string, deck?: any) => { success: boolean; isValid: boolean; errors: string[] };
  canStartGame: boolean;
  canForceStart: boolean;
  startGame: () => boolean;
  forceStartGame: () => boolean;
  closeLobby: () => void;
  getGameCode: () => string;
  validateDeckForFormat: (deck: any) => { isValid: boolean; errors: string[] };
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

  const updatePlayerDeck = useCallback((playerId: string, deckId: string, deckName: string, deck?: any) => {
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

  const validateDeckForFormat = useCallback((deck: any) => {
    if (!lobby) return { isValid: false, errors: ['No lobby found'] };

    const validation = validateDeckForLobby(deck, lobby.format);
    return {
      isValid: validation.isValid && validation.canPlay,
      errors: [...validation.errors, ...validation.warnings],
    };
  }, [lobby]);

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
  };
}
