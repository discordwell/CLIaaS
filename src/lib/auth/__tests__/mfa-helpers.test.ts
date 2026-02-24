import { describe, it, expect, afterEach } from 'vitest';
import { requireDatabase } from '@/lib/auth/mfa-helpers';

describe('mfa-helpers', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  describe('requireDatabase', () => {
    it('returns 503 response when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      const result = requireDatabase();
      expect(result).not.toBeNull();
      expect(result!.status).toBe(503);
    });

    it('returns null when DATABASE_URL is set', () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const result = requireDatabase();
      expect(result).toBeNull();
    });
  });
});
