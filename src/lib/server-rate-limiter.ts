/**
 * Server-Side Rate Limiting
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides server-side rate limiting for AI API calls.
 * Unlike client-side rate limiting, this cannot be bypassed by users.
 */

import { LRUCache } from 'lru-cache';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message?: string;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: parseInt(process.env.AI_RATE_LIMIT_MAX || '100', 10),
  windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || '60000', 10),
  message: 'Rate limit exceeded. Please try again later.',
};

/**
 * Request tracking using LRU cache for memory efficiency
 * Key: userId or IP address
 * Value: array of request timestamps
 */
class RateLimitStore {
  private cache: LRUCache<string, number[]>;

  constructor(maxSize: number = 10000) {
    this.cache = new LRUCache({
      max: maxSize,
      ttl: parseInt(process.env.AI_RATE_LIMIT_TTL_MS || '300000', 10), // 5 min default
      updateAgeOnGet: true,
    });
  }

  /**
   * Get request timestamps for a user
   */
  get(userId: string): number[] {
    return this.cache.get(userId) || [];
  }

  /**
   * Set request timestamps for a user
   */
  set(userId: string, timestamps: number[]): void {
    this.cache.set(userId, timestamps);
  }

  /**
   * Delete user data
   */
  delete(userId: string): boolean {
    return this.cache.delete(userId);
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

// Singleton instance
const rateLimitStore = new RateLimitStore();

/**
 * Check rate limit for a user
 * @param userId - Unique user identifier (user ID, session ID, or IP)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(
  userId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get existing requests
  const requests = rateLimitStore.get(userId);

  // Filter to only requests within the window
  const recentRequests = requests.filter(timestamp => timestamp > windowStart);

  // Calculate remaining requests
  const remaining = Math.max(0, config.maxRequests - recentRequests.length);

  // Calculate reset time (when the oldest request in window expires)
  const oldestRequest = recentRequests.length > 0 
    ? Math.min(...recentRequests) 
    : now;
  const resetAt = oldestRequest + config.windowMs;

  // Check if rate limited
  if (recentRequests.length >= config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000), // Convert to seconds
    };
  }

  // Add current request
  recentRequests.push(now);
  rateLimitStore.set(userId, recentRequests);

  return {
    success: true,
    remaining,
    resetAt,
  };
}

/**
 * Enforce rate limit and throw error if exceeded
 * @param userId - Unique user identifier
 * @param config - Rate limit configuration
 * @throws {RateLimitError} If rate limit is exceeded
 */
export function enforceRateLimit(
  userId: string,
  config?: RateLimitConfig
): RateLimitResult {
  const result = checkRateLimit(userId, config);

  if (!result.success) {
    throw new RateLimitError(
      config?.message || 'Rate limit exceeded',
      result.retryAfter || 0,
      result.remaining
    );
  }

  return result;
}

/**
 * Rate limit error class
 */
export class RateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly remaining: number;
  public readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(message: string, retryAfterMs: number, remainingRequests: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfterMs;
    this.remaining = remainingRequests;
  }
}

/**
 * Get rate limit status for display
 */
export function getRateLimitStatus(
  userId: string,
  config?: RateLimitConfig
): {
  remaining: number;
  limit: number;
  resetIn: number;
  isLimited: boolean;
} {
  const now = Date.now();
  const result = checkRateLimit(userId, config);
  const resetIn = Math.max(0, result.resetAt - now);

  return {
    remaining: result.remaining,
    limit: config?.maxRequests || DEFAULT_RATE_LIMIT.maxRequests,
    resetIn,
    isLimited: !result.success,
  };
}

/**
 * Reset rate limit for a user
 */
export function resetRateLimit(userId: string): void {
  rateLimitStore.delete(userId);
}

/**
 * Clear all rate limit data
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

/**
 * Create rate limit headers for response
 */
export function getRateLimitHeaders(
  result: RateLimitResult,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): Record<string, string> {
  return {
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toString(),
    ...(result.retryAfter && {
      'Retry-After': result.retryAfter.toString(),
    }),
  };
}
