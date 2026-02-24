import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Auth enforcement sweep test.
 * Verifies that protected routes return 401 when called without auth headers
 * and with DATABASE_URL set (non-demo mode).
 */

// Helper to create a request without auth headers
function unauthenticatedRequest(
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>,
): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('auth enforcement', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    // Enable auth by setting DATABASE_URL
    process.env.DATABASE_URL = 'postgres://localhost/test';
  });

  afterEach(() => {
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  // Agent-level routes (requireAuth)
  const agentRoutes: Array<{ path: string; method: string; importPath: string; handler: string }> = [
    { path: '/api/tickets', method: 'GET', importPath: '@/app/api/tickets/route', handler: 'GET' },
    { path: '/api/tickets/stats', method: 'GET', importPath: '@/app/api/tickets/stats/route', handler: 'GET' },
    { path: '/api/ai/stats', method: 'GET', importPath: '@/app/api/ai/stats/route', handler: 'GET' },
    { path: '/api/automations', method: 'GET', importPath: '@/app/api/automations/route', handler: 'GET' },
    { path: '/api/custom-fields', method: 'GET', importPath: '@/app/api/custom-fields/route', handler: 'GET' },
    { path: '/api/rules', method: 'GET', importPath: '@/app/api/rules/route', handler: 'GET' },
    { path: '/api/time', method: 'GET', importPath: '@/app/api/time/route', handler: 'GET' },
    { path: '/api/time/report', method: 'GET', importPath: '@/app/api/time/report/route', handler: 'GET' },
    { path: '/api/presence', method: 'GET', importPath: '@/app/api/presence/route', handler: 'GET' },
    { path: '/api/sla', method: 'GET', importPath: '@/app/api/sla/route', handler: 'GET' },
    { path: '/api/kb', method: 'GET', importPath: '@/app/api/kb/route', handler: 'GET' },
    { path: '/api/customers', method: 'GET', importPath: '@/app/api/customers/route', handler: 'GET' },
    { path: '/api/chat/sessions', method: 'GET', importPath: '@/app/api/chat/sessions/route', handler: 'GET' },
  ];

  // Admin-level routes (requireRole admin)
  const adminRoutes: Array<{ path: string; method: string; importPath: string; handler: string }> = [
    { path: '/api/analytics', method: 'GET', importPath: '@/app/api/analytics/route', handler: 'GET' },
    { path: '/api/analytics/export', method: 'GET', importPath: '@/app/api/analytics/export/route', handler: 'GET' },
    { path: '/api/audit', method: 'GET', importPath: '@/app/api/audit/route', handler: 'GET' },
    { path: '/api/audit/export', method: 'GET', importPath: '@/app/api/audit/export/route', handler: 'GET' },
    { path: '/api/connectors', method: 'GET', importPath: '@/app/api/connectors/route', handler: 'GET' },
    { path: '/api/connectors/status', method: 'GET', importPath: '@/app/api/connectors/status/route', handler: 'GET' },
    { path: '/api/compliance', method: 'GET', importPath: '@/app/api/compliance/route', handler: 'GET' },
    { path: '/api/compliance/audit-export', method: 'GET', importPath: '@/app/api/compliance/audit-export/route', handler: 'GET' },
  ];

  describe('agent-level routes return 401 without auth', () => {
    for (const route of agentRoutes) {
      it(`${route.method} ${route.path} returns 401`, async () => {
        const mod = await import(route.importPath);
        const handler = mod[route.handler];
        const req = unauthenticatedRequest(route.path, route.method);
        const res = await handler(req);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toMatch(/authentication required/i);
      });
    }
  });

  describe('admin-level routes return 401 without auth', () => {
    for (const route of adminRoutes) {
      it(`${route.method} ${route.path} returns 401`, async () => {
        const mod = await import(route.importPath);
        const handler = mod[route.handler];
        const req = unauthenticatedRequest(route.path, route.method);
        const res = await handler(req);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toMatch(/authentication required/i);
      });
    }
  });

  describe('admin-level routes return 403 for agent role', () => {
    it('GET /api/analytics returns 403 for agent', async () => {
      const req = new NextRequest('http://localhost:3000/api/analytics', {
        headers: {
          'x-user-id': 'user-1',
          'x-workspace-id': 'ws-1',
          'x-user-role': 'agent',
          'x-user-email': 'agent@test.com',
        },
      });
      const { GET } = await import('@/app/api/analytics/route');
      const res = await GET(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/insufficient permissions/i);
    });
  });
});
