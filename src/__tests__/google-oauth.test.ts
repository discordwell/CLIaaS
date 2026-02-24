import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { getJwtSecret } from '@/lib/auth';
import { buildPostRequest } from './helpers';

describe('Google OAuth routes', () => {
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

  // -- GET /api/auth/google/login --

  describe('GET /api/auth/google/login', () => {
    it('redirects to Google when GOOGLE_CLIENT_ID is set', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';

      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/login/route');
      const res = await GET();

      expect(res.status).toBe(307);
      const location = res.headers.get('location') || '';
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('scope=openid+email+profile');
    });

    it('returns 503 when GOOGLE_CLIENT_ID is not set', async () => {
      delete process.env.GOOGLE_CLIENT_ID;

      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/login/route');
      const res = await GET();

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });
  });

  // -- GET /api/auth/google/callback --

  describe('GET /api/auth/google/callback', () => {
    it('redirects to sign-in with error when code is missing', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/callback/route');
      const req = new Request('http://localhost:3000/api/auth/google/callback?state=abc');
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/sign-in');
      expect(location).toContain('google_missing_params');
    });

    it('redirects to sign-in with error when state is missing', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/callback/route');
      const req = new Request('http://localhost:3000/api/auth/google/callback?code=authcode');
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/sign-in');
      expect(location).toContain('google_missing_params');
    });

    it('redirects with state_mismatch when state cookie does not match', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'google-oauth-state') return { value: 'saved-state' };
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/callback/route');
      const req = new Request(
        'http://localhost:3000/api/auth/google/callback?code=authcode&state=wrong-state'
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/sign-in');
      expect(location).toContain('google_state_mismatch');
    });

    it('redirects with google_denied when error param is present', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { GET } = await import('@/app/api/auth/google/callback/route');
      const req = new Request(
        'http://localhost:3000/api/auth/google/callback?error=access_denied'
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/sign-in');
      expect(location).toContain('google_denied');
    });
  });

  // -- POST /api/auth/google/complete --

  describe('POST /api/auth/google/complete', () => {
    it('returns 400 when token or workspaceName is missing', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/google/complete/route');
      const req = buildPostRequest('/api/auth/google/complete', {
        workspaceName: 'Test',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/required/i);
    });

    it('rejects expired or invalid tokens', async () => {
      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/google/complete/route');
      const req = buildPostRequest('/api/auth/google/complete', {
        token: 'invalid-jwt-token',
        workspaceName: 'Test Workspace',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/expired|invalid/i);
    });

    it('rejects tokens with wrong purpose claim', async () => {
      // Create a valid JWT but with wrong purpose
      const wrongPurposeToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test',
        purpose: 'password-reset',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(getJwtSecret());

      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/google/complete/route');
      const req = buildPostRequest('/api/auth/google/complete', {
        token: wrongPurposeToken,
        workspaceName: 'Test Workspace',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid/i);
    });

    it('returns 503 when DATABASE_URL is not set', async () => {
      delete process.env.DATABASE_URL;

      const signupToken = await new SignJWT({
        email: 'new@example.com',
        name: 'New User',
        purpose: 'google-signup',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(getJwtSecret());

      vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }));

      const { POST } = await import('@/app/api/auth/google/complete/route');
      const req = buildPostRequest('/api/auth/google/complete', {
        token: signupToken,
        workspaceName: 'My Workspace',
      });
      const res = await POST(req);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/database/i);
    });
  });

  // -- Middleware PUBLIC_PATHS --

  describe('Middleware PUBLIC_PATHS', () => {
    it('includes Google OAuth routes in public paths', async () => {
      // Read the middleware source and verify the paths are present
      const fs = await import('fs');
      const path = await import('path');
      const middlewarePath = path.resolve('src/middleware.ts');
      const source = fs.readFileSync(middlewarePath, 'utf-8');

      expect(source).toContain("'/api/auth/google/login'");
      expect(source).toContain("'/api/auth/google/callback'");
      expect(source).toContain("'/api/auth/google/complete'");
    });
  });
});
