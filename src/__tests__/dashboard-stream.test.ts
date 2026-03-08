import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the route
vi.mock('@/lib/data', () => ({
  loadTickets: vi.fn().mockResolvedValue([
    {
      id: 't1',
      subject: 'Test ticket',
      status: 'open',
      priority: 'urgent',
      assignee: null,
      tags: ['billing'],
      createdAt: '2026-03-08T10:00:00Z',
      updatedAt: '2026-03-08T10:00:00Z',
    },
    {
      id: 't2',
      subject: 'Assigned ticket',
      status: 'pending',
      priority: 'normal',
      assignee: 'agent1',
      tags: [],
      createdAt: '2026-03-08T09:00:00Z',
      updatedAt: '2026-03-08T09:00:00Z',
    },
  ]),
  loadMessages: vi.fn().mockResolvedValue([]),
  computeStats: vi.fn().mockReturnValue({
    total: 2,
    byStatus: { open: 1, pending: 1 },
    byPriority: { urgent: 1, normal: 1 },
    byAssignee: { unassigned: 1, agent1: 1 },
    topTags: [{ tag: 'billing', count: 1 }],
    recentTickets: [],
  }),
}));

vi.mock('@/lib/sla', () => ({
  checkAllTicketsSLA: vi.fn().mockResolvedValue([
    {
      ticketId: 't1',
      firstResponse: { status: 'breached', remainingMinutes: -30 },
      resolution: { status: 'warning', remainingMinutes: 45 },
    },
  ]),
}));

vi.mock('@/lib/routing/availability', () => ({
  availability: {
    getAllAvailability: vi.fn().mockReturnValue([
      { agentId: 'a1', status: 'online' },
      { agentId: 'a2', status: 'offline' },
    ]),
  },
}));

describe('GET /api/dashboard/stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns SSE content type headers', async () => {
    const { GET } = await import('@/app/api/dashboard/stream/route');
    const controller = new AbortController();
    const request = new Request('http://localhost/api/dashboard/stream', {
      signal: controller.signal,
    });

    const response = await GET(request);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');

    controller.abort();
  });

  it('sends an initial metrics event immediately', async () => {
    const { GET } = await import('@/app/api/dashboard/stream/route');
    const controller = new AbortController();
    const request = new Request('http://localhost/api/dashboard/stream', {
      signal: controller.signal,
    });

    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('event: metrics');
    expect(text).toContain('"openCount":1');
    expect(text).toContain('"pendingCount":1');
    expect(text).toContain('"urgentCount":1');
    expect(text).toContain('"slaBreaches":1');
    expect(text).toContain('"slaWarnings":1');
    expect(text).toContain('"unassigned":1');
    expect(text).toContain('"agentsOnline":1');
    expect(text).toContain('"timestamp"');

    controller.abort();
  });

  it('has correct data format as SSE', async () => {
    const { GET } = await import('@/app/api/dashboard/stream/route');
    const controller = new AbortController();
    const request = new Request('http://localhost/api/dashboard/stream', {
      signal: controller.signal,
    });

    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const { value } = await reader.read();
    const text = decoder.decode(value);

    // SSE format: "event: metrics\ndata: {...}\n\n"
    const lines = text.split('\n');
    expect(lines[0]).toBe('event: metrics');
    expect(lines[1]).toMatch(/^data: \{/);

    // Parse the JSON payload
    const jsonStr = lines[1].replace('data: ', '');
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty('openCount');
    expect(parsed).toHaveProperty('pendingCount');
    expect(parsed).toHaveProperty('urgentCount');
    expect(parsed).toHaveProperty('slaBreaches');
    expect(parsed).toHaveProperty('slaWarnings');
    expect(parsed).toHaveProperty('unassigned');
    expect(parsed).toHaveProperty('agentsOnline');
    expect(parsed).toHaveProperty('timestamp');

    controller.abort();
  });
});
