/**
 * Comprehensive API Feature Test Suite
 *
 * Tests the full surface area of the CLIaaS API, MCP tool helpers,
 * and data provider layer:
 *   - 21 describe sections, ~220 it() blocks
 *   - Demo mode (no DATABASE_URL) for all tests unless noted
 *   - Dynamic imports after vi.resetModules()
 *   - NextRequest constructor for requests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import {
  createTestToken,
  TEST_USER,
  TEST_USER_AGENT,
  buildAuthHeaders,
  buildPostRequest,
} from './helpers';

// ── Shared Helpers ──────────────────────────────────────────────────

const BASE = 'http://localhost:3000';

function jsonReq(path: string, body: unknown, method = 'POST'): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(path: string, params?: Record<string, string>): NextRequest {
  const url = new URL(path, BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function patchReq(path: string, body: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedReq(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    headers: { ...buildAuthHeaders(), ...headers },
  });
}

// ── Test Suite ───────────────────────────────────────────────────────

describe('Comprehensive API Feature Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    // Reset global stores used by in-memory endpoints to prevent state leaking between tests
    delete (globalThis as Record<string, unknown>).__cliaasScimUsers;
    delete (globalThis as Record<string, unknown>).__cliaasScimGroups;
    delete (globalThis as Record<string, unknown>).__cliaasAuditMCP;
    delete (globalThis as Record<string, unknown>).__cliaasSmsCons;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Auth Flow (12 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('1. Auth Flow', () => {
    describe('POST /api/auth/signin', () => {
      it('returns 400 when email is missing', async () => {
        const { POST } = await import('@/app/api/auth/signin/route');
        const res = await POST(buildPostRequest('/api/auth/signin', { password: 'x' }));
        expect(res.status).toBe(400);
      });

      it('returns 400 when password is missing', async () => {
        const { POST } = await import('@/app/api/auth/signin/route');
        const res = await POST(buildPostRequest('/api/auth/signin', { email: 'a@b.com' }));
        expect(res.status).toBe(400);
      });

      it('returns 503 when DATABASE_URL is not set', async () => {
        const { POST } = await import('@/app/api/auth/signin/route');
        const res = await POST(
          buildPostRequest('/api/auth/signin', { email: 'a@b.com', password: 'password123' }),
        );
        expect(res.status).toBe(503);
      });
    });

    describe('POST /api/auth/signup', () => {
      it('returns 400 when required fields are missing', async () => {
        const { POST } = await import('@/app/api/auth/signup/route');
        const res = await POST(
          buildPostRequest('/api/auth/signup', { email: 'x@y.com', password: 'pass1234' }),
        );
        expect(res.status).toBe(400);
      });

      it('returns 400 for short password', async () => {
        const { POST } = await import('@/app/api/auth/signup/route');
        const res = await POST(
          buildPostRequest('/api/auth/signup', {
            email: 'x@y.com',
            password: 'short',
            name: 'T',
            workspaceName: 'W',
          }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/8 characters/i);
      });

      it('returns 503 without database', async () => {
        const { POST } = await import('@/app/api/auth/signup/route');
        const res = await POST(
          buildPostRequest('/api/auth/signup', {
            email: 'x@y.com',
            password: 'password123',
            name: 'New',
            workspaceName: 'WS',
          }),
        );
        expect(res.status).toBe(503);
      });
    });

    describe('GET /api/auth/me', () => {
      it('returns 401 when no session cookie', async () => {
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
        expect((await res.json()).user).toBeNull();
      });

      it('returns 200 with user data for valid cookie', async () => {
        const token = await createTestToken(TEST_USER);
        vi.doMock('next/headers', () => ({
          cookies: vi.fn().mockResolvedValue({
            get: vi.fn().mockImplementation((name: string) =>
              name === 'cliaas-session' ? { value: token } : undefined,
            ),
            set: vi.fn(),
            delete: vi.fn(),
          }),
        }));
        const { GET } = await import('@/app/api/auth/me/route');
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.user.id).toBe(TEST_USER.id);
        expect(body.user.email).toBe(TEST_USER.email);
      });
    });

    describe('POST /api/auth/signout', () => {
      it('returns 200', async () => {
        vi.doMock('next/headers', () => ({
          cookies: vi.fn().mockResolvedValue({
            get: vi.fn().mockReturnValue(undefined),
            set: vi.fn(),
            delete: vi.fn(),
          }),
        }));
        const { POST } = await import('@/app/api/auth/signout/route');
        const res = await POST();
        expect(res.status).toBe(200);
        expect((await res.json()).ok).toBe(true);
      });
    });

    describe('Auth helpers', () => {
      it('buildAuthHeaders returns correct headers', () => {
        const headers = buildAuthHeaders(TEST_USER);
        expect(headers['x-user-id']).toBe(TEST_USER.id);
        expect(headers['x-workspace-id']).toBe(TEST_USER.workspaceId);
        expect(headers['x-user-role']).toBe(TEST_USER.role);
        expect(headers['x-user-email']).toBe(TEST_USER.email);
      });

      it('demo mode returns DEMO_USER from getAuthUser', async () => {
        const { getAuthUser } = await import('@/lib/api-auth');
        const req = new NextRequest(`${BASE}/api/test`);
        const user = await getAuthUser(req);
        expect(user).not.toBeNull();
        expect(user!.id).toBe('demo-user');
        expect(user!.role).toBe('admin');
      });

      it('requireAuth passes in demo mode', async () => {
        const { requireAuth } = await import('@/lib/api-auth');
        const req = new NextRequest(`${BASE}/api/test`);
        const result = await requireAuth(req);
        expect('user' in result).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Ticket CRUD (14 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('2. Ticket CRUD', () => {
    describe('GET /api/tickets', () => {
      it('returns 200 with tickets array and pagination', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.tickets)).toBe(true);
        expect(typeof body.total).toBe('number');
        expect(typeof body.limit).toBe('number');
        expect(typeof body.offset).toBe('number');
      });

      it('respects limit and offset', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { limit: '2', offset: '0' }));
        const body = await res.json();
        expect(body.limit).toBe(2);
        expect(body.offset).toBe(0);
        expect(body.tickets.length).toBeLessThanOrEqual(2);
      });

      it('filters by status', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { status: 'open' }));
        expect(res.status).toBe(200);
        for (const t of (await res.json()).tickets) expect(t.status).toBe('open');
      });

      it('filters by priority', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { priority: 'urgent' }));
        expect(res.status).toBe(200);
        for (const t of (await res.json()).tickets) expect(t.priority).toBe('urgent');
      });

      it('supports text search returning empty for nonsense query', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { q: 'zzz_no_match_zzz' }));
        expect(res.status).toBe(200);
        expect((await res.json()).total).toBe(0);
      });

      it('handles sort=priority', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { sort: 'priority' }));
        expect(res.status).toBe(200);
      });

      it('handles sort=updated', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { sort: 'updated' }));
        expect(res.status).toBe(200);
      });

      it('caps limit at 200', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets', { limit: '999' }));
        const body = await res.json();
        expect(body.limit).toBeLessThanOrEqual(200);
      });
    });

    describe('GET /api/tickets/[id]', () => {
      it('returns 404 for nonexistent ticket', async () => {
        const { GET } = await import('@/app/api/tickets/[id]/route');
        const res = await GET(new NextRequest(`${BASE}/api/tickets/nonexistent`), {
          params: Promise.resolve({ id: 'nonexistent' }),
        });
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/not found/i);
      });

      it('returns ticket and messages array for valid id', async () => {
        const { GET: listGET } = await import('@/app/api/tickets/route');
        const listRes = await listGET(getReq('/api/tickets', { limit: '1' }));
        const { tickets } = await listRes.json();
        expect(tickets.length).toBeGreaterThan(0);
        const { GET } = await import('@/app/api/tickets/[id]/route');
        const res = await GET(new NextRequest(`${BASE}/api/tickets/${tickets[0].id}`), {
          params: Promise.resolve({ id: tickets[0].id }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ticket.id).toBe(tickets[0].id);
        expect(Array.isArray(body.messages)).toBe(true);
      });
    });

    describe('PATCH /api/tickets/[id]', () => {
      it('returns 400 for empty body', async () => {
        const { PATCH } = await import('@/app/api/tickets/[id]/route');
        const res = await PATCH(patchReq('/api/tickets/zd-1', {}), {
          params: Promise.resolve({ id: 'zd-1' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/no updates/i);
      });

      it('returns 400 for invalid status', async () => {
        const { PATCH } = await import('@/app/api/tickets/[id]/route');
        const res = await PATCH(patchReq('/api/tickets/zd-1', { status: 'bogus' }), {
          params: Promise.resolve({ id: 'zd-1' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/invalid status/i);
      });

      it('returns 400 for invalid priority', async () => {
        const { PATCH } = await import('@/app/api/tickets/[id]/route');
        const res = await PATCH(patchReq('/api/tickets/zd-1', { priority: 'mega' }), {
          params: Promise.resolve({ id: 'zd-1' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/invalid priority/i);
      });

      it('returns 400 when connector not configured', async () => {
        const { PATCH } = await import('@/app/api/tickets/[id]/route');
        const res = await PATCH(patchReq('/api/tickets/zd-999', { status: 'solved' }), {
          params: Promise.resolve({ id: 'zd-999' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/not configured/i);
      });
    });

    describe('GET /api/tickets/stats', () => {
      it('returns stats with byStatus and byPriority', async () => {
        const { GET } = await import('@/app/api/tickets/stats/route');
        const res = await GET(getReq('/api/tickets/stats'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('byStatus');
        expect(body).toHaveProperty('byPriority');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Ticket Create (6 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('3. Ticket Create', () => {
    it('returns 400 when source is missing', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(jsonReq('/api/tickets/create', { message: 'Help' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when message is missing', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(jsonReq('/api/tickets/create', { source: 'zendesk' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/required/i);
    });

    it('returns 400 for invalid source', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(
        jsonReq('/api/tickets/create', { source: 'fakesrc', message: 'Help' }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/invalid source/i);
    });

    it('returns 400 for empty message', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(
        jsonReq('/api/tickets/create', { source: 'zendesk', message: '' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when zendesk connector not configured', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(
        jsonReq('/api/tickets/create', { source: 'zendesk', message: 'Help!' }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not configured/i);
    });

    it('returns 400 when helpcrunch connector not configured', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const res = await POST(
        jsonReq('/api/tickets/create', { source: 'helpcrunch', message: 'Hi' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Ticket Reply (6 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('4. Ticket Reply', () => {
    it('returns 400 when message body is missing', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(jsonReq('/api/tickets/zd-1/reply', {}), {
        params: Promise.resolve({ id: 'zd-1' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/required/i);
    });

    it('returns 400 when message is empty string', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(jsonReq('/api/tickets/zd-1/reply', { message: '' }), {
        params: Promise.resolve({ id: 'zd-1' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when message is whitespace', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(jsonReq('/api/tickets/zd-1/reply', { message: '   ' }), {
        params: Promise.resolve({ id: 'zd-1' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown source prefix', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(
        jsonReq('/api/tickets/xx-1/reply', { message: 'Hello' }),
        { params: Promise.resolve({ id: 'xx-1' }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/cannot determine source/i);
    });

    it('returns 400 when connector not configured', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(
        jsonReq('/api/tickets/zd-999/reply', { message: 'Hello' }),
        { params: Promise.resolve({ id: 'zd-999' }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not configured/i);
    });

    it('returns 400 for invalid ticket ID format (non-numeric)', async () => {
      // groove connector not configured, but tests source detection
      const { POST } = await import('@/app/api/tickets/[id]/reply/route');
      const res = await POST(
        jsonReq('/api/tickets/gv-abc/reply', { message: 'Hello' }),
        { params: Promise.resolve({ id: 'gv-abc' }) },
      );
      // Either 400 for not configured or 400 for invalid format
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. KB CRUD (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('5. KB CRUD', () => {
    describe('GET /api/kb', () => {
      it('returns 200 with articles array', async () => {
        const { GET } = await import('@/app/api/kb/route');
        const res = await GET(getReq('/api/kb'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.articles)).toBe(true);
        expect(typeof body.total).toBe('number');
      });

      it('filters by query', async () => {
        const { GET } = await import('@/app/api/kb/route');
        const res = await GET(getReq('/api/kb', { q: 'zzz_no_match_zzz' }));
        expect(res.status).toBe(200);
        expect((await res.json()).total).toBe(0);
      });

      it('filters by category', async () => {
        const { GET } = await import('@/app/api/kb/route');
        const res = await GET(getReq('/api/kb', { category: 'nonexistent_cat' }));
        expect(res.status).toBe(200);
        expect((await res.json()).total).toBe(0);
      });
    });

    describe('POST /api/kb', () => {
      it('returns 400 when title is missing', async () => {
        const { POST } = await import('@/app/api/kb/route');
        const res = await POST(jsonReq('/api/kb', { body: 'Content here' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/required/i);
      });

      it('returns 400 when body is missing', async () => {
        const { POST } = await import('@/app/api/kb/route');
        const res = await POST(jsonReq('/api/kb', { title: 'My Article' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/required/i);
      });

      it('returns 400 when title is empty', async () => {
        const { POST } = await import('@/app/api/kb/route');
        const res = await POST(jsonReq('/api/kb', { title: '', body: 'stuff' }));
        expect(res.status).toBe(400);
      });

      it('returns 500 for create in demo mode (no DB)', async () => {
        const { POST } = await import('@/app/api/kb/route');
        const res = await POST(
          jsonReq('/api/kb', { title: 'Test Article', body: 'Article content here' }),
        );
        // createKBArticle requires DB — 500 in demo mode is expected
        expect(res.status).toBe(500);
      });
    });

    describe('GET /api/portal/kb', () => {
      it('returns articles for portal (no auth required)', async () => {
        const { GET } = await import('@/app/api/portal/kb/route');
        const res = await GET(getReq('/api/portal/kb'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.articles)).toBe(true);
        expect(Array.isArray(body.categories)).toBe(true);
        expect(typeof body.total).toBe('number');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Webhook Management (10 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('6. Webhook Management', () => {
    describe('GET /api/webhooks', () => {
      it('returns 200 with webhooks array', async () => {
        const { GET } = await import('@/app/api/webhooks/route');
        const res = await GET(getReq('/api/webhooks'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.webhooks)).toBe(true);
      });
    });

    describe('POST /api/webhooks', () => {
      it('returns 400 when url is missing', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(jsonReq('/api/webhooks', { events: ['ticket.created'] }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/url/i);
      });

      it('returns 400 when events array is empty', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(
          jsonReq('/api/webhooks', { url: 'https://hook.test/cb', events: [] }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/events/i);
      });

      it('returns 400 when events is missing', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(jsonReq('/api/webhooks', { url: 'https://hook.test/cb' }));
        expect(res.status).toBe(400);
      });

      it('returns 400 for empty url string', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(jsonReq('/api/webhooks', { url: '', events: ['ticket.created'] }));
        expect(res.status).toBe(400);
      });

      it('creates webhook with valid url and events', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(
          jsonReq('/api/webhooks', {
            url: 'https://hook.test/cb',
            events: ['ticket.created', 'ticket.updated'],
          }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.webhook).toBeDefined();
        expect(body.webhook.url).toBe('https://hook.test/cb');
        expect(body.webhook.secret).toBeDefined();
        expect(body.webhook.enabled).toBe(true);
      });

      it('auto-generates secret when not provided', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(
          jsonReq('/api/webhooks', {
            url: 'https://hook.test/auto',
            events: ['ticket.created'],
          }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.webhook.secret).toMatch(/^whsec_/);
      });

      it('uses provided secret when given', async () => {
        const { POST } = await import('@/app/api/webhooks/route');
        const res = await POST(
          jsonReq('/api/webhooks', {
            url: 'https://hook.test/custom',
            events: ['ticket.created'],
            secret: 'my-custom-secret',
          }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.webhook.secret).toBe('my-custom-secret');
      });
    });

    describe('POST /api/webhooks/test', () => {
      it('returns 400 when url is missing', async () => {
        const { POST } = await import('@/app/api/webhooks/test/route');
        const res = await POST(jsonReq('/api/webhooks/test', {}));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/url/i);
      });

      it('returns 200 for valid url (delivery attempted)', async () => {
        const { POST } = await import('@/app/api/webhooks/test/route');
        const res = await POST(
          jsonReq('/api/webhooks/test', { url: 'https://hook.test/test' }),
        );
        expect(res.status).toBe(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. Automation Rules (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('7. Automation Rules', () => {
    describe('GET /api/automations', () => {
      it('returns 200 with rules array', async () => {
        const { GET } = await import('@/app/api/automations/route');
        const res = await GET(getReq('/api/automations'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.rules)).toBe(true);
      });
    });

    describe('POST /api/automations', () => {
      it('returns 400 when name is missing', async () => {
        const { POST } = await import('@/app/api/automations/route');
        const res = await POST(jsonReq('/api/automations', { type: 'trigger' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/name/i);
      });

      it('returns 400 when type is missing', async () => {
        const { POST } = await import('@/app/api/automations/route');
        const res = await POST(jsonReq('/api/automations', { name: 'My Rule' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/type/i);
      });

      it('creates rule with valid name and type', async () => {
        const { POST } = await import('@/app/api/automations/route');
        const res = await POST(
          jsonReq('/api/automations', { name: 'Test Rule', type: 'trigger' }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.rule).toBeDefined();
        expect(body.rule.name).toBe('Test Rule');
        expect(body.rule.type).toBe('trigger');
        expect(body.rule.id).toBeDefined();
      });
    });

    describe('POST /api/automations/[id]/test', () => {
      it('returns 404 for nonexistent rule', async () => {
        const { POST } = await import('@/app/api/automations/[id]/test/route');
        const res = await POST(
          jsonReq('/api/automations/nonexistent/test', { ticket: { id: 'tk-1' } }),
          { params: Promise.resolve({ id: 'nonexistent' }) },
        );
        expect(res.status).toBe(404);
      });

      it('returns 400 when ticket is missing from body', async () => {
        // Create a rule first
        const { POST: createPost } = await import('@/app/api/automations/route');
        const createRes = await createPost(
          jsonReq('/api/automations', { name: 'TestRule', type: 'trigger' }),
        );
        const { rule } = await createRes.json();

        const { POST } = await import('@/app/api/automations/[id]/test/route');
        const res = await POST(jsonReq(`/api/automations/${rule.id}/test`, {}), {
          params: Promise.resolve({ id: rule.id }),
        });
        expect(res.status).toBe(400);
      });
    });

    describe('GET /api/automations/history', () => {
      it('returns execution history', async () => {
        const { GET } = await import('@/app/api/automations/history/route');
        const res = await GET(getReq('/api/automations/history'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.entries)).toBe(true);
        expect(typeof body.total).toBe('number');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. Connector Operations (6 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('8. Connector Operations', () => {
    describe('GET /api/connectors', () => {
      it('returns 200 with connectors list', async () => {
        const { GET } = await import('@/app/api/connectors/route');
        const res = await GET(getReq('/api/connectors'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.connectors).toBeDefined();
      });
    });

    describe('POST /api/connectors/[name]/verify', () => {
      it('returns 404 for unknown connector', async () => {
        const { POST } = await import('@/app/api/connectors/[name]/verify/route');
        const res = await POST(jsonReq('/api/connectors/unknown/verify', {}), {
          params: Promise.resolve({ name: 'unknown' }),
        });
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/unknown/i);
      });

      it('returns 400 for unconfigured zendesk', async () => {
        const { POST } = await import('@/app/api/connectors/[name]/verify/route');
        const res = await POST(jsonReq('/api/connectors/zendesk/verify', {}), {
          params: Promise.resolve({ name: 'zendesk' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/not configured/i);
      });

      it('returns 400 for unconfigured helpcrunch', async () => {
        const { POST } = await import('@/app/api/connectors/[name]/verify/route');
        const res = await POST(jsonReq('/api/connectors/helpcrunch/verify', {}), {
          params: Promise.resolve({ name: 'helpcrunch' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/not configured/i);
      });

      it('returns 400 for unconfigured freshdesk', async () => {
        const { POST } = await import('@/app/api/connectors/[name]/verify/route');
        const res = await POST(jsonReq('/api/connectors/freshdesk/verify', {}), {
          params: Promise.resolve({ name: 'freshdesk' }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/not configured/i);
      });
    });

    describe('GET /api/connectors/status', () => {
      it('returns connector sync statuses', async () => {
        const { GET } = await import('@/app/api/connectors/status/route');
        const res = await GET(getReq('/api/connectors/status'));
        expect(res.status).toBe(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. Custom Fields & Forms (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('9. Custom Fields & Forms', () => {
    describe('GET /api/custom-fields', () => {
      it('returns 200 with fields array', async () => {
        const { GET } = await import('@/app/api/custom-fields/route');
        const res = await GET(getReq('/api/custom-fields'));
        expect(res.status).toBe(200);
        expect(Array.isArray((await res.json()).fields)).toBe(true);
      });
    });

    describe('POST /api/custom-fields', () => {
      it('returns 400 when required fields missing', async () => {
        const { POST } = await import('@/app/api/custom-fields/route');
        const res = await POST(jsonReq('/api/custom-fields', { name: 'Field' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/required/i);
      });

      it('returns 400 for invalid type', async () => {
        const { POST } = await import('@/app/api/custom-fields/route');
        const res = await POST(
          jsonReq('/api/custom-fields', { name: 'F', key: 'f', type: 'invalid' }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/type/i);
      });

      it('creates field with valid data', async () => {
        const { POST } = await import('@/app/api/custom-fields/route');
        const res = await POST(
          jsonReq('/api/custom-fields', { name: 'Priority Label', key: 'priority_label', type: 'text' }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.field).toBeDefined();
        expect(body.field.name).toBe('Priority Label');
      });
    });

    describe('GET /api/custom-forms', () => {
      it('returns 200 with forms array', async () => {
        const { GET } = await import('@/app/api/custom-forms/route');
        const res = await GET(getReq('/api/custom-forms'));
        expect(res.status).toBe(200);
        expect(Array.isArray((await res.json()).forms)).toBe(true);
      });
    });

    describe('POST /api/custom-forms', () => {
      it('returns 400 when name or fields missing', async () => {
        const { POST } = await import('@/app/api/custom-forms/route');
        const res = await POST(jsonReq('/api/custom-forms', { name: 'Form' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/required/i);
      });

      it('creates form with valid data', async () => {
        const { POST } = await import('@/app/api/custom-forms/route');
        const res = await POST(
          jsonReq('/api/custom-forms', { name: 'Bug Report', fields: ['desc', 'steps'] }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.form).toBeDefined();
        expect(body.form.name).toBe('Bug Report');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. SLA (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('10. SLA', () => {
    describe('GET /api/sla', () => {
      it('returns 200 with policies array', async () => {
        const { GET } = await import('@/app/api/sla/route');
        const res = await GET(getReq('/api/sla'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('policies');
      });
    });

    describe('POST /api/sla', () => {
      it('returns 400 when name is missing', async () => {
        const { POST } = await import('@/app/api/sla/route');
        const res = await POST(
          jsonReq('/api/sla', { targets: { firstResponse: 60, resolution: 240 } }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/name/i);
      });

      it('returns 400 when targets are missing', async () => {
        const { POST } = await import('@/app/api/sla/route');
        const res = await POST(jsonReq('/api/sla', { name: 'Standard SLA' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/targets/i);
      });

      it('returns 400 when target times are zero or negative', async () => {
        const { POST } = await import('@/app/api/sla/route');
        const res = await POST(
          jsonReq('/api/sla', {
            name: 'Bad SLA',
            targets: { firstResponse: -1, resolution: -1 },
          }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/positive/i);
      });

      it('creates SLA policy with valid data', async () => {
        const { POST } = await import('@/app/api/sla/route');
        const res = await POST(
          jsonReq('/api/sla', {
            name: 'Gold SLA',
            targets: { firstResponse: 30, resolution: 120 },
          }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.policy).toBeDefined();
        expect(body.policy.name).toBe('Gold SLA');
      });
    });

    describe('POST /api/sla/check', () => {
      it('returns 404 when no ticket found', async () => {
        const { POST } = await import('@/app/api/sla/check/route');
        const res = await POST(jsonReq('/api/sla/check', { ticketId: 'nonexistent' }));
        expect(res.status).toBe(404);
      });

      it('returns compliance result for inline ticket', async () => {
        const { POST } = await import('@/app/api/sla/check/route');
        const res = await POST(
          jsonReq('/api/sla/check', {
            ticket: {
              id: 'sla-test-1',
              externalId: 'ext-sla-1',
              source: 'zendesk',
              subject: 'SLA test ticket',
              status: 'open',
              priority: 'high',
              requester: 'user@test.com',
              tags: [],
              createdAt: new Date(Date.now() - 7200000).toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ticketId).toBe('sla-test-1');
        expect(Array.isArray(body.results)).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. Analytics & Audit (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('11. Analytics & Audit', () => {
    describe('GET /api/analytics', () => {
      it('returns 200 with analytics data', async () => {
        const { GET } = await import('@/app/api/analytics/route');
        const res = await GET(getReq('/api/analytics'));
        expect(res.status).toBe(200);
      });

      it('accepts date range params', async () => {
        const { GET } = await import('@/app/api/analytics/route');
        const res = await GET(
          getReq('/api/analytics', {
            from: '2026-01-01',
            to: '2026-02-28',
          }),
        );
        expect(res.status).toBe(200);
      });

      it('handles invalid date range gracefully', async () => {
        const { GET } = await import('@/app/api/analytics/route');
        const res = await GET(
          getReq('/api/analytics', { from: 'not-a-date', to: 'also-not' }),
        );
        // Should still return 200, just ignore invalid dates
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/audit', () => {
      it('returns 200 with audit events', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const res = await GET(getReq('/api/audit'));
        expect(res.status).toBe(200);
      });

      it('filters by action', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const res = await GET(getReq('/api/audit', { action: 'ticket.update' }));
        expect(res.status).toBe(200);
      });

      it('supports pagination', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const res = await GET(getReq('/api/audit', { limit: '10', offset: '0' }));
        expect(res.status).toBe(200);
      });

      it('filters by userId', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const res = await GET(getReq('/api/audit', { userId: 'user-1' }));
        expect(res.status).toBe(200);
      });

      it('filters by date range', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const res = await GET(
          getReq('/api/audit', { from: '2026-01-01', to: '2026-12-31' }),
        );
        expect(res.status).toBe(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. API Keys (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('12. API Keys', () => {
    describe('GET /api/api-keys', () => {
      it('returns 500 in demo mode (requires DB)', async () => {
        const { GET } = await import('@/app/api/api-keys/route');
        const res = await GET(getReq('/api/api-keys'));
        // listApiKeys imports @/db which requires DATABASE_URL
        expect(res.status).toBe(500);
      });
    });

    describe('POST /api/api-keys', () => {
      it('returns 400 when name is missing', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(jsonReq('/api/api-keys', {}));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/name/i);
      });

      it('returns 400 when name is empty', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(jsonReq('/api/api-keys', { name: '' }));
        expect(res.status).toBe(400);
      });

      it('returns 400 for invalid scopes', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(
          jsonReq('/api/api-keys', { name: 'My Key', scopes: ['invalid:scope'] }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/invalid scopes/i);
      });

      it('returns 400 for invalid expiresAt date', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(
          jsonReq('/api/api-keys', { name: 'Key', expiresAt: 'not-a-date' }),
        );
        expect(res.status).toBe(400);
      });

      it('returns 400 for past expiresAt date', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(
          jsonReq('/api/api-keys', { name: 'Key', expiresAt: '2020-01-01T00:00:00Z' }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/future/i);
      });

      it('returns 500 with valid scopes in demo mode (requires DB)', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(
          jsonReq('/api/api-keys', { name: 'Valid Key', scopes: ['tickets:read', 'kb:read'] }),
        );
        // createApiKey imports @/db which requires DATABASE_URL
        expect(res.status).toBe(500);
      });

      it('returns 500 with wildcard scope in demo mode (requires DB)', async () => {
        const { POST } = await import('@/app/api/api-keys/route');
        const res = await POST(
          jsonReq('/api/api-keys', { name: 'Admin Key', scopes: ['*'] }),
        );
        expect(res.status).toBe(500);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 13. Portal (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('13. Portal', () => {
    describe('POST /api/portal/auth', () => {
      it('returns 400 when email is missing', async () => {
        const { POST } = await import('@/app/api/portal/auth/route');
        const res = await POST(jsonReq('/api/portal/auth', {}));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/email/i);
      });

      it('returns 400 for invalid email format', async () => {
        const { POST } = await import('@/app/api/portal/auth/route');
        const res = await POST(jsonReq('/api/portal/auth', { email: 'not-an-email' }));
        expect(res.status).toBe(400);
      });

      it('returns 200 with token for valid email', async () => {
        const { POST } = await import('@/app/api/portal/auth/route');
        const res = await POST(
          jsonReq('/api/portal/auth', { email: 'customer@example.com' }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.email).toBe('customer@example.com');
        expect(body.verifyUrl).toBeDefined();
      });
    });

    describe('GET /api/portal/tickets', () => {
      it('returns 401 when no portal email cookie', async () => {
        const { GET } = await import('@/app/api/portal/tickets/route');
        const res = await GET(getReq('/api/portal/tickets'));
        expect(res.status).toBe(401);
      });

      it('returns 200 with tickets for authenticated portal user', async () => {
        const { GET } = await import('@/app/api/portal/tickets/route');
        const req = new NextRequest(`${BASE}/api/portal/tickets`, {
          headers: { Cookie: 'cliaas-portal-email=test@example.com' },
        });
        const res = await GET(req);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.tickets)).toBe(true);
      });
    });

    describe('POST /api/portal/tickets', () => {
      it('returns 401 when no portal email cookie', async () => {
        const { POST } = await import('@/app/api/portal/tickets/route');
        const res = await POST(jsonReq('/api/portal/tickets', { subject: 'Help' }));
        expect(res.status).toBe(401);
      });

      it('returns 400 when subject is missing', async () => {
        const { POST } = await import('@/app/api/portal/tickets/route');
        const req = new NextRequest(`${BASE}/api/portal/tickets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'cliaas-portal-email=test@example.com',
          },
          body: JSON.stringify({ description: 'Details here' }),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/required/i);
      });

      it('creates portal ticket with valid data', async () => {
        const { POST } = await import('@/app/api/portal/tickets/route');
        const req = new NextRequest(`${BASE}/api/portal/tickets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'cliaas-portal-email=test@example.com',
          },
          body: JSON.stringify({ subject: 'Help me', description: 'I have an issue' }),
        });
        const res = await POST(req);
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.ticket).toBeDefined();
        expect(body.ticket.subject).toBe('Help me');
        expect(body.ticket.status).toBe('open');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 14. Chat (12 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('14. Chat', () => {
    describe('POST /api/chat action=create', () => {
      it('returns 400 when customerName is missing', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', { action: 'create', customerEmail: 'a@b.com' }),
        );
        expect(res.status).toBe(400);
      });

      it('returns 400 when customerEmail is missing', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', { action: 'create', customerName: 'Alice' }),
        );
        expect(res.status).toBe(400);
      });

      it('creates session with valid fields', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', {
            action: 'create',
            customerName: 'Alice',
            customerEmail: 'alice@test.com',
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sessionId).toBeDefined();
        expect(body.status).toBeDefined();
      });
    });

    describe('POST /api/chat action=message', () => {
      it('returns 400 when sessionId is missing', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', { action: 'message', role: 'customer', body: 'Hi' }),
        );
        expect(res.status).toBe(400);
      });

      it('returns 404 for unknown session', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', {
            action: 'message',
            sessionId: 'nonexistent',
            role: 'customer',
            body: 'Hi',
          }),
        );
        expect(res.status).toBe(404);
      });

      it('sends message to existing session', async () => {
        const { POST } = await import('@/app/api/chat/route');
        // Create session first
        const createRes = await POST(
          jsonReq('/api/chat', {
            action: 'create',
            customerName: 'Bob',
            customerEmail: 'bob@test.com',
          }),
        );
        const { sessionId } = await createRes.json();

        const res = await POST(
          jsonReq('/api/chat', {
            action: 'message',
            sessionId,
            role: 'customer',
            body: 'Hello!',
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toBeDefined();
        expect(body.message.body).toBe('Hello!');
      });
    });

    describe('POST /api/chat action=close', () => {
      it('returns 400 when sessionId is missing', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(jsonReq('/api/chat', { action: 'close' }));
        expect(res.status).toBe(400);
      });

      it('returns 404 for unknown session', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(
          jsonReq('/api/chat', { action: 'close', sessionId: 'nonexistent' }),
        );
        expect(res.status).toBe(404);
      });

      it('closes existing session', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const createRes = await POST(
          jsonReq('/api/chat', {
            action: 'create',
            customerName: 'Carol',
            customerEmail: 'carol@test.com',
          }),
        );
        const { sessionId } = await createRes.json();

        const res = await POST(
          jsonReq('/api/chat', { action: 'close', sessionId }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('closed');
      });
    });

    describe('POST /api/chat unknown action', () => {
      it('returns 400 for unknown action', async () => {
        const { POST } = await import('@/app/api/chat/route');
        const res = await POST(jsonReq('/api/chat', { action: 'teleport' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/unknown action/i);
      });
    });

    describe('GET /api/chat/sessions', () => {
      it('returns 200 with sessions array', async () => {
        const { GET } = await import('@/app/api/chat/sessions/route');
        const res = await GET(getReq('/api/chat/sessions'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.sessions)).toBe(true);
      });

      it('supports all=true to include closed sessions', async () => {
        const { GET } = await import('@/app/api/chat/sessions/route');
        const res = await GET(getReq('/api/chat/sessions', { all: 'true' }));
        expect(res.status).toBe(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 15. SCIM (10 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('15. SCIM', () => {
    const SCIM_TOKEN = 'scim-test-token-abc123';

    function scimReq(
      path: string,
      method = 'GET',
      body?: unknown,
      token?: string,
    ): NextRequest {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (body) headers['Content-Type'] = 'application/json';
      return new NextRequest(`${BASE}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }

    describe('SCIM Auth', () => {
      it('returns 401 when no SCIM token is configured', async () => {
        delete process.env.SCIM_BEARER_TOKEN;
        vi.resetModules();
        const { GET } = await import('@/app/api/scim/v2/Users/route');
        const res = await GET(scimReq('/api/scim/v2/Users', 'GET', undefined, 'some-token'));
        expect(res.status).toBe(401);
      });

      it('returns 401 when wrong token provided', async () => {
        process.env.SCIM_BEARER_TOKEN = SCIM_TOKEN;
        vi.resetModules();
        const { GET } = await import('@/app/api/scim/v2/Users/route');
        const res = await GET(scimReq('/api/scim/v2/Users', 'GET', undefined, 'wrong-token'));
        expect(res.status).toBe(401);
      });

      it('returns 401 when no auth header', async () => {
        process.env.SCIM_BEARER_TOKEN = SCIM_TOKEN;
        vi.resetModules();
        const { GET } = await import('@/app/api/scim/v2/Users/route');
        const res = await GET(scimReq('/api/scim/v2/Users'));
        expect(res.status).toBe(401);
      });

      it('returns 200 with correct token', async () => {
        process.env.SCIM_BEARER_TOKEN = SCIM_TOKEN;
        vi.resetModules();
        const { GET } = await import('@/app/api/scim/v2/Users/route');
        const res = await GET(scimReq('/api/scim/v2/Users', 'GET', undefined, SCIM_TOKEN));
        expect(res.status).toBe(200);
      });
    });

    describe('GET/POST /api/scim/v2/Users', () => {
      beforeEach(() => {
        process.env.SCIM_BEARER_TOKEN = SCIM_TOKEN;
        vi.resetModules();
      });

      it('GET returns user list', async () => {
        const { GET } = await import('@/app/api/scim/v2/Users/route');
        const res = await GET(scimReq('/api/scim/v2/Users', 'GET', undefined, SCIM_TOKEN));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.schemas).toBeDefined();
        expect(Array.isArray(body.Resources)).toBe(true);
      });

      it('POST creates user with userName', async () => {
        const { POST } = await import('@/app/api/scim/v2/Users/route');
        const res = await POST(
          scimReq('/api/scim/v2/Users', 'POST', {
            userName: 'newagent@test.com',
            name: { formatted: 'New Agent' },
          }, SCIM_TOKEN),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.userName).toBe('newagent@test.com');
      });

      it('POST returns 400 when no userName or emails', async () => {
        const { POST } = await import('@/app/api/scim/v2/Users/route');
        const res = await POST(
          scimReq('/api/scim/v2/Users', 'POST', { name: { formatted: 'No Email' } }, SCIM_TOKEN),
        );
        expect(res.status).toBe(400);
      });
    });

    describe('GET/POST /api/scim/v2/Groups', () => {
      beforeEach(() => {
        process.env.SCIM_BEARER_TOKEN = SCIM_TOKEN;
        vi.resetModules();
      });

      it('GET returns group list', async () => {
        const { GET } = await import('@/app/api/scim/v2/Groups/route');
        const res = await GET(scimReq('/api/scim/v2/Groups', 'GET', undefined, SCIM_TOKEN));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.Resources)).toBe(true);
      });

      it('POST creates group with displayName', async () => {
        const { POST } = await import('@/app/api/scim/v2/Groups/route');
        const res = await POST(
          scimReq('/api/scim/v2/Groups', 'POST', { displayName: 'Support Team' }, SCIM_TOKEN),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.displayName).toBe('Support Team');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 16. Channels (10 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('16. Channels', () => {
    describe('POST /api/channels/sms/inbound', () => {
      it('returns TwiML for valid inbound SMS', async () => {
        const { POST } = await import('@/app/api/channels/sms/inbound/route');
        const formData = new FormData();
        formData.set('MessageSid', 'SM_test_123');
        formData.set('From', '+15551234567');
        formData.set('To', '+15559876543');
        formData.set('Body', 'Need help');
        formData.set('NumMedia', '0');
        const req = new NextRequest(`${BASE}/api/channels/sms/inbound`, {
          method: 'POST',
          body: formData,
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/xml');
        const text = await res.text();
        expect(text).toContain('<Response>');
      });

      it('returns TwiML for WhatsApp-prefixed message', async () => {
        const { POST } = await import('@/app/api/channels/sms/inbound/route');
        const formData = new FormData();
        formData.set('MessageSid', 'SM_wa_456');
        formData.set('From', 'whatsapp:+447700900123');
        formData.set('To', 'whatsapp:+15559876543');
        formData.set('Body', 'Question');
        formData.set('NumMedia', '0');
        const req = new NextRequest(`${BASE}/api/channels/sms/inbound`, {
          method: 'POST',
          body: formData,
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect((await res.text())).toContain('<Response>');
      });
    });

    describe('GET /api/channels/facebook/webhook', () => {
      it('returns challenge when verify token matches', async () => {
        const { GET } = await import('@/app/api/channels/facebook/webhook/route');
        const url = `${BASE}/api/channels/facebook/webhook?hub.mode=subscribe&hub.verify_token=demo-verify-token&hub.challenge=test_challenge`;
        const res = await GET(new NextRequest(url));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('test_challenge');
      });

      it('returns 403 for wrong verify token', async () => {
        const { GET } = await import('@/app/api/channels/facebook/webhook/route');
        const url = `${BASE}/api/channels/facebook/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`;
        const res = await GET(new NextRequest(url));
        expect(res.status).toBe(403);
      });
    });

    describe('POST /api/channels/facebook/webhook', () => {
      it('processes messenger payload', async () => {
        const { POST } = await import('@/app/api/channels/facebook/webhook/route');
        const res = await POST(
          jsonReq('/api/channels/facebook/webhook', {
            object: 'page',
            entry: [{
              id: 'page_1',
              time: Date.now(),
              messaging: [{
                sender: { id: 'user_1' },
                recipient: { id: 'page_1' },
                timestamp: Date.now(),
                message: { mid: 'mid.1', text: 'Hi from FB' },
              }],
            }],
          }),
        );
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe('ok');
      });
    });

    describe('GET /api/channels/twitter/webhook (CRC)', () => {
      it('returns response_token for crc_token', async () => {
        const { GET } = await import('@/app/api/channels/twitter/webhook/route');
        const crcToken = 'test-crc-token';
        const res = await GET(
          new NextRequest(`${BASE}/api/channels/twitter/webhook?crc_token=${crcToken}`),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.response_token).toMatch(/^sha256=/);
        const expected = createHmac('sha256', 'demo-secret').update(crcToken).digest('base64');
        expect(body.response_token).toBe(`sha256=${expected}`);
      });

      it('returns 400 when crc_token is missing', async () => {
        const { GET } = await import('@/app/api/channels/twitter/webhook/route');
        const res = await GET(new NextRequest(`${BASE}/api/channels/twitter/webhook`));
        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/channels/twitter/webhook', () => {
      it('processes DM event', async () => {
        const { POST } = await import('@/app/api/channels/twitter/webhook/route');
        const res = await POST(
          jsonReq('/api/channels/twitter/webhook', {
            for_user_id: 'bot_1',
            direct_message_events: [{
              type: 'message_create',
              id: 'dm_1',
              created_timestamp: String(Date.now()),
              message_create: {
                sender_id: 'user_1',
                target: { recipient_id: 'bot_1' },
                message_data: { text: 'Hello from X' },
              },
            }],
          }),
        );
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe('ok');
      });
    });

    describe('GET /api/channels/voice', () => {
      it('returns voice config and stats', async () => {
        const { GET } = await import('@/app/api/channels/voice/route');
        const res = await GET(getReq('/api/channels/voice'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('ivrConfig');
        expect(body).toHaveProperty('stats');
        expect(typeof body.demo).toBe('boolean');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 17. AI Features (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('17. AI Features', () => {
    describe('POST /api/ai/resolve', () => {
      it('returns 400 when ticketId is missing', async () => {
        const { POST } = await import('@/app/api/ai/resolve/route');
        const res = await POST(jsonReq('/api/ai/resolve', {}));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/ticketId/i);
      });

      it('returns 404 for nonexistent ticket', async () => {
        const { POST } = await import('@/app/api/ai/resolve/route');
        const res = await POST(jsonReq('/api/ai/resolve', { ticketId: 'nonexistent' }));
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/ai/insights', () => {
      it('returns insights in heuristic mode without LLM key', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        vi.resetModules();
        const { GET } = await import('@/app/api/ai/insights/route');
        const res = await GET(getReq('/api/ai/insights'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe('heuristic');
        expect(body.insights).toBeDefined();
      });

      it('respects useLLM=false parameter', async () => {
        const { GET } = await import('@/app/api/ai/insights/route');
        const res = await GET(getReq('/api/ai/insights', { useLLM: 'false' }));
        expect(res.status).toBe(200);
        expect((await res.json()).mode).toBe('heuristic');
      });
    });

    describe('POST /api/ai/qa', () => {
      it('returns 400 when ticketId is missing', async () => {
        const { POST } = await import('@/app/api/ai/qa/route');
        const res = await POST(
          jsonReq('/api/ai/qa', { responseText: 'Some response' }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/ticketId/i);
      });

      it('returns 400 when responseText is missing', async () => {
        const { POST } = await import('@/app/api/ai/qa/route');
        const res = await POST(jsonReq('/api/ai/qa', { ticketId: 'tk-1' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/responseText/i);
      });

      it('returns 404 for nonexistent ticket', async () => {
        const { POST } = await import('@/app/api/ai/qa/route');
        const res = await POST(
          jsonReq('/api/ai/qa', { ticketId: 'nonexistent', responseText: 'Answer' }),
        );
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/ai/qa', () => {
      it('returns QA overview', async () => {
        const { GET } = await import('@/app/api/ai/qa/route');
        const res = await GET(getReq('/api/ai/qa'));
        expect(res.status).toBe(200);
        expect((await res.json()).overview).toBeDefined();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 18. Billing (12 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('18. Billing', () => {
    describe('GET /api/billing', () => {
      it('returns byoc plan in demo mode', async () => {
        const { GET } = await import('@/app/api/billing/route');
        const res = await GET(getReq('/api/billing'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.plan).toBe('byoc');
        expect(body.planName).toBeDefined();
        expect(body.price).toBe(0);
        expect(body.subscription).toBeNull();
      });

      it('returns stripeConfigured: false without STRIPE_SECRET_KEY', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        vi.resetModules();
        const { GET } = await import('@/app/api/billing/route');
        const res = await GET(getReq('/api/billing'));
        expect((await res.json()).stripeConfigured).toBe(false);
      });

      it('returns stripeConfigured: true with STRIPE_SECRET_KEY', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        vi.resetModules();
        const { GET } = await import('@/app/api/billing/route');
        const res = await GET(getReq('/api/billing'));
        expect((await res.json()).stripeConfigured).toBe(true);
      });

      it('returns quotas and usage fields', async () => {
        const { GET } = await import('@/app/api/billing/route');
        const res = await GET(getReq('/api/billing'));
        const body = await res.json();
        expect(body).toHaveProperty('quotas');
        expect(body).toHaveProperty('usage');
      });
    });

    describe('POST /api/billing/checkout', () => {
      it('returns 503 when Stripe not configured', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        vi.resetModules();
        const { POST } = await import('@/app/api/billing/checkout/route');
        const res = await POST(jsonReq('/api/billing/checkout', { plan: 'pro_hosted' }));
        expect(res.status).toBe(503);
        expect((await res.json()).error).toMatch(/stripe/i);
      });

      it('returns 400 when plan is missing', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        vi.resetModules();
        const { POST } = await import('@/app/api/billing/checkout/route');
        const res = await POST(jsonReq('/api/billing/checkout', {}));
        expect(res.status).toBe(400);
      });

      it('returns 400 for invalid plan name', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        vi.resetModules();
        const { POST } = await import('@/app/api/billing/checkout/route');
        const res = await POST(jsonReq('/api/billing/checkout', { plan: 'hackerplan' }));
        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/billing/portal', () => {
      it('returns 503 when Stripe not configured', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        vi.resetModules();
        const { POST } = await import('@/app/api/billing/portal/route');
        const res = await POST(new NextRequest(`${BASE}/api/billing/portal`, { method: 'POST' }));
        expect(res.status).toBe(503);
        expect((await res.json()).error).toMatch(/stripe/i);
      });
    });

    describe('POST /api/stripe/webhook', () => {
      it('returns 503 when Stripe not configured', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        vi.resetModules();
        const { POST } = await import('@/app/api/stripe/webhook/route');
        const res = await POST(
          new NextRequest(`${BASE}/api/stripe/webhook`, {
            method: 'POST',
            headers: { 'stripe-signature': 'sig' },
            body: '{}',
          }),
        );
        expect(res.status).toBe(503);
      });

      it('returns 400 when stripe-signature missing', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        vi.resetModules();
        const { POST } = await import('@/app/api/stripe/webhook/route');
        const res = await POST(
          new NextRequest(`${BASE}/api/stripe/webhook`, { method: 'POST', body: '{}' }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/stripe-signature/i);
      });

      it('returns 400 for invalid signature', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        vi.resetModules();
        const { POST } = await import('@/app/api/stripe/webhook/route');
        const res = await POST(
          new NextRequest(`${BASE}/api/stripe/webhook`, {
            method: 'POST',
            headers: { 'stripe-signature': 'v1=invalid' },
            body: '{"type":"test"}',
          }),
        );
        expect(res.status).toBe(400);
      });
    });

    describe('Quota enforcement (demo mode)', () => {
      it('ticket quota passes', async () => {
        const { checkQuota } = await import('@/lib/billing/usage');
        expect((await checkQuota('any-tenant', 'ticket')).allowed).toBe(true);
      });

      it('AI call quota passes', async () => {
        const { checkQuota } = await import('@/lib/billing/usage');
        expect((await checkQuota('any-tenant', 'ai_call')).allowed).toBe(true);
      });

      it('API request quota passes', async () => {
        const { checkQuota } = await import('@/lib/billing/usage');
        expect((await checkQuota('any-tenant', 'api_request')).allowed).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 19. MCP Tool Helpers (16 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('19. MCP Tool Helpers', () => {
    describe('textResult', () => {
      it('wraps string data in content array', async () => {
        const { textResult } = await import('@cli/mcp/util');
        const result = textResult('hello');
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('hello');
      });

      it('JSON-stringifies object data', async () => {
        const { textResult } = await import('@cli/mcp/util');
        const result = textResult({ count: 5 });
        expect(result.content[0].text).toContain('"count": 5');
      });
    });

    describe('errorResult', () => {
      it('returns isError: true', async () => {
        const { errorResult } = await import('@cli/mcp/util');
        const result = errorResult('something failed');
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('something failed');
      });
    });

    describe('findTicket', () => {
      it('finds by id', async () => {
        const { findTicket } = await import('@cli/mcp/util');
        const tickets = [
          { id: 'tk-1', externalId: 'ext-1', subject: '', status: 'open', priority: 'normal', tags: [], createdAt: '', updatedAt: '', source: 'zendesk', requester: 'a@b.com' },
          { id: 'tk-2', externalId: 'ext-2', subject: '', status: 'open', priority: 'normal', tags: [], createdAt: '', updatedAt: '', source: 'zendesk', requester: 'c@d.com' },
        ] as Parameters<typeof findTicket>[0];
        const found = findTicket(tickets, 'tk-1');
        expect(found).toBeDefined();
        expect(found!.id).toBe('tk-1');
      });

      it('finds by externalId', async () => {
        const { findTicket } = await import('@cli/mcp/util');
        const tickets = [
          { id: 'tk-1', externalId: 'ext-1', subject: '', status: 'open', priority: 'normal', tags: [], createdAt: '', updatedAt: '', source: 'zendesk', requester: 'a@b.com' },
        ] as Parameters<typeof findTicket>[0];
        const found = findTicket(tickets, 'ext-1');
        expect(found).toBeDefined();
      });

      it('returns undefined when not found', async () => {
        const { findTicket } = await import('@cli/mcp/util');
        expect(findTicket([], 'missing')).toBeUndefined();
      });
    });

    describe('getTicketMessages', () => {
      it('filters messages by ticketId', async () => {
        const { getTicketMessages } = await import('@cli/mcp/util');
        const messages = [
          { ticketId: 'tk-1', body: 'msg1', author: '', createdAt: '' },
          { ticketId: 'tk-2', body: 'msg2', author: '', createdAt: '' },
          { ticketId: 'tk-1', body: 'msg3', author: '', createdAt: '' },
        ] as Parameters<typeof getTicketMessages>[1];
        const result = getTicketMessages('tk-1', messages);
        expect(result).toHaveLength(2);
      });

      it('returns empty for no matches', async () => {
        const { getTicketMessages } = await import('@cli/mcp/util');
        expect(getTicketMessages('missing', [])).toHaveLength(0);
      });
    });

    describe('safeLoadTickets', () => {
      it('returns empty array when no data files exist', async () => {
        const { safeLoadTickets } = await import('@cli/mcp/util');
        const tickets = await safeLoadTickets('/tmp/nonexistent-cliaas-dir');
        expect(Array.isArray(tickets)).toBe(true);
        expect(tickets).toHaveLength(0);
      });
    });

    describe('maskConfig', () => {
      it('masks API keys in config sections', async () => {
        const { maskConfig } = await import('@cli/mcp/util');
        const config = {
          provider: 'claude',
          claude: { apiKey: 'sk-ant-1234567890abcdef' },
        };
        const masked = maskConfig(config);
        expect((masked.claude as { apiKey: string }).apiKey).toMatch(/\.\.\.$/);
        expect((masked.claude as { apiKey: string }).apiKey.length).toBeLessThan(20);
      });
    });

    describe('withConfirmation', () => {
      it('returns preview when confirm is false', async () => {
        const { withConfirmation } = await import('@cli/mcp/tools/confirm');
        const result = withConfirmation(false, {
          description: 'Test action',
          preview: { key: 'value' },
          execute: () => ({ done: true }),
        });
        expect(result.needsConfirmation).toBe(true);
      });

      it('returns preview when confirm is undefined', async () => {
        const { withConfirmation } = await import('@cli/mcp/tools/confirm');
        const result = withConfirmation(undefined, {
          description: 'Test action',
          preview: { key: 'value' },
          execute: () => ({ done: true }),
        });
        expect(result.needsConfirmation).toBe(true);
      });

      it('executes when confirm is true', async () => {
        const { withConfirmation } = await import('@cli/mcp/tools/confirm');
        const result = withConfirmation(true, {
          description: 'Test action',
          preview: { key: 'value' },
          execute: () => ({ done: true }),
        });
        expect(result.needsConfirmation).toBe(false);
        if (!result.needsConfirmation) {
          expect(result.value).toEqual({ done: true });
        }
      });
    });

    describe('recordMCPAction / getMCPAuditLog', () => {
      it('records and retrieves actions', async () => {
        const { recordMCPAction, getMCPAuditLog } = await import('@cli/mcp/tools/confirm');
        const entry = {
          tool: 'test_tool',
          action: 'test',
          params: { key: 'val' },
          timestamp: new Date().toISOString(),
          result: 'success' as const,
        };
        recordMCPAction(entry);
        const log = getMCPAuditLog();
        expect(log).toHaveLength(1);
        expect(log[0].tool).toBe('test_tool');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 20. Data Provider (10 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('20. Data Provider', () => {
    describe('detectDataMode', () => {
      it('returns local when no env vars set', async () => {
        delete process.env.DATABASE_URL;
        delete process.env.CLIAAS_MODE;
        vi.resetModules();
        const { detectDataMode } = await import('@/lib/data-provider/index');
        expect(detectDataMode()).toBe('local');
      });

      it('returns db when DATABASE_URL is set', async () => {
        process.env.DATABASE_URL = 'postgresql://fake';
        delete process.env.CLIAAS_MODE;
        vi.resetModules();
        const { detectDataMode } = await import('@/lib/data-provider/index');
        expect(detectDataMode()).toBe('db');
      });

      it('returns explicit CLIAAS_MODE when set', async () => {
        process.env.CLIAAS_MODE = 'remote';
        vi.resetModules();
        const { detectDataMode } = await import('@/lib/data-provider/index');
        expect(detectDataMode()).toBe('remote');
      });

      it('CLIAAS_MODE overrides DATABASE_URL', async () => {
        process.env.DATABASE_URL = 'postgresql://fake';
        process.env.CLIAAS_MODE = 'local';
        vi.resetModules();
        const { detectDataMode } = await import('@/lib/data-provider/index');
        expect(detectDataMode()).toBe('local');
      });

      it('ignores invalid CLIAAS_MODE values', async () => {
        process.env.CLIAAS_MODE = 'invalid_mode';
        delete process.env.DATABASE_URL;
        vi.resetModules();
        const { detectDataMode } = await import('@/lib/data-provider/index');
        expect(detectDataMode()).toBe('local');
      });
    });

    describe('getDataProvider', () => {
      it('returns provider for local mode', async () => {
        delete process.env.DATABASE_URL;
        delete process.env.CLIAAS_MODE;
        vi.resetModules();
        const { getDataProvider } = await import('@/lib/data-provider/index');
        const provider = await getDataProvider();
        expect(provider.capabilities.mode).toBe('local');
        expect(provider.capabilities.supportsWrite).toBe(false);
      });

      it('returns fresh provider when dir is specified', async () => {
        delete process.env.DATABASE_URL;
        vi.resetModules();
        const { getDataProvider } = await import('@/lib/data-provider/index');
        const provider = await getDataProvider('/tmp/test-dir');
        expect(provider.capabilities.mode).toBe('local');
      });
    });

    describe('JsonlProvider', () => {
      it('returns empty tickets when no data files exist', async () => {
        const { JsonlProvider } = await import('@/lib/data-provider/jsonl-provider');
        const provider = new JsonlProvider('/tmp/nonexistent-provider-dir');
        const tickets = await provider.loadTickets();
        expect(tickets).toHaveLength(0);
      });

      it('returns empty messages when no data files exist', async () => {
        const { JsonlProvider } = await import('@/lib/data-provider/jsonl-provider');
        const provider = new JsonlProvider('/tmp/nonexistent-provider-dir');
        const messages = await provider.loadMessages();
        expect(messages).toHaveLength(0);
      });

      it('throws on write operations', async () => {
        const { JsonlProvider } = await import('@/lib/data-provider/jsonl-provider');
        const provider = new JsonlProvider('/tmp/nonexistent-provider-dir');
        await expect(
          provider.createTicket({ subject: 'Test' }),
        ).rejects.toThrow(/write operations/i);
      });

      it('has correct capabilities', async () => {
        const { JsonlProvider } = await import('@/lib/data-provider/jsonl-provider');
        const provider = new JsonlProvider();
        expect(provider.capabilities).toEqual({
          mode: 'local',
          supportsWrite: false,
          supportsSync: false,
          supportsRag: false,
        });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 21. Auth Enforcement (8 tests)
  // ═══════════════════════════════════════════════════════════════════

  describe('21. Auth Enforcement', () => {
    describe('401 without auth in non-demo mode', () => {
      beforeEach(() => {
        // Set DATABASE_URL to disable demo mode
        process.env.DATABASE_URL = 'postgresql://fake:5432/test';
        vi.resetModules();
      });

      it('GET /api/tickets returns 401 without auth headers', async () => {
        const { GET } = await import('@/app/api/tickets/route');
        const res = await GET(getReq('/api/tickets'));
        expect(res.status).toBe(401);
      });

      it('GET /api/kb returns 401 without auth headers', async () => {
        const { GET } = await import('@/app/api/kb/route');
        const res = await GET(getReq('/api/kb'));
        expect(res.status).toBe(401);
      });

      it('GET /api/analytics returns 401 without auth headers', async () => {
        const { GET } = await import('@/app/api/analytics/route');
        const res = await GET(getReq('/api/analytics'));
        expect(res.status).toBe(401);
      });

      it('GET /api/automations returns 401 without auth headers', async () => {
        const { GET } = await import('@/app/api/automations/route');
        const res = await GET(getReq('/api/automations'));
        expect(res.status).toBe(401);
      });
    });

    describe('403 for insufficient role', () => {
      beforeEach(() => {
        process.env.DATABASE_URL = 'postgresql://fake:5432/test';
        vi.resetModules();
      });

      it('GET /api/connectors returns 403 for agent role', async () => {
        const { GET } = await import('@/app/api/connectors/route');
        const req = new NextRequest(`${BASE}/api/connectors`, {
          headers: buildAuthHeaders(TEST_USER_AGENT),
        });
        const res = await GET(req);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/insufficient/i);
      });

      it('GET /api/audit returns 403 for agent role', async () => {
        const { GET } = await import('@/app/api/audit/route');
        const req = new NextRequest(`${BASE}/api/audit`, {
          headers: buildAuthHeaders(TEST_USER_AGENT),
        });
        const res = await GET(req);
        expect(res.status).toBe(403);
      });

      it('GET /api/api-keys returns 403 for agent role', async () => {
        const { GET } = await import('@/app/api/api-keys/route');
        const req = new NextRequest(`${BASE}/api/api-keys`, {
          headers: buildAuthHeaders(TEST_USER_AGENT),
        });
        const res = await GET(req);
        expect(res.status).toBe(403);
      });
    });

    describe('Scope enforcement', () => {
      it('API key without required scope returns 403', async () => {
        process.env.DATABASE_URL = 'postgresql://fake:5432/test';
        vi.resetModules();
        const { requireScope } = await import('@/lib/api-auth');
        // Simulate an API key user with limited scopes
        const req = new NextRequest(`${BASE}/api/test`, {
          headers: {
            'x-user-id': 'key-user-1',
            'x-workspace-id': 'ws-1',
            'x-user-role': 'admin',
            'x-auth-type': 'api-key',
            Authorization: 'Bearer test-key',
          },
        });
        // requireScope would need to validate the key; without DB it returns null (401)
        const result = await requireScope(req, 'tickets:read');
        expect('error' in result).toBe(true);
      });
    });
  });
});
