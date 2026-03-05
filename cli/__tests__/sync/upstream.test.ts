import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock helpers ----

// When CLIAAS_WORKSPACE is not set, workspace lookup uses orderBy().limit() (no where call).
// So the only where() call in enqueueUpstream is the dedup check.
// dedupResult controls what the dedup select returns.
let dedupResult: unknown[] = [];

function makeWhereResult(result: unknown[]) {
  // Object that is both thenable (for dedup `await db.select().from().where()`)
  // and has .limit() (for workspace lookup `await db.select().from().where().limit()`)
  return {
    limit: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
}

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

const mockUpdateSet = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue(undefined),
});
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelect = vi.fn().mockImplementation(() => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockImplementation(() => makeWhereResult(dedupResult)),
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: 'ws-1' }]),
    }),
  }),
}));

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

let originalUrl: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  dedupResult = []; // default: no existing pending entry
  originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  delete process.env.CLIAAS_WORKSPACE; // ensure workspace lookup uses orderBy path
});

afterEach(() => {
  if (originalUrl) {
    process.env.DATABASE_URL = originalUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

describe('enqueueUpstream', () => {
  it('returns "skipped" without DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;

    const result = await enqueueUpstream({
      connector: 'zendesk',
      operation: 'update_ticket',
      ticketId: 'tk-1',
      externalId: '999',
      payload: { status: 'solved' },
    });

    expect(result).toBe('skipped');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts and returns "enqueued" when no pending duplicate exists', async () => {
    dedupResult = []; // no match

    const result = await enqueueUpstream({
      connector: 'zendesk',
      operation: 'update_ticket',
      ticketId: 'tk-1',
      externalId: '999',
      payload: { status: 'solved' },
    });

    expect(result).toBe('enqueued');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('silently catches errors (fire-and-forget)', async () => {
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await enqueueUpstream({
      connector: 'zendesk',
      operation: 'create_reply',
      ticketId: 'tk-2',
      payload: { body: 'hello' },
    });

    expect(result).toBe('skipped');
  });

  // ---- Dedup tests ----

  describe('dedup', () => {
    it('skips duplicate create_ticket', async () => {
      dedupResult = [{
        id: 'existing-1',
        connector: 'zendesk',
        operation: 'create_ticket',
        ticketId: 'tk-1',
        payload: { subject: 'Test' },
      }];

      const result = await enqueueUpstream({
        connector: 'zendesk',
        operation: 'create_ticket',
        ticketId: 'tk-1',
        payload: { subject: 'Test' },
      });

      expect(result).toBe('skipped');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('merges payload for duplicate update_ticket', async () => {
      dedupResult = [{
        id: 'existing-2',
        connector: 'freshdesk',
        operation: 'update_ticket',
        ticketId: 'tk-5',
        payload: { status: 'open', priority: 'low' },
      }];

      const result = await enqueueUpstream({
        connector: 'freshdesk',
        operation: 'update_ticket',
        ticketId: 'tk-5',
        payload: { priority: 'high', tags: ['urgent'] },
      });

      expect(result).toBe('merged');
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockUpdateSet).toHaveBeenCalledWith({
        payload: { status: 'open', priority: 'high', tags: ['urgent'] },
      });
    });

    it('skips duplicate create_reply with same body', async () => {
      dedupResult = [{
        id: 'existing-3',
        connector: 'groove',
        operation: 'create_reply',
        ticketId: 'tk-7',
        payload: { body: 'Thanks for reaching out!' },
      }];

      const result = await enqueueUpstream({
        connector: 'groove',
        operation: 'create_reply',
        ticketId: 'tk-7',
        payload: { body: 'Thanks for reaching out!' },
      });

      expect(result).toBe('skipped');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('allows create_reply with different body', async () => {
      dedupResult = [{
        id: 'existing-4',
        connector: 'groove',
        operation: 'create_reply',
        ticketId: 'tk-7',
        payload: { body: 'Thanks for reaching out!' },
      }];

      const result = await enqueueUpstream({
        connector: 'groove',
        operation: 'create_reply',
        ticketId: 'tk-7',
        payload: { body: 'A completely different reply.' },
      });

      expect(result).toBe('enqueued');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('skips duplicate create_note with same body', async () => {
      dedupResult = [{
        id: 'existing-5',
        connector: 'helpscout',
        operation: 'create_note',
        ticketId: 'tk-9',
        payload: { body: 'Internal note text' },
      }];

      const result = await enqueueUpstream({
        connector: 'helpscout',
        operation: 'create_note',
        ticketId: 'tk-9',
        payload: { body: 'Internal note text' },
      });

      expect(result).toBe('skipped');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('allows create_note with different body', async () => {
      dedupResult = [{
        id: 'existing-6',
        connector: 'helpscout',
        operation: 'create_note',
        ticketId: 'tk-9',
        payload: { body: 'Original note' },
      }];

      const result = await enqueueUpstream({
        connector: 'helpscout',
        operation: 'create_note',
        ticketId: 'tk-9',
        payload: { body: 'Updated note with new info' },
      });

      expect(result).toBe('enqueued');
      expect(mockInsert).toHaveBeenCalled();
    });
  });
});
