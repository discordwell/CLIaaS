import { describe, it, expect } from 'vitest';

/**
 * Auth bypass tests — verifies protected routes reject unauthenticated requests.
 * These test the requireRole/requireAuth guards.
 */
describe('auth bypass protection', () => {
  it('requireAuth returns error when no user headers present', async () => {
    const { requireAuth } = await import('@/lib/api-auth');

    // Simulate a request with no auth headers and DATABASE_URL set
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    try {
      const request = new Request('http://localhost/api/test', {
        method: 'GET',
      });
      const result = await requireAuth(request);
      expect('error' in result).toBe(true);
    } finally {
      if (originalDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDbUrl;
      }
    }
  });

  it('requireRole returns error for insufficient role', async () => {
    const { requireRole } = await import('@/lib/api-auth');

    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    try {
      const request = new Request('http://localhost/api/test', {
        method: 'GET',
        headers: {
          'x-user-id': 'user-1',
          'x-workspace-id': 'ws-1',
          'x-user-role': 'agent',
        },
      });
      const result = await requireRole(request, 'admin');
      expect('error' in result).toBe(true);
    } finally {
      if (originalDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDbUrl;
      }
    }
  });

  it('demo mode returns DEMO_USER for any request', async () => {
    const { getAuthUser } = await import('@/lib/api-auth');
    // Ensure no DATABASE_URL (demo mode)
    const originalDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const request = new Request('http://localhost/api/test');
      const user = await getAuthUser(request);
      expect(user).toBeDefined();
      expect(user!.role).toBe('admin');
    } finally {
      if (originalDbUrl !== undefined) {
        process.env.DATABASE_URL = originalDbUrl;
      }
    }
  });
});
