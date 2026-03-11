import { DeterministicGameStateEngine } from "../deterministic-sync";
import { GameState } from "../types";

describe("DeterministicGameStateEngine", () => {
  const localPeerId = "local-peer";
  const remotePeerId = "remote-peer";
  let engine: DeterministicGameStateEngine;

  beforeEach(() => {
    engine = new DeterministicGameStateEngine(localPeerId);
    engine.registerPeer(remotePeerId);
  });

  const mockGameState: GameState = {
    gameId: "game-1",
    players: new Map(),
    cards: new Map(),
    zones: new Map(),
    stack: [],
    turn: {
      activePlayerId: "player-1",
      currentPhase: "main_1" as any,
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: Date.now(),
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: "player-1",
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "standard",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  };

  test("resolveConflict should handle simultaneous actions with tie-breaking", () => {
    const conflictSeq = 5;
    const now = Date.now();

    // Create two conflicting actions with the same sequence number
    const localAction = {
      sequenceNumber: conflictSeq,
      action: { type: "PASS_PRIORITY" as any, payload: {} },
      previousStateHash: "hash-pre",
      resultingStateHash: "hash-local",
      initiatorId: localPeerId,
      timestamp: now,
    };

    const remoteAction = {
      sequenceNumber: conflictSeq,
      action: { type: "DECLARE_ATTACKER" as any, payload: {} },
      previousStateHash: "hash-pre",
      resultingStateHash: "hash-remote",
      initiatorId: remotePeerId,
      timestamp: now, // Same timestamp
    };

    // Add them to history manually to simulate conflict discovery
    // In a real scenario, they would arrive via different paths
    (engine as any).actionHistory = [localAction, remoteAction];

    const resolution = engine.resolveConflict(
      mockGameState,
      { ...mockGameState, status: "completed", players: new Map([["p1", { life: 10 } as any]]) }, // Discrepancy in player state
      remotePeerId,
      conflictSeq
    );

    expect(resolution.resolved).toBe(true);
    expect(resolution.strategy).toBe("authoritative");
    
    // Tie-breaker: local-peer (L) vs remote-peer (R) alphabetically
    // "local-peer" comes before "remote-peer"
    expect(resolution.resolutionActions[0].initiatorId).toBe(localPeerId);
    expect(resolution.conflictDescription).toContain("Resolved simultaneous action conflict");
  });

  test("resolveConflict should prioritize earlier timestamp", () => {
    const conflictSeq = 10;
    const now = Date.now();

    const localAction = {
      sequenceNumber: conflictSeq,
      action: { type: "PASS_PRIORITY" as any, payload: {} },
      previousStateHash: "hash-pre",
      resultingStateHash: "hash-local",
      initiatorId: localPeerId,
      timestamp: now + 100, // Later
    };

    const remoteAction = {
      sequenceNumber: conflictSeq,
      action: { type: "DECLARE_ATTACKER" as any, payload: {} },
      previousStateHash: "hash-pre",
      resultingStateHash: "hash-remote",
      initiatorId: remotePeerId,
      timestamp: now, // Earlier
    };

    (engine as any).actionHistory = [localAction, remoteAction];

    const resolution = engine.resolveConflict(
      mockGameState,
      { ...mockGameState, status: "completed", players: new Map([["p1", { life: 10 } as any]]) },
      remotePeerId,
      conflictSeq
    );

    expect(resolution.resolutionActions[0].initiatorId).toBe(remotePeerId);
  });
});
