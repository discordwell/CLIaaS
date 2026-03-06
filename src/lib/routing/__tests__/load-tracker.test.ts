import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the data provider before importing load-tracker
vi.mock('../../data-provider/index', () => ({
  getDataProvider: vi.fn(),
}));

import { loadTracker } from '../load-tracker';
import { getDataProvider } from '../../data-provider/index';

const mockGetDataProvider = vi.mocked(getDataProvider);

function makeTickets(assignments: Array<{ assignee: string; status: string }>) {
  return assignments.map((a, i) => ({
    id: `ticket-${i}`,
    externalId: `ext-${i}`,
    source: 'zendesk',
    subject: 'Test',
    status: a.status,
    priority: 'normal',
    requester: 'user@test.com',
    assignee: a.assignee,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

describe('LoadTracker', () => {
  beforeEach(() => {
    loadTracker.destroy();
    vi.clearAllMocks();
  });

  afterEach(() => {
    loadTracker.destroy();
  });

  it('returns 0 for unknown agent', () => {
    expect(loadTracker.getLoad('nonexistent')).toBe(0);
  });

  it('counts open tickets per assignee', async () => {
    mockGetDataProvider.mockResolvedValue({
      loadTickets: vi.fn().mockResolvedValue(makeTickets([
        { assignee: 'Alice', status: 'open' },
        { assignee: 'Alice', status: 'pending' },
        { assignee: 'Bob', status: 'open' },
        { assignee: 'Alice', status: 'open' },
      ])),
      capabilities: { mode: 'local', supportsWrite: false, supportsSync: false, supportsRag: false },
    } as any);

    await loadTracker.ensureLoaded();

    expect(loadTracker.getLoad('Alice')).toBe(3);
    expect(loadTracker.getLoad('Bob')).toBe(1);
  });

  it('ignores solved/closed tickets', async () => {
    mockGetDataProvider.mockResolvedValue({
      loadTickets: vi.fn().mockResolvedValue(makeTickets([
        { assignee: 'Alice', status: 'open' },
        { assignee: 'Alice', status: 'solved' },
        { assignee: 'Alice', status: 'closed' },
      ])),
      capabilities: { mode: 'local', supportsWrite: false, supportsSync: false, supportsRag: false },
    } as any);

    await loadTracker.ensureLoaded();

    expect(loadTracker.getLoad('Alice')).toBe(1);
  });

  it('cache invalidation forces reload', async () => {
    const loadTicketsFn = vi.fn()
      .mockResolvedValueOnce(makeTickets([
        { assignee: 'Alice', status: 'open' },
      ]))
      .mockResolvedValueOnce(makeTickets([
        { assignee: 'Alice', status: 'open' },
        { assignee: 'Alice', status: 'open' },
      ]));

    mockGetDataProvider.mockResolvedValue({
      loadTickets: loadTicketsFn,
      capabilities: { mode: 'local', supportsWrite: false, supportsSync: false, supportsRag: false },
    } as any);

    await loadTracker.ensureLoaded();
    expect(loadTracker.getLoad('Alice')).toBe(1);

    loadTracker.invalidate();
    await loadTracker.ensureLoaded();
    expect(loadTracker.getLoad('Alice')).toBe(2);
    expect(loadTicketsFn).toHaveBeenCalledTimes(2);
  });
});
