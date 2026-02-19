/**
 * Desync Logger Utility
 * Issue #314: Logging and debugging for multiplayer desync events
 */

import type { 
  HashDiscrepancy, 
  ConflictResolution, 
  DeterministicAction,
  PeerId,
  SequenceNumber,
} from './game-state/deterministic-sync';
import type { GameState } from './game-state/types';

/**
 * Desync event record
 */
export interface DesyncEvent {
  /** Unique event ID */
  id: string;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Type of desync event */
  type: 'detected' | 'resolved' | 'ignored' | 'escalated';
  /** Local peer ID */
  localPeerId: PeerId;
  /** Remote peer ID where desync was detected */
  remotePeerId: PeerId;
  /** Local state hash */
  localHash: string;
  /** Remote state hash */
  remoteHash: string;
  /** Sequence number at time of desync */
  sequenceNumber: SequenceNumber;
  /** Detected discrepancies */
  discrepancies: HashDiscrepancy[];
  /** Resolution applied (if any) */
  resolution?: ConflictResolution;
  /** Time to resolve (ms) */
  resolutionTime?: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Desync statistics
 */
export interface DesyncStatistics {
  /** Total desync events */
  totalEvents: number;
  /** Events by type */
  byType: Record<string, number>;
  /** Events by peer */
  byPeer: Map<PeerId, number>;
  /** Average resolution time */
  avgResolutionTime: number;
  /** Most common discrepancy categories */
  commonDiscrepancies: Array<{ category: string; count: number }>;
  /** Resolution success rate */
  successRate: number;
}

/**
 * Configuration for the desync logger
 */
export interface DesyncLoggerConfig {
  /** Maximum number of events to keep */
  maxEvents: number;
  /** Whether to persist logs to localStorage */
  persistToStorage: boolean;
  /** Storage key for persisted logs */
  storageKey: string;
  /** Whether to log to console */
  logToConsole: boolean;
  /** Minimum severity to log */
  minSeverity: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DesyncLoggerConfig = {
  maxEvents: 100,
  persistToStorage: true,
  storageKey: 'planar_nexus_desync_logs',
  logToConsole: true,
  minSeverity: 'info',
};

/**
 * Desync Logger class
 * Manages logging and analysis of desync events
 */
export class DesyncLogger {
  private events: DesyncEvent[] = [];
  private config: DesyncLoggerConfig;
  private eventIdCounter = 0;

  constructor(config: Partial<DesyncLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Load persisted events
    if (this.config.persistToStorage) {
      this.loadFromStorage();
    }
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return `desync_${Date.now()}_${++this.eventIdCounter}`;
  }

  /**
   * Log a desync detection event
   */
  logDetection(
    localPeerId: PeerId,
    remotePeerId: PeerId,
    localHash: string,
    remoteHash: string,
    sequenceNumber: SequenceNumber,
    discrepancies: HashDiscrepancy[],
    context?: Record<string, unknown>
  ): DesyncEvent {
    const event: DesyncEvent = {
      id: this.generateEventId(),
      timestamp: Date.now(),
      type: 'detected',
      localPeerId,
      remotePeerId,
      localHash,
      remoteHash,
      sequenceNumber,
      discrepancies,
      context,
    };

    this.addEvent(event);

    if (this.config.logToConsole) {
      console.warn('[DesyncLogger] Desync detected:', {
        peer: remotePeerId,
        localHash,
        remoteHash,
        discrepancies: discrepancies.length,
        sequenceNumber,
      });
    }

    return event;
  }

  /**
   * Log a desync resolution event
   */
  logResolution(
    eventId: string,
    resolution: ConflictResolution,
    resolutionTime: number
  ): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.resolution = resolution;
      event.resolutionTime = resolutionTime;
      event.type = 'resolved';

      if (this.config.logToConsole) {
        console.info('[DesyncLogger] Desync resolved:', {
          eventId,
          strategy: resolution.strategy,
          resolutionTime: `${resolutionTime}ms`,
        });
      }

      this.saveToStorage();
    }
  }

  /**
   * Log an ignored desync event
   */
  logIgnored(
    localPeerId: PeerId,
    remotePeerId: PeerId,
    localHash: string,
    remoteHash: string,
    reason: string
  ): DesyncEvent {
    const event: DesyncEvent = {
      id: this.generateEventId(),
      timestamp: Date.now(),
      type: 'ignored',
      localPeerId,
      remotePeerId,
      localHash,
      remoteHash,
      sequenceNumber: 0,
      discrepancies: [],
      context: { reason },
    };

    this.addEvent(event);

    if (this.config.logToConsole) {
      console.info('[DesyncLogger] Desync ignored:', reason);
    }

    return event;
  }

  /**
   * Log an escalated desync event
   */
  logEscalated(
    eventId: string,
    reason: string
  ): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.type = 'escalated';
      event.context = { ...event.context, escalationReason: reason };

      if (this.config.logToConsole) {
        console.error('[DesyncLogger] Desync escalated:', reason);
      }

      this.saveToStorage();
    }
  }

  /**
   * Add an event to the log
   */
  private addEvent(event: DesyncEvent): void {
    this.events.push(event);

    // Trim old events
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    this.saveToStorage();
  }

  /**
   * Get all events
   */
  getEvents(): DesyncEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType(type: DesyncEvent['type']): DesyncEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events by peer
   */
  getEventsByPeer(peerId: PeerId): DesyncEvent[] {
    return this.events.filter(e => e.remotePeerId === peerId);
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 10): DesyncEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get statistics
   */
  getStatistics(): DesyncStatistics {
    const byType: Record<string, number> = {};
    const byPeer = new Map<PeerId, number>();
    const categoryCounts: Record<string, number> = {};
    
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const event of this.events) {
      // Count by type
      byType[event.type] = (byType[event.type] || 0) + 1;

      // Count by peer
      byPeer.set(event.remotePeerId, (byPeer.get(event.remotePeerId) || 0) + 1);

      // Count discrepancy categories
      for (const d of event.discrepancies) {
        categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
      }

      // Track resolution time
      if (event.resolutionTime !== undefined) {
        totalResolutionTime += event.resolutionTime;
        resolvedCount++;
      }
    }

    // Sort categories by count
    const commonDiscrepancies = Object.entries(categoryCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate success rate
    const resolved = byType['resolved'] || 0;
    const escalated = byType['escalated'] || 0;
    const successRate = resolved + escalated > 0 
      ? resolved / (resolved + escalated) 
      : 1;

    return {
      totalEvents: this.events.length,
      byType,
      byPeer,
      avgResolutionTime: resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0,
      commonDiscrepancies,
      successRate,
    };
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      events: this.events,
      statistics: this.getStatistics(),
    }, null, 2);
  }

  /**
   * Import logs from JSON
   */
  importLogs(json: string): void {
    try {
      const data = JSON.parse(json);
      if (data.events && Array.isArray(data.events)) {
        this.events = data.events;
        this.saveToStorage();
      }
    } catch (error) {
      console.error('[DesyncLogger] Failed to import logs:', error);
    }
  }

  /**
   * Save logs to localStorage
   */
  private saveToStorage(): void {
    if (!this.config.persistToStorage) return;

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(this.config.storageKey, JSON.stringify(this.events));
      }
    } catch (error) {
      console.error('[DesyncLogger] Failed to save to storage:', error);
    }
  }

  /**
   * Load logs from localStorage
   */
  private loadFromStorage(): void {
    if (!this.config.persistToStorage) return;

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(this.config.storageKey);
        if (stored) {
          this.events = JSON.parse(stored);
        }
      }
    } catch (error) {
      console.error('[DesyncLogger] Failed to load from storage:', error);
    }
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.events = [];
    
    if (this.config.persistToStorage && typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.config.storageKey);
    }
  }

  /**
   * Create a debug report for a specific event
   */
  createDebugReport(eventId: string): string {
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      return 'Event not found';
    }

    const lines: string[] = [
      `=== Desync Event Report ===`,
      `Event ID: ${event.id}`,
      `Timestamp: ${new Date(event.timestamp).toISOString()}`,
      `Type: ${event.type}`,
      ``,
      `=== Peers ===`,
      `Local: ${event.localPeerId}`,
      `Remote: ${event.remotePeerId}`,
      ``,
      `=== State Hashes ===`,
      `Local:  ${event.localHash}`,
      `Remote: ${event.remoteHash}`,
      `Sequence: ${event.sequenceNumber}`,
      ``,
      `=== Discrepancies (${event.discrepancies.length}) ===`,
    ];

    for (const d of event.discrepancies) {
      lines.push(`- [${d.category}] ${d.description}`);
      lines.push(`  Local: ${d.localValue}`);
      lines.push(`  Remote: ${d.remoteValue}`);
    }

    if (event.resolution) {
      lines.push(``);
      lines.push(`=== Resolution ===`);
      lines.push(`Strategy: ${event.resolution.strategy}`);
      lines.push(`Description: ${event.resolution.conflictDescription}`);
      if (event.resolutionTime) {
        lines.push(`Time: ${event.resolutionTime}ms`);
      }
    }

    if (event.context) {
      lines.push(``);
      lines.push(`=== Context ===`);
      lines.push(JSON.stringify(event.context, null, 2));
    }

    return lines.join('\n');
  }
}

/**
 * Singleton instance
 */
let loggerInstance: DesyncLogger | null = null;

/**
 * Get the singleton desync logger
 */
export function getDesyncLogger(config?: Partial<DesyncLoggerConfig>): DesyncLogger {
  if (!loggerInstance) {
    loggerInstance = new DesyncLogger(config);
  }
  return loggerInstance;
}

/**
 * Reset the singleton logger
 */
export function resetDesyncLogger(): void {
  loggerInstance = null;
}

/**
 * Create a new desync logger instance
 */
export function createDesyncLogger(config?: Partial<DesyncLoggerConfig>): DesyncLogger {
  return new DesyncLogger(config);
}