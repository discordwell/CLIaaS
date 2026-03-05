import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB context so tests don't need a real database
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});
const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: 'ws-1' }]),
    }),
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: 'ws-1' }]),
    }),
  }),
});

vi.mock('@/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock('@/db/schema', () => ({
  workspaces: { id: 'id', name: 'name', createdAt: 'created_at' },
  upstreamOutbox: {
    id: 'id',
    workspaceId: 'workspace_id',
    connector: 'connector',
    operation: 'operation',
    ticketId: 'ticket_id',
    externalId: 'external_id',
    payload: 'payload',
    status: 'status',
    externalResult: 'external_result',
    pushedAt: 'pushed_at',
    error: 'error',
    retryCount: 'retry_count',
    createdAt: 'created_at',
  },
}));

// Must import after mocks
import { enqueueUpstream } from '../../sync/upstream.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enqueueUpstream', () => {
  it('is a no-op without DATABASE_URL', async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await enqueueUpstream({
      connector: 'zendesk',
      operation: 'update_ticket',
      ticketId: 'tk-1',
      externalId: '999',
      payload: { status: 'solved' },
    });

    // Should not have called db.insert
    expect(mockInsert).not.toHaveBeenCalled();

    // Restore
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
  });

  it('inserts into upstream_outbox when DATABASE_URL is set', async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    await enqueueUpstream({
      connector: 'zendesk',
      operation: 'update_ticket',
      ticketId: 'tk-1',
      externalId: '999',
      payload: { status: 'solved' },
    });

    expect(mockInsert).toHaveBeenCalled();

    if (originalUrl) {
      process.env.DATABASE_URL = originalUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it('silently catches errors (fire-and-forget)', async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    // Make insert throw
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    // Should not throw
    await expect(
      enqueueUpstream({
        connector: 'zendesk',
        operation: 'create_reply',
        ticketId: 'tk-2',
        payload: { body: 'hello' },
      }),
    ).resolves.toBeUndefined();

    if (originalUrl) {
      process.env.DATABASE_URL = originalUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });
});
