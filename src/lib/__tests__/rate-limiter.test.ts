/**
 * Rate limiter tests
 */

import { RateLimitError, checkRateLimit, getRemainingRequests, getTimeUntilReset, getRateLimitStatus } from '../rate-limiter';

describe('RateLimitError', () => {
  it('should be an Error subclass', () => {
    const error = new RateLimitError('rate limited', 1000, 0);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('checkRateLimit', () => {
  it('should return a boolean', () => {
    const allowed = checkRateLimit('test-key');
    expect(typeof allowed).toBe('boolean');
  });
});

describe('getRemainingRequests', () => {
  it('should return a number', () => {
    const remaining = getRemainingRequests('test-key');
    expect(typeof remaining).toBe('number');
  });
});

describe('getTimeUntilReset', () => {
  it('should return a number', () => {
    const time = getTimeUntilReset('test-key');
    expect(typeof time).toBe('number');
  });
});

describe('getRateLimitStatus', () => {
  it('should return status object', () => {
    const status = getRateLimitStatus('test-key');
    expect(status).toBeDefined();
  });
});
