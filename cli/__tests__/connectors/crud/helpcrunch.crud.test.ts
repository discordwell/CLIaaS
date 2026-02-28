import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, HELPCRUNCH_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('HelpCrunch CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with agent and chat counts', async () => {
      const { helpcrunchVerifyConnection } = await import('../../../connectors/helpcrunch.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1, name: 'Agent H' }] }))
        .mockResolvedValueOnce(jsonResponse({ data: [], meta: { total: 25 } }));

      const result = await helpcrunchVerifyConnection(HELPCRUNCH_AUTH);
      expect(result.success).toBe(true);
      expect(result.agentCount).toBe(1);
      expect(result.chatCount).toBe(25);
    });

    it('returns failure on auth error', async () => {
      const { helpcrunchVerifyConnection } = await import('../../../connectors/helpcrunch.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await helpcrunchVerifyConnection(HELPCRUNCH_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a chat (2-step: create chat + post message) and returns the ID', async () => {
      const { helpcrunchCreateChat } = await import('../../../connectors/helpcrunch.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 701 })) // create chat
        .mockResolvedValueOnce(jsonResponse({ id: 801 })); // post message

      const result = await helpcrunchCreateChat(HELPCRUNCH_AUTH, 42, 'Hello world');

      expect(result).toEqual({ id: 701 });

      // First call: create chat
      const [chatUrl, chatOpts] = mockFetch.mock.calls[0];
      expect(chatUrl).toContain('/chats');
      expect(chatOpts.method).toBe('POST');
      const chatBody = JSON.parse(chatOpts.body);
      expect(chatBody.customer).toBe(42);
      expect(chatBody.application).toBe(1);

      // Second call: post message
      const [msgUrl, msgOpts] = mockFetch.mock.calls[1];
      expect(msgUrl).toContain('/messages');
      expect(msgOpts.method).toBe('POST');
      const msgBody = JSON.parse(msgOpts.body);
      expect(msgBody.chat).toBe(701);
      expect(msgBody.text).toBe('Hello world');
    });
  });

  describe('update', () => {
    it('sends separate PUT calls for status, assignee, and department', async () => {
      const { helpcrunchUpdateChat } = await import('../../../connectors/helpcrunch.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({}));

      await helpcrunchUpdateChat(HELPCRUNCH_AUTH, 701, { status: 3, assignee: 5, department: 2 });

      expect(mockFetch).toHaveBeenCalledTimes(3);

      const [statusUrl, statusOpts] = mockFetch.mock.calls[0];
      expect(statusUrl).toContain('/chats/701/status');
      expect(statusOpts.method).toBe('PUT');
      expect(JSON.parse(statusOpts.body).status).toBe(3);

      const [assigneeUrl] = mockFetch.mock.calls[1];
      expect(assigneeUrl).toContain('/chats/701/assignee');

      const [deptUrl] = mockFetch.mock.calls[2];
      expect(deptUrl).toContain('/chats/701/department');
    });
  });

  describe('reply/message', () => {
    it('posts message to /messages endpoint', async () => {
      const { helpcrunchPostMessage } = await import('../../../connectors/helpcrunch.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 802 }));

      await helpcrunchPostMessage(HELPCRUNCH_AUTH, 701, 'Reply text');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/messages');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.chat).toBe(701);
      expect(body.text).toBe('Reply text');
      expect(body.type).toBe('message');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('HelpCrunch export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('hc-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports chats and messages to JSONL with correct IDs and source', async () => {
    const { exportHelpcrunch } = await import('../../../connectors/helpcrunch.js');

    mockFetch
      // chats offset=0&limit=100 (1 result < 100 → stops)
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 1, status: 2, assignee: { id: 10, name: 'Agent H' },
          customer: { id: 20, name: 'User A', email: 'a@t.com', company: null },
          department: null, lastMessageText: 'Help me',
          createdAt: '1706745600', lastMessageAt: '1706832000',
        }],
      }))
      // messages for chat 1 offset=0&limit=100 (1 result < 100 → stops)
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 100, text: 'Help me', type: 'message',
          from: 'customer', agent: null,
          createdAt: '1706745600',
        }],
      }))
      // customers offset=0&limit=100 (1 result < 100 → stops)
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 20, name: 'User A', email: 'a@t.com', phone: null, company: null }],
      }))
      // agents
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 10, name: 'Agent H', email: 'agent@hc.com' }] }));

    const manifest = await exportHelpcrunch(HELPCRUNCH_AUTH, tmpDir);

    expect(manifest.source).toBe('helpcrunch');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'hc-1', source: 'helpcrunch' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ticketId: 'hc-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.HELPCRUNCH_API_KEY)('HelpCrunch CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → update → message', { timeout: 30_000 }, async () => {
    const { helpcrunchVerifyConnection, helpcrunchCreateChat, helpcrunchUpdateChat, helpcrunchPostMessage } =
      await import('../../../connectors/helpcrunch.js');
    const auth = { apiKey: process.env.HELPCRUNCH_API_KEY! };

    const verify = await helpcrunchVerifyConnection(auth);
    expect(verify.success).toBe(true);

    // Requires a valid customer ID for live test
    const customerId = parseInt(process.env.HELPCRUNCH_TEST_CUSTOMER_ID ?? '1', 10);
    const created = await helpcrunchCreateChat(auth, customerId, 'CLIaaS CRUD test');
    expect(created.id).toBeGreaterThan(0);

    await helpcrunchUpdateChat(auth, created.id, { status: 3 });
    await helpcrunchPostMessage(auth, created.id, 'Test message');
  });
});
