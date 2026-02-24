import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearBucket } from '@/lib/security/rate-limiter';

const MFA_RATE_CONFIG = { windowMs: 900_000, maxRequests: 5 };

describe('MFA per-user rate limiting', () => {
  beforeEach(() => {
    globalThis.__cliaasRateLimiter = new Map();
  });

  it('allows up to 5 attempts', () => {
    const key = 'mfa:user-1';
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, MFA_RATE_CONFIG);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks on 6th attempt', () => {
    const key = 'mfa:user-2';
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, MFA_RATE_CONFIG);
    }
    const result = checkRateLimit(key, MFA_RATE_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('rate limits are per-user', () => {
    const user1Key = 'mfa:user-a';
    const user2Key = 'mfa:user-b';

    // Exhaust user-a's limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(user1Key, MFA_RATE_CONFIG);
    }
    expect(checkRateLimit(user1Key, MFA_RATE_CONFIG).allowed).toBe(false);

    // user-b should still have attempts
    expect(checkRateLimit(user2Key, MFA_RATE_CONFIG).allowed).toBe(true);
  });

  it('clearBucket resets rate limit', () => {
    const key = 'mfa:user-reset';
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, MFA_RATE_CONFIG);
    }
    expect(checkRateLimit(key, MFA_RATE_CONFIG).allowed).toBe(false);
    clearBucket(key);
    expect(checkRateLimit(key, MFA_RATE_CONFIG).allowed).toBe(true);
  });
});
