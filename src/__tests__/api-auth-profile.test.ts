import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPostRequest, TEST_USER, createTestToken } from './helpers';

describe('Auth Profile API routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // -- PATCH /api/auth/me --

  describe('PATCH /api/auth/me', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { PATCH } = await import('@/app/api/auth/me/route');
      const req = buildPostRequest('/api/auth/me', { name: 'New Name' });
      // Build a PATCH request manually
      const patchReq = new Request('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const res = await PATCH(patchReq);
      expect(res.status).toBe(401);
    });

    it('returns 400 when name is empty', async () => {
      const token = await createTestToken(TEST_USER);
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'cliaas-session') return { value: token };
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { PATCH } = await import('@/app/api/auth/me/route');
      const patchReq = new Request('http://localhost:3000/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      const res = await PATCH(patchReq);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/name/i);
    });
  });

  // -- POST /api/auth/me/password --

  describe('POST /api/auth/me/password', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/me/password/route');
      const req = buildPostRequest('/api/auth/me/password', {
        currentPassword: 'old',
        newPassword: 'newpassword123',
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when passwords are missing', async () => {
      const token = await createTestToken(TEST_USER);
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'cliaas-session') return { value: token };
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/me/password/route');
      const req = buildPostRequest('/api/auth/me/password', {
        currentPassword: 'old',
        // missing newPassword
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/required/i);
    });
  });
});
