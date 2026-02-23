import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);

  // Reset the cached OAuth token between tests by re-importing the module.
  // The module caches tokens at module scope, so we must clear the import cache.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

/** OAuth token response mock — always returned first for a fresh import */
function oauthTokenResponse(): Response {
  return jsonResponse({ access_token: 'test-token-123', expires_in: 7200 });
}

/** 204 No Content response (Help Scout reply/note pattern) */
function noContentResponse(): Response {
  return new Response(null, { status: 204, statusText: 'No Content' });
}

const testAuth = { appId: 'test-app-id', appSecret: 'test-app-secret' };

describe('helpscoutFetch (backward-compat wrapper)', () => {
  it('acquires OAuth token and delegates to createClient with Bearer auth', async () => {
    mockFetch
      .mockResolvedValueOnce(oauthTokenResponse())
      .mockResolvedValueOnce(jsonResponse({ _embedded: { mailboxes: [{ id: 1 }] } }));

    const { helpscoutFetch } = await import('../../connectors/helpscout.js');
    const result = await helpscoutFetch<{ _embedded: { mailboxes: Array<{ id: number }> } }>(
      testAuth,
      '/mailboxes',
    );

    expect(result._embedded.mailboxes).toHaveLength(1);

    // First call: OAuth token
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/oauth2/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: 'test-app-id',
          client_secret: 'test-app-secret',
        }),
      }),
    );

    // Second call: actual API request with Bearer token
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/mailboxes',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('retries on 429 with Retry-After header', async () => {
    mockFetch
      .mockResolvedValueOnce(oauthTokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { helpscoutFetch } = await import('../../connectors/helpscout.js');
    const result = await helpscoutFetch<{ ok: boolean }>(testAuth, '/test');

    expect(result).toEqual({ ok: true });
    // OAuth token + rate-limited request + successful retry = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('helpscoutVerifyConnection', () => {
  it('returns success with userName and mailboxCount', async () => {
    mockFetch
      // OAuth token (called once, then cached for both requests)
      .mockResolvedValueOnce(oauthTokenResponse())
      // GET /mailboxes
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { mailboxes: [{ id: 1, name: 'Support', email: 'support@test.com' }, { id: 2, name: 'Sales', email: 'sales@test.com' }] },
      }))
      // GET /users?page=1
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { users: [{ id: 10, firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' }] },
      }));

    const { helpscoutVerifyConnection } = await import('../../connectors/helpscout.js');
    const result = await helpscoutVerifyConnection(testAuth);

    expect(result).toEqual({
      success: true,
      userName: 'Jane Doe',
      mailboxCount: 2,
    });
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { helpscoutVerifyConnection } = await import('../../connectors/helpscout.js');
    const result = await helpscoutVerifyConnection(testAuth);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});

describe('write operations', () => {
  it('helpscoutCreateConversation posts and extracts ID from Location header', async () => {
    // Create a 201 response with Location header
    const createdRes = new Response(null, {
      status: 201,
      statusText: 'Created',
      headers: { 'Location': 'https://api.helpscout.net/v2/conversations/54321' },
    });

    mockFetch
      .mockResolvedValueOnce(oauthTokenResponse())
      .mockResolvedValueOnce(createdRes);

    const { helpscoutCreateConversation } = await import('../../connectors/helpscout.js');
    const result = await helpscoutCreateConversation(testAuth, 100, 'Test Subject', 'Test body', {
      customerEmail: 'customer@test.com',
      tags: ['urgent'],
    });

    expect(result).toEqual({ id: 54321 });

    // Verify the POST was made to the conversations endpoint
    const postCall = mockFetch.mock.calls[1];
    expect(postCall[0]).toBe('https://api.helpscout.net/v2/conversations');
    expect(postCall[1].method).toBe('POST');
    const sentBody = JSON.parse(postCall[1].body);
    expect(sentBody.subject).toBe('Test Subject');
    expect(sentBody.mailboxId).toBe(100);
    expect(sentBody.tags).toEqual(['urgent']);
    expect(sentBody.threads[0].customer.email).toBe('customer@test.com');
  });

  it('helpscoutReply sends POST to reply endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce(oauthTokenResponse())
      .mockResolvedValueOnce(noContentResponse());

    const { helpscoutReply } = await import('../../connectors/helpscout.js');
    await helpscoutReply(testAuth, 789, 'Thank you for contacting us');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/conversations/789/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Thank you for contacting us' }),
        headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' }),
      }),
    );
  });

  it('helpscoutAddNote sends POST to notes endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce(oauthTokenResponse())
      .mockResolvedValueOnce(noContentResponse());

    const { helpscoutAddNote } = await import('../../connectors/helpscout.js');
    await helpscoutAddNote(testAuth, 456, 'Internal note content');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/conversations/456/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Internal note content' }),
        headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' }),
      }),
    );
  });
});

describe('exportHelpScout with paginatePages adapter', () => {
  it('unwraps _embedded responses and produces correct JSONL output', async () => {
    mockFetch
      // OAuth token
      .mockResolvedValueOnce(oauthTokenResponse())
      // Conversations page 1 (paginatePages requests: /conversations?status=all&per_page=100&page=1)
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          conversations: [{
            id: 1, number: 101, subject: 'Test', status: 'active', state: 'published',
            priority: null, mailboxId: 1,
            primaryCustomer: { id: 10, email: 'cust@test.com' },
            tags: [{ id: 1, tag: 'billing' }],
            createdAt: '2024-01-01T00:00:00Z', closedAt: null, userUpdatedAt: '2024-01-02T00:00:00Z',
          }],
        },
        page: { totalPages: 1, number: 1 },
      }))
      // Threads for conversation 1 (/conversations/1/threads?per_page=100&page=1)
      .mockResolvedValueOnce(jsonResponse({
        _embedded: {
          threads: [{
            id: 100, type: 'customer', body: 'Hello support',
            status: 'active', createdAt: '2024-01-01T00:00:00Z',
            createdBy: { id: 10, type: 'customer', email: 'cust@test.com' },
          }],
        },
        page: { totalPages: 1 },
      }))
      // Customers page 1 (/customers?per_page=100&page=1)
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { customers: [] },
        page: { totalPages: 1 },
      }))
      // Users page 1 (/users?per_page=100&page=1)
      .mockResolvedValueOnce(jsonResponse({
        _embedded: { users: [] },
        page: { totalPages: 1 },
      }))
      // Docs collections (/docs/collections)
      .mockResolvedValueOnce(jsonResponse({ collections: { items: [] } }));

    const { exportHelpScout } = await import('../../connectors/helpscout.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/helpscout-test-${Date.now()}`;

    const manifest = await exportHelpScout(testAuth, tmpDir);

    expect(manifest.source).toBe('helpscout');
    expect(manifest.counts.tickets).toBe(1);
    expect(manifest.counts.messages).toBe(1);

    // Verify JSONL files were written
    const ticketsContent = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim();
    const ticket = JSON.parse(ticketsContent);
    expect(ticket.id).toBe('hs-1');
    expect(ticket.subject).toBe('Test');
    expect(ticket.status).toBe('open');
    expect(ticket.tags).toEqual(['billing']);

    const messagesContent = fs.readFileSync(`${tmpDir}/messages.jsonl`, 'utf-8').trim();
    const message = JSON.parse(messagesContent);
    expect(message.id).toBe('hs-msg-100');
    expect(message.ticketId).toBe('hs-1');
    expect(message.body).toBe('Hello support');
    expect(message.type).toBe('reply');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
