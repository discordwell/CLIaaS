import { describe, it, expect, beforeEach } from 'vitest';
import { generateToken, verifyToken, cleanupExpiredTokens } from '../magic-link';

beforeEach(() => {
  global.__cliaasPortalTokens = new Map();
});

describe('magic-link tokens', () => {
  it('generates a token with email', () => {
    const token = generateToken('user@test.com');
    expect(token.email).toBe('user@test.com');
    expect(token.token).toBeTruthy();
    expect(token.used).toBe(false);
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('normalizes email to lowercase', () => {
    const token = generateToken('User@TEST.com');
    expect(token.email).toBe('user@test.com');
  });

  it('verifies a valid token', () => {
    const token = generateToken('user@test.com');
    const result = verifyToken(token.token);
    expect(result.valid).toBe(true);
    expect(result.email).toBe('user@test.com');
  });

  it('rejects unknown token', () => {
    const result = verifyToken('nonexistent');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token not found');
  });

  it('rejects already-used token (single-use)', () => {
    const token = generateToken('user@test.com');
    verifyToken(token.token); // first use
    const result = verifyToken(token.token); // second use
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token already used');
  });

  it('rejects expired token', () => {
    const token = generateToken('user@test.com');
    // Manually set expiry to past
    const store = global.__cliaasPortalTokens!;
    const stored = store.get(token.token)!;
    stored.expiresAt = Date.now() - 1000;

    const result = verifyToken(token.token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token expired');
  });
});

describe('cleanupExpiredTokens', () => {
  it('removes expired and used tokens', () => {
    const token1 = generateToken('a@b.com');
    generateToken('c@d.com');

    // Mark first as used
    verifyToken(token1.token);

    const cleaned = cleanupExpiredTokens();
    expect(cleaned).toBe(1); // The used one
    expect(global.__cliaasPortalTokens!.size).toBe(1); // Only the unused one remains
  });
});
