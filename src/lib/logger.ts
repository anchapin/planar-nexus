/**
 * Centralized logging utility for Planar Nexus
 * 
 * Provides structured logging with log levels and environment-based filtering.
 * Debug logs are only shown in development mode.
 * 
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger';
 * 
 * logger.debug('Detailed debug info', { data });
 * logger.info('User action', { userId });
 * logger.warn('Potential issue', { context });
 * logger.error('Error occurred', error, { context });
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  /** Minimum log level to display (default: 'debug' in dev, 'info' in production) */
  minLevel?: LogLevel;
  /** Prefix to add to all log messages */
  prefix?: string;
  /** Whether to include timestamps (default: true) */
  includeTimestamp?: boolean;
}

export class Logger {
  private minLevel: LogLevel;
  private prefix: string;
  private includeTimestamp: boolean;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: LoggerOptions = {}) {
    const isDevelopment = process.env.NODE_ENV === 'development';
    this.minLevel = options.minLevel ?? (isDevelopment ? 'debug' : 'info');
    this.prefix = options.prefix ?? '';
    this.includeTimestamp = options.includeTimestamp ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.logLevels[level] >= this.logLevels[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): any[] {
    const parts: any[] = [];
    
    if (this.includeTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    parts.push(`[${level.toUpperCase()}]`);
    
    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }
    
    parts.push(message);
    
    return [...parts, ...args];
  }

  /**
   * Debug level logging - only shown in development
   * Use for detailed debugging information
   */
  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage('debug', message, ...args));
    }
  }

  /**
   * Info level logging - shown in all environments
   * Use for general informational messages
   */
  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(...this.formatMessage('info', message, ...args));
    }
  }

  /**
   * Warning level logging - shown in all environments
   * Use for potential issues or deprecated features
   */
  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('warn', message, ...args));
    }
  }

  /**
   * Error level logging - shown in all environments
   * Use for errors and exceptions
   */
  error(message: string, error?: Error | unknown, ...args: any[]): void {
    if (this.shouldLog('error')) {
      if (error instanceof Error) {
        console.error(...this.formatMessage('error', message, error, ...args));
      } else {
        console.error(...this.formatMessage('error', message, error, ...args));
      }
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      minLevel: this.minLevel,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      includeTimestamp: this.includeTimestamp,
    });
  }
}

// Default logger instance for general use
export const logger = new Logger();

// Specialized loggers for different subsystems
export const aiLogger = logger.child('ai');
export const gameLogger = logger.child('game');
export const networkLogger = logger.child('network');
export const uiLogger = logger.child('ui');

/**
 * Helper function to log AI provider usage
 * @deprecated Use aiLogger directly instead
 */
export function logAiUsage(provider: string, action: string, metadata?: Record<string, unknown>): void {
  aiLogger.info(`${provider} - ${action}`, metadata);
}

/**
 * Helper function to log game events
 * @deprecated Use gameLogger directly instead
 */
export function logGameEvent(event: string, details?: Record<string, unknown>): void {
  gameLogger.info(event, details);
}
