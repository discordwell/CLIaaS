import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestToken, TEST_USER, buildPostRequest } from './helpers';

describe('Auth API routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure no DATABASE_URL so signin/signup return 503 (demo mode)
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // -- POST /api/auth/signin --

  describe('POST /api/auth/signin', () => {
    it('returns 400 when email or password is missing', async () => {
      const { POST } = await import('@/app/api/auth/signin/route');
      const req = buildPostRequest('/api/auth/signin', { email: 'a@b.com' });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/required/i);
    });

    it('returns 503 when DATABASE_URL is not set', async () => {
      const { POST } = await import('@/app/api/auth/signin/route');
      const req = buildPostRequest('/api/auth/signin', {
        email: 'demo@cliaas.com',
        password: 'password123',
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/database/i);
    });
  });

  // -- POST /api/auth/signup --

  describe('POST /api/auth/signup', () => {
    it('returns 400 when required fields are missing', async () => {
      const { POST } = await import('@/app/api/auth/signup/route');
      const req = buildPostRequest('/api/auth/signup', {
        email: 'new@test.com',
        password: 'password123',
        // missing name and workspaceName
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/required/i);
    });

    it('returns 400 when password is too short', async () => {
      const { POST } = await import('@/app/api/auth/signup/route');
      const req = buildPostRequest('/api/auth/signup', {
        email: 'new@test.com',
        password: 'short',
        name: 'Test',
        workspaceName: 'TestWS',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/8 characters/i);
    });

    it('returns 503 when DATABASE_URL is not set', async () => {
      const { POST } = await import('@/app/api/auth/signup/route');
      const req = buildPostRequest('/api/auth/signup', {
        email: 'new@test.com',
        password: 'password123',
        name: 'New User',
        workspaceName: 'My Workspace',
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/database/i);
    });
  });

  // -- GET /api/auth/me --

  describe('GET /api/auth/me', () => {
    it('returns 401 when no session cookie is present', async () => {
      // Mock next/headers cookies() to return an empty cookie jar
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/me/route');
      const res = await GET();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.user).toBeNull();
    });

    it('returns user data when a valid session cookie is present', async () => {
      const token = await createTestToken(TEST_USER);

      // Mock next/headers cookies() to return the test token
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'cliaas-session') {
              return { value: token };
            }
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/me/route');
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe(TEST_USER.id);
      expect(body.user.email).toBe(TEST_USER.email);
      expect(body.user.role).toBe(TEST_USER.role);
    });
  });
});
