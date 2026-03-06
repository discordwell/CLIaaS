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

const mockMessages = [
  { id: 'm1', ticketId: 't1', author: 'Alice', body: 'Hello', type: 'reply' as const, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'm2', ticketId: 't1', author: 'Bob', body: 'Reply', type: 'reply' as const, createdAt: '2026-01-02T00:00:00Z' },
  { id: 'm3', ticketId: 't1', author: 'Carol', body: 'Latest', type: 'reply' as const, createdAt: '2026-01-03T00:00:00Z' },
];

vi.mock('@/lib/realtime/collision', () => ({
  checkForNewReplies: vi.fn(async (ticketId: string, since: Date) => {
    const filtered = mockMessages.filter(
      (m) => new Date(m.createdAt).getTime() > since.getTime(),
    );
    return {
      hasNewReplies: filtered.length > 0,
      newReplies: filtered.map((m) => ({
        id: m.id,
        author: m.author,
        body: m.body.slice(0, 200),
        createdAt: m.createdAt,
        type: m.type,
      })),
    };
  }),
}));

// Reset presence singleton before import
delete (global as Record<string, unknown>).__cliaasPresence;
delete (global as Record<string, unknown>).__cliaasEventBus;

const { GET } = await import('../route');

function makeRequest(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('Collision-check API', () => {
  beforeEach(async () => {
    const { presence } = await import('@/lib/realtime/presence');
    presence._testClear();
  });

  it('should return new replies when since is before messages', async () => {
    const req = makeRequest('/api/tickets/t1/collision-check?since=2026-01-01T12:00:00Z');
    const res = await GET(req, { params: Promise.resolve({ id: 't1' }) });
    const data = await res.json();
    expect(data.hasNewReplies).toBe(true);
    expect(data.newReplies).toHaveLength(2); // m2 and m3
  });

  it('should return no new replies when since is in the future', async () => {
    const req = makeRequest('/api/tickets/t1/collision-check?since=2027-01-01T00:00:00Z');
    const res = await GET(req, { params: Promise.resolve({ id: 't1' }) });
    const data = await res.json();
    expect(data.hasNewReplies).toBe(false);
    expect(data.newReplies).toHaveLength(0);
  });

  it('should return 400 without since parameter', async () => {
    const req = makeRequest('/api/tickets/t1/collision-check');
    const res = await GET(req, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('since');
  });

  it('should return 400 with invalid since timestamp', async () => {
    const req = makeRequest('/api/tickets/t1/collision-check?since=not-a-date');
    const res = await GET(req, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid');
  });

  it('should include activeViewers excluding current user', async () => {
    const { presence } = await import('@/lib/realtime/presence');
    presence.update('u1', 'Agent', 't1', 'viewing');
    presence.update('u2', 'Other', 't1', 'typing');

    const req = makeRequest('/api/tickets/t1/collision-check?since=2026-01-01T12:00:00Z');
    const res = await GET(req, { params: Promise.resolve({ id: 't1' }) });
    const data = await res.json();
    // u1 should be filtered out
    expect(data.activeViewers).toHaveLength(1);
    expect(data.activeViewers[0].userId).toBe('u2');
  });
});
