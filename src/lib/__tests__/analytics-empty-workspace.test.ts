/**
 * Analytics empty-workspace tests.
 *
 * Verifies that computeAnalytics() returns valid zeroed-out metrics
 * when the data source is empty (no tickets, no messages, no ratings)
 * or completely unavailable (provider throws).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Analytics – empty workspace', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns zeroed-out metrics when data loaders return empty arrays', async () => {
    // Mock the data module to return empty arrays (simulates empty workspace)
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadCSATRatings: vi.fn().mockResolvedValue([]),
      loadSurveyResponses: vi.fn().mockResolvedValue([]),
    }));

    const { computeAnalytics } = await import('@/lib/analytics');
    const data = await computeAnalytics();

    // Volume
    expect(data.totalTickets).toBe(0);
    expect(data.ticketsCreated).toEqual([]);
    expect(data.ticketsByChannel).toEqual({});
    expect(data.ticketsBySource).toEqual({});

    // Performance
    expect(data.avgResponseTimeHours).toBe(0);
    expect(data.avgResolutionTimeHours).toBe(0);

    // SLA
    expect(data.firstResponseSLA).toEqual({ met: 0, breached: 0 });
    expect(data.resolutionSLA).toEqual({ met: 0, breached: 0 });

    // Agent
    expect(data.agentPerformance).toEqual([]);

    // Satisfaction
    expect(data.csatOverall).toBe(0);
    expect(data.csatTrend).toEqual([]);

    // NPS
    expect(data.npsScore).toBe(0);
    expect(data.npsTrend).toEqual([]);
    expect(data.npsBreakdown).toEqual({ promoters: 0, passives: 0, detractors: 0 });

    // CES
    expect(data.cesScore).toBe(0);
    expect(data.cesTrend).toEqual([]);

    // Tags & priority
    expect(data.topTags).toEqual([]);
    expect(data.priorityDistribution).toEqual({});

    // Period comparison
    expect(data.periodComparison.current).toEqual({ tickets: 0, avgResponseHours: 0, resolved: 0 });
    expect(data.periodComparison.previous).toEqual({ tickets: 0, avgResponseHours: 0, resolved: 0 });

    // Date range should be today's date
    const today = new Date().toISOString().slice(0, 10);
    expect(data.dateRange.from).toBe(today);
    expect(data.dateRange.to).toBe(today);
  });

  it('returns zeroed-out metrics when data loaders throw (no workspace)', async () => {
    // Mock the data module to throw (simulates "No workspace found" from DbProvider)
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadMessages: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadCSATRatings: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadSurveyResponses: vi.fn().mockRejectedValue(new Error('No workspace found.')),
    }));

    const { computeAnalytics } = await import('@/lib/analytics');
    const data = await computeAnalytics();

    expect(data.totalTickets).toBe(0);
    expect(data.ticketsCreated).toEqual([]);
    expect(data.avgResponseTimeHours).toBe(0);
    expect(data.avgResolutionTimeHours).toBe(0);
    expect(data.agentPerformance).toEqual([]);
    expect(data.csatOverall).toBe(0);
    expect(data.npsScore).toBe(0);
    expect(data.cesScore).toBe(0);
    expect(data.periodComparison.current.tickets).toBe(0);
    expect(data.periodComparison.previous.tickets).toBe(0);
  });

  it('returns zeroed-out metrics with custom date range when loaders throw', async () => {
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockRejectedValue(new Error('Database not configured.')),
      loadMessages: vi.fn().mockRejectedValue(new Error('Database not configured.')),
      loadCSATRatings: vi.fn().mockRejectedValue(new Error('Database not configured.')),
      loadSurveyResponses: vi.fn().mockRejectedValue(new Error('Database not configured.')),
    }));

    const { computeAnalytics } = await import('@/lib/analytics');
    const data = await computeAnalytics({
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    });

    expect(data.totalTickets).toBe(0);
    expect(data.dateRange.from).toBe('2026-01-01');
    expect(data.dateRange.to).toBe('2026-01-31');
  });

  it('API route returns 200 with valid analytics for empty workspace', async () => {
    // Mock the data module to return empty arrays
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadCSATRatings: vi.fn().mockResolvedValue([]),
      loadSurveyResponses: vi.fn().mockResolvedValue([]),
    }));

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/analytics/route');

    const req = new NextRequest('http://localhost:3000/api/analytics');
    const res = await GET(req);

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.totalTickets).toBe(0);
    expect(json.avgResponseTimeHours).toBe(0);
    expect(json.avgResolutionTimeHours).toBe(0);
    expect(json.ticketsCreated).toEqual([]);
    expect(json.agentPerformance).toEqual([]);
  });

  it('API route returns 200 (not 500) when data provider throws', async () => {
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadMessages: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadCSATRatings: vi.fn().mockRejectedValue(new Error('No workspace found.')),
      loadSurveyResponses: vi.fn().mockRejectedValue(new Error('No workspace found.')),
    }));

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/analytics/route');

    const req = new NextRequest('http://localhost:3000/api/analytics');
    const res = await GET(req);

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.totalTickets).toBe(0);
    expect(json.error).toBeUndefined();
  });
});
