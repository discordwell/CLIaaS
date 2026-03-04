import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();

// Store the original setTimeout
const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.resetModules();
  // Groove client uses preRequestDelayMs: 2500ms sleep() calls via setTimeout.
  // Override setTimeout to resolve immediately so tests don't wait.
  vi.stubGlobal('setTimeout', (fn: () => void, _ms?: number) => {
    return originalSetTimeout(fn, 0);
  });
});

afterEach(() => {
  vi.stubGlobal('setTimeout', originalSetTimeout);
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Groove priority mapping', () => {
  it('maps priority from ticket data instead of hardcoding normal', async () => {
    const tickets = [
      {
        number: 1, title: 'Urgent ticket', state: 'opened', tags: [],
        starred: false, message_count: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z', assigned_group: null, closed_by: null,
        priority: 'urgent', links: {},
      },
      {
        number: 2, title: 'High ticket', state: 'opened', tags: [],
        starred: false, message_count: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z', assigned_group: null, closed_by: null,
        priority: 'high', links: {},
      },
      {
        number: 3, title: 'Low ticket', state: 'opened', tags: [],
        starred: false, message_count: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z', assigned_group: null, closed_by: null,
        priority: 'low', links: {},
      },
      {
        number: 4, title: 'Null priority ticket', state: 'opened', tags: [],
        starred: false, message_count: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z', assigned_group: null, closed_by: null,
        priority: null, links: {},
      },
    ];

    mockFetch
      // Tickets page 1 (4 tickets, < pageSize 50 so no second page)
      .mockResolvedValueOnce(jsonResponse({ tickets }))
      // Messages for ticket 1 (empty)
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      // Messages for ticket 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      // Messages for ticket 3 (empty)
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      // Messages for ticket 4 (empty)
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      // Customers page 1 (empty)
      .mockResolvedValueOnce(jsonResponse({ customers: [] }))
      // Agents
      .mockResolvedValueOnce(jsonResponse({ agents: [] }))
      // KB
      .mockResolvedValueOnce(jsonResponse({ knowledge_bases: [] }));

    const { exportGroove } = await import('../../connectors/groove.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/groove-priority-test-${Date.now()}`;

    await exportGroove({ apiToken: 'test-token' }, tmpDir);

    const ticketLines = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketLines).toHaveLength(4);

    const t1 = JSON.parse(ticketLines[0]);
    const t2 = JSON.parse(ticketLines[1]);
    const t3 = JSON.parse(ticketLines[2]);
    const t4 = JSON.parse(ticketLines[3]);

    expect(t1.priority).toBe('urgent');
    expect(t2.priority).toBe('high');
    expect(t3.priority).toBe('low');
    // null priority should default to 'normal'
    expect(t4.priority).toBe('normal');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles case-insensitive priority values', async () => {
    const tickets = [
      {
        number: 1, title: 'Mixed case', state: 'opened', tags: [],
        starred: false, message_count: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z', assigned_group: null, closed_by: null,
        priority: 'HIGH', links: {},
      },
    ];

    mockFetch
      // Tickets page 1
      .mockResolvedValueOnce(jsonResponse({ tickets }))
      // Messages for ticket 1 (empty)
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      // Customers page 1 (empty)
      .mockResolvedValueOnce(jsonResponse({ customers: [] }))
      // Agents
      .mockResolvedValueOnce(jsonResponse({ agents: [] }))
      // KB
      .mockResolvedValueOnce(jsonResponse({ knowledge_bases: [] }));

    const { exportGroove } = await import('../../connectors/groove.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/groove-priority-case-test-${Date.now()}`;

    await exportGroove({ apiToken: 'test-token' }, tmpDir);

    const ticketLines = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    const t1 = JSON.parse(ticketLines[0]);
    expect(t1.priority).toBe('high');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
