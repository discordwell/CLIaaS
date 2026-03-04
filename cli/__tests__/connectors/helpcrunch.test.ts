import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
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

describe('helpcrunchFetch (backward-compat wrapper)', () => {
  it('delegates to createClient with Bearer auth and correct base URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 1, name: 'Agent' }] }));

    const { helpcrunchFetch } = await import('../../connectors/helpcrunch.js');
    const result = await helpcrunchFetch<{ data: Array<{ id: number }> }>(
      { apiKey: 'test-key' },
      '/agents',
    );

    expect(result.data).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/agents',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('passes method and body through to the client', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }));

    const { helpcrunchFetch } = await import('../../connectors/helpcrunch.js');
    await helpcrunchFetch({ apiKey: 'test-key' }, '/chats', {
      method: 'POST',
      body: { customer: 1, message: { text: 'Hello' } },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/chats',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customer: 1, message: { text: 'Hello' } }),
      }),
    );
  });

  it('retries on 429 with Retry-After header', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { helpcrunchFetch } = await import('../../connectors/helpcrunch.js');
    const result = await helpcrunchFetch<{ ok: boolean }>({ apiKey: 'test-key' }, '/chats');

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('helpcrunchVerifyConnection', () => {
  it('returns success with agent and chat counts', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1, name: 'Agent', email: 'a@test.com', role: 'admin' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }], meta: { total: 42 } }));

    const { helpcrunchVerifyConnection } = await import('../../connectors/helpcrunch.js');
    const result = await helpcrunchVerifyConnection({ apiKey: 'test-key' });

    expect(result).toEqual({
      success: true,
      agentCount: 1,
      chatCount: 42,
    });
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { helpcrunchVerifyConnection } = await import('../../connectors/helpcrunch.js');
    const result = await helpcrunchVerifyConnection({ apiKey: 'bad-key' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

describe('exportHelpcrunch message type mapping', () => {
  it('maps private messages to note type and non-private to reply', async () => {
    vi.resetModules();

    const chat = {
      id: 1, status: 2, createdAt: '1700000000', closedAt: null,
      lastMessageAt: '1700001000', lastMessageText: 'Test chat',
      customer: { id: 10, name: 'Customer', email: 'c@test.com' },
      assignee: null, agents: [], department: null,
    };

    const privateMsg = {
      id: 101, text: 'Internal note', type: 'private', from: 'agent' as const,
      createdAt: '1700000100', agent: { id: 5, name: 'Agent', email: 'a@test.com' }, read: true,
    };

    const publicMsg = {
      id: 102, text: 'Customer reply', type: 'message', from: 'customer' as const,
      createdAt: '1700000200', read: true,
    };

    mockFetch
      // Chats page 1 (offset=0)
      .mockResolvedValueOnce(jsonResponse({ data: [chat] }))
      // Messages for chat 1 page 1 (offset=0)
      .mockResolvedValueOnce(jsonResponse({ data: [privateMsg, publicMsg] }))
      // Customers page 1 (offset=0)
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // Agents
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const { exportHelpcrunch } = await import('../../connectors/helpcrunch.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/helpcrunch-msgtype-test-${Date.now()}`;

    await exportHelpcrunch({ apiKey: 'test-key' }, tmpDir);

    const messagesContent = fs.readFileSync(`${tmpDir}/messages.jsonl`, 'utf-8').trim().split('\n');
    expect(messagesContent).toHaveLength(2);

    const msg1 = JSON.parse(messagesContent[0]);
    const msg2 = JSON.parse(messagesContent[1]);

    // Private message should be mapped to 'note'
    expect(msg1.id).toBe('hc-msg-101');
    expect(msg1.type).toBe('note');

    // Non-private message should be mapped to 'reply'
    expect(msg2.id).toBe('hc-msg-102');
    expect(msg2.type).toBe('reply');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('write operations use createClient', () => {
  it('helpcrunchPostMessage sends POST to correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { helpcrunchPostMessage } = await import('../../connectors/helpcrunch.js');
    await helpcrunchPostMessage({ apiKey: 'test-key' }, 123, 'Hello!');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat: 123, text: 'Hello!', type: 'message' }),
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('helpcrunchCreateChat sends POST and returns id', async () => {
    // First call creates the chat, second call posts the initial message
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 999 }))
      .mockResolvedValueOnce(jsonResponse({}));

    const { helpcrunchCreateChat } = await import('../../connectors/helpcrunch.js');
    const result = await helpcrunchCreateChat({ apiKey: 'test-key' }, 42, 'New chat');

    expect(result).toEqual({ id: 999 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/chats',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat: 999, text: 'New chat', type: 'message' }),
      }),
    );
  });

  it('helpcrunchUpdateChat sends PUT for each provided field', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));

    const { helpcrunchUpdateChat } = await import('../../connectors/helpcrunch.js');
    await helpcrunchUpdateChat({ apiKey: 'test-key' }, 10, {
      status: 5,
      assignee: 2,
      department: 3,
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/chats/10/status',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ status: 5 }) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/chats/10/assignee',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ assignee: 2 }) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.helpcrunch.com/v1/chats/10/department',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ department: 3 }) }),
    );
  });
});
