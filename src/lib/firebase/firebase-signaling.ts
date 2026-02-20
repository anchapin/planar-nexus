/**
 * Firebase Signaling Service
 * Issue #305: Add Firebase Realtime Database for signaling/state
 * 
 * This module provides signaling functionality using Firebase Realtime Database,
 * enabling WebRTC connections between players without a custom signaling server.
 */

import {
  ref,
  set,
  get,
  remove,
  onValue,
  off,
  push,
  serverTimestamp,
  DataSnapshot,
} from 'firebase/database';
import { firebaseService, isFirebaseAvailable } from './firebase-config';
import type { P2PConnectionState } from '../webrtc-p2p';

/**
 * Firebase signaling session info
 */
export interface FirebaseSignalingSession {
  sessionId: string;
  gameCode: string;
  hostId: string;
  hostName: string;
  clientId?: string;
  clientName?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  hostCandidates: RTCIceCandidateInit[];
  clientCandidates: RTCIceCandidateInit[];
  createdAt: number;
  expiresAt: number;
  status: 'waiting' | 'connecting' | 'connected' | 'closed';
}

/**
 * Signaling callbacks
 */
export interface FirebaseSignalingCallbacks {
  onConnectionStateChange: (state: P2PConnectionState) => void;
  onSessionUpdate: (session: FirebaseSignalingSession) => void;
  onOfferReceived: (offer: RTCSessionDescriptionInit) => void;
  onAnswerReceived: (answer: RTCSessionDescriptionInit) => void;
  onIceCandidateReceived: (candidate: RTCIceCandidateInit, fromHost: boolean) => void;
  onError: (error: Error) => void;
}

/**
 * Firebase Signaling Service
 * Uses Firebase Realtime Database for WebRTC signaling
 */
export class FirebaseSignalingService {
  private sessionId: string | null = null;
  private gameCode: string | null = null;
  private isHost: boolean = false;
  private playerId: string = '';
  private playerName: string = '';
  private callbacks: FirebaseSignalingCallbacks;
  private listeners: Array<{ ref: ReturnType<typeof ref>; callback: (snap: DataSnapshot) => void }> = [];
  private sessionTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new Firebase Signaling Service
   */
  constructor(callbacks: FirebaseSignalingCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Check if Firebase is available
   */
  private checkAvailability(): boolean {
    if (!isFirebaseAvailable()) {
      this.callbacks.onError(new Error('Firebase is not configured or unavailable'));
      return false;
    }
    return true;
  }

  /**
   * Create a new signaling session as host
   */
  async createSession(
    hostId: string,
    hostName: string,
    offer?: RTCSessionDescriptionInit
  ): Promise<FirebaseSignalingSession> {
    if (!this.checkAvailability()) {
      throw new Error('Firebase not available');
    }

    const db = firebaseService.getDatabaseInstance()!;
    
    // Generate game code
    const gameCode = this.generateGameCode();
    
    // Create session
    const sessionsRef = ref(db, 'signaling/sessions');
    const newSessionRef = push(sessionsRef);
    const sessionId = newSessionRef.key!;

    const now = Date.now();
    const session: Omit<FirebaseSignalingSession, 'sessionId'> = {
      gameCode,
      hostId,
      hostName,
      hostCandidates: [],
      clientCandidates: [],
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes
      status: 'waiting',
      offer,
    };

    // Store game code to session ID mapping
    await set(ref(db, `signaling/gameCodes/${gameCode}`), sessionId);
    
    // Store session data
    await set(newSessionRef, session);

    this.sessionId = sessionId;
    this.gameCode = gameCode;
    this.isHost = true;
    this.playerId = hostId;
    this.playerName = hostName;

    // Set up listeners
    this.setupSessionListeners();
    
    // Start heartbeat
    this.startHeartbeat();

    // Set up session expiration cleanup
    this.setupExpirationCleanup();

    return {
      sessionId,
      ...session,
    };
  }

  /**
   * Join an existing session as client
   */
  async joinSession(
    gameCode: string,
    clientId: string,
    clientName: string
  ): Promise<FirebaseSignalingSession> {
    if (!this.checkAvailability()) {
      throw new Error('Firebase not available');
    }

    const db = firebaseService.getDatabaseInstance()!;

    // Look up session by game code
    const gameCodeRef = ref(db, `signaling/gameCodes/${gameCode}`);
    const gameCodeSnap = await get(gameCodeRef);

    if (!gameCodeSnap.exists()) {
      throw new Error('Game not found. Check the code and try again.');
    }

    const sessionId = gameCodeSnap.val();
    const sessionRef = ref(db, `signaling/sessions/${sessionId}`);
    const sessionSnap = await get(sessionRef);

    if (!sessionSnap.exists()) {
      throw new Error('Session expired or not found.');
    }

    const sessionData = sessionSnap.val();

    // Check if session already has a client
    if (sessionData.clientId && sessionData.clientId !== clientId) {
      throw new Error('Game already has another player connected.');
    }

    // Register as client
    await set(ref(db, `signaling/sessions/${sessionId}/clientId`), clientId);
    await set(ref(db, `signaling/sessions/${sessionId}/clientName`), clientName);
    await set(ref(db, `signaling/sessions/${sessionId}/status`), 'connecting');

    this.sessionId = sessionId;
    this.gameCode = gameCode;
    this.isHost = false;
    this.playerId = clientId;
    this.playerName = clientName;

    // Set up listeners
    this.setupSessionListeners();
    
    // Start heartbeat
    this.startHeartbeat();

    return {
      sessionId,
      ...sessionData,
      clientId,
      clientName,
    };
  }

  /**
   * Set up real-time listeners for session updates
   */
  private setupSessionListeners(): void {
    if (!this.sessionId) return;

    const db = firebaseService.getDatabaseInstance()!;
    const sessionRef = ref(db, `signaling/sessions/${this.sessionId}`);

    // Listen for session updates
    const sessionCallback = (snap: DataSnapshot) => {
      if (!snap.exists()) {
        this.callbacks.onError(new Error('Session closed'));
        this.cleanup();
        return;
      }

      const data = snap.val();
      this.callbacks.onSessionUpdate({
        sessionId: this.sessionId!,
        ...data,
      });
    };

    onValue(sessionRef, sessionCallback);
    this.listeners.push({ ref: sessionRef, callback: sessionCallback });

    // Listen for answer (host) or offer updates (client)
    const offerRef = ref(db, `signaling/sessions/${this.sessionId}/offer`);
    const offerCallback = (snap: DataSnapshot) => {
      if (snap.exists() && !this.isHost) {
        this.callbacks.onOfferReceived(snap.val());
      }
    };
    onValue(offerRef, offerCallback);
    this.listeners.push({ ref: offerRef, callback: offerCallback });

    const answerRef = ref(db, `signaling/sessions/${this.sessionId}/answer`);
    const answerCallback = (snap: DataSnapshot) => {
      if (snap.exists() && this.isHost) {
        this.callbacks.onAnswerReceived(snap.val());
      }
    };
    onValue(answerRef, answerCallback);
    this.listeners.push({ ref: answerRef, callback: answerCallback });

    // Listen for ICE candidates from the other party
    const candidatesRef = ref(
      db,
      `signaling/sessions/${this.sessionId}/${this.isHost ? 'clientCandidates' : 'hostCandidates'}`
    );
    const candidatesCallback = (snap: DataSnapshot) => {
      if (snap.exists()) {
        const candidates = snap.val();
        if (Array.isArray(candidates)) {
          candidates.forEach((candidate) => {
            this.callbacks.onIceCandidateReceived(candidate, !this.isHost);
          });
        }
      }
    };
    onValue(candidatesRef, candidatesCallback);
    this.listeners.push({ ref: candidatesRef, callback: candidatesCallback });
  }

  /**
   * Send offer to the session (host)
   */
  async sendOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const db = firebaseService.getDatabaseInstance()!;
    await set(ref(db, `signaling/sessions/${this.sessionId}/offer`), offer);
  }

  /**
   * Send answer to the session (client)
   */
  async sendAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const db = firebaseService.getDatabaseInstance()!;
    await set(ref(db, `signaling/sessions/${this.sessionId}/answer`), answer);
    await set(ref(db, `signaling/sessions/${this.sessionId}/status`), 'connected');
  }

  /**
   * Send ICE candidate
   */
  async sendIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const db = firebaseService.getDatabaseInstance()!;
    const candidateKey = this.isHost ? 'hostCandidates' : 'clientCandidates';
    const candidatesRef = ref(db, `signaling/sessions/${this.sessionId}/${candidateKey}`);
    
    // Get existing candidates and append new one
    const snap = await get(candidatesRef);
    const existingCandidates: RTCIceCandidateInit[] = snap.exists() ? snap.val() : [];
    existingCandidates.push(candidate);
    
    await set(candidatesRef, existingCandidates);
  }

  /**
   * Update connection status
   */
  async updateStatus(status: 'waiting' | 'connecting' | 'connected' | 'closed'): Promise<void> {
    if (!this.sessionId) return;

    const db = firebaseService.getDatabaseInstance()!;
    await set(ref(db, `signaling/sessions/${this.sessionId}/status`), status);
  }

  /**
   * Start heartbeat to keep session alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.sessionId) return;

      const db = firebaseService.getDatabaseInstance()!;
      const now = Date.now();
      
      // Update last seen timestamp
      await set(
        ref(db, `signaling/sessions/${this.sessionId}/lastSeen`),
        serverTimestamp()
      );
      
      // Extend expiration
      await set(
        ref(db, `signaling/sessions/${this.sessionId}/expiresAt`),
        now + 5 * 60 * 1000
      );
    }, 30000); // Every 30 seconds
  }

  /**
   * Set up session expiration cleanup
   */
  private setupExpirationCleanup(): void {
    this.sessionTimeout = setTimeout(() => {
      this.callbacks.onError(new Error('Session expired'));
      this.closeSession();
    }, 5 * 60 * 1000);
  }

  /**
   * Generate a short game code
   */
  private generateGameCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get current game code
   */
  getGameCode(): string | null {
    return this.gameCode;
  }

  /**
   * Check if this is the host
   */
  getIsHost(): boolean {
    return this.isHost;
  }

  /**
   * Close the session and clean up
   */
  async closeSession(): Promise<void> {
    if (!this.sessionId) return;

    const db = firebaseService.getDatabaseInstance()!;

    // Remove game code mapping
    if (this.gameCode) {
      await remove(ref(db, `signaling/gameCodes/${this.gameCode}`));
    }

    // Remove session data
    await remove(ref(db, `signaling/sessions/${this.sessionId}`));

    this.cleanup();
  }

  /**
   * Clean up listeners and intervals
   */
  private cleanup(): void {
    // Remove all listeners
    this.listeners.forEach(({ ref, callback }) => {
      off(ref, 'value', callback);
    });
    this.listeners = [];

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }

    this.sessionId = null;
    this.gameCode = null;
    this.callbacks.onConnectionStateChange('disconnected');
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    this.cleanup();
  }
}

/**
 * Create a Firebase signaling service
 */
export function createFirebaseSignalingService(
  callbacks: FirebaseSignalingCallbacks
): FirebaseSignalingService {
  return new FirebaseSignalingService(callbacks);
}
