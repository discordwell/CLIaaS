import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sign, verify, PORTAL_COOKIE_NAME } from '@/lib/portal/cookie';
import { generateToken, verifyToken } from '@/lib/portal/magic-link';

beforeEach(() => {
  global.__cliaasPortalTokens = new Map();
});

describe('portal auth flow', () => {
  it('generates a token and verify endpoint would set a signed cookie', () => {
    // 1. Generate a magic-link token
    const token = generateToken('alice@example.com');
    expect(token.token).toBeTruthy();
    expect(token.email).toBe('alice@example.com');

    // 2. Verify the token (simulating what GET /verify does)
    const result = verifyToken(token.token);
    expect(result.valid).toBe(true);
    expect(result.email).toBe('alice@example.com');

    // 3. Sign the email into a cookie value
    const cookieValue = sign(result.email!);
    expect(cookieValue).toContain('.');

    // 4. Verify the cookie value recovers the email
    const recovered = verify(cookieValue);
    expect(recovered).toBe('alice@example.com');
  });

  it('rejects an invalid magic-link token', () => {
    const result = verifyToken('bogus-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token not found');
  });

  it('rejects a used magic-link token', () => {
    const token = generateToken('bob@example.com');
    verifyToken(token.token); // first use
    const result = verifyToken(token.token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token already used');
  });

  it('sign-out: clearing cookie means verify returns null', () => {
    const cookieValue = sign('alice@example.com');
    expect(verify(cookieValue)).toBe('alice@example.com');

    // Simulating clearing: verify empty string
    expect(verify('')).toBeNull();
  });

  it('rejects tampered cookies', () => {
    const cookieValue = sign('alice@example.com');
    const [encoded] = cookieValue.split('.');
    const tampered = `${encoded}.ffffffffffffffffffffffffffffffff`;
    expect(verify(tampered)).toBeNull();
  });
});

describe('cookie name', () => {
  it('uses cliaas-portal-auth', () => {
    expect(PORTAL_COOKIE_NAME).toBe('cliaas-portal-auth');
  });
});
