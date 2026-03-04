import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRateLimit, clearBucket, getRateLimitHeaders } from '@/lib/security/rate-limiter';
import { getClientIp } from '../route';

// Use the same configs as the route
const EMAIL_RATE_LIMIT = { windowMs: 5 * 60_000, maxRequests: 3 };
const IP_RATE_LIMIT = { windowMs: 15 * 60_000, maxRequests: 10 };

beforeEach(() => {
  globalThis.__cliaasRateLimiter = new Map();
});

describe('getClientIp', () => {
  it('extracts IP from x-forwarded-for header', () => {
    const req = new NextRequest('http://localhost/api/portal/auth', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
    });
    expect(getClientIp(req)).toBe('203.0.113.50');
  });

  it('extracts IP from x-real-ip when x-forwarded-for is absent', () => {
    const req = new NextRequest('http://localhost/api/portal/auth', {
      method: 'POST',
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    expect(getClientIp(req)).toBe('198.51.100.7');
  });

  it('falls back to unknown when no IP headers present', () => {
    const req = new NextRequest('http://localhost/api/portal/auth', {
      method: 'POST',
    });
    expect(getClientIp(req)).toBe('unknown');
  });

  it('trims whitespace from x-forwarded-for first entry', () => {
    const req = new NextRequest('http://localhost/api/portal/auth', {
      method: 'POST',
      headers: { 'x-forwarded-for': '  10.0.0.1 , 10.0.0.2' },
    });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });
});

describe('magic link per-email rate limiting', () => {
  it('allows up to 3 requests per email', () => {
    const key = 'magic-link:email:alice@example.com';
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(key, EMAIL_RATE_LIMIT);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 4th request for the same email', () => {
    const key = 'magic-link:email:alice@example.com';
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, EMAIL_RATE_LIMIT);
    }
    const result = checkRateLimit(key, EMAIL_RATE_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('does not affect a different email address', () => {
    const aliceKey = 'magic-link:email:alice@example.com';
    const bobKey = 'magic-link:email:bob@example.com';

    // Exhaust Alice's limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit(aliceKey, EMAIL_RATE_LIMIT);
    }
    expect(checkRateLimit(aliceKey, EMAIL_RATE_LIMIT).allowed).toBe(false);

    // Bob should still be allowed
    expect(checkRateLimit(bobKey, EMAIL_RATE_LIMIT).allowed).toBe(true);
  });

  it('resets after clearBucket', () => {
    const key = 'magic-link:email:alice@example.com';
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, EMAIL_RATE_LIMIT);
    }
    expect(checkRateLimit(key, EMAIL_RATE_LIMIT).allowed).toBe(false);

    clearBucket(key);
    expect(checkRateLimit(key, EMAIL_RATE_LIMIT).allowed).toBe(true);
  });
});

describe('magic link per-IP rate limiting', () => {
  it('allows up to 10 requests from the same IP', () => {
    const key = 'magic-link:ip:203.0.113.50';
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(key, IP_RATE_LIMIT);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 11th request from the same IP', () => {
    const key = 'magic-link:ip:203.0.113.50';
    for (let i = 0; i < 10; i++) {
      checkRateLimit(key, IP_RATE_LIMIT);
    }
    const result = checkRateLimit(key, IP_RATE_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('does not affect a different IP', () => {
    const ip1 = 'magic-link:ip:203.0.113.50';
    const ip2 = 'magic-link:ip:198.51.100.7';

    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip1, IP_RATE_LIMIT);
    }
    expect(checkRateLimit(ip1, IP_RATE_LIMIT).allowed).toBe(false);
    expect(checkRateLimit(ip2, IP_RATE_LIMIT).allowed).toBe(true);
  });
});

describe('combined email + IP rate limiting', () => {
  it('email limit triggers before IP limit (3 < 10)', () => {
    const email = 'magic-link:email:alice@example.com';
    const ip = 'magic-link:ip:203.0.113.50';

    // Simulate 3 requests from the same email and IP
    for (let i = 0; i < 3; i++) {
      checkRateLimit(ip, IP_RATE_LIMIT);
      checkRateLimit(email, EMAIL_RATE_LIMIT);
    }

    // IP should still be allowed (7 remaining), but email should be blocked
    expect(checkRateLimit(ip, IP_RATE_LIMIT).allowed).toBe(true);
    expect(checkRateLimit(email, EMAIL_RATE_LIMIT).allowed).toBe(false);
  });

  it('IP limit blocks even if per-email limit is not reached', () => {
    const ip = 'magic-link:ip:10.0.0.1';

    // Exhaust the IP limit by using 10 different emails
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, IP_RATE_LIMIT);
      checkRateLimit(`magic-link:email:user${i}@example.com`, EMAIL_RATE_LIMIT);
    }

    // IP should be blocked
    expect(checkRateLimit(ip, IP_RATE_LIMIT).allowed).toBe(false);

    // But a new email key should still be under its own limit
    const newEmailKey = 'magic-link:email:newuser@example.com';
    expect(checkRateLimit(newEmailKey, EMAIL_RATE_LIMIT).allowed).toBe(true);
  });

  it('rate limit headers include Retry-After when blocked', () => {
    const key = 'magic-link:email:alice@example.com';
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, EMAIL_RATE_LIMIT);
    }
    const result = checkRateLimit(key, EMAIL_RATE_LIMIT);
    expect(result.allowed).toBe(false);

    const headers = getRateLimitHeaders(result, EMAIL_RATE_LIMIT);
    expect(headers['X-RateLimit-Limit']).toBe('3');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBeDefined();
  });
});
