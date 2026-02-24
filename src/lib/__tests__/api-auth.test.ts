import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAuthUser, requireAuth, requireRole } from '@/lib/api-auth';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/test', {
    headers,
  });
}

const ADMIN_HEADERS = {
  'x-user-id': 'user-1',
  'x-workspace-id': 'ws-1',
  'x-user-role': 'admin',
  'x-user-email': 'admin@test.com',
};

const AGENT_HEADERS = {
  'x-user-id': 'user-2',
  'x-workspace-id': 'ws-1',
  'x-user-role': 'agent',
  'x-user-email': 'agent@test.com',
};

const OWNER_HEADERS = {
  'x-user-id': 'user-3',
  'x-workspace-id': 'ws-1',
  'x-user-role': 'owner',
  'x-user-email': 'owner@test.com',
};

describe('api-auth', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  describe('getAuthUser', () => {
    it('returns DEMO_USER when no DATABASE_URL', async () => {
      delete process.env.DATABASE_URL;
      const user = await getAuthUser(makeRequest());
      expect(user).not.toBeNull();
      expect(user!.id).toBe('demo-user');
      expect(user!.role).toBe('admin');
    });

    it('returns user from headers when DATABASE_URL is set', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const user = await getAuthUser(makeRequest(ADMIN_HEADERS));
      expect(user).toEqual({
        id: 'user-1',
        email: 'admin@test.com',
        role: 'admin',
        workspaceId: 'ws-1',
        authType: 'session',
      });
    });

    it('returns null when headers are missing and DATABASE_URL is set', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const user = await getAuthUser(makeRequest());
      expect(user).toBeNull();
    });

    it('defaults role to agent when x-user-role header is missing', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const user = await getAuthUser(makeRequest({
        'x-user-id': 'user-1',
        'x-workspace-id': 'ws-1',
      }));
      expect(user).not.toBeNull();
      expect(user!.role).toBe('agent');
    });
  });

  describe('requireAuth', () => {
    it('returns user when authenticated', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const result = await requireAuth(makeRequest(ADMIN_HEADERS));
      expect('user' in result).toBe(true);
      if ('user' in result) {
        expect(result.user.id).toBe('user-1');
      }
    });

    it('returns 401 error when not authenticated', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      const result = await requireAuth(makeRequest());
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.status).toBe(401);
      }
    });

    it('passes in demo mode (no DATABASE_URL)', async () => {
      delete process.env.DATABASE_URL;
      const result = await requireAuth(makeRequest());
      expect('user' in result).toBe(true);
      if ('user' in result) {
        expect(result.user.id).toBe('demo-user');
      }
    });
  });

  describe('requireRole', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
    });

    it('allows admin for admin-required route', async () => {
      const result = await requireRole(makeRequest(ADMIN_HEADERS), 'admin');
      expect('user' in result).toBe(true);
    });

    it('allows owner for admin-required route', async () => {
      const result = await requireRole(makeRequest(OWNER_HEADERS), 'admin');
      expect('user' in result).toBe(true);
    });

    it('returns 403 for agent on admin-required route', async () => {
      const result = await requireRole(makeRequest(AGENT_HEADERS), 'admin');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.status).toBe(403);
      }
    });

    it('allows agent for agent-required route', async () => {
      const result = await requireRole(makeRequest(AGENT_HEADERS), 'agent');
      expect('user' in result).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      const result = await requireRole(makeRequest(), 'admin');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.status).toBe(401);
      }
    });

    it('passes in demo mode regardless of required role', async () => {
      delete process.env.DATABASE_URL;
      const result = await requireRole(makeRequest(), 'admin');
      expect('user' in result).toBe(true);
      if ('user' in result) {
        expect(result.user.role).toBe('admin');
      }
    });
  });
});
