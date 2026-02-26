import { describe, it, expect } from 'vitest';
import { sign, verify, PORTAL_COOKIE_NAME } from '../cookie';

describe('portal cookie', () => {
  it('exports the correct cookie name', () => {
    expect(PORTAL_COOKIE_NAME).toBe('cliaas-portal-auth');
  });

  it('sign returns base64url.hmac format', () => {
    const val = sign('user@test.com');
    expect(val).toContain('.');
    const [encoded, sig] = val.split('.');
    expect(encoded.length).toBeGreaterThan(0);
    expect(sig.length).toBe(32);
  });

  it('verify round-trips a signed email', () => {
    const email = 'user@test.com';
    const cookie = sign(email);
    expect(verify(cookie)).toBe(email);
  });

  it('verify returns null for empty string', () => {
    expect(verify('')).toBeNull();
  });

  it('verify returns null for string without dot', () => {
    expect(verify('nodothere')).toBeNull();
  });

  it('verify returns null for tampered signature', () => {
    const cookie = sign('user@test.com');
    const [encoded] = cookie.split('.');
    const tampered = `${encoded}.${'a'.repeat(32)}`;
    expect(verify(tampered)).toBeNull();
  });

  it('verify returns null for tampered email payload', () => {
    const cookie = sign('user@test.com');
    const [, sig] = cookie.split('.');
    const fakeEncoded = Buffer.from('attacker@evil.com').toString('base64url');
    expect(verify(`${fakeEncoded}.${sig}`)).toBeNull();
  });

  it('verify returns null for truncated signature', () => {
    const cookie = sign('user@test.com');
    const [encoded, sig] = cookie.split('.');
    expect(verify(`${encoded}.${sig.slice(0, 10)}`)).toBeNull();
  });

  it('handles emails with special characters', () => {
    const email = 'user+tag@sub.domain.com';
    const cookie = sign(email);
    expect(verify(cookie)).toBe(email);
  });

  it('handles unicode emails', () => {
    const email = 'ñoño@example.com';
    const cookie = sign(email);
    expect(verify(cookie)).toBe(email);
  });
});
