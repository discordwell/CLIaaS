import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, noContentResponse, INTERCOM_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('Intercom CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with app name and admin count', async () => {
      const { intercomVerifyConnection } = await import('../../../connectors/intercom.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ app: { name: 'TestApp' }, type: 'app' }))
        .mockResolvedValueOnce(jsonResponse({ admins: [{ id: '1', name: 'Admin I', email: 'a@i.com' }] }));

      const result = await intercomVerifyConnection(INTERCOM_AUTH);
      expect(result.success).toBe(true);
      expect(result.appName).toBe('TestApp');
      expect(result.adminCount).toBe(1);
    });

    it('returns failure on auth error', async () => {
      const { intercomVerifyConnection } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await intercomVerifyConnection(INTERCOM_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a conversation and returns string ID', async () => {
      const { intercomCreateConversation } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ conversation_id: 'conv-abc-123' }));

      const result = await intercomCreateConversation(INTERCOM_AUTH, 'contact-xyz', 'Hello from user');

      expect(result).toEqual({ id: 'conv-abc-123' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.intercom.io/conversations');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.from).toEqual({ type: 'user', id: 'contact-xyz' });
      expect(body.body).toBe('Hello from user');
    });
  });

  describe('reply', () => {
    it('posts reply with admin type', async () => {
      const { intercomReplyToConversation } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ type: 'conversation' }));

      await intercomReplyToConversation(INTERCOM_AUTH, 'conv-abc-123', 'Admin reply', 'admin-1');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/conversations/conv-abc-123/reply');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.message_type).toBe('comment');
      expect(body.type).toBe('admin');
      expect(body.admin_id).toBe('admin-1');
      expect(body.body).toBe('Admin reply');
    });
  });

  describe('note', () => {
    it('posts note with message_type=note', async () => {
      const { intercomAddNote } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ type: 'conversation' }));

      await intercomAddNote(INTERCOM_AUTH, 'conv-abc-123', 'Internal note', 'admin-1');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message_type).toBe('note');
      expect(body.type).toBe('admin');
    });
  });

  describe('delete conversation', () => {
    it('sends DELETE with Unstable API version', async () => {
      const { intercomDeleteConversation } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(noContentResponse());

      await intercomDeleteConversation(INTERCOM_AUTH, 'conv-abc-123');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/conversations/conv-abc-123');
      expect(opts.method).toBe('DELETE');
      // Unstable version header
      expect(opts.headers['Intercom-Version']).toBe('Unstable');
    });
  });

  describe('delete contact', () => {
    it('sends DELETE to contacts endpoint', async () => {
      const { intercomDeleteContact } = await import('../../../connectors/intercom.js');
      mockFetch.mockResolvedValueOnce(noContentResponse());

      await intercomDeleteContact(INTERCOM_AUTH, 'contact-xyz');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/contacts/contact-xyz');
      expect(opts.method).toBe('DELETE');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Intercom export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('ic-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports conversations and parts to JSONL with correct IDs and source', async () => {
    const { exportIntercom } = await import('../../../connectors/intercom.js');

    mockFetch
      // conversations page 1
      .mockResolvedValueOnce(jsonResponse({
        conversations: [{
          id: 'conv-1',
          source: { body: '<p>Help</p>', author: { id: 'user-1', type: 'user' }, delivered_as: 'customer_initiated' },
          state: 'open', priority: 'not_priority',
          contacts: { contacts: [{ id: 'user-1', type: 'user' }] },
          assignee: { id: '10', type: 'admin' },
          tags: { tags: [] },
          created_at: 1706745600, updated_at: 1706832000,
        }],
        pages: { total_pages: 1 },
      }))
      // conversations page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ conversations: [], pages: { total_pages: 1 } }))
      // conversation detail (for parts)
      .mockResolvedValueOnce(jsonResponse({
        id: 'conv-1',
        conversation_parts: {
          conversation_parts: [{
            id: 'part-100', part_type: 'comment', body: 'Reply here',
            author: { id: '10', type: 'admin' }, created_at: 1706832000,
          }],
        },
      }))
      // contacts page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'user-1', name: 'User A', email: 'a@t.com', phone: null, role: 'user',
          companies: { data: [] }, type: 'contact' }],
        pages: { total_pages: 1 },
      }))
      // contacts page 2 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [], pages: { total_pages: 1 } }))
      // admins
      .mockResolvedValueOnce(jsonResponse({ admins: [{ id: '10', name: 'Admin I', email: 'admin@i.com' }] }))
      // companies scroll
      .mockResolvedValueOnce(jsonResponse({ data: [], scroll_param: null }))
      // KB articles
      .mockResolvedValueOnce(jsonResponse({ data: [], pages: { total_pages: 1 } }));

    const manifest = await exportIntercom(INTERCOM_AUTH, tmpDir);

    expect(manifest.source).toBe('intercom');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'ic-conv-1', source: 'intercom' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]).toMatchObject({ ticketId: 'ic-conv-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.INTERCOM_ACCESS_TOKEN)('Intercom CRUD lifecycle (live)', () => {
  let testConversationId: string | undefined;

  afterEach(async () => {
    if (testConversationId) {
      const { intercomDeleteConversation } = await import('../../../connectors/intercom.js');
      const auth = { accessToken: process.env.INTERCOM_ACCESS_TOKEN! };
      await intercomDeleteConversation(auth, testConversationId).catch(() => {});
      testConversationId = undefined;
    }
  });

  it('full lifecycle: verify → create → reply → note → delete', { timeout: 30_000 }, async () => {
    const { intercomVerifyConnection, intercomCreateConversation, intercomReplyToConversation, intercomAddNote, intercomDeleteConversation } =
      await import('../../../connectors/intercom.js');
    const auth = { accessToken: process.env.INTERCOM_ACCESS_TOKEN! };
    const contactId = process.env.INTERCOM_TEST_CONTACT_ID!;
    const adminId = process.env.INTERCOM_TEST_ADMIN_ID!;

    const verify = await intercomVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await intercomCreateConversation(auth, contactId, 'CLIaaS CRUD test');
    testConversationId = created.id;
    expect(created.id).toBeTruthy();

    await intercomReplyToConversation(auth, created.id, 'Test reply', adminId);
    await intercomAddNote(auth, created.id, 'Internal note', adminId);
    await intercomDeleteConversation(auth, created.id);
    testConversationId = undefined;
  });
});
