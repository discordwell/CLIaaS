import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, createdResponse, noContentResponse, oauthTokenResponse, HELPSCOUT_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  // Reset module to clear cached OAuth token
  vi.resetModules();
});
afterEach(() => { vi.restoreAllMocks(); });

/** Mock the OAuth token exchange, then the actual API call */
function mockWithOAuth(apiResponse: Response) {
  mockFetch
    .mockResolvedValueOnce(oauthTokenResponse()) // OAuth token
    .mockResolvedValueOnce(apiResponse);          // API call
}

// ---- CRUD lifecycle (mocked) ----

describe('HelpScout CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with user name and mailbox count', async () => {
      const { helpscoutVerifyConnection } = await import('../../../connectors/helpscout.js');
      mockFetch
        .mockResolvedValueOnce(oauthTokenResponse())
        // /mailboxes (raw _embedded response)
        .mockResolvedValueOnce(jsonResponse({
          _embedded: { mailboxes: [{ id: 10, name: 'Inbox' }, { id: 11, name: 'Support' }] },
        }))
        // /users?page=1 (raw _embedded response)
        .mockResolvedValueOnce(jsonResponse({
          _embedded: { users: [{ id: 1, firstName: 'Agent', lastName: 'S' }] },
        }));

      const result = await helpscoutVerifyConnection(HELPSCOUT_AUTH);
      expect(result.success).toBe(true);
      expect(result.userName).toBe('Agent S');
      expect(result.mailboxCount).toBe(2);
    });

    it('returns failure on OAuth error', async () => {
      const { helpscoutVerifyConnection } = await import('../../../connectors/helpscout.js');
      mockFetch.mockResolvedValueOnce(new Response('Bad credentials', { status: 401, statusText: 'Unauthorized' }));

      const result = await helpscoutVerifyConnection(HELPSCOUT_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a conversation via 201 + Location header and returns the ID', async () => {
      const { helpscoutCreateConversation } = await import('../../../connectors/helpscout.js');
      mockFetch
        .mockResolvedValueOnce(oauthTokenResponse()) // OAuth token
        .mockResolvedValueOnce(createdResponse('https://api.helpscout.net/v2/conversations/12345'));

      const result = await helpscoutCreateConversation(HELPSCOUT_AUTH, 10, 'Test subject', 'Body text', {
        customerEmail: 'user@test.com', tags: ['cliaas-test-cleanup'],
      });

      expect(result).toEqual({ id: 12345 });

      // Verify the create call (second fetch after OAuth)
      const [url, opts] = mockFetch.mock.calls[1];
      expect(url).toBe('https://api.helpscout.net/v2/conversations');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('Test subject');
      expect(body.mailboxId).toBe(10);
      expect(body.tags).toEqual(['cliaas-test-cleanup']);
      expect(body.threads[0].type).toBe('customer');
    });
  });

  describe('reply', () => {
    it('posts reply to correct endpoint', async () => {
      const { helpscoutReply } = await import('../../../connectors/helpscout.js');
      mockWithOAuth(noContentResponse());

      await helpscoutReply(HELPSCOUT_AUTH, 12345, 'Reply text');

      const [url, opts] = mockFetch.mock.calls[1];
      expect(url).toContain('/conversations/12345/reply');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('Reply text');
    });
  });

  describe('note', () => {
    it('posts note to correct endpoint', async () => {
      const { helpscoutAddNote } = await import('../../../connectors/helpscout.js');
      mockWithOAuth(noContentResponse());

      await helpscoutAddNote(HELPSCOUT_AUTH, 12345, 'Internal note');

      const [url, opts] = mockFetch.mock.calls[1];
      expect(url).toContain('/conversations/12345/notes');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('Internal note');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('HelpScout export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('hs-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports conversations and threads to JSONL with correct IDs and source', async () => {
    const { exportHelpScout } = await import('../../../connectors/helpscout.js');

    mockFetch
      // OAuth token
      .mockResolvedValueOnce(oauthTokenResponse())
      // conversations page 1
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          conversations: [{
            id: 1, subject: 'Issue', status: 'active', type: 'email',
            mailboxId: 10,
            primaryCustomer: { id: 20, email: 'a@t.com' },
            assignee: { id: 10 },
            tags: [{ tag: 'bug' }],
            createdAt: '2026-01-01T00:00:00Z', closedAt: null,
            customFields: [],
          }],
        },
        page: { totalPages: 1 },
      }))
      // threads for conversation 1
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          threads: [{
            id: 100, type: 'customer', body: 'Help me',
            customer: { id: 20, email: 'a@t.com' },
            createdAt: '2026-01-01T00:00:00Z',
          }],
        },
        page: { totalPages: 1 },
      }))
      // customers page 1
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { customers: [{ id: 20, firstName: 'Alice', lastName: 'A', emails: [{ value: 'a@t.com' }], phones: [] }] },
        page: { totalPages: 1 },
      }))
      // users (agents)
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { users: [{ id: 10, firstName: 'Agent', lastName: 'S', email: 'agent@hs.com' }] },
        page: { totalPages: 1 },
      }))
      // Docs collections (KB)
      .mockResolvedValueOnce(jsonResponse({ collections: { items: [] } }));

    const manifest = await exportHelpScout(HELPSCOUT_AUTH, tmpDir);

    expect(manifest.source).toBe('helpscout');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'hs-1', source: 'helpscout' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ticketId: 'hs-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.HELPSCOUT_APP_ID)('HelpScout CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → reply → note', { timeout: 30_000 }, async () => {
    const { helpscoutVerifyConnection, helpscoutCreateConversation, helpscoutReply, helpscoutAddNote } =
      await import('../../../connectors/helpscout.js');
    const auth = { appId: process.env.HELPSCOUT_APP_ID!, appSecret: process.env.HELPSCOUT_APP_SECRET! };
    const mailboxId = parseInt(process.env.HELPSCOUT_MAILBOX_ID ?? '1', 10);

    const verify = await helpscoutVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await helpscoutCreateConversation(auth, mailboxId, 'CLIaaS CRUD test', 'Automated test', {
      customerEmail: 'test@cliaas.com', tags: ['cliaas-test-cleanup'],
    });
    expect(created.id).toBeGreaterThan(0);

    await helpscoutReply(auth, created.id, 'Test reply');
    await helpscoutAddNote(auth, created.id, 'Internal note');
  });
});
