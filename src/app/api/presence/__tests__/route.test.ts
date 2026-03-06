import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'u1', email: 'agent@test.com', name: 'Agent', role: 'agent', workspaceId: 'ws1' },
  })),
  requireRole: vi.fn(async () => ({
    user: { id: 'u1', email: 'agent@test.com', name: 'Agent', role: 'agent', workspaceId: 'ws1' },
  })),
  requireScope: vi.fn(async () => ({
    user: { id: 'u1', email: 'agent@test.com', name: 'Agent', role: 'agent', workspaceId: 'ws1' },
  })),
  requireScopeAndRole: vi.fn(async () => ({
    user: { id: 'u1', email: 'agent@test.com', name: 'Agent', role: 'agent', workspaceId: 'ws1' },
  })),
  getAuthUser: vi.fn(async () => ({ id: 'u1', email: 'agent@test.com', name: 'Agent', role: 'agent', workspaceId: 'ws1' })),
  ROLE_HIERARCHY: { owner: 6, admin: 5, agent: 4, light_agent: 3, collaborator: 2, viewer: 1 },
  VALID_SCOPES: ['tickets:read', 'tickets:write', 'kb:read', 'kb:write', 'analytics:read', '*'],
}));

// Reset presence singleton before import
delete (global as Record<string, unknown>).__cliaasPresence;
delete (global as Record<string, unknown>).__cliaasEventBus;

const { GET, POST } = await import('../route');

function makeRequest(
  url: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> },
) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: options?.body,
  });
}

describe('Presence API', () => {
  beforeEach(async () => {
    const { presence } = await import('@/lib/realtime/presence');
    presence._testClear();
  });

  describe('POST', () => {
    it('should return ok with currentUserId and viewers on valid activity', async () => {
      const req = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 'ticket-1', activity: 'viewing' }),
      });
      const res = await POST(req);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.currentUserId).toBe('u1');
      expect(data.viewers).toBeInstanceOf(Array);
    });

    it('should remove viewer on action=leave', async () => {
      // First register presence
      const req1 = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 'ticket-1', activity: 'viewing' }),
      });
      await POST(req1);

      // Then leave
      const req2 = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 'ticket-1', action: 'leave' }),
      });
      const res = await POST(req2);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.viewers).toHaveLength(0);
    });

    it('should return 400 without ticketId', async () => {
      const req = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ activity: 'viewing' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('should coerce random activity string to viewing', async () => {
      const req = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 'ticket-1', activity: 'dancing' }),
      });
      const res = await POST(req);
      const data = await res.json();
      expect(data.ok).toBe(true);
      // The viewer should be tracked as 'viewing' (coerced)
      const viewer = data.viewers.find((v: { userId: string }) => v.userId === 'u1');
      expect(viewer?.activity).toBe('viewing');
    });
  });

  describe('GET', () => {
    it('should return viewers for a ticketId', async () => {
      // First register presence
      const postReq = makeRequest('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 'ticket-1', activity: 'viewing' }),
      });
      await POST(postReq);

      const req = makeRequest('/api/presence?ticketId=ticket-1');
      const res = await GET(req);
      const data = await res.json();
      expect(data.viewers).toBeInstanceOf(Array);
      expect(data.currentUserId).toBe('u1');
    });

    it('should return 400 without ticketId', async () => {
      const req = makeRequest('/api/presence');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });
});
