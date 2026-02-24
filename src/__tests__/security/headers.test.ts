import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from '@/lib/security/headers';

describe('security headers', () => {
  const headers = getSecurityHeaders();

  it('includes Content-Security-Policy', () => {
    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('CSP includes form-action restriction', () => {
    expect(headers['Content-Security-Policy']).toContain("form-action 'self'");
  });

  it('CSP includes base-uri restriction', () => {
    expect(headers['Content-Security-Policy']).toContain("base-uri 'self'");
  });

  it('CSP blocks frame-ancestors', () => {
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('includes HSTS with preload', () => {
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Strict-Transport-Security']).toContain('includeSubDomains');
    expect(headers['Strict-Transport-Security']).toContain('preload');
  });

  it('includes X-Content-Type-Options: nosniff', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('includes X-Frame-Options: DENY', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('disables X-XSS-Protection (modern best practice)', () => {
    expect(headers['X-XSS-Protection']).toBe('0');
  });

  it('includes Referrer-Policy', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('includes Permissions-Policy', () => {
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('geolocation=()');
  });

  it('includes Cross-Origin-Opener-Policy', () => {
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('includes Cross-Origin-Resource-Policy', () => {
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });
});
