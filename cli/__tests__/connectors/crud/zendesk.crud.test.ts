import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, noContentResponse, ZENDESK_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('Zendesk CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with user name and ticket count', async () => {
      const { zendeskVerifyConnection } = await import('../../../connectors/zendesk.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ user: { name: 'Agent Smith', email: 'a@t.com', role: 'admin' } }))
        .mockResolvedValueOnce(jsonResponse({ count: { value: 42 } }));

      const result = await zendeskVerifyConnection(ZENDESK_AUTH);
      expect(result).toEqual({ success: true, userName: 'Agent Smith', ticketCount: 42 });
    });

    it('returns failure on auth error', async () => {
      const { zendeskVerifyConnection } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await zendeskVerifyConnection(ZENDESK_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('create', () => {
    it('creates a ticket and returns the ID', async () => {
      const { zendeskCreateTicket } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ticket: { id: 101 } }));

      const result = await zendeskCreateTicket(ZENDESK_AUTH, 'Test ticket', 'Body text', {
        priority: 'high', tags: ['cliaas-test-cleanup'],
      });

      expect(result).toEqual({ id: 101 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.zendesk.com/api/v2/tickets.json');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.ticket.subject).toBe('Test ticket');
      expect(body.ticket.comment.body).toBe('Body text');
      expect(body.ticket.priority).toBe('high');
      expect(body.ticket.tags).toEqual(['cliaas-test-cleanup']);
    });
  });

  describe('update', () => {
    it('sends PUT with correct payload', async () => {
      const { zendeskUpdateTicket } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ticket: { id: 101 } }));

      await zendeskUpdateTicket(ZENDESK_AUTH, 101, { status: 'pending', priority: 'urgent' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.zendesk.com/api/v2/tickets/101.json');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.ticket.status).toBe('pending');
      expect(body.ticket.priority).toBe('urgent');
    });
  });

  describe('reply (public comment)', () => {
    it('posts a public comment via PUT', async () => {
      const { zendeskPostComment } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ticket: { id: 101 } }));

      await zendeskPostComment(ZENDESK_AUTH, 101, 'Hello customer', true);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.zendesk.com/api/v2/tickets/101.json');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.ticket.comment.body).toBe('Hello customer');
      expect(body.ticket.comment.public).toBe(true);
    });
  });

  describe('note (internal comment)', () => {
    it('posts an internal comment via PUT', async () => {
      const { zendeskPostComment } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ticket: { id: 101 } }));

      await zendeskPostComment(ZENDESK_AUTH, 101, 'Internal note', false);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ticket.comment.public).toBe(false);
    });
  });

  describe('delete', () => {
    it('sends DELETE to correct URL', async () => {
      const { zendeskDeleteTicket } = await import('../../../connectors/zendesk.js');
      mockFetch.mockResolvedValueOnce(noContentResponse());

      await zendeskDeleteTicket(ZENDESK_AUTH, 101);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.zendesk.com/api/v2/tickets/101.json');
      expect(opts.method).toBe('DELETE');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Zendesk export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('zd-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports tickets and messages to JSONL with correct IDs and source', async () => {
    const { exportZendesk } = await import('../../../connectors/zendesk.js');

    // Page 1: one ticket (end_of_stream to stop pagination)
    mockFetch
      // tickets cursor page
      .mockResolvedValueOnce(jsonResponse({
        tickets: [{ id: 1, subject: 'Bug', status: 'open', priority: 'high', assignee_id: 10,
          requester_id: 20, tags: ['bug'], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }],
        end_of_stream: true,
      }))
      // comments for ticket 1
      .mockResolvedValueOnce(jsonResponse({
        comments: [{ id: 100, author_id: 20, body: 'Help!', html_body: '<p>Help!</p>', public: true, created_at: '2026-01-01T00:00:00Z' }],
      }))
      // users cursor page
      .mockResolvedValueOnce(jsonResponse({ users: [{ id: 20, name: 'Alice', email: 'a@t.com', phone: null, organization_id: null }], end_of_stream: true }))
      // organizations
      .mockResolvedValueOnce(jsonResponse({ organizations: [], links: {} }))
      // groups
      .mockResolvedValueOnce(jsonResponse({ groups: [] }))
      // ticket_fields
      .mockResolvedValueOnce(jsonResponse({ ticket_fields: [] }))
      // views
      .mockResolvedValueOnce(jsonResponse({ views: [] }))
      // ticket_forms
      .mockResolvedValueOnce(jsonResponse({ ticket_forms: [] }))
      // brands
      .mockResolvedValueOnce(jsonResponse({ brands: [] }))
      // audits
      .mockResolvedValueOnce(jsonResponse({ audits: [] }))
      // satisfaction_ratings
      .mockResolvedValueOnce(jsonResponse({ satisfaction_ratings: [] }))
      // time_entries
      .mockResolvedValueOnce(jsonResponse({ time_entries: [] }))
      // KB articles
      .mockResolvedValueOnce(jsonResponse({ articles: [] }))
      // macros
      .mockResolvedValueOnce(jsonResponse({ macros: [] }))
      // triggers
      .mockResolvedValueOnce(jsonResponse({ triggers: [] }))
      // automations
      .mockResolvedValueOnce(jsonResponse({ automations: [] }))
      // SLA policies
      .mockResolvedValueOnce(jsonResponse({ sla_policies: [] }));

    const manifest = await exportZendesk(ZENDESK_AUTH, tmpDir);

    expect(manifest.source).toBe('zendesk');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'zd-1', source: 'zendesk', subject: 'Bug' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'zd-msg-100', ticketId: 'zd-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.ZENDESK_SUBDOMAIN)('Zendesk CRUD lifecycle (live)', () => {
  let testTicketId: number | undefined;

  afterAll(async () => {
    if (testTicketId) {
      const { zendeskDeleteTicket } = await import('../../../connectors/zendesk.js');
      const auth = {
        subdomain: process.env.ZENDESK_SUBDOMAIN!,
        email: process.env.ZENDESK_EMAIL!,
        token: process.env.ZENDESK_TOKEN!,
      };
      await zendeskDeleteTicket(auth, testTicketId).catch(() => {});
    }
  });

  it('full lifecycle: verify → create → update → reply → note → delete', { timeout: 30_000 }, async () => {
    const { zendeskVerifyConnection, zendeskCreateTicket, zendeskUpdateTicket, zendeskPostComment, zendeskDeleteTicket } =
      await import('../../../connectors/zendesk.js');
    const auth = {
      subdomain: process.env.ZENDESK_SUBDOMAIN!,
      email: process.env.ZENDESK_EMAIL!,
      token: process.env.ZENDESK_TOKEN!,
    };

    const verify = await zendeskVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await zendeskCreateTicket(auth, 'CLIaaS CRUD test', 'Automated test', { tags: ['cliaas-test-cleanup'] });
    testTicketId = created.id;
    expect(created.id).toBeGreaterThan(0);

    await zendeskUpdateTicket(auth, created.id, { priority: 'high' });
    await zendeskPostComment(auth, created.id, 'Test reply', true);
    await zendeskPostComment(auth, created.id, 'Internal note', false);
    await zendeskDeleteTicket(auth, created.id);
    testTicketId = undefined;
  });
});
