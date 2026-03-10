import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from '@/lib/security/headers';

describe('security headers', () => {
  const headers = getSecurityHeaders();

  it('includes Content-Security-Policy', () => {
    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('includes Strict-Transport-Security', () => {
    expect(headers['Strict-Transport-Security']).toBeDefined();
    expect(headers['Strict-Transport-Security']).toContain('max-age=');
  });

  it('includes X-Frame-Options set to DENY', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('CSP allows archive.org media for FMV cutscenes', () => {
    expect(headers['Content-Security-Policy']).toContain('media-src');
    expect(headers['Content-Security-Policy']).toContain('https://archive.org');
    expect(headers['Content-Security-Policy']).toContain('https://*.us.archive.org');
  });

  it('includes all required headers', () => {
    const required = [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection',
      'Referrer-Policy',
      'Permissions-Policy',
    ];
    for (const header of required) {
      expect(headers[header]).toBeDefined();
    }
  });
});
