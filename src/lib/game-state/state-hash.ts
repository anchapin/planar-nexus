/**
 * State Hash Verification for P2P Multiplayer
 * 
 * This module provides deterministic state hashing to detect desyncs
 * between peers in a multiplayer game.
 */

import type { GameState, PlayerId } from './types';

/**
 * Compute a deterministic hash of the game state
 * This hash is used to detect desyncs between peers
 */
export function computeStateHash(state: GameState): string {
  // Create a deterministic representation of the state
  const stateSnapshot = createStateSnapshot(state);
  
  // Serialize to a consistent string format
  const serialized = serializeStateSnapshot(stateSnapshot);
  
  // Use a simple hash function for consistency
  return simpleHash(serialized);
}

/**
 * Create a deterministic snapshot of relevant game state
 */
function createStateSnapshot(state: GameState): StateSnapshot {
  const snapshot: StateSnapshot = {
    gameId: state.gameId,
    status: state.status,
    turn: state.turn ? {
      turnNumber: state.turn.turnNumber,
      activePlayerId: state.turn.activePlayerId,
      currentPhase: state.turn.currentPhase,
    } : null,
    players: [],
    stack: state.stack.map(item => ({
      id: item.id,
      type: item.type,
    })),
    combat: state.combat ? {
      inCombatPhase: state.combat.inCombatPhase,
      attackerIds: state.combat.attackers.map(a => a.cardId),
      blockerAssignments: Object.fromEntries(
        Array.from(state.combat.blockers.entries()).map(([attackerId, blockers]) => [
          attackerId,
          blockers.map(b => b.cardId)
        ])
      ),
    } : null,
  };

  // Add player states (order-independent via sorting)
  const playerIds = Array.from(state.players.keys()).sort();
  
  for (const playerId of playerIds) {
    const player = state.players.get(playerId)!;
    snapshot.players.push({
      playerId,
      life: player.life,
      poisonCounters: player.poisonCounters,
      hasLost: player.hasLost,
      // Simplified commander damage
      commanderDamage: Array.from(player.commanderDamage.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([targetId, damage]) => `${targetId}:${damage}`),
    });
  }

  // Add zone contents (libraries, hands, battlefields, graveyards)
  for (const [zoneId, zone] of state.zones) {
    // Extract player ID from zone ID if applicable
    const isPlayerZone = zoneId.includes('-');
    const playerId = isPlayerZone ? zoneId.split('-')[0] : null;
    
    snapshot.zones = snapshot.zones || {};
    snapshot.zones[zoneId] = {
      type: zone.type,
      cardIds: zone.cardIds.slice().sort(), // Sort for determinism
      ownerId: playerId,
    };
  }

  return snapshot;
}

/**
 * Serialize state snapshot to a consistent string
 */
function serializeStateSnapshot(snapshot: StateSnapshot): string {
  const parts: string[] = [];
  
  parts.push(`gameId:${snapshot.gameId}`);
  parts.push(`status:${snapshot.status}`);
  
  if (snapshot.turn) {
    parts.push(`turn:${snapshot.turn.turnNumber}:${snapshot.turn.activePlayerId}:${snapshot.turn.currentPhase}`);
  }
  
  for (const player of snapshot.players) {
    parts.push(`p:${player.playerId}:${player.life}:${player.poisonCounters}:${player.hasLost}:${player.commanderDamage.join(',')}`);
  }
  
  for (const item of snapshot.stack) {
    parts.push(`stack:${item.id}:${item.type}`);
  }
  
  if (snapshot.combat) {
    parts.push(`combat:${snapshot.combat.inCombatPhase}:${snapshot.combat.attackerIds.join(',')}:${JSON.stringify(snapshot.combat.blockerAssignments)}`);
  }
  
  // Sort zone keys for determinism
  const zoneKeys = Object.keys(snapshot.zones || {}).sort();
  for (const zoneId of zoneKeys) {
    const zone = snapshot.zones![zoneId];
    parts.push(`zone:${zoneId}:${zone.type}:${zone.cardIds.join(',')}`);
  }
  
  return parts.join('|');
}

/**
 * Simple hash function for consistent results
 * Uses DJB2-style hashing
 */
function simpleHash(str: string): string {
  let hash = 5381;
  
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit
  }
  
  // Convert to hex string with leading zeros
  return hash.toString(16).padStart(8, '0');
}

/**
 * State snapshot interface
 */
interface StateSnapshot {
  gameId: string;
  status: string;
  turn: {
    turnNumber: number;
    activePlayerId: PlayerId;
    currentPhase: string;
  } | null;
  players: Array<{
    playerId: PlayerId;
    life: number;
    poisonCounters: number;
    hasLost: boolean;
    commanderDamage: string[];
  }>;
  stack: Array<{
    id: string;
    type: string;
  }>;
  combat: {
    inCombatPhase: boolean;
    attackerIds: string[];
    blockerAssignments: Record<string, string[]>;
  } | null;
  zones?: Record<string, {
    type: string;
    cardIds: string[];
    ownerId: string | null;
  }>;
}

/**
 * Result of comparing two state hashes
 */
export interface HashComparisonResult {
  isMatch: boolean;
  localHash: string;
  remoteHash: string;
  timestamp: number;
}

/**
 * Compare local and remote state hashes
 */
export function compareStateHashes(
  localState: GameState,
  remoteHash: string
): HashComparisonResult {
  const localHash = computeStateHash(localState);
  
  return {
    isMatch: localHash === remoteHash,
    localHash,
    remoteHash,
    timestamp: Date.now(),
  };
}

/**
 * Hash verification event for tracking desyncs
 */
export interface HashVerificationEvent {
  type: 'match' | 'mismatch' | 'error';
  localHash: string;
  remoteHash?: string;
  peerId?: string;
  timestamp: number;
  gameState?: string;
  discrepancy?: HashDiscrepancy;
}

/**
 * Details about what differs between states
 */
export interface HashDiscrepancy {
  category: 'player' | 'zone' | 'stack' | 'combat' | 'turn' | 'unknown';
  description: string;
  localValue: string;
  remoteValue: string;
}

/**
 * Analyze what might be different when hashes don't match
 */
export function analyzeHashDiscrepancy(
  localState: GameState,
  remoteState: GameState
): HashDiscrepancy[] {
  const discrepancies: HashDiscrepancy[] = [];
  
  // Check player states
  const localPlayerIds = Array.from(localState.players.keys()).sort();
  const remotePlayerIds = Array.from(remoteState.players.keys()).sort();
  
  if (JSON.stringify(localPlayerIds) !== JSON.stringify(remotePlayerIds)) {
    discrepancies.push({
      category: 'player',
      description: 'Player lists differ',
      localValue: localPlayerIds.join(','),
      remoteValue: remotePlayerIds.join(','),
    });
  }
  
  // Check each player
  for (const playerId of localPlayerIds) {
    const localPlayer = localState.players.get(playerId);
    const remotePlayer = remoteState.players.get(playerId);
    
    if (!localPlayer || !remotePlayer) continue;
    
    if (localPlayer.life !== remotePlayer.life) {
      discrepancies.push({
        category: 'player',
        description: `Life total for ${playerId}`,
        localValue: String(localPlayer.life),
        remoteValue: String(remotePlayer.life),
      });
    }
    
    if (localPlayer.poisonCounters !== remotePlayer.poisonCounters) {
      discrepancies.push({
        category: 'player',
        description: `Poison counters for ${playerId}`,
        localValue: String(localPlayer.poisonCounters),
        remoteValue: String(remotePlayer.poisonCounters),
      });
    }
  }
  
  // Check turn
  if (localState.turn && remoteState.turn) {
    if (localState.turn.turnNumber !== remoteState.turn.turnNumber) {
      discrepancies.push({
        category: 'turn',
        description: 'Turn number',
        localValue: String(localState.turn.turnNumber),
        remoteValue: String(remoteState.turn.turnNumber),
      });
    }
    
    if (localState.turn.currentPhase !== remoteState.turn.currentPhase) {
      discrepancies.push({
        category: 'turn',
        description: 'Current phase',
        localValue: localState.turn.currentPhase,
        remoteValue: remoteState.turn.currentPhase,
      });
    }
  }
  
  // Check stack
  if (localState.stack.length !== remoteState.stack.length) {
    discrepancies.push({
      category: 'stack',
      description: 'Stack size',
      localValue: String(localState.stack.length),
      remoteValue: String(remoteState.stack.length),
    });
  }
  
  // Check combat
  if (localState.combat && remoteState.combat) {
    if (localState.combat.inCombatPhase !== remoteState.combat.inCombatPhase) {
      discrepancies.push({
        category: 'combat',
        description: 'Combat phase status',
        localValue: String(localState.combat.inCombatPhase),
        remoteValue: String(remoteState.combat.inCombatPhase),
      });
    }
    
    if (JSON.stringify(localState.combat.attackers) !== JSON.stringify(remoteState.combat.attackers)) {
      discrepancies.push({
        category: 'combat',
        description: 'Attackers',
        localValue: JSON.stringify(localState.combat.attackers),
        remoteValue: JSON.stringify(remoteState.combat.attackers),
      });
    }
  }
  
  // Check zones (simplified check)
  const localZoneKeys = Array.from(localState.zones.keys()).sort();
  const remoteZoneKeys = Array.from(remoteState.zones.keys()).sort();
  
  if (JSON.stringify(localZoneKeys) !== JSON.stringify(remoteZoneKeys)) {
    discrepancies.push({
      category: 'zone',
      description: 'Zone keys differ',
      localValue: localZoneKeys.join(','),
      remoteValue: remoteZoneKeys.join(','),
    });
  }
  
  return discrepancies;
}

/**
 * State hash verification manager for multiplayer
 */
export class StateHashVerifier {
  private hashHistory: HashComparisonResult[] = [];
  private readonly maxHistorySize = 100;
  
  /**
   * Record a hash comparison result
   */
  recordComparison(result: HashComparisonResult): void {
    this.hashHistory.push(result);
    
    // Trim history if too large
    if (this.hashHistory.length > this.maxHistorySize) {
      this.hashHistory = this.hashHistory.slice(-this.maxHistorySize);
    }
  }
  
  /**
   * Get hash history
   */
  getHistory(): HashComparisonResult[] {
    return [...this.hashHistory];
  }
  
  /**
   * Get the most recent mismatch, if any
   */
  getLastMismatch(): HashComparisonResult | null {
    for (let i = this.hashHistory.length - 1; i >= 0; i--) {
      if (!this.hashHistory[i].isMatch) {
        return this.hashHistory[i];
      }
    }
    return null;
  }
  
  /**
   * Check if there have been any mismatches
   */
  hasMismatches(): boolean {
    return this.hashHistory.some(r => !r.isMatch);
  }
  
  /**
   * Clear hash history
   */
  clearHistory(): void {
    this.hashHistory = [];
  }
  
  /**
   * Get desync statistics
   */
  getStatistics(): {
    totalChecks: number;
    mismatchCount: number;
    matchRate: number;
  } {
    const mismatches = this.hashHistory.filter(r => !r.isMatch).length;
    const total = this.hashHistory.length;
    
    return {
      totalChecks: total,
      mismatchCount: mismatches,
      matchRate: total > 0 ? (total - mismatches) / total : 1,
    };
  }
}

/**
 * Create a new state hash verifier
 */
export function createStateHashVerifier(): StateHashVerifier {
  return new StateHashVerifier();
}
