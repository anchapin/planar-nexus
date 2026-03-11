/**
 * React hook for monitoring P2P connection health with reconnection indicators
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * P2P Connection state (combined from both sources)
 */
export type P2PConnectionState =
  | 'disconnected'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * Extended connection state with reconnection details
 */
export type ExtendedConnectionState = 
  | 'disconnected'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'reconnecting-poor'    // Connection poor but not lost
  | 'reconnecting-attempting' // Actively attempting reconnection
  | 'failed';

/**
 * Connection health metrics
 */
export interface ConnectionHealth {
  state: ExtendedConnectionState;
  isHealthy: boolean;
  isReconnecting: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastStateChange: Date;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'lost';
  latency?: number;
  packetLoss?: number;
  jitter?: number;
}

/**
 * Hook options
 */
export interface UseConnectionHealthOptions {
  getConnectionState: () => P2PConnectionState;
  getReconnectAttempts?: () => number;
  getMaxReconnectAttempts?: () => number;
  getLatency?: () => number | undefined;
  enableMonitoring?: boolean;
  healthCheckInterval?: number;
}

/**
 * Monitor connection health and provide reconnection indicators
 */
export function useConnectionHealth(
  options: UseConnectionHealthOptions
): ConnectionHealth {
  const {
    getConnectionState,
    getReconnectAttempts,
    getMaxReconnectAttempts,
    getLatency,
    enableMonitoring = true,
    healthCheckInterval = 1000,
  } = options;

  const [health, setHealth] = useState<ConnectionHealth>({
    state: 'disconnected',
    isHealthy: false,
    isReconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    lastStateChange: new Date(),
    connectionQuality: 'lost',
  });

  const previousStateRef = useRef<ExtendedConnectionState>('disconnected');
  const reconnectStartTimeRef = useRef<number | null>(null);

  // Update health based on connection state
  const updateHealth = useCallback(() => {
    const currentState = getConnectionState() as ExtendedConnectionState;
    const reconnectAttempts = getReconnectAttempts?.() || 0;
    const maxReconnectAttempts = getMaxReconnectAttempts?.() || 3;
    const latency = getLatency?.();

    let extendedState: ExtendedConnectionState = currentState;
    let isHealthy = false;
    let isReconnecting = false;
    let connectionQuality: ConnectionHealth['connectionQuality'] = 'lost';

    // Determine extended state and health
    switch (currentState) {
      case 'connected':
        extendedState = 'connected';
        isHealthy = true;
        isReconnecting = false;
        reconnectStartTimeRef.current = null;

        // Determine quality based on latency
        if (latency !== undefined) {
          if (latency < 50) {
            connectionQuality = 'excellent';
          } else if (latency < 100) {
            connectionQuality = 'good';
          } else if (latency < 200) {
            connectionQuality = 'fair';
          } else {
            connectionQuality = 'poor';
          }
        } else {
          connectionQuality = 'good';
        }
        break;

      case 'signaling':
        extendedState = 'connecting';
        isHealthy = false;
        isReconnecting = false;
        connectionQuality = 'lost';
        break;

      case 'reconnecting': {
        extendedState = 'reconnecting-attempting';
        isHealthy = false;
        isReconnecting = true;

        if (!reconnectStartTimeRef.current) {
          reconnectStartTimeRef.current = Date.now();
        }

        // Quality degrades during reconnection
        const reconnectDuration = Date.now() - reconnectStartTimeRef.current;
        if (reconnectDuration < 2000) {
          connectionQuality = 'poor';
        } else {
          connectionQuality = 'lost';
        }
        break;
      }

      case 'connecting':
        extendedState = 'connecting';
        isHealthy = false;
        isReconnecting = previousStateRef.current === 'connected';
        connectionQuality = 'lost';
        break;

      case 'disconnected':
        extendedState = 'disconnected';
        isHealthy = false;
        isReconnecting = false;
        connectionQuality = 'lost';
        break;

      case 'failed':
        extendedState = 'failed';
        isHealthy = false;
        isReconnecting = false;
        connectionQuality = 'lost';
        break;
    }

    setHealth(prev => ({
      state: extendedState,
      isHealthy,
      isReconnecting,
      reconnectAttempts,
      maxReconnectAttempts,
      lastStateChange: currentState !== previousStateRef.current 
        ? new Date() 
        : prev.lastStateChange,
      connectionQuality,
      latency,
    }));

    previousStateRef.current = currentState;
  }, [getConnectionState, getReconnectAttempts, getMaxReconnectAttempts, getLatency]);

  // Initial update
  useEffect(() => {
    updateHealth();
  }, [updateHealth]);

  // Periodic health checks
  useEffect(() => {
    if (!enableMonitoring) return;

    const interval = setInterval(updateHealth, healthCheckInterval);
    return () => clearInterval(interval);
  }, [enableMonitoring, healthCheckInterval, updateHealth]);

  return health;
}

/**
 * Get human-readable connection status message
 */
export function getConnectionStatusMessage(health: ConnectionHealth): string {
  switch (health.state) {
    case 'connected':
      // All connection qualities under 'connected' state return the same message
      // eslint-disable-next-line no-fallthrough
      switch (health.connectionQuality) {
        case 'excellent':
        case 'good':
        case 'fair':
        case 'poor':
        case 'lost':
          return 'Connected';
      }
      break;

    case 'reconnecting-poor':
      return 'Connection Poor - Attempting to Improve...';

    case 'reconnecting-attempting':
      return `Reconnecting... (Attempt ${health.reconnectAttempts}/${health.maxReconnectAttempts})`;

    case 'connecting':
      return 'Connecting...';

    case 'disconnected':
      return 'Disconnected';

    case 'failed':
      return 'Connection Failed';

    default:
      return 'Unknown State';
  }
}

/**
 * Get appropriate color for connection state
 */
export function getConnectionStateColor(health: ConnectionHealth): string {
  switch (health.connectionQuality) {
    case 'excellent':
      return 'text-green-600';
    case 'good':
      return 'text-green-500';
    case 'fair':
      return 'text-yellow-500';
    case 'poor':
      return 'text-orange-500';
    case 'lost':
    default:
      return 'text-red-500';
  }
}

/**
 * Get icon name for connection state
 */
export function getConnectionStateIcon(health: ConnectionHealth): string {
  switch (health.state) {
    case 'connected':
      return 'wifi';
    case 'reconnecting-poor':
    case 'reconnecting-attempting':
      return 'wifi-off';
    case 'connecting':
      return 'wifi-search';
    case 'disconnected':
      return 'wifi-off';
    case 'failed':
      return 'circle-x';
    default:
      return 'help-circle';
  }
}
