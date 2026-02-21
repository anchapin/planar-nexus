/**
 * State Synchronization Hook
 * Issue #313: Integrate state hash verification for multiplayer sync detection
 * 
 * This hook provides state hash verification and desync detection for P2P multiplayer games.
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState } from '@/lib/game-state/types';
import {
  computeStateHash,
  createStateHashVerifier,
  StateHashVerifier,
} from '@/lib/game-state/state-hash';
import {
  createDeterministicEngine,
  DeterministicGameStateEngine,
  type PeerId,
  type SyncVerificationResult,
  type ConflictResolution,
  type GameSyncMessage,
  type DeterministicAction,
  DEFAULT_SYNC_CONFIG,
} from '@/lib/game-state/deterministic-sync';

/**
 * Configuration for state sync
 */
export interface StateSyncConfig {
  /** Interval between sync checks (ms) */
  syncCheckInterval: number;
  /** Number of consecutive desyncs before alert */
  desyncThreshold: number;
  /** Whether to auto-resolve conflicts */
  autoResolveConflicts: boolean;
  /** Callback when desync is detected */
  onDesyncDetected?: (result: SyncVerificationResult) => void;
  /** Callback when conflict is resolved */
  onConflictResolved?: (resolution: ConflictResolution) => void;
}

/**
 * Default configuration
 */
const DEFAULT_STATE_SYNC_CONFIG: StateSyncConfig = {
  syncCheckInterval: DEFAULT_SYNC_CONFIG.syncCheckInterval,
  desyncThreshold: DEFAULT_SYNC_CONFIG.desyncThreshold,
  autoResolveConflicts: DEFAULT_SYNC_CONFIG.autoResolveConflicts,
};

/**
 * State sync status
 */
export interface StateSyncStatus {
  /** Whether the game is in sync with all peers */
  isInSync: boolean;
  /** Current local state hash */
  localHash: string;
  /** Hashes from all peers */
  peerHashes: Map<PeerId, string>;
  /** Number of consecutive desyncs */
  consecutiveDesyncs: number;
  /** Last sync check timestamp */
  lastSyncCheck: number;
  /** Sync statistics */
  statistics: {
    totalChecks: number;
    mismatchCount: number;
    matchRate: number;
  };
}

/**
 * Desync alert information
 */
export interface DesyncAlert {
  /** Whether a desync is currently detected */
  hasDesync: boolean;
  /** The peer that is out of sync */
  peerId: PeerId | null;
  /** Local hash */
  localHash: string;
  /** Remote hash */
  remoteHash: string;
  /** Timestamp when desync was detected */
  detectedAt: number;
  /** Description of the discrepancy */
  description?: string;
}

/**
 * State sync hook return type
 */
export interface UseStateSyncReturn {
  /** Current sync status */
  status: StateSyncStatus;
  /** Current desync alert, if any */
  desyncAlert: DesyncAlert | null;
  /** Whether a conflict resolution is in progress */
  isResolving: boolean;
  /** Last conflict resolution result */
  lastResolution: ConflictResolution | null;
  
  /** Initialize the sync engine */
  initialize: (localPeerId: PeerId) => void;
  /** Register a peer for sync tracking */
  registerPeer: (peerId: PeerId) => void;
  /** Unregister a peer */
  unregisterPeer: (peerId: PeerId) => void;
  /** Update local game state */
  updateGameState: (state: GameState) => void;
  /** Record an action for deterministic tracking */
  recordAction: (action: DeterministicAction) => void;
  /** Handle incoming sync message from a peer */
  handleSyncMessage: (message: GameSyncMessage) => void;
  /** Manually trigger a sync check */
  checkSync: () => SyncVerificationResult | null;
  /** Attempt to resolve a desync */
  resolveDesync: (remoteState: GameState, remotePeerId: PeerId) => ConflictResolution | null;
  /** Get the deterministic engine */
  getEngine: () => DeterministicGameStateEngine | null;
  /** Reset the sync state */
  reset: () => void;
}

/**
 * Hook for managing state synchronization in multiplayer games
 */
export function useStateSync(config: Partial<StateSyncConfig> = {}): UseStateSyncReturn {
  // Memoize config to prevent unnecessary re-renders
  const fullConfig = useMemo(() => ({ ...DEFAULT_STATE_SYNC_CONFIG, ...config }), [config]);
  
  // Refs for engine instances
  const engineRef = useRef<DeterministicGameStateEngine | null>(null);
  const verifierRef = useRef<StateHashVerifier | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // State
  const [status, setStatus] = useState<StateSyncStatus>({
    isInSync: true,
    localHash: '',
    peerHashes: new Map(),
    consecutiveDesyncs: 0,
    lastSyncCheck: 0,
    statistics: {
      totalChecks: 0,
      mismatchCount: 0,
      matchRate: 1,
    },
  });
  
  const [desyncAlert, setDesyncAlert] = useState<DesyncAlert | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [lastResolution, setLastResolution] = useState<ConflictResolution | null>(null);
  
  // Initialize the sync engine
  const initialize = useCallback((localPeerId: PeerId) => {
    engineRef.current = createDeterministicEngine(localPeerId);
    verifierRef.current = createStateHashVerifier();
    
    // Set up desync handler
    engineRef.current.setDesyncHandler((result: SyncVerificationResult) => {
      const peerIds = Array.from(result.remoteHashes.keys());
      const firstPeerId = peerIds[0] || null;
      const firstPeerHash = firstPeerId ? result.remoteHashes.get(firstPeerId) || '' : '';
      
      setDesyncAlert({
        hasDesync: !result.isInSync,
        peerId: firstPeerId,
        localHash: result.localHash,
        remoteHash: firstPeerHash,
        detectedAt: result.timestamp,
      });
      
      if (fullConfig.onDesyncDetected) {
        fullConfig.onDesyncDetected(result);
      }
    });
    
    // Set up conflict handler
    engineRef.current.setConflictHandler((resolution: ConflictResolution) => {
      setLastResolution(resolution);
      setIsResolving(false);
      
      if (fullConfig.onConflictResolved) {
        fullConfig.onConflictResolved(resolution);
      }
    });
    
    console.log('[StateSync] Initialized for peer:', localPeerId);
  }, [fullConfig]);
  
  // Register a peer
  const registerPeer = useCallback((peerId: PeerId) => {
    if (!engineRef.current) {
      console.warn('[StateSync] Engine not initialized');
      return;
    }
    
    engineRef.current.registerPeer(peerId);
    console.log('[StateSync] Registered peer:', peerId);
  }, []);
  
  // Unregister a peer
  const unregisterPeer = useCallback((peerId: PeerId) => {
    if (!engineRef.current) return;
    
    engineRef.current.unregisterPeer(peerId);
    
    setStatus(prev => {
      const newPeerHashes = new Map(prev.peerHashes);
      newPeerHashes.delete(peerId);
      return { ...prev, peerHashes: newPeerHashes };
    });
    
    console.log('[StateSync] Unregistered peer:', peerId);
  }, []);
  
  // Update local game state
  const updateGameState = useCallback((state: GameState) => {
    gameStateRef.current = state;
    
    const localHash = computeStateHash(state);
    
    setStatus(prev => ({
      ...prev,
      localHash,
    }));
  }, []);
  
  // Record an action
  const recordAction = useCallback((action: DeterministicAction) => {
    if (!engineRef.current || !gameStateRef.current) return;
    
    // The action should already have been created with createAction
    // This is for tracking purposes
    console.log('[StateSync] Recorded action:', action.sequenceNumber);
  }, []);
  
  // Handle incoming sync message
  const handleSyncMessage = useCallback((message: GameSyncMessage) => {
    if (!engineRef.current || !gameStateRef.current) return;
    
    switch (message.type) {
      case 'state-hash': {
        // Update peer's known hash
        const peerId = message.senderId;
        const stateHash = message.stateHash;
        
        setStatus(prev => {
          const newPeerHashes = new Map(prev.peerHashes);
          newPeerHashes.set(peerId, stateHash);
          
          // Check if this matches our local hash
          const isInSync = stateHash === prev.localHash;
          
          return {
            ...prev,
            peerHashes: newPeerHashes,
            isInSync: isInSync && prev.isInSync,
            consecutiveDesyncs: isInSync ? 0 : prev.consecutiveDesyncs + 1,
          };
        });
        
        // Update engine's peer state
        engineRef.current.updatePeerState(
          message.senderId,
          message.sequenceNumber,
          message.stateHash
        );
        break;
      }
      
      case 'action': {
        // Handle incoming action
        const action = message.action;
        const validation = engineRef.current.validateAction(action, gameStateRef.current);
        
        if (!validation.valid) {
          console.error('[StateSync] Invalid action:', validation.error);
          return;
        }
        
        engineRef.current.applyRemoteAction(action, gameStateRef.current);
        break;
      }
      
      case 'ack': {
        // Handle acknowledgment
        engineRef.current.updatePeerState(
          message.senderId,
          message.acknowledgedSeq,
          message.stateHash
        );
        break;
      }
      
      case 'desync-alert': {
        // Handle desync alert from peer
        setDesyncAlert({
          hasDesync: true,
          peerId: message.senderId,
          localHash: message.remoteHash,
          remoteHash: message.localHash,
          detectedAt: message.timestamp,
          description: `Desync detected at sequence ${message.conflictSeq}`,
        });
        break;
      }
      
      case 'conflict-resolution': {
        // Handle conflict resolution from peer
        setLastResolution(message.resolution);
        setIsResolving(false);
        break;
      }
      
      case 'sync-request': {
        // Peer is requesting sync - would send back action history
        console.log('[StateSync] Sync request from:', message.senderId);
        break;
      }
      
      case 'sync-response': {
        // Handle sync response with actions
        if (message.actions && message.actions.length > 0) {
          console.log('[StateSync] Received sync response with', message.actions.length, 'actions');
        }
        break;
      }
    }
  }, []);
  
  // Check sync manually
  const checkSync = useCallback((): SyncVerificationResult | null => {
    if (!engineRef.current || !gameStateRef.current) return null;
    
    const result = engineRef.current.verifySync(gameStateRef.current);
    
    // Update statistics
    if (verifierRef.current) {
      verifierRef.current.recordComparison({
        isMatch: result.isInSync,
        localHash: result.localHash,
        remoteHash: result.remoteHashes.values().next().value || '',
        timestamp: result.timestamp,
      });
      
      const stats = verifierRef.current.getStatistics();
      
      setStatus(prev => ({
        ...prev,
        isInSync: result.isInSync,
        lastSyncCheck: result.timestamp,
        statistics: stats,
        consecutiveDesyncs: result.isInSync ? 0 : prev.consecutiveDesyncs + 1,
      }));
    }
    
    return result;
  }, []);
  
  // Resolve desync
  const resolveDesync = useCallback((remoteState: GameState, remotePeerId: PeerId): ConflictResolution | null => {
    if (!engineRef.current || !gameStateRef.current) return null;
    
    setIsResolving(true);
    
    // Find the conflict sequence number
    const history = engineRef.current.getActionHistory();
    const conflictSeq = history.length > 0 ? history[history.length - 1].sequenceNumber : 0;
    
    const resolution = engineRef.current.resolveConflict(
      gameStateRef.current,
      remoteState,
      remotePeerId,
      conflictSeq
    );
    
    setLastResolution(resolution);
    setIsResolving(false);
    
    // Clear desync alert if resolved
    if (resolution.resolved) {
      setDesyncAlert(null);
    }
    
    return resolution;
  }, []);
  
  // Get the engine
  const getEngine = useCallback(() => engineRef.current, []);
  
  // Reset
  const reset = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.reset();
    }
    if (verifierRef.current) {
      verifierRef.current.clearHistory();
    }
    gameStateRef.current = null;
    
    setStatus({
      isInSync: true,
      localHash: '',
      peerHashes: new Map(),
      consecutiveDesyncs: 0,
      lastSyncCheck: 0,
      statistics: {
        totalChecks: 0,
        mismatchCount: 0,
        matchRate: 1,
      },
    });
    
    setDesyncAlert(null);
    setLastResolution(null);
    setIsResolving(false);
  }, []);
  
  // Set up periodic sync check
  useEffect(() => {
    if (fullConfig.syncCheckInterval > 0) {
      syncIntervalRef.current = setInterval(() => {
        if (engineRef.current && gameStateRef.current) {
          checkSync();
        }
      }, fullConfig.syncCheckInterval);
    }
    
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [fullConfig.syncCheckInterval, checkSync]);
  
  // Check for desync threshold
  useEffect(() => {
    if (status.consecutiveDesyncs >= fullConfig.desyncThreshold && desyncAlert) {
      console.warn('[StateSync] Desync threshold reached:', status.consecutiveDesyncs);
      
      // Auto-resolve if configured
      if (fullConfig.autoResolveConflicts && gameStateRef.current) {
        // Would need remote state to resolve - this is a placeholder
        console.log('[StateSync] Auto-resolve enabled but remote state not available');
      }
    }
  }, [status.consecutiveDesyncs, fullConfig.desyncThreshold, fullConfig.autoResolveConflicts, desyncAlert]);
  
  return {
    status,
    desyncAlert,
    isResolving,
    lastResolution,
    initialize,
    registerPeer,
    unregisterPeer,
    updateGameState,
    recordAction,
    handleSyncMessage,
    checkSync,
    resolveDesync,
    getEngine,
    reset,
  };
}

export default useStateSync;