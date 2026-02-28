import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, GROOVE_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  // Use fake timers to skip Groove's 2500ms preRequestDelay
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- CRUD lifecycle (mocked) ----

describe('Groove CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with agent count', async () => {
      const { grooveVerifyConnection } = await import('../../../connectors/groove.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ agents: [{ id: 1, name: 'Agent G' }] }));

      const result = await grooveVerifyConnection(GROOVE_AUTH);
      expect(result.success).toBe(true);
      expect(result.agentCount).toBe(1);
    });

    it('returns failure on auth error', async () => {
      const { grooveVerifyConnection } = await import('../../../connectors/groove.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await grooveVerifyConnection(GROOVE_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a ticket and returns the number', async () => {
      const { grooveCreateTicket } = await import('../../../connectors/groove.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ticket: { number: 301 } }));

      const result = await grooveCreateTicket(GROOVE_AUTH, 'user@test.com', 'Ticket body', {
        subject: 'Test ticket', tags: ['cliaas-test-cleanup'],
      });

      expect(result).toEqual({ number: 301 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.groovehq.com/v1/tickets');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.to).toBe('user@test.com');
      expect(body.body).toBe('Ticket body');
      expect(body.subject).toBe('Test ticket');
      expect(body.tags).toEqual(['cliaas-test-cleanup']);
    });
  });

  describe('update', () => {
    it('sends separate PUT calls for state, assignee, and tags', { timeout: 30_000 }, async () => {
      const { grooveUpdateTicket } = await import('../../../connectors/groove.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ ticket: { state: 'pending' } }))
        .mockResolvedValueOnce(jsonResponse({ ticket: { assignee: 'agent@g.com' } }))
        .mockResolvedValueOnce(jsonResponse({ ticket: { tags: ['bug'] } }));

      await grooveUpdateTicket(GROOVE_AUTH, 301, {
        state: 'pending', assignee: 'agent@g.com', tags: ['bug'],
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [stateUrl, stateOpts] = mockFetch.mock.calls[0];
      expect(stateUrl).toContain('/tickets/301/state');
      expect(stateOpts.method).toBe('PUT');

      const [assigneeUrl] = mockFetch.mock.calls[1];
      expect(assigneeUrl).toContain('/tickets/301/assignee');

      const [tagsUrl] = mockFetch.mock.calls[2];
      expect(tagsUrl).toContain('/tickets/301/tags');
    });
  });

  describe('reply (message)', () => {
    it('posts a message to correct endpoint', async () => {
      const { groovePostMessage } = await import('../../../connectors/groove.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: { id: 400 } }));

      await groovePostMessage(GROOVE_AUTH, 301, 'Reply text', false);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/tickets/301/messages');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.body).toBe('Reply text');
      expect(body.note).toBe(false);
    });
  });

  describe('note', () => {
    it('posts a note with note=true', async () => {
      const { groovePostMessage } = await import('../../../connectors/groove.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: { id: 401 } }));

      await groovePostMessage(GROOVE_AUTH, 301, 'Internal note', true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.note).toBe(true);
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Groove export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('gv-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports tickets and messages to JSONL with correct IDs and source', { timeout: 60_000 }, async () => {
    const { exportGroove } = await import('../../../connectors/groove.js');

    mockFetch
      // tickets (pageSize=50, dataKey='tickets'; 1 result < 50 → stops)
      .mockResolvedValueOnce(jsonResponse({
        tickets: [{
          number: 1, title: 'Issue', state: 'opened',
          tags: ['bug'],
          links: {
            assignee: { href: 'https://api.groovehq.com/v1/agents/10' },
            customer: { href: 'https://api.groovehq.com/v1/customers/user@t.com' },
          },
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
        }],
      }))
      // messages for ticket 1 (pageSize=50, dataKey='messages'; 1 < 50 → stops)
      .mockResolvedValueOnce(jsonResponse({
        messages: [{
          href: 'https://api.groovehq.com/v1/messages/100',
          body: '<p>Help!</p>', plain_text_body: 'Help!', note: false,
          links: { author: { href: 'https://api.groovehq.com/v1/customers/user@t.com' } },
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        }],
      }))
      // customers (pageSize=50; 1 < 50 → stops)
      .mockResolvedValueOnce(jsonResponse({
        customers: [{ email: 'user@t.com', name: 'User A', company_name: null }],
      }))
      // agents
      .mockResolvedValueOnce(jsonResponse({ agents: [{ id: 10, name: 'Agent G', email: 'agent@g.com' }] }))
      // KB knowledge_bases
      .mockResolvedValueOnce(jsonResponse({ knowledge_bases: [] }));

    const manifest = await exportGroove(GROOVE_AUTH, tmpDir);

    expect(manifest.source).toBe('groove');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'gv-1', source: 'groove' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ticketId: 'gv-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.GROOVE_API_TOKEN)('Groove CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → update → reply → note', { timeout: 30_000 }, async () => {
    const { grooveVerifyConnection, grooveCreateTicket, grooveUpdateTicket, groovePostMessage } =
      await import('../../../connectors/groove.js');
    const auth = { apiToken: process.env.GROOVE_API_TOKEN! };

    const verify = await grooveVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await grooveCreateTicket(auth, 'test@cliaas.com', 'Automated test', {
      subject: 'CLIaaS CRUD test', tags: ['cliaas-test-cleanup'],
    });
    expect(created.number).toBeGreaterThan(0);

    await grooveUpdateTicket(auth, created.number, { state: 'pending' });
    await groovePostMessage(auth, created.number, 'Test reply', false);
    await groovePostMessage(auth, created.number, 'Internal note', true);
  });
});
