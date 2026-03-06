import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeReport, drillDown } from '../engine';

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
  {
    id: 't3', subject: 'Feature request', status: 'closed', priority: 'low',
    assignee: 'Alice', requester: 'dev@test.com', source: 'zendesk',
    tags: ['feature'], createdAt: '2026-01-16T09:00:00Z', updatedAt: '2026-01-17T09:00:00Z',
  },
  {
    id: 't4', subject: 'Chat issue', status: 'pending', priority: 'urgent',
    assignee: 'Bob', requester: 'chat@test.com', source: 'helpcrunch',
    tags: ['login', 'chat'], createdAt: '2026-01-16T14:00:00Z', updatedAt: '2026-01-16T15:00:00Z',
  },
];

const mockMessages = [
  { id: 'm1', ticketId: 't1', type: 'reply', author: 'Alice', body: 'Looking into it', createdAt: '2026-01-15T10:30:00Z' },
  { id: 'm2', ticketId: 't2', type: 'reply', author: 'Bob', body: 'Fixed', createdAt: '2026-01-15T13:00:00Z' },
  { id: 'm3', ticketId: 't1', type: 'reply', author: 'customer@test.com', body: 'Thanks', createdAt: '2026-01-15T11:00:00Z' },
];

const mockCsatRatings = [
  { ticketId: 't2', rating: 5, createdAt: '2026-01-15T19:00:00Z' },
  { ticketId: 't3', rating: 4, createdAt: '2026-01-17T10:00:00Z' },
];

const mockSurveyResponses = [
  { rating: 9, createdAt: '2026-01-15T20:00:00Z' },
  { rating: 7, createdAt: '2026-01-15T21:00:00Z' },
  { rating: 3, createdAt: '2026-01-16T10:00:00Z' },
];

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: () => ({
    loadTickets: () => Promise.resolve(mockTickets),
    loadMessages: () => Promise.resolve(mockMessages),
    loadCSATRatings: () => Promise.resolve(mockCsatRatings),
    loadSurveyResponses: (type?: string) => {
      if (type === 'nps') return Promise.resolve(mockSurveyResponses);
      if (type === 'ces') return Promise.resolve([{ rating: 3, createdAt: '2026-01-15T20:00:00Z' }]);
      return Promise.resolve([]);
    },
  }),
}));

describe('executeReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes ticket_volume grouped by date', async () => {
    const result = await executeReport({ metric: 'ticket_volume', groupBy: ['date'] });

    expect(result.metric).toBe('ticket_volume');
    expect(result.summary.total).toBe(4);
    expect(result.columns).toEqual(['date', 'count']);
    expect(result.rows.length).toBe(2); // 2 distinct dates
  });

  it('computes ticket_volume grouped by priority', async () => {
    const result = await executeReport({ metric: 'ticket_volume', groupBy: ['priority'] });

    expect(result.rows.length).toBe(4);
    const high = result.rows.find(r => r.priority === 'high');
    expect(high?.count).toBe(1);
  });

  it('computes ticket_volume grouped by assignee', async () => {
    const result = await executeReport({ metric: 'ticket_volume', groupBy: ['assignee'] });

    const alice = result.rows.find(r => r.assignee === 'Alice');
    const bob = result.rows.find(r => r.assignee === 'Bob');
    expect(alice?.count).toBe(2);
    expect(bob?.count).toBe(2);
  });

  it('computes tickets_resolved', async () => {
    const result = await executeReport({ metric: 'tickets_resolved' });

    expect(result.summary.total).toBe(2); // solved + closed
  });

  it('computes tickets_open', async () => {
    const result = await executeReport({ metric: 'tickets_open' });

    expect(result.summary.total).toBe(2); // open + pending
  });

  it('computes avg_first_response_time', async () => {
    const result = await executeReport({ metric: 'avg_first_response_time' });

    expect(result.metric).toBe('avg_first_response_time');
    expect(result.summary.sample_size).toBe(2); // t1 and t2 have agent replies
    expect(result.summary.avg_hours).toBeGreaterThan(0);
  });

  it('computes avg_resolution_time', async () => {
    const result = await executeReport({ metric: 'avg_resolution_time' });

    expect(result.summary.sample_size).toBe(2);
    expect(result.summary.avg_hours).toBeGreaterThan(0);
  });

  it('computes sla_compliance_rate', async () => {
    const result = await executeReport({ metric: 'sla_compliance_rate' });

    expect(result.metric).toBe('sla_compliance_rate');
    expect(result.summary.met + result.summary.breached).toBe(2);
  });

  it('computes csat_score', async () => {
    const result = await executeReport({ metric: 'csat_score' });

    expect(result.metric).toBe('csat_score');
    expect(result.summary.avg_score).toBe(4.5);
    expect(result.summary.count).toBe(2);
  });

  it('computes nps_score', async () => {
    const result = await executeReport({ metric: 'nps_score' });

    expect(result.metric).toBe('nps_score');
    // 1 promoter (9), 1 passive (7), 1 detractor (3) => (1-1)/3*100 = 0
    expect(result.summary.nps_score).toBe(0);
  });

  it('computes ces_score', async () => {
    const result = await executeReport({ metric: 'ces_score' });

    expect(result.metric).toBe('ces_score');
    expect(result.summary.ces_score).toBe(3);
  });

  it('computes channel_breakdown', async () => {
    const result = await executeReport({ metric: 'channel_breakdown' });

    expect(result.metric).toBe('channel_breakdown');
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('computes priority_distribution', async () => {
    const result = await executeReport({ metric: 'priority_distribution' });

    expect(result.rows.length).toBe(4);
    expect(result.summary.total).toBe(4);
  });

  it('computes ai_resolution_rate with no AI tickets', async () => {
    const result = await executeReport({ metric: 'ai_resolution_rate' });

    expect(result.summary.rate).toBe(0);
    expect(result.summary.ai_resolved).toBe(0);
  });

  it('applies date range filter', async () => {
    const result = await executeReport(
      { metric: 'ticket_volume', groupBy: ['date'] },
      { from: '2026-01-15', to: '2026-01-15' },
    );

    expect(result.summary.total).toBe(2); // Only tickets from Jan 15
    expect(result.dateRange).toEqual({ from: '2026-01-15', to: '2026-01-15' });
  });

  it('applies status filter', async () => {
    const result = await executeReport({
      metric: 'ticket_volume',
      filters: { status: 'open' },
    });

    expect(result.summary.total).toBe(1);
  });

  it('returns error summary for unknown metric', async () => {
    const result = await executeReport({ metric: 'nonexistent' });

    expect(result.summary.error).toBe(1);
    expect(result.rows).toEqual([]);
  });
});

describe('drillDown', () => {
  it('returns ticket IDs for a date group', async () => {
    const result = await drillDown(
      { metric: 'ticket_volume', groupBy: ['date'] },
      'date',
      '2026-01-15',
    );

    expect(result.count).toBe(2);
    expect(result.ticketIds).toContain('t1');
    expect(result.ticketIds).toContain('t2');
  });

  it('returns ticket IDs for an assignee group', async () => {
    const result = await drillDown(
      { metric: 'ticket_volume', groupBy: ['assignee'] },
      'assignee',
      'Alice',
    );

    expect(result.count).toBe(2);
    expect(result.ticketIds).toContain('t1');
    expect(result.ticketIds).toContain('t3');
  });

  it('returns ticket IDs for a tag group', async () => {
    const result = await drillDown(
      { metric: 'top_tags' },
      'tag',
      'login',
    );

    expect(result.count).toBe(2);
    expect(result.ticketIds).toContain('t1');
    expect(result.ticketIds).toContain('t4');
  });
});
