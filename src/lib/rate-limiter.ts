/**
 * @fileoverview Rate limiting and request debouncing utilities for AI API calls
 *
 * Issue #526: Add rate limiting and debouncing for AI API calls
 *
 * Provides:
 * - Rate limiting per user/session to prevent API abuse
 * - Request debouncing for user-triggered AI calls
 * - Request queue with priority handling
 * - User-friendly rate limit status
 */

// Configuration constants
const DEFAULT_RATE_LIMIT_MAX = parseInt(process.env.NEXT_PUBLIC_AI_RATE_LIMIT_MAX || '10', 10);
const DEFAULT_RATE_LIMIT_WINDOW_MS = parseInt(process.env.NEXT_PUBLIC_AI_RATE_LIMIT_WINDOW_MS || '60000', 10);
const DEFAULT_DEBOUNCE_MS = parseInt(process.env.NEXT_PUBLIC_AI_DEBOUNCE_MS || '500', 10);

// Request tracking storage
const requestCounts = new Map<string, number[]>();
const debouncedFunctions = new Map<string, (...args: unknown[]) => unknown>();

/**
 * Check if a user has exceeded their rate limit
 * @param userId - Unique identifier for the user/session
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns true if within limit, false if rate limited
 */
export function checkRateLimit(
  userId: string,
  limit: number = DEFAULT_RATE_LIMIT_MAX,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): boolean {
  const now = Date.now();
  const userRequests = requestCounts.get(userId) || [];
  
  // Remove old requests outside window
  const recentRequests = userRequests.filter(time => now - time < windowMs);
  
  if (recentRequests.length >= limit) {
    return false; // Rate limited
  }
  
  recentRequests.push(now);
  requestCounts.set(userId, recentRequests);
  return true;
}

/**
 * Get remaining requests for a user
 * @param userId - Unique identifier for the user/session
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Number of remaining requests
 */
export function getRemainingRequests(
  userId: string,
  limit: number = DEFAULT_RATE_LIMIT_MAX,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): number {
  const now = Date.now();
  const userRequests = requestCounts.get(userId) || [];
  const recentRequests = userRequests.filter(time => now - time < windowMs);
  return Math.max(0, limit - recentRequests.length);
}

/**
 * Get time until rate limit resets
 * @param userId - Unique identifier for the user/session
 * @param windowMs - Time window in milliseconds
 * @returns Milliseconds until oldest request expires
 */
export function getTimeUntilReset(
  userId: string,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): number {
  const now = Date.now();
  const userRequests = requestCounts.get(userId) || [];
  const recentRequests = userRequests.filter(time => now - time < windowMs);
  
  if (recentRequests.length === 0) {
    return 0;
  }
  
  const oldestRequest = Math.min(...recentRequests);
  return Math.max(0, windowMs - (now - oldestRequest));
}

/**
 * Rate limit error class
 */
export class RateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly remaining: number;
  
  constructor(message: string, retryAfterMs: number, remainingRequests: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfterMs;
    this.remaining = remainingRequests;
  }
}

/**
 * Enforce rate limit and throw error if exceeded
 * @param userId - Unique identifier for the user/session
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @throws {RateLimitError} If rate limit is exceeded
 */
export function enforceRateLimit(
  userId: string,
  limit?: number,
  windowMs?: number
): void {
  if (!checkRateLimit(userId, limit, windowMs)) {
    const retryAfter = getTimeUntilReset(userId, windowMs);
    const remaining = getRemainingRequests(userId, limit, windowMs);
    throw new RateLimitError(
      `Rate limit exceeded. ${remaining} requests remaining.`,
      retryAfter,
      remaining
    );
  }
}

/**
 * Create a debounced version of an async function
 * @param fn - The function to debounce
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced function
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number = DEFAULT_DEBOUNCE_MS
): T {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastCallTime: number = 0;
  let lastResult: unknown = null;
  
  const debouncedFn = ((...args: unknown[]) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    
    // If called again within delay, extend the timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    return new Promise<unknown>((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          lastResult = result;
          lastCallTime = Date.now();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, Math.max(0, delay - timeSinceLastCall));
    });
  }) as T;
  
  debouncedFunctions.set(fn.name || 'anonymous', debouncedFn);
  
  return debouncedFn;
}

/**
 * Cancel a debounced function
 * @param fn - The debounced function to cancel
 */
export function cancelDebounce(fn: (...args: unknown[]) => unknown): void {
  // Note: This is a simplified implementation
  // In a real scenario, we'd need to store timeout IDs per function
  console.warn('cancelDebounce not fully implemented for this function');
}

/**
 * Request queue entry
 */
interface QueuedRequest {
  id: string;
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  priority: 'high' | 'normal' | 'low';
  createdAt: number;
}

/**
 * Request queue manager
 */
class RequestQueue {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private maxConcurrent = 2;
  private activeCount = 0;
  
  /**
   * Add a request to the queue
   */
  public add<T>(
    fn: () => Promise<T>,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: `${Date.now()}-${Math.random()}`,
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        createdAt: Date.now(),
      });
      
      // Sort by priority
      this.queue.sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
      
      this.processQueue();
    });
  }
  
  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const request = this.queue.shift();
      if (!request) break;
      
      this.activeCount++;
      
      request.fn()
        .then(request.resolve)
        .catch(request.reject)
        .finally(() => {
          this.activeCount--;
          this.processQueue();
        });
    }
    
    this.processing = false;
  }
  
  /**
   * Get queue status
   */
  public getStatus(): { pending: number; active: number } {
    return {
      pending: this.queue.length,
      active: this.activeCount,
    };
  }
}

// Export singleton instance
export const aiRequestQueue = new RequestQueue();

/**
 * Format rate limit status for display
 */
export interface RateLimitStatus {
  remaining: number;
  limit: number;
  windowMs: number;
  resetIn: number;
  isLimited: boolean;
}

/**
 * Get rate limit status for a user
 */
export function getRateLimitStatus(
  userId: string,
  limit?: number,
  windowMs?: number
): RateLimitStatus {
  const remaining = getRemainingRequests(userId, limit, windowMs);
  const resetIn = getTimeUntilReset(userId, windowMs);
  
  return {
    remaining,
    limit: limit || DEFAULT_RATE_LIMIT_MAX,
    windowMs: windowMs || DEFAULT_RATE_LIMIT_WINDOW_MS,
    resetIn,
    isLimited: remaining === 0,
  };
}
