import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, noContentResponse, ZOHO_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('Zoho Desk CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with org name and agent count', async () => {
      const { zodeskVerifyConnection } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: '1', name: 'Agent Z' }] }));

      const result = await zodeskVerifyConnection(ZOHO_AUTH);
      expect(result.success).toBe(true);
      expect(result.orgName).toBe('Org org-123');
      expect(result.agentCount).toBe(1);
    });

    it('returns failure on auth error', async () => {
      const { zodeskVerifyConnection } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await zodeskVerifyConnection(ZOHO_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a ticket and returns string ID', async () => {
      const { zodeskCreateTicket } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'zd-desk-001' }));

      const result = await zodeskCreateTicket(ZOHO_AUTH, 'Test ticket', 'Description here', {
        priority: 'high', contactId: 'contact-1',
      });

      expect(result).toEqual({ id: 'zd-desk-001' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://desk.zoho.com/api/v1/tickets');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('Test ticket');
      expect(body.description).toBe('Description here');
      expect(body.priority).toBe('high');
      expect(body.contactId).toBe('contact-1');

      // Verify orgId header is present
      expect(opts.headers.orgId).toBe('org-123');
    });
  });

  describe('reply (sendReply)', () => {
    it('sends reply with EMAIL channel', async () => {
      const { zodeskSendReply } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(noContentResponse());

      await zodeskSendReply(ZOHO_AUTH, 'zd-desk-001', 'Reply content');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/tickets/zd-desk-001/sendReply');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.content).toBe('Reply content');
      expect(body.channel).toBe('EMAIL');
    });
  });

  describe('comment (addComment)', () => {
    it('posts internal comment by default', async () => {
      const { zodeskAddComment } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }));

      await zodeskAddComment(ZOHO_AUTH, 'zd-desk-001', 'Internal comment');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/tickets/zd-desk-001/comments');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.content).toBe('Internal comment');
      expect(body.isPublic).toBe(false);
    });

    it('posts public comment when isPublic=true', async () => {
      const { zodeskAddComment } = await import('../../../connectors/zoho-desk.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'comment-2' }));

      await zodeskAddComment(ZOHO_AUTH, 'zd-desk-001', 'Public comment', true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.isPublic).toBe(true);
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Zoho Desk export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('zd-desk-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports tickets and messages to JSONL with correct IDs and source', async () => {
    const { exportZohoDesk } = await import('../../../connectors/zoho-desk.js');

    mockFetch
      // tickets page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: '1', subject: 'Issue', status: 'Open', priority: 'High',
          assigneeId: '10', contactId: '20', departmentId: '30',
          createdTime: '2026-01-01T00:00:00Z', modifiedTime: '2026-01-02T00:00:00Z',
          cf: {}, channel: 'EMAIL',
        }],
      }))
      // tickets page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // threads for ticket 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: '100', content: 'Help me', direction: 'in', fromEmailAddress: 'a@t.com',
          isPrivate: false, createdTime: '2026-01-01T00:00:00Z',
        }],
      }))
      // threads page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // comments for ticket 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: '200', content: 'Agent note', isPublic: false,
          commentedBy: 'Agent Z', createdTime: '2026-01-01T12:00:00Z',
        }],
      }))
      // comments page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // contacts
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '20', firstName: 'Bob', lastName: 'B', email: 'bob@t.com', phone: null, accountId: null }],
      }))
      // contacts page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // agents
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: '10', name: 'Agent Z', emailId: 'agent@z.com' }] }))
      // accounts (organizations)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // KB categories
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const manifest = await exportZohoDesk(ZOHO_AUTH, tmpDir);

    expect(manifest.source).toBe('zoho-desk');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'zd-desk-1', source: 'zoho-desk' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Should have both thread and comment messages
    expect(messages[0]).toMatchObject({ ticketId: 'zd-desk-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.ZOHO_DESK_ORG_ID)('Zoho Desk CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → reply → comment', { timeout: 30_000 }, async () => {
    const { zodeskVerifyConnection, zodeskCreateTicket, zodeskSendReply, zodeskAddComment } =
      await import('../../../connectors/zoho-desk.js');
    const auth = {
      orgId: process.env.ZOHO_DESK_ORG_ID!,
      accessToken: process.env.ZOHO_DESK_ACCESS_TOKEN!,
      apiDomain: process.env.ZOHO_DESK_API_DOMAIN,
    };

    const verify = await zodeskVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await zodeskCreateTicket(auth, 'CLIaaS CRUD test', 'Automated test');
    expect(created.id).toBeTruthy();

    await zodeskSendReply(auth, created.id, 'Test reply');
    await zodeskAddComment(auth, created.id, 'Internal comment');
  });
});
