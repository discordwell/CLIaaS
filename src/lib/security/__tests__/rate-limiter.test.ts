import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearBucket, getRateLimitHeaders } from '@/lib/security/rate-limiter';

describe('rate-limiter', () => {
  beforeEach(() => {
    // Clear the global store
    globalThis.__cliaasRateLimiter = new Map();
  });

  it('allows requests under limit', () => {
    const result = checkRateLimit('test-ip', { windowMs: 60000, maxRequests: 10 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('blocks after limit exceeded', () => {
    const config = { windowMs: 60000, maxRequests: 3 };
    checkRateLimit('blocker', config);
    checkRateLimit('blocker', config);
    checkRateLimit('blocker', config);
    const result = checkRateLimit('blocker', config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
  });

  it('different keys have independent limits', () => {
    const config = { windowMs: 60000, maxRequests: 2 };
    checkRateLimit('ip-a', config);
    checkRateLimit('ip-a', config);
    const resultA = checkRateLimit('ip-a', config);
    const resultB = checkRateLimit('ip-b', config);
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it('clearBucket removes a key', () => {
    const config = { windowMs: 60000, maxRequests: 1 };
    checkRateLimit('clear-me', config);
    checkRateLimit('clear-me', config);
    expect(checkRateLimit('clear-me', config).allowed).toBe(false);
    clearBucket('clear-me');
    expect(checkRateLimit('clear-me', config).allowed).toBe(true);
  });

  it('returns retryAfter when blocked', () => {
    const config = { windowMs: 60000, maxRequests: 1 };
    checkRateLimit('retry-key', config);
    const blocked = checkRateLimit('retry-key', config);
    expect(blocked.allowed).toBe(false);
    expect(typeof blocked.retryAfter).toBe('number');
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  describe('getRateLimitHeaders', () => {
    it('reports default limit (60) when no config provided', () => {
      const result = checkRateLimit('headers-default', { windowMs: 60000, maxRequests: 60 });
      const headers = getRateLimitHeaders(result);
      expect(headers['X-RateLimit-Limit']).toBe('60');
      expect(headers['X-RateLimit-Remaining']).toBe('59');
    });

    it('reports custom limit when config is provided', () => {
      const config = { windowMs: 60000, maxRequests: 120 };
      const result = checkRateLimit('headers-custom', config);
      const headers = getRateLimitHeaders(result, config);
      expect(headers['X-RateLimit-Limit']).toBe('120');
      expect(headers['X-RateLimit-Remaining']).toBe('119');
    });

    it('includes Retry-After when blocked', () => {
      const config = { windowMs: 60000, maxRequests: 1 };
      checkRateLimit('headers-blocked', config);
      const blocked = checkRateLimit('headers-blocked', config);
      const headers = getRateLimitHeaders(blocked, config);
      expect(headers['X-RateLimit-Limit']).toBe('1');
      expect(headers['X-RateLimit-Remaining']).toBe('0');
      expect(headers['Retry-After']).toBeDefined();
    });
  });
});
