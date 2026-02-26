import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ChatbotFlow } from '@/lib/chatbot/types';

// ---- Mocks ----

const mockFlows: ChatbotFlow[] = [];

vi.mock('@/lib/chatbot/store', () => ({
  getChatbots: vi.fn(async () => mockFlows),
  getChatbot: vi.fn(async (id: string) => mockFlows.find((f) => f.id === id) ?? null),
  upsertChatbot: vi.fn(async (flow: ChatbotFlow) => {
    const idx = mockFlows.findIndex((f) => f.id === flow.id);
    if (idx >= 0) mockFlows[idx] = flow;
    else mockFlows.push(flow);
    return flow;
  }),
  deleteChatbot: vi.fn(async (id: string) => {
    const idx = mockFlows.findIndex((f) => f.id === id);
    if (idx < 0) return false;
    mockFlows.splice(idx, 1);
    return true;
  }),
  getActiveChatbot: vi.fn(async () => mockFlows.find((f) => f.enabled) ?? null),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin', workspaceId: 'ws1' },
  })),
}));

const { GET, POST } = await import('../route');

function makeRequest(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

function makeFlow(overrides: Partial<ChatbotFlow> = {}): ChatbotFlow {
  return {
    id: 'flow-1',
    name: 'Test Bot',
    nodes: { root: { id: 'root', type: 'message', data: { text: 'Hi' } } },
    rootNodeId: 'root',
    enabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockFlows.length = 0;
});

// ---- GET /api/chatbots ----

describe('GET /api/chatbots', () => {
  it('returns empty list', async () => {
    const res = await GET(makeRequest('/api/chatbots'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chatbots).toEqual([]);
  });

  it('returns existing chatbots', async () => {
    mockFlows.push(makeFlow());
    const res = await GET(makeRequest('/api/chatbots'));
    const data = await res.json();

    expect(data.chatbots).toHaveLength(1);
    expect(data.chatbots[0].name).toBe('Test Bot');
  });
});

// ---- POST /api/chatbots ----

describe('POST /api/chatbots', () => {
  it('creates a new chatbot flow', async () => {
    const res = await POST(
      makeRequest('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Bot',
          nodes: { root: { id: 'root', type: 'message', data: { text: 'Welcome' } } },
          rootNodeId: 'root',
        }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.chatbot.name).toBe('My Bot');
    expect(data.chatbot.id).toBeTruthy();
    expect(data.chatbot.enabled).toBe(false);
  });

  it('rejects missing name', async () => {
    const res = await POST(
      makeRequest('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: { root: { id: 'root', type: 'message', data: { text: 'Hi' } } },
          rootNodeId: 'root',
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('name');
  });

  it('rejects missing nodes', async () => {
    const res = await POST(
      makeRequest('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bot' }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('rejects invalid rootNodeId', async () => {
    const res = await POST(
      makeRequest('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bot',
          nodes: { root: { id: 'root', type: 'message', data: { text: 'Hi' } } },
          rootNodeId: 'nonexistent',
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('rootNodeId');
  });
});

// ---- GET/PUT/DELETE /api/chatbots/:id ----

describe('single chatbot routes', () => {
  let routeModule: typeof import('../[id]/route');

  beforeEach(async () => {
    routeModule = await import('../[id]/route');
  });

  it('GET returns 404 for unknown ID', async () => {
    const res = await routeModule.GET(
      makeRequest('/api/chatbots/unknown'),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(res.status).toBe(404);
  });

  it('GET returns the chatbot', async () => {
    mockFlows.push(makeFlow());
    const res = await routeModule.GET(
      makeRequest('/api/chatbots/flow-1'),
      { params: Promise.resolve({ id: 'flow-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chatbot.id).toBe('flow-1');
  });

  it('PUT updates the chatbot', async () => {
    mockFlows.push(makeFlow());
    const res = await routeModule.PUT(
      makeRequest('/api/chatbots/flow-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Bot', enabled: true }),
      }),
      { params: Promise.resolve({ id: 'flow-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chatbot.name).toBe('Updated Bot');
    expect(data.chatbot.enabled).toBe(true);
  });

  it('DELETE removes the chatbot', async () => {
    mockFlows.push(makeFlow());
    const res = await routeModule.DELETE(
      makeRequest('/api/chatbots/flow-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'flow-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockFlows).toHaveLength(0);
  });

  it('DELETE returns 404 for unknown ID', async () => {
    const res = await routeModule.DELETE(
      makeRequest('/api/chatbots/unknown', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(res.status).toBe(404);
  });
});
