/**
 * ICE Configuration for NAT Traversal
 * Issue #286: Add NAT traversal and STUN/TURN server support
 * 
 * Provides configurable STUN/TURN server settings for WebRTC connections,
 * enabling P2P connectivity across various network configurations.
 */

/**
 * ICE Server configuration
 */
export interface ICEServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

/**
 * ICE Transport Policy
 */
export type ICETransportPolicy = 'all' | 'relay';

/**
 * ICE Connection Mode
 */
export type ICEConnectionMode = 
  | 'auto'           // Automatically select best servers
  | 'stun-only'      // Only use STUN servers
  | 'turn-relay'     // Force TURN relay
  | 'custom';        // Use custom server configuration

/**
 * ICE Configuration Options
 */
export interface ICEConfigOptions {
  /** Connection mode */
  mode?: ICEConnectionMode;
  /** Custom STUN servers */
  customStunServers?: ICEServerConfig[];
  /** Custom TURN servers */
  customTurnServers?: ICEServerConfig[];
  /** Enable IPv6 candidates */
  enableIPv6?: boolean;
  /** ICE candidate pool size */
  candidatePoolSize?: number;
  /** Bundle policy */
  bundlePolicy?: RTCBundlePolicy;
  /** RTCP mux policy */
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Default public STUN servers
 * These are free public STUN servers for NAT traversal
 */
export const DEFAULT_STUN_SERVERS: ICEServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:stun.voip.eutelia.it:3478' },
];

/**
 * Default TURN servers (placeholder - should be configured with actual credentials)
 * In production, these would be your own TURN servers or a TURN service
 */
export const DEFAULT_TURN_SERVERS: ICEServerConfig[] = [
  // Example TURN server configuration
  // {
  //   urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'],
  //   username: 'username',
  //   credential: 'credential',
  // },
];

/**
 * ICE Configuration Manager
 * Manages ICE server configuration for WebRTC connections
 */
export class ICEConfigurationManager {
  private stunServers: ICEServerConfig[];
  private turnServers: ICEServerConfig[];
  private mode: ICEConnectionMode;
  private enableIPv6: boolean;
  private candidatePoolSize: number;
  private bundlePolicy: RTCBundlePolicy;
  private rtcpMuxPolicy: RTCRtcpMuxPolicy;

  constructor(options: ICEConfigOptions = {}) {
    this.mode = options.mode || 'auto';
    this.stunServers = options.customStunServers || DEFAULT_STUN_SERVERS;
    this.turnServers = options.customTurnServers || DEFAULT_TURN_SERVERS;
    this.enableIPv6 = options.enableIPv6 ?? true;
    this.candidatePoolSize = options.candidatePoolSize ?? 10;
    this.bundlePolicy = options.bundlePolicy || 'balanced';
    this.rtcpMuxPolicy = options.rtcpMuxPolicy || 'require';
  }

  /**
   * Get RTCConfiguration for WebRTC
   */
  getRTCConfiguration(): RTCConfiguration {
    const iceServers = this.getICEServers();
    
    const config: RTCConfiguration = {
      iceServers,
      iceCandidatePoolSize: this.candidatePoolSize,
      bundlePolicy: this.bundlePolicy,
      rtcpMuxPolicy: this.rtcpMuxPolicy,
    };

    // Force relay mode if specified
    if (this.mode === 'turn-relay') {
      config.iceTransportPolicy = 'relay';
    }

    return config;
  }

  /**
   * Get ICE servers based on mode
   */
  private getICEServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [];

    switch (this.mode) {
      case 'stun-only':
        servers.push(...this.stunServers);
        break;
      
      case 'turn-relay':
        // Only TURN servers in relay mode
        servers.push(...this.turnServers);
        break;
      
      case 'custom':
        // Use only custom servers
        servers.push(...this.stunServers, ...this.turnServers);
        break;
      
      case 'auto':
      default:
        // Use both STUN and TURN
        servers.push(...this.stunServers);
        if (this.turnServers.length > 0) {
          servers.push(...this.turnServers);
        }
        break;
    }

    return servers;
  }

  /**
   * Add a STUN server
   */
  addStunServer(server: ICEServerConfig): void {
    this.stunServers.push(server);
  }

  /**
   * Add a TURN server
   */
  addTurnServer(server: ICEServerConfig): void {
    this.turnServers.push(server);
  }

  /**
   * Set connection mode
   */
  setMode(mode: ICEConnectionMode): void {
    this.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): ICEConnectionMode {
    return this.mode;
  }

  /**
   * Set TURN credentials
   */
  setTurnCredentials(username: string, credential: string): void {
    this.turnServers = this.turnServers.map(server => ({
      ...server,
      username,
      credential,
    }));
  }

  /**
   * Check if TURN is configured
   */
  hasTurnServers(): boolean {
    return this.turnServers.length > 0;
  }

  /**
   * Get STUN servers
   */
  getStunServers(): ICEServerConfig[] {
    return [...this.stunServers];
  }

  /**
   * Get TURN servers
   */
  getTurnServers(): ICEServerConfig[] {
    return [...this.turnServers];
  }

  /**
   * Create a configuration for testing connectivity
   */
  static createTestConfiguration(): RTCConfiguration {
    return {
      iceServers: DEFAULT_STUN_SERVERS,
      iceCandidatePoolSize: 10,
    };
  }
}

/**
 * ICE Connection State Monitor
 * Monitors ICE connection states and provides fallback handling
 */
export class ICEConnectionMonitor {
  private connection: RTCPeerConnection | null = null;
  private onStateChange?: (state: RTCIceConnectionState) => void;
  private onFailed?: () => void;
  private onConnected?: () => void;
  private onDisconnected?: () => void;
  private failureTimeout: ReturnType<typeof setTimeout> | null = null;
  private failureTimeoutMs: number;

  constructor(options: {
    onStateChange?: (state: RTCIceConnectionState) => void;
    onFailed?: () => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
    failureTimeoutMs?: number;
  } = {}) {
    this.onStateChange = options.onStateChange;
    this.onFailed = options.onFailed;
    this.onConnected = options.onConnected;
    this.onDisconnected = options.onDisconnected;
    this.failureTimeoutMs = options.failureTimeoutMs || 30000; // 30 seconds default
  }

  /**
   * Attach to a peer connection
   */
  attach(connection: RTCPeerConnection): void {
    this.detach();
    this.connection = connection;
    
    connection.oniceconnectionstatechange = () => {
      this.handleStateChange();
    };
  }

  /**
   * Detach from current connection
   */
  detach(): void {
    if (this.connection) {
      this.connection.oniceconnectionstatechange = null;
      this.connection = null;
    }
    this.clearFailureTimeout();
  }

  /**
   * Handle ICE state changes
   */
  private handleStateChange(): void {
    if (!this.connection) return;

    const state = this.connection.iceConnectionState;
    console.log('[ICE] Connection state:', state);
    
    this.onStateChange?.(state);

    switch (state) {
      case 'connected':
      case 'completed':
        this.clearFailureTimeout();
        this.onConnected?.();
        break;
      
      case 'disconnected':
        this.startFailureTimeout();
        this.onDisconnected?.();
        break;
      
      case 'failed':
        this.clearFailureTimeout();
        this.onFailed?.();
        break;
      
      case 'closed':
        this.clearFailureTimeout();
        break;
    }
  }

  /**
   * Start failure timeout
   */
  private startFailureTimeout(): void {
    this.clearFailureTimeout();
    this.failureTimeout = setTimeout(() => {
      console.log('[ICE] Connection timeout - considering failed');
      this.onFailed?.();
    }, this.failureTimeoutMs);
  }

  /**
   * Clear failure timeout
   */
  private clearFailureTimeout(): void {
    if (this.failureTimeout) {
      clearTimeout(this.failureTimeout);
      this.failureTimeout = null;
    }
  }

  /**
   * Get current state
   */
  getState(): RTCIceConnectionState | null {
    return this.connection?.iceConnectionState || null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    const state = this.getState();
    return state === 'connected' || state === 'completed';
  }
}

/**
 * ICE Candidate Filter
 * Filters ICE candidates based on configuration
 */
export class ICECandidateFilter {
  private allowIPv6: boolean;
  private allowLoopback: boolean;
  private allowLinkLocal: boolean;

  constructor(options: {
    allowIPv6?: boolean;
    allowLoopback?: boolean;
    allowLinkLocal?: boolean;
  } = {}) {
    this.allowIPv6 = options.allowIPv6 ?? true;
    this.allowLoopback = options.allowLoopback ?? false;
    this.allowLinkLocal = options.allowLinkLocal ?? false;
  }

  /**
   * Filter an ICE candidate
   */
  filter(candidate: RTCIceCandidate): RTCIceCandidate | null {
    // Check IPv6
    if (!this.allowIPv6 && this.isIPv6(candidate.address || candidate.candidate)) {
      return null;
    }

    // Check loopback
    if (!this.allowLoopback && this.isLoopback(candidate.address || candidate.candidate)) {
      return null;
    }

    // Check link-local
    if (!this.allowLinkLocal && this.isLinkLocal(candidate.address || candidate.candidate)) {
      return null;
    }

    return candidate;
  }

  /**
   * Check if address is IPv6
   */
  private isIPv6(address: string | null): boolean {
    if (!address) return false;
    return address.includes(':');
  }

  /**
   * Check if address is loopback
   */
  private isLoopback(address: string | null): boolean {
    if (!address) return false;
    return address === '127.0.0.1' || address === '::1' || address === 'localhost';
  }

  /**
   * Check if address is link-local
   */
  private isLinkLocal(address: string | null): boolean {
    if (!address) return false;
    return address.startsWith('169.254.') || 
           address.startsWith('fe80:') ||
           address.startsWith('fe80::');
  }
}

/**
 * Create default ICE configuration
 */
export function createDefaultICEConfiguration(): RTCConfiguration {
  const manager = new ICEConfigurationManager();
  return manager.getRTCConfiguration();
}

/**
 * Create ICE configuration with TURN servers
 */
export function createICEConfigurationWithTurn(
  turnServers: ICEServerConfig[],
  stunServers?: ICEServerConfig[]
): RTCConfiguration {
  const manager = new ICEConfigurationManager({
    customStunServers: stunServers,
    customTurnServers: turnServers,
    mode: 'auto',
  });
  return manager.getRTCConfiguration();
}

/**
 * Create relay-only ICE configuration
 */
export function createRelayOnlyConfiguration(
  turnServers: ICEServerConfig[]
): RTCConfiguration {
  const manager = new ICEConfigurationManager({
    customTurnServers: turnServers,
    mode: 'turn-relay',
  });
  return manager.getRTCConfiguration();
}

// Singleton instance for app-wide configuration
let globalICEManager: ICEConfigurationManager | null = null;

/**
 * Get global ICE configuration manager
 */
export function getGlobalICEManager(): ICEConfigurationManager {
  if (!globalICEManager) {
    globalICEManager = new ICEConfigurationManager();
  }
  return globalICEManager;
}

/**
 * Set global ICE configuration
 */
export function setGlobalICEConfiguration(options: ICEConfigOptions): void {
  globalICEManager = new ICEConfigurationManager(options);
}