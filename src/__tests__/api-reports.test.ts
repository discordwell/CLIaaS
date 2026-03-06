import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTickets = [
  {
    id: 't1', subject: 'Login issue', status: 'open', priority: 'high',
    assignee: 'Alice', requester: 'customer@test.com', source: 'zendesk',
    tags: ['login', 'urgent'], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T12:00:00Z',
  },
  {
    id: 't2', subject: 'Billing question', status: 'solved', priority: 'normal',
    assignee: 'Bob', requester: 'user@test.com', source: 'zendesk',
    tags: ['billing'], createdAt: '2026-01-15T11:00:00Z', updatedAt: '2026-01-15T18:00:00Z',
  },
];

const mockMessages = [
  { id: 'm1', ticketId: 't1', type: 'reply', author: 'Alice', body: 'Looking into it', createdAt: '2026-01-15T10:30:00Z' },
  { id: 'm2', ticketId: 't2', type: 'reply', author: 'Bob', body: 'Fixed', createdAt: '2026-01-15T13:00:00Z' },
];

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: () => ({
    loadTickets: () => Promise.resolve(mockTickets),
    loadMessages: () => Promise.resolve(mockMessages),
    loadCSATRatings: () => Promise.resolve([]),
    loadSurveyResponses: () => Promise.resolve([]),
  }),
}));

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

describe('Reports API (JSONL mode)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  describe('GET /api/reports', () => {
    it('returns template reports', async () => {
      const { GET } = await import('@/app/api/reports/route');
      const res = await GET(makeRequest('/api/reports') as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reports.length).toBeGreaterThan(0);
      expect(body.reports[0].isTemplate).toBe(true);
    });
  });

  describe('POST /api/reports', () => {
    it('creates a report and returns it', async () => {
      const { POST } = await import('@/app/api/reports/route');
      const res = await POST(makeRequest('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Report',
          metric: 'ticket_volume',
          groupBy: ['date'],
          visualization: 'bar',
        }),
      }) as any);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.report.name).toBe('Test Report');
      expect(body.report.metric).toBe('ticket_volume');
    });

    it('rejects missing name', async () => {
      const { POST } = await import('@/app/api/reports/route');
      const res = await POST(makeRequest('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric: 'ticket_volume' }),
      }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects missing metric', async () => {
      const { POST } = await import('@/app/api/reports/route');
      const res = await POST(makeRequest('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }) as any);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/reports/[id]/execute', () => {
    it('executes a template report', async () => {
      const { POST } = await import('@/app/api/reports/[id]/execute/route');
      const res = await POST(
        makeRequest('/api/reports/template-0/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }) as any,
        { params: Promise.resolve({ id: 'template-0' }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toBeDefined();
      expect(body.result.metric).toBe('ticket_volume');
      expect(body.result.rows.length).toBeGreaterThan(0);
    });

    it('returns 404 for invalid template index', async () => {
      const { POST } = await import('@/app/api/reports/[id]/execute/route');
      const res = await POST(
        makeRequest('/api/reports/template-999/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }) as any,
        { params: Promise.resolve({ id: 'template-999' }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/reports/[id]/export', () => {
    it('exports as CSV by default', async () => {
      const { GET } = await import('@/app/api/reports/[id]/export/route');
      const res = await GET(
        makeRequest('/api/reports/template-0/export') as any,
        { params: Promise.resolve({ id: 'template-0' }) },
      );
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type');
      expect(ct).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('date');
    });

    it('exports as JSON when format=json', async () => {
      const { GET } = await import('@/app/api/reports/[id]/export/route');
      const res = await GET(
        makeRequest('/api/reports/template-0/export?format=json') as any,
        { params: Promise.resolve({ id: 'template-0' }) },
      );
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type');
      expect(ct).toContain('application/json');
    });
  });

  describe('POST /api/reports/[id]/drill', () => {
    it('drills down into a group', async () => {
      const { POST } = await import('@/app/api/reports/[id]/drill/route');
      const res = await POST(
        makeRequest('/api/reports/template-0/drill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupKey: 'date', groupValue: '2026-01-15' }),
        }) as any,
        { params: Promise.resolve({ id: 'template-0' }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.drillDown).toBeDefined();
      expect(body.drillDown.count).toBeGreaterThan(0);
      expect(body.drillDown.ticketIds).toContain('t1');
    });

    it('rejects missing groupKey', async () => {
      const { POST } = await import('@/app/api/reports/[id]/drill/route');
      const res = await POST(
        makeRequest('/api/reports/template-0/drill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupValue: '2026-01-15' }),
        }) as any,
        { params: Promise.resolve({ id: 'template-0' }) },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/reports/[id] (JSONL mode)', () => {
    it('returns 404 in JSONL mode', async () => {
      const { GET } = await import('@/app/api/reports/[id]/route');
      const res = await GET(
        makeRequest('/api/reports/some-id') as any,
        { params: Promise.resolve({ id: 'some-id' }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/reports/[id] (JSONL mode)', () => {
    it('returns 501 in JSONL mode', async () => {
      const { DELETE } = await import('@/app/api/reports/[id]/route');
      const res = await DELETE(
        makeRequest('/api/reports/some-id', { method: 'DELETE' }) as any,
        { params: Promise.resolve({ id: 'some-id' }) },
      );
      expect(res.status).toBe(501);
    });
  });
});
