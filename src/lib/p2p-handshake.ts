/**
 * P2P Handshake Protocol for State Verification
 * 
 * This module implements a handshake protocol to verify state checksums
 * between peers during connection establishment and game state synchronization.
 */

import type { GameState } from '@/lib/game-state/types';
import { serializeGameState } from '@/lib/game-state/serialization';

/**
 * Handshake message types
 */
export type HandshakeMessageType =
  | 'handshake-init'
  | 'handshake-challenge'
  | 'handshake-response'
  | 'handshake-ack'
  | 'handshake-failed'
  | 'state-checksum-request'
  | 'state-checksum-response'
  | 'state-sync-request'
  | 'state-sync-response';

/**
 * Handshake message structure
 */
export interface HandshakeMessage {
  type: HandshakeMessageType;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

/**
 * Initial handshake message
 */
export interface HandshakeInitMessage extends HandshakeMessage {
  type: 'handshake-init';
  payload: {
    protocolVersion: string;
    playerName: string;
    playerId: string;
    gameCode: string;
    capabilities: string[];
  };
}

/**
 * Challenge message for verification
 */
export interface HandshakeChallengeMessage extends HandshakeMessage {
  type: 'handshake-challenge';
  payload: {
    challenge: string; // Random nonce
    checksumAlgorithm: string;
  };
}

/**
 * Response to challenge with checksum
 */
export interface HandshakeResponseMessage extends HandshakeMessage {
  type: 'handshake-response';
  payload: {
    challenge: string;
    checksum: string;
    stateVersion: number;
    checksumAlgorithm?: string;
  };
}

/**
 * Acknowledgment message
 */
export interface HandshakeAckMessage extends HandshakeMessage {
  type: 'handshake-ack';
  payload: {
    checksumMatch: boolean;
    stateVersion: number;
  };
}

/**
 * Handshake failed message
 */
export interface HandshakeFailedMessage extends HandshakeMessage {
  type: 'handshake-failed';
  payload: {
    reason: string;
    expectedChecksum?: string;
    receivedChecksum?: string;
  };
}

/**
 * State checksum request
 */
export interface StateChecksumRequestMessage extends HandshakeMessage {
  type: 'state-checksum-request';
  payload: {
    requestedVersion?: number;
  };
}

/**
 * State checksum response
 */
export interface StateChecksumResponseMessage extends HandshakeMessage {
  type: 'state-checksum-response';
  payload: {
    checksum: string;
    stateVersion: number;
    timestamp: number;
  };
}

/**
 * State sync request
 */
export interface StateSyncRequestMessage extends HandshakeMessage {
  type: 'state-sync-request';
  payload: {
    currentVersion: number;
    checksum: string;
  };
}

/**
 * State sync response
 */
export interface StateSyncResponseMessage extends HandshakeMessage {
  type: 'state-sync-response';
  payload: {
    gameState?: string; // Serialized game state
    stateVersion: number;
    isFullSync: boolean;
    checksum: string;
  };
}

/**
 * Current protocol version
 */
export const PROTOCOL_VERSION = '1.0.0';

/**
 * Supported checksum algorithms
 */
export const CHECKSUM_ALGORITHMS = ['crc32', 'md5', 'sha256'] as const;
export type ChecksumAlgorithm = typeof CHECKSUM_ALGORITHMS[number];

/**
 * Default checksum algorithm
 */
export const DEFAULT_CHECKSUM_ALGORITHM: ChecksumAlgorithm = 'crc32';

/**
 * Calculate CRC32 checksum (simple implementation)
 * For production, use a proper CRC32 library
 */
export function calculateCRC32(data: string): number {
  let crc = 0xffffffff;
  const table = getCRC32Table();

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data.charCodeAt(i)) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Get CRC32 lookup table
 */
function getCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);
  
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  
  return table;
}

/**
 * Calculate checksum for game state
 */
export function calculateStateChecksum(gameState: GameState, algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM): string {
  const serialized = serializeGameState(gameState, 'Handshake checksum');
  const data = JSON.stringify(serialized);

  switch (algorithm) {
    case 'crc32':
      return calculateCRC32(data).toString(16).padStart(8, '0');
    case 'md5':
      // Simple MD5-like hash (for production, use crypto.subtle)
      return simpleHash(data);
    case 'sha256':
      // Simple SHA256-like hash (for production, use crypto.subtle)
      return simpleHash(data, 256);
    default:
      return calculateCRC32(data).toString(16).padStart(8, '0');
  }
}

/**
 * Simple hash function for fallback
 */
function simpleHash(data: string, bits: number = 128): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to hex string with specified bits
  const hex = (hash >>> 0).toString(16).padStart(bits / 4, '0');
  return hex.slice(0, bits / 4);
}

/**
 * Generate random challenge nonce
 */
export function generateChallenge(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create handshake init message
 */
export function createHandshakeInit(
  senderId: string,
  playerName: string,
  playerId: string,
  gameCode: string,
  capabilities: string[] = ['state-sync', 'chat', 'emotes']
): HandshakeInitMessage {
  return {
    type: 'handshake-init',
    senderId,
    timestamp: Date.now(),
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      playerName,
      playerId,
      gameCode,
      capabilities,
    },
  };
}

/**
 * Create handshake challenge message
 */
export function createHandshakeChallenge(
  senderId: string,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM
): HandshakeChallengeMessage {
  return {
    type: 'handshake-challenge',
    senderId,
    timestamp: Date.now(),
    payload: {
      challenge: generateChallenge(),
      checksumAlgorithm: algorithm,
    },
  };
}

/**
 * Create handshake response message
 */
export function createHandshakeResponse(
  senderId: string,
  challenge: string,
  gameState: GameState,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM
): HandshakeResponseMessage {
  const checksum = calculateStateChecksum(gameState, algorithm);
  
  return {
    type: 'handshake-response',
    senderId,
    timestamp: Date.now(),
    payload: {
      challenge,
      checksum,
      stateVersion: (gameState.turn as any).turnNumber || 0,
    },
  };
}

/**
 * Create handshake acknowledgment message
 */
export function createHandshakeAck(
  senderId: string,
  checksumMatch: boolean,
  stateVersion: number
): HandshakeAckMessage {
  return {
    type: 'handshake-ack',
    senderId,
    timestamp: Date.now(),
    payload: {
      checksumMatch,
      stateVersion,
    },
  };
}

/**
 * Create handshake failed message
 */
export function createHandshakeFailed(
  senderId: string,
  reason: string,
  expectedChecksum?: string,
  receivedChecksum?: string
): HandshakeFailedMessage {
  return {
    type: 'handshake-failed',
    senderId,
    timestamp: Date.now(),
    payload: {
      reason,
      expectedChecksum,
      receivedChecksum,
    },
  };
}

/**
 * Create state checksum request message
 */
export function createStateChecksumRequest(
  senderId: string,
  requestedVersion?: number
): StateChecksumRequestMessage {
  return {
    type: 'state-checksum-request',
    senderId,
    timestamp: Date.now(),
    payload: {
      requestedVersion,
    },
  };
}

/**
 * Create state checksum response message
 */
export function createStateChecksumResponse(
  senderId: string,
  gameState: GameState,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM
): StateChecksumResponseMessage {
  const checksum = calculateStateChecksum(gameState, algorithm);
  
  return {
    type: 'state-checksum-response',
    senderId,
    timestamp: Date.now(),
    payload: {
      checksum,
      stateVersion: (gameState.turn as any).turnNumber || 0,
      timestamp: Date.now(),
    },
  };
}

/**
 * Create state sync request message
 */
export function createStateSyncRequest(
  senderId: string,
  currentVersion: number,
  checksum: string
): StateSyncRequestMessage {
  return {
    type: 'state-sync-request',
    senderId,
    timestamp: Date.now(),
    payload: {
      currentVersion,
      checksum,
    },
  };
}

/**
 * Create state sync response message
 */
export function createStateSyncResponse(
  senderId: string,
  gameState: GameState,
  isFullSync: boolean,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM
): StateSyncResponseMessage {
  const serialized = serializeGameState(gameState, 'State sync response');
  const checksum = calculateStateChecksum(gameState, algorithm);
  
  return {
    type: 'state-sync-response',
    senderId,
    timestamp: Date.now(),
    payload: {
      gameState: JSON.stringify(serialized),
      stateVersion: (gameState.turn as any).turnNumber || 0,
      isFullSync,
      checksum,
    },
  };
}

/**
 * Verify checksum match
 */
export function verifyChecksum(
  gameState: GameState,
  expectedChecksum: string,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM
): boolean {
  const actualChecksum = calculateStateChecksum(gameState, algorithm);
  return actualChecksum === expectedChecksum;
}

/**
 * Handshake state machine
 */
export type HandshakeState =
  | 'idle'
  | 'initiated'
  | 'challenged'
  | 'responded'
  | 'verified'
  | 'completed'
  | 'failed';

/**
 * Handshake session manager
 */
export class HandshakeSession {
  private state: HandshakeState = 'idle';
  private remotePlayerId: string | null = null;
  private remoteChecksum: string | null = null;
  private localChecksum: string | null = null;
  private challenge: string | null = null;
  private stateVersion: number = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly HANDSHAKE_TIMEOUT = 10000; // 10 seconds

  constructor(
    private localPlayerId: string,
    private onStateChange?: (state: HandshakeState) => void,
    private onComplete?: (success: boolean, error?: string) => void
  ) {}

  /**
   * Start handshake as initiator
   */
  start(remotePlayerId: string): HandshakeInitMessage {
    this.state = 'initiated';
    this.remotePlayerId = remotePlayerId;
    this.onStateChange?.(this.state);

    // Set timeout
    this.startTimeout();

    return createHandshakeInit(
      this.localPlayerId,
      'Local Player', // Should be passed in
      this.localPlayerId,
      'GAME' // Should be passed in
    );
  }

  /**
   * Handle received init message
   */
  handleInit(message: HandshakeInitMessage): HandshakeChallengeMessage {
    if (this.state !== 'idle' && this.state !== 'initiated') {
      throw new Error('Invalid handshake state');
    }

    this.state = 'challenged';
    this.remotePlayerId = message.senderId;
    this.onStateChange?.(this.state);

    // Validate protocol version
    if (message.payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${message.payload.protocolVersion}`);
    }

    // Send challenge
    return createHandshakeChallenge(this.localPlayerId);
  }

  /**
   * Handle received challenge
   */
  handleChallenge(message: HandshakeChallengeMessage, gameState: GameState): HandshakeResponseMessage {
    if (this.state !== 'challenged' && this.state !== 'initiated') {
      throw new Error('Invalid handshake state');
    }

    this.challenge = message.payload.challenge;
    this.state = 'responded';
    this.onStateChange?.(this.state);

    // Calculate and send response
    return createHandshakeResponse(
      this.localPlayerId,
      message.payload.challenge,
      gameState,
      message.payload.checksumAlgorithm as ChecksumAlgorithm
    );
  }

  /**
   * Handle received response
   */
  handleResponse(message: HandshakeResponseMessage, localGameState: GameState): HandshakeAckMessage {
    if (this.state !== 'challenged') {
      throw new Error('Invalid handshake state');
    }

    // Verify challenge matches
    if (!this.challenge || message.payload.challenge !== this.challenge) {
      this.state = 'failed';
      this.onStateChange?.(this.state);
      return createHandshakeAck(this.localPlayerId, false, 0);
    }

    // Verify checksum
    const checksumMatch = verifyChecksum(
      localGameState,
      message.payload.checksum,
      message.payload.checksumAlgorithm as ChecksumAlgorithm
    );

    this.remoteChecksum = message.payload.checksum;
    this.stateVersion = message.payload.stateVersion;

    if (checksumMatch) {
      this.state = 'verified';
      this.onComplete?.(true);
    } else {
      this.state = 'failed';
      this.onComplete?.(false, 'Checksum mismatch');
    }

    this.onStateChange?.(this.state);
    this.clearTimeout();

    return createHandshakeAck(this.localPlayerId, checksumMatch, this.stateVersion);
  }

  /**
   * Handle acknowledgment
   */
  handleAck(message: HandshakeAckMessage): void {
    if (this.state !== 'responded') {
      throw new Error('Invalid handshake state');
    }

    if (message.payload.checksumMatch) {
      this.state = 'completed';
      this.onComplete?.(true);
    } else {
      this.state = 'failed';
      this.onComplete?.(false, 'Checksum verification failed');
    }

    this.onStateChange?.(this.state);
    this.clearTimeout();
  }

  /**
   * Handle failure
   */
  handleFailed(message: HandshakeFailedMessage): void {
    this.state = 'failed';
    this.onStateChange?.(this.state);
    this.clearTimeout();
    this.onComplete?.(false, message.payload.reason);
  }

  /**
   * Get current state
   */
  getState(): HandshakeState {
    return this.state;
  }

  /**
   * Get remote checksum
   */
  getRemoteChecksum(): string | null {
    return this.remoteChecksum;
  }

  /**
   * Get state version
   */
  getStateVersion(): number {
    return this.stateVersion;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.clearTimeout();
    this.state = 'idle';
    this.remotePlayerId = null;
    this.remoteChecksum = null;
    this.localChecksum = null;
    this.challenge = null;
  }

  /**
   * Start timeout timer
   */
  private startTimeout(): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => {
      this.state = 'failed';
      this.onStateChange?.(this.state);
      this.onComplete?.(false, 'Handshake timeout');
    }, this.HANDSHAKE_TIMEOUT);
  }

  /**
   * Clear timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
