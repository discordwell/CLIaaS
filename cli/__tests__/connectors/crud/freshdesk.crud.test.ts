import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, noContentResponse, FRESHDESK_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('Freshdesk CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with user name and ticket count', async () => {
      const { freshdeskVerifyConnection } = await import('../../../connectors/freshdesk.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ contact: { name: 'Agent Jones' } }))
        .mockResolvedValueOnce(jsonResponse([]));

      const result = await freshdeskVerifyConnection(FRESHDESK_AUTH);
      expect(result.success).toBe(true);
      expect(result.userName).toBe('Agent Jones');
      expect(result.ticketCount).toBe(0);
    });

    it('returns failure on auth error', async () => {
      const { freshdeskVerifyConnection } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await freshdeskVerifyConnection(FRESHDESK_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a ticket and returns the ID', async () => {
      const { freshdeskCreateTicket } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 201 }));

      const result = await freshdeskCreateTicket(FRESHDESK_AUTH, 'Test ticket', 'Description here', {
        email: 'user@test.com', priority: 2, tags: ['cliaas-test-cleanup'],
      });

      expect(result).toEqual({ id: 201 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.freshdesk.com/api/v2/tickets');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('Test ticket');
      expect(body.description).toBe('Description here');
      expect(body.email).toBe('user@test.com');
      expect(body.tags).toEqual(['cliaas-test-cleanup']);
    });
  });

  describe('update', () => {
    it('sends PUT with correct payload', async () => {
      const { freshdeskUpdateTicket } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 201 }));

      await freshdeskUpdateTicket(FRESHDESK_AUTH, 201, { status: 3, priority: 4, tags: ['urgent'] });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.freshdesk.com/api/v2/tickets/201');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.status).toBe(3);
      expect(body.priority).toBe(4);
    });
  });

  describe('reply', () => {
    it('posts reply to correct endpoint', async () => {
      const { freshdeskReply } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 300 }));

      await freshdeskReply(FRESHDESK_AUTH, 201, 'Thanks for reaching out');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.freshdesk.com/api/v2/tickets/201/reply');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.body).toBe('Thanks for reaching out');
    });
  });

  describe('note', () => {
    it('posts private note to correct endpoint', async () => {
      const { freshdeskAddNote } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 301 }));

      await freshdeskAddNote(FRESHDESK_AUTH, 201, 'Internal observation');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.freshdesk.com/api/v2/tickets/201/notes');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.body).toBe('Internal observation');
      expect(body.private).toBe(true);
    });
  });

  describe('delete', () => {
    it('sends DELETE to correct URL', async () => {
      const { freshdeskDeleteTicket } = await import('../../../connectors/freshdesk.js');
      mockFetch.mockResolvedValueOnce(noContentResponse());

      await freshdeskDeleteTicket(FRESHDESK_AUTH, 201);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.freshdesk.com/api/v2/tickets/201');
      expect(opts.method).toBe('DELETE');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Freshdesk export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('fd-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports tickets and messages to JSONL with correct IDs and source', async () => {
    const { exportFreshdesk } = await import('../../../connectors/freshdesk.js');

    mockFetch
      // tickets page 1 (1 result < 100 → pagination stops)
      .mockResolvedValueOnce(jsonResponse([
        { id: 1, subject: 'Issue', status: 2, priority: 3, responder_id: 10, requester_id: 20,
          group_id: null, tags: ['bug'], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
      ]))
      // conversations for ticket 1 (1 result < 100 → stops)
      .mockResolvedValueOnce(jsonResponse([
        { id: 100, user_id: 20, body: 'Help me', body_text: 'Help me', incoming: true,
          private: false, created_at: '2026-01-01T00:00:00Z', attachments: [] },
      ]))
      // agents
      .mockResolvedValueOnce(jsonResponse([
        { id: 10, contact: { name: 'Agent J', email: 'agent@fd.com', phone: null } },
      ]))
      // contacts page 1 (1 result < 100 → stops)
      .mockResolvedValueOnce(jsonResponse([
        { id: 20, name: 'Bob', email: 'bob@t.com', phone: null, company_id: null },
      ]))
      // companies page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // KB categories (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // SLA policies (empty)
      .mockResolvedValueOnce(jsonResponse([]));

    const manifest = await exportFreshdesk(FRESHDESK_AUTH, tmpDir);

    expect(manifest.source).toBe('freshdesk');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'fd-1', source: 'freshdesk', subject: 'Issue' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'fd-msg-100', ticketId: 'fd-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.FRESHDESK_SUBDOMAIN)('Freshdesk CRUD lifecycle (live)', () => {
  let testTicketId: number | undefined;

  afterAll(async () => {
    if (testTicketId) {
      const { freshdeskDeleteTicket } = await import('../../../connectors/freshdesk.js');
      const auth = { subdomain: process.env.FRESHDESK_SUBDOMAIN!, apiKey: process.env.FRESHDESK_API_KEY! };
      await freshdeskDeleteTicket(auth, testTicketId).catch(() => {});
    }
  });

  it('full lifecycle: verify → create → update → reply → note → delete', { timeout: 30_000 }, async () => {
    const { freshdeskVerifyConnection, freshdeskCreateTicket, freshdeskUpdateTicket, freshdeskReply, freshdeskAddNote, freshdeskDeleteTicket } =
      await import('../../../connectors/freshdesk.js');
    const auth = { subdomain: process.env.FRESHDESK_SUBDOMAIN!, apiKey: process.env.FRESHDESK_API_KEY! };

    const verify = await freshdeskVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await freshdeskCreateTicket(auth, 'CLIaaS CRUD test', 'Automated test', {
      email: 'test@cliaas.com', tags: ['cliaas-test-cleanup'],
    });
    testTicketId = created.id;
    expect(created.id).toBeGreaterThan(0);

    await freshdeskUpdateTicket(auth, created.id, { priority: 3 });
    await freshdeskReply(auth, created.id, 'Test reply');
    await freshdeskAddNote(auth, created.id, 'Internal note');
    await freshdeskDeleteTicket(auth, created.id);
    testTicketId = undefined;
  });
});
