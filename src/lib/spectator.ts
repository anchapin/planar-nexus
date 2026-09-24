/**
 * Spectator Mode System
 * Issue #75: Implement spectator mode UI and game state delivery
 *
 * Allows non-participating players to observe ongoing games in real-time.
 * Spectators receive full game state updates but cannot interact with the game.
 *
 * Features:
 * - Spectator registration and session management
 * - Real-time game state broadcasting to spectators
 * - Spectator-specific view filtering (see all hands, graveyard info)
 * - Spectator count and list tracking
 */

import { z } from "zod";
import type { GameAction } from "./action-broadcast";

// Spectator type - lightweight public representation
export interface Spectator {
  id: string;
  name: string;
  joinedAt: number;
  isHidden?: boolean;
}

// Spectator permissions for UI access control
export interface SpectatorPermissions {
  canChat: boolean;
  canSeeHands: boolean;
  canSeeTimers: boolean;
  isHidden: boolean;
}

// Spectator session schema
export const SpectatorSessionSchema = z.object({
  sessionId: z.string().uuid(),
  gameId: z.string(),
  spectatorId: z.string(),
  spectatorName: z.string(),
  joinedAt: z.number(),
  isActive: z.boolean(),
});

export type SpectatorSession = z.infer<typeof SpectatorSessionSchema>;

// Spectator message types
export type SpectatorMessageType =
  | "spectator-join"
  | "spectator-leave"
  | "spectator-list"
  | "game-state-update"
  | "action-broadcast"
  | "phase-change"
  | "turn-change"
  | "game-end";

export interface SpectatorMessage {
  type: SpectatorMessageType;
  gameId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// Game state for spectators (includes hidden info)
export interface SpectatorGameState {
  gameId: string;
  turn: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  players: SpectatorPlayerInfo[];
  stack: GameAction[];
  spectatingPlayerIds: string[];
}

export interface SpectatorPlayerInfo {
  playerId: string;
  name: string;
  life: number;
  hands: SpectatorHandInfo | null; // Spectators can see all hands
  graveyard: string[]; // Spectators can see graveyards
  library: number;
  exile: string[];
}

export interface SpectatorHandInfo {
  cards: string[]; // Card IDs or names visible to spectators
}

/**
 * Spectator manager for handling spectator sessions
 */
export class SpectatorManager {
  private sessions: Map<string, SpectatorSession> = new Map();
  private gameSpectators: Map<string, Set<string>> = new Map();

  /**
   * Register a spectator for a game
   */
  registerSpectator(gameId: string, spectatorId: string, spectatorName: string): SpectatorSession {
    const session: SpectatorSession = {
      sessionId: crypto.randomUUID(),
      gameId,
      spectatorId,
      spectatorName,
      joinedAt: Date.now(),
      isActive: true,
    };

    this.sessions.set(session.sessionId, session);

    // Add to game's spectator set
    if (!this.gameSpectators.has(gameId)) {
      this.gameSpectators.set(gameId, new Set());
    }
    this.gameSpectators.get(gameId)!.add(session.sessionId);

    return session;
  }

  /**
   * Remove a spectator session
   */
  removeSpectator(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const gameSpectators = this.gameSpectators.get(session.gameId);
    if (gameSpectators) {
      gameSpectators.delete(sessionId);
      if (gameSpectators.size === 0) {
        this.gameSpectators.delete(session.gameId);
      }
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get all spectators for a game
   */
  getGameSpectators(gameId: string): SpectatorSession[] {
    const sessionIds = this.gameSpectators.get(gameId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is SpectatorSession => s !== undefined && s.isActive);
  }

  /**
   * Get spectator count for a game
   */
  getSpectatorCount(gameId: string): number {
    return this.getGameSpectators(gameId).length;
  }

  /**
   * Create a spectator view of game state
   * Includes hidden information (hands, graveyards) visible to spectators
   */
  createSpectatorGameState(
    gameId: string,
    players: SpectatorPlayerInfo[]
  ): SpectatorGameState {
    return {
      gameId,
      turn: 0,
      phase: "unknown",
      step: "unknown",
      activePlayerId: "",
      priorityPlayerId: "",
      players,
      stack: [],
      spectatingPlayerIds: this.getGameSpectators(gameId).map(s => s.spectatorId),
    };
  }

  /**
   * Create a spectator leave message
   */
  createLeaveMessage(gameId: string, spectatorId: string): SpectatorMessage {
    return {
      type: "spectator-leave",
      gameId,
      timestamp: Date.now(),
      payload: { spectatorId },
    };
  }

  /**
   * Create a spectator join message
   */
  createJoinMessage(gameId: string, spectator: SpectatorSession): SpectatorMessage {
    return {
      type: "spectator-join",
      gameId,
      timestamp: Date.now(),
      payload: {
        spectatorId: spectator.spectatorId,
        spectatorName: spectator.spectatorName,
        spectatorCount: this.getSpectatorCount(gameId),
      },
    };
  }
}

// Default export for singleton
export const spectatorManager = new SpectatorManager();
