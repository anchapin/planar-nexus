/**
 * AI Usage Tracking Module
 * Issue #51: Phase 3.3: Add usage tracking per provider
 * 
 * This module tracks API usage per provider including:
 * - Token usage
 * - Cost estimation
 * - Request counts
 * - Usage statistics display
 */

import type { AIProvider } from '@/ai/providers';

/**
 * Usage tracking data structure
 */
export interface UsageRecord {
  provider: AIProvider;
  timestamp: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  model?: string;
  feature?: string;
}

/**
 * Aggregated usage statistics per provider
 */
export interface ProviderUsageStats {
  provider: AIProvider;
  totalRequests: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  firstUsed: number;
  lastUsed: number;
  dailyUsage: Record<string, DailyUsage>;
}

/**
 * Daily usage breakdown
 */
export interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
}

/**
 * Overall usage summary
 */
export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  providers: ProviderUsageStats[];
  periodStart: number;
  periodEnd: number;
}

/**
 * Pricing info per provider (per 1M tokens)
 * These are approximate prices and may vary
 */
const PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini
  'gemini-1.5-flash-latest': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash-8b': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro-latest': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  // Anthropic
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  // Default fallback
  'default': { input: 1.00, output: 4.00 },
};

/**
 * Storage keys
 */
const USAGE_STORAGE_KEY = 'planar_nexus_ai_usage';

/**
 * Get pricing for a specific model
 */
function getModelPricing(model: string): { input: number; output: number } {
  return PRICING[model] || PRICING['default'];
}

/**
 * Calculate cost estimate for a request
 */
function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Get today's date string
 */
function getDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get all usage records from storage
 */
function getUsageRecords(): UsageRecord[] {
  if (typeof window === 'undefined') return [];
  
  const stored = localStorage.getItem(USAGE_STORAGE_KEY);
  if (!stored) return [];
  
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save usage records to storage
 */
function saveUsageRecords(records: UsageRecord[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(records));
}

/**
 * Track a usage event
 */
export async function trackUsage(
  provider: AIProvider,
  inputTokens: number,
  outputTokens: number,
  model?: string,
  feature?: string
): Promise<void> {
  const records = getUsageRecords();
  
  const record: UsageRecord = {
    provider,
    timestamp: Date.now(),
    tokensUsed: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    costEstimate: calculateCost(inputTokens, outputTokens, model || 'default'),
    model,
    feature,
  };
  
  records.push(record);
  
  // Keep only last 90 days of data to prevent storage bloat
  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const filteredRecords = records.filter(r => r.timestamp > ninetyDaysAgo);
  
  saveUsageRecords(filteredRecords);
}

/**
 * Get usage statistics for a specific provider
 */
export function getProviderUsageStats(provider: AIProvider): ProviderUsageStats {
  const records = getUsageRecords().filter(r => r.provider === provider);
  
  if (records.length === 0) {
    return {
      provider,
      totalRequests: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      firstUsed: 0,
      lastUsed: 0,
      dailyUsage: {},
    };
  }
  
  const dailyUsage: Record<string, DailyUsage> = {};
  
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let firstUsed = records[0].timestamp;
  let lastUsed = records[0].timestamp;
  
  for (const record of records) {
    totalTokens += record.tokensUsed;
    totalInputTokens += record.inputTokens;
    totalOutputTokens += record.outputTokens;
    totalCost += record.costEstimate;
    
    if (record.timestamp < firstUsed) firstUsed = record.timestamp;
    if (record.timestamp > lastUsed) lastUsed = record.timestamp;
    
    const date = getDateString(new Date(record.timestamp));
    if (!dailyUsage[date]) {
      dailyUsage[date] = { date, requests: 0, tokens: 0, cost: 0 };
    }
    dailyUsage[date].requests++;
    dailyUsage[date].tokens += record.tokensUsed;
    dailyUsage[date].cost += record.costEstimate;
  }
  
  return {
    provider,
    totalRequests: records.length,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    firstUsed,
    lastUsed,
    dailyUsage,
  };
}

/**
 * Get usage statistics for all providers
 */
export function getAllUsageStats(): ProviderUsageStats[] {
  const providers: AIProvider[] = ['google', 'openai', 'anthropic', 'custom'];
  return providers.map(provider => getProviderUsageStats(provider));
}

/**
 * Get overall usage summary
 */
export function getUsageSummary(days: number = 30): UsageSummary {
  const providers = getAllUsageStats();
  
  const periodStart = Date.now() - (days * 24 * 60 * 60 * 1000);
  const periodEnd = Date.now();
  
  let totalRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;
  
  for (const stats of providers) {
    totalRequests += stats.totalRequests;
    totalTokens += stats.totalTokens;
    totalCost += stats.totalCost;
  }
  
  // Filter to only providers with usage
  const activeProviders = providers.filter(p => p.totalRequests > 0);
  
  return {
    totalRequests,
    totalTokens,
    totalCost,
    providers: activeProviders,
    periodStart,
    periodEnd,
  };
}

/**
 * Get usage for a specific time period
 */
export function getUsageForPeriod(
  provider: AIProvider,
  startDate: number,
  endDate: number
): UsageRecord[] {
  const records = getUsageRecords();
  return records.filter(
    r => r.provider === provider && r.timestamp >= startDate && r.timestamp <= endDate
  );
}

/**
 * Reset usage tracking for a provider
 */
export function resetProviderUsage(provider: AIProvider): void {
  const records = getUsageRecords();
  const filteredRecords = records.filter(r => r.provider !== provider);
  saveUsageRecords(filteredRecords);
}

/**
 * Reset all usage tracking
 */
export function resetAllUsage(): void {
  saveUsageRecords([]);
}

/**
 * Export usage data as JSON
 */
export function exportUsageData(): string {
  const records = getUsageRecords();
  const stats = getAllUsageStats();
  
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    records,
    aggregatedStats: stats,
  }, null, 2);
}

/**
 * Get formatted cost display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return '<\u00A20.01';
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get formatted token count
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
