import { describe, it, expect, beforeEach } from 'vitest';
import { trackToken, consumeToken, cleanupExpiredTokens } from '@/lib/auth/mfa-token-store';

describe('mfa-token-store', () => {
  beforeEach(() => {
    globalThis.__cliaasIntermediateTokens = new Map();
  });

  it('tracks and consumes a token successfully', () => {
    const jti = 'test-jti-1';
    trackToken(jti, Date.now() + 300_000); // 5 minutes
    expect(consumeToken(jti)).toBe(true);
  });

  it('prevents replay — second consume returns false', () => {
    const jti = 'test-jti-2';
    trackToken(jti, Date.now() + 300_000);
    expect(consumeToken(jti)).toBe(true);
    expect(consumeToken(jti)).toBe(false);
  });

  it('returns false for unknown JTI', () => {
    expect(consumeToken('nonexistent')).toBe(false);
  });

  it('returns false for expired token', () => {
    const jti = 'test-jti-expired';
    trackToken(jti, Date.now() - 1); // already expired
    expect(consumeToken(jti)).toBe(false);
  });

  it('cleanupExpiredTokens removes expired and used entries', () => {
    // Add entries directly to store to avoid cleanup from trackToken
    const store = globalThis.__cliaasIntermediateTokens!;
    store.set('expired', { used: false, expiresAt: Date.now() - 1000 });
    store.set('used', { used: true, expiresAt: Date.now() + 300_000 });
    store.set('active', { used: false, expiresAt: Date.now() + 300_000 });

    const cleaned = cleanupExpiredTokens();
    expect(cleaned).toBe(2); // expired + used

    // active should still be consumable
    expect(consumeToken('active')).toBe(true);
  });
});
