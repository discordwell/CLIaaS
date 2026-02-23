import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zodeskFetch } from '../../connectors/zoho-desk.js';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const AUTH = { orgId: 'org-123', accessToken: 'test-token' };

describe('zoho-desk connector (migrated to base)', () => {
  it('zodeskFetch uses createClient under the hood with correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: '1', name: 'Agent' }] }));

    const result = await zodeskFetch<{ data: { id: string; name: string }[] }>(AUTH, '/agents?from=0&limit=1');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Agent');

    // Verify the call went to the Zoho Desk API with correct headers
    expect(mockFetch).toHaveBeenCalledWith(
      'https://desk.zoho.com/api/v1/agents?from=0&limit=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Zoho-oauthtoken test-token',
          orgId: 'org-123',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('zodeskFetch passes orgId as extraHeader on every request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await zodeskFetch(AUTH, '/tickets?from=0&limit=10');

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.orgId).toBe('org-123');
  });

  it('zodeskFetch retries on 429 with Retry-After', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ data: 'ok' }));

    const result = await zodeskFetch<{ data: string }>(AUTH, '/tickets');

    expect(result).toEqual({ data: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('zodeskFetch error message references Zoho Desk source name', async () => {
    // Use Retry-After: 0 to avoid real waits; verify error message uses the createClient sourceName
    mockFetch.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));

    await expect(
      zodeskFetch(AUTH, '/tickets'),
    ).rejects.toThrow('Zoho Desk rate limit exceeded');
  });

  it('zodeskFetch handles POST with body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: '999' }));

    const result = await zodeskFetch<{ id: string }>(AUTH, '/tickets', {
      method: 'POST',
      body: { subject: 'Test', description: 'Hello' },
    });

    expect(result.id).toBe('999');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subject: 'Test', description: 'Hello' }),
      }),
    );
  });

  it('zodeskFetch handles 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await zodeskFetch(AUTH, '/tickets/123/sendReply', { method: 'POST', body: { content: 'hi' } });
    expect(result).toEqual({});
  });

  it('zodeskFetch throws on API errors with source name', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Bad Request', { status: 400, statusText: 'Bad Request' }));

    await expect(zodeskFetch(AUTH, '/invalid')).rejects.toThrow('Zoho Desk API error: 400 Bad Request');
  });

  it('zodeskFetch supports absolute URLs', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await zodeskFetch(AUTH, 'https://desk.zoho.com/api/v1/custom/endpoint');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://desk.zoho.com/api/v1/custom/endpoint',
      expect.any(Object),
    );
  });
});
