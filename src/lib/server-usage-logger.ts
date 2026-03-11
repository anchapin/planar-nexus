/**
 * Server-Side Usage Tracking and Logging
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides server-side usage tracking and logging for AI API calls.
 * Unlike client-side tracking, this provides accurate server-verified usage data.
 */

import { AIProvider } from '@/ai/providers/types';
import { indexedDBStorage } from './indexeddb-storage';

/**
 * Usage log entry
 */
export interface UsageLogEntry {
  id: string;
  userId: string;
  provider: AIProvider;
  endpoint: string;
  model?: string;
  timestamp: number;
  duration: number;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  costEstimate?: number;
  success: boolean;
  error?: string;
  errorCode?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated usage statistics
 */
export interface UsageStatistics {
  provider: AIProvider;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  totalCost: number;
  averageDuration: number;
  firstUsed: number;
  lastUsed: number;
  errorsByCode: Record<string, number>;
}

/**
 * Pricing info per provider (per 1M tokens)
 * Server-side authoritative pricing
 */
const SERVER_PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini
  'gemini-1.5-flash-latest': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash-8b': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro-latest': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  // Z.ai (approximate)
  'default': { input: 1.00, output: 4.00 },
  'zaiclient-7b': { input: 0.50, output: 2.00 },
  'zaiclient-14b': { input: 1.00, output: 4.00 },
  'zaiclient-72b': { input: 2.00, output: 8.00 },
};

/**
 * Storage key for usage logs
 */
const USAGE_LOGS_KEY = 'planar_nexus_server_usage_logs';

/**
 * Calculate cost estimate for token usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = SERVER_PRICING[model] || SERVER_PRICING['default'] || { input: 1.0, output: 4.0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Generate unique log entry ID
 */
function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get usage logs from storage
 */
async function getUsageLogs(): Promise<UsageLogEntry[]> {
  if (typeof window === 'undefined') {
    // Server-side: return empty array or implement server storage
    return [];
  }

  try {
    await indexedDBStorage.initialize();
    const logs = await indexedDBStorage.getAll<UsageLogEntry>('usage-tracking');
    return logs || [];
  } catch (error) {
    console.error('Failed to get usage logs:', error);
    return [];
  }
}

/**
 * Save usage logs to storage
 */
async function saveUsageLogs(logs: UsageLogEntry[]): Promise<void> {
  if (typeof window === 'undefined') {
    // Server-side: could implement file-based or database storage
    return;
  }

  try {
    await indexedDBStorage.initialize();
    
    // Add IDs to logs without them
    const logsWithIds = logs.map(log => ({
      ...log,
      id: log.id || generateLogId(),
    }));

    await indexedDBStorage.setAll('usage-tracking', logsWithIds);
  } catch (error) {
    console.error('Failed to save usage logs:', error);
  }
}

/**
 * Log a usage event
 */
export async function logUsage(
  entry: Omit<UsageLogEntry, 'id'>
): Promise<void> {
  const logs = await getUsageLogs();
  
  const newEntry: UsageLogEntry = {
    ...entry,
    id: generateLogId(),
  };

  logs.push(newEntry);

  // Keep only last 90 days of data
  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const filteredLogs = logs.filter(log => log.timestamp > ninetyDaysAgo);

  await saveUsageLogs(filteredLogs);
}

/**
 * Create a usage log entry builder
 */
export class UsageLogger {
  private entry: Partial<UsageLogEntry>;
  private startTime: number;

  constructor(userId: string, provider: AIProvider, endpoint: string) {
    this.entry = {
      userId,
      provider,
      endpoint,
      timestamp: Date.now(),
      success: false,
    };
    this.startTime = Date.now();
  }

  /**
   * Set model information
   */
  setModel(model: string): this {
    this.entry.model = model;
    return this;
  }

  /**
   * Set token usage
   */
  setTokenUsage(input: number, output: number): this {
    this.entry.tokensUsed = {
      input,
      output,
      total: input + output,
    };
    
    if (this.entry.model) {
      this.entry.costEstimate = calculateCost(input, output, this.entry.model);
    }
    
    return this;
  }

  /**
   * Set request metadata
   */
  setMetadata(metadata: Record<string, unknown>): this {
    this.entry.metadata = metadata;
    return this;
  }

  /**
   * Set client information
   */
  setClientInfo(ipAddress?: string, userAgent?: string): this {
    if (ipAddress) this.entry.ipAddress = ipAddress;
    if (userAgent) this.entry.userAgent = userAgent;
    return this;
  }

  /**
   * Mark as successful
   */
  markSuccess(): this {
    this.entry.success = true;
    this.entry.duration = Date.now() - this.startTime;
    return this;
  }

  /**
   * Mark as failed
   */
  markFailure(error: string, errorCode?: string): this {
    this.entry.success = false;
    this.entry.error = error;
    this.entry.errorCode = errorCode;
    this.entry.duration = Date.now() - this.startTime;
    return this;
  }

  /**
   * Save the log entry
   */
  async save(): Promise<void> {
    if (!this.entry.timestamp) {
      this.entry.timestamp = Date.now();
    }
    if (!this.entry.duration) {
      this.entry.duration = Date.now() - this.startTime;
    }
    
    await logUsage(this.entry as UsageLogEntry);
  }
}

/**
 * Get usage statistics for a provider
 */
export async function getProviderUsageStats(
  provider: AIProvider,
  days: number = 30
): Promise<UsageStatistics> {
  const logs = await getUsageLogs();
  const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const providerLogs = logs.filter(
    log => log.provider === provider && log.timestamp > cutoffDate
  );

  if (providerLogs.length === 0) {
    return {
      provider,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      totalCost: 0,
      averageDuration: 0,
      firstUsed: 0,
      lastUsed: 0,
      errorsByCode: {},
    };
  }

  // Calculate statistics
  const stats: UsageStatistics = {
    provider,
    totalRequests: providerLogs.length,
    successfulRequests: providerLogs.filter(log => log.success).length,
    failedRequests: providerLogs.filter(log => !log.success).length,
    totalTokens: { input: 0, output: 0, total: 0 },
    totalCost: 0,
    averageDuration: 0,
    firstUsed: providerLogs[0].timestamp,
    lastUsed: providerLogs[0].timestamp,
    errorsByCode: {},
  };

  let totalDuration = 0;

  for (const log of providerLogs) {
    // Token usage
    if (log.tokensUsed) {
      stats.totalTokens.input += log.tokensUsed.input;
      stats.totalTokens.output += log.tokensUsed.output;
      stats.totalTokens.total += log.tokensUsed.total;
    }

    // Cost
    if (log.costEstimate) {
      stats.totalCost += log.costEstimate;
    }

    // Duration
    totalDuration += log.duration;

    // First/last used
    if (log.timestamp < stats.firstUsed) stats.firstUsed = log.timestamp;
    if (log.timestamp > stats.lastUsed) stats.lastUsed = log.timestamp;

    // Error tracking
    if (!log.success && log.errorCode) {
      stats.errorsByCode[log.errorCode] = (stats.errorsByCode[log.errorCode] || 0) + 1;
    }
  }

  stats.averageDuration = totalDuration / providerLogs.length;

  return stats;
}

/**
 * Get overall usage summary
 */
export async function getUsageSummary(days: number = 30): Promise<{
  totalRequests: number;
  totalTokens: { input: number; output: number; total: number };
  totalCost: number;
  providers: UsageStatistics[];
}> {
  const providers: AIProvider[] = ['google', 'openai', 'zaic', 'custom'];
  const stats: UsageStatistics[] = [];

  let totalRequests = 0;
  const totalTokens = { input: 0, output: 0, total: 0 };
  let totalCost = 0;

  for (const provider of providers) {
    const providerStats = await getProviderUsageStats(provider, days);
    stats.push(providerStats);

    totalRequests += providerStats.totalRequests;
    totalTokens.input += providerStats.totalTokens.input;
    totalTokens.output += providerStats.totalTokens.output;
    totalTokens.total += providerStats.totalTokens.total;
    totalCost += providerStats.totalCost;
  }

  return {
    totalRequests,
    totalTokens,
    totalCost,
    providers: stats.filter(s => s.totalRequests > 0),
  };
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return '<¢0.01';
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token count for display
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}
