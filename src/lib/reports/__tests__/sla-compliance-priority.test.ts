/**
 * SLA-compliance report must classify first response against the per-priority
 * target the SLA engine enforces (urgent 15m, high 60m, normal 240m, low 480m),
 * not a flat 1h. Regression for the flat-target bug that inverted the result for
 * every priority except `high`.
 */

import { describe, it, expect, vi } from 'vitest';

// Each ticket is answered by an agent at a delay chosen to straddle its real
// per-priority target but sit on the *wrong* side of a flat 1h target, so the
// old and new classifications disagree for urgent and low.
const mockTickets = [
  // urgent target 15m; answered in 45m → breached (old flat-1h wrongly said met)
  {
    id: 'u1', subject: 'urgent', status: 'open', priority: 'urgent',
    assignee: 'Alice', requester: 'c@test.com', source: 'zendesk',
    tags: [], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T10:45:00Z',
  },
  // low target 480m; answered in 90m → met (old flat-1h wrongly said breached)
  {
    id: 'l1', subject: 'low', status: 'open', priority: 'low',
    assignee: 'Alice', requester: 'c@test.com', source: 'zendesk',
    tags: [], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T11:30:00Z',
  },
  // high target 60m; answered in 30m → met
  {
    id: 'h1', subject: 'high', status: 'open', priority: 'high',
    assignee: 'Alice', requester: 'c@test.com', source: 'zendesk',
    tags: [], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T10:30:00Z',
  },
  // normal target 240m; answered in 270m → breached
  {
    id: 'n1', subject: 'normal', status: 'open', priority: 'normal',
    assignee: 'Alice', requester: 'c@test.com', source: 'zendesk',
    tags: [], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T14:30:00Z',
  },
];

const mockMessages = [
  { id: 'mu', ticketId: 'u1', type: 'reply', author: 'Alice', body: 'hi', createdAt: '2026-01-15T10:45:00Z' },
  { id: 'ml', ticketId: 'l1', type: 'reply', author: 'Alice', body: 'hi', createdAt: '2026-01-15T11:30:00Z' },
  { id: 'mh', ticketId: 'h1', type: 'reply', author: 'Alice', body: 'hi', createdAt: '2026-01-15T10:30:00Z' },
  { id: 'mn', ticketId: 'n1', type: 'reply', author: 'Alice', body: 'hi', createdAt: '2026-01-15T14:30:00Z' },
];

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: () => ({
    loadTickets: () => Promise.resolve(mockTickets),
    loadMessages: () => Promise.resolve(mockMessages),
    loadCSATRatings: () => Promise.resolve([]),
    loadSurveyResponses: () => Promise.resolve([]),
  }),
}));

describe('sla_compliance_rate — per-priority first-response targets', () => {
  it('classifies each ticket against its priority target, not a flat 1h', async () => {
    const { executeReport } = await import('../engine');
    const result = await executeReport({ metric: 'sla_compliance_rate', groupBy: ['priority'] });

    const byPriority = Object.fromEntries(
      result.rows.map(r => [r.priority as string, r]),
    );

    // urgent answered in 45m > 15m target → breached
    expect(byPriority.urgent).toMatchObject({ met: 0, breached: 1, rate: 0 });
    // low answered in 90m < 480m target → met
    expect(byPriority.low).toMatchObject({ met: 1, breached: 0, rate: 100 });
    // high answered in 30m < 60m target → met
    expect(byPriority.high).toMatchObject({ met: 1, breached: 0 });
    // normal answered in 270m > 240m target → breached
    expect(byPriority.normal).toMatchObject({ met: 0, breached: 1 });

    // Overall: 2 met (low, high), 2 breached (urgent, normal).
    expect(result.summary.met).toBe(2);
    expect(result.summary.breached).toBe(2);
  });
});
