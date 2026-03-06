import { describe, it, expect, vi } from 'vitest';
import { computeLiveSnapshot } from '../live-metrics';

const mockTickets = [
  { id: 't1', subject: 'A', status: 'open', priority: 'high', assignee: 'Alice', requester: 'a@t.com', source: 'zendesk', tags: [], createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), updatedAt: new Date().toISOString() },
  { id: 't2', subject: 'B', status: 'pending', priority: 'normal', assignee: 'Bob', requester: 'b@t.com', source: 'zendesk', tags: [], createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), updatedAt: new Date().toISOString() },
  { id: 't3', subject: 'C', status: 'solved', priority: 'low', assignee: 'Alice', requester: 'c@t.com', source: 'zendesk', tags: [], createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
  { id: 't4', subject: 'D', status: 'open', priority: 'urgent', assignee: 'Bob', requester: 'd@t.com', source: 'zendesk', tags: [], createdAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(), updatedAt: new Date().toISOString() },
];

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: () => ({
    loadTickets: () => Promise.resolve(mockTickets),
  }),
}));

vi.mock('@/lib/routing/availability', () => ({
  availability: {
    getAllAvailability: () => [
      { userId: 'u1', status: 'online' },
      { userId: 'u2', status: 'online' },
      { userId: 'u3', status: 'away' },
    ],
  },
}));

describe('computeLiveSnapshot', () => {
  it('returns correct queue depth', async () => {
    const snap = await computeLiveSnapshot();
    expect(snap.queueDepth.open).toBe(2);
    expect(snap.queueDepth.pending).toBe(1);
  });

  it('returns agents online count', async () => {
    const snap = await computeLiveSnapshot();
    expect(snap.agentsOnline).toBe(2);
  });

  it('returns avg wait hours > 0 for open tickets', async () => {
    const snap = await computeLiveSnapshot();
    expect(snap.avgWaitHours).toBeGreaterThan(0);
  });

  it('counts tickets created in last hour', async () => {
    const snap = await computeLiveSnapshot();
    expect(snap.createdLastHour).toBe(2); // t1 (30 min ago) + t4 (50 min ago)
  });

  it('counts SLA at-risk tickets', async () => {
    const snap = await computeLiveSnapshot();
    // t4 created 50 min ago > 45 min threshold
    expect(snap.slaAtRisk).toBe(1);
  });

  it('includes a valid timestamp', async () => {
    const snap = await computeLiveSnapshot();
    expect(snap.timestamp).toBeDefined();
    expect(new Date(snap.timestamp).getTime()).not.toBeNaN();
  });
});
