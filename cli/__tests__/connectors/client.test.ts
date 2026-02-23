import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../../connectors/base/client.js';

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

describe('createClient', () => {
  it('makes a GET request with auth headers', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test-token' }),
      sourceName: 'Test',
    });

    const result = await client.request<{ ok: boolean }>('/users');

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('retries on 429 then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ data: 'success' }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'Test',
    });

    const result = await client.request<{ data: string }>('/items');

    expect(result).toEqual({ data: 'success' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exceeded', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'TestAPI',
      maxRetries: 2,
    });

    await expect(client.request('/items')).rejects.toThrow('TestAPI rate limit exceeded after 2 retries');
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('supports async authHeaders for OAuth2 token refresh', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ user: 'test' }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: async () => ({ Authorization: 'Bearer refreshed-token' }),
      sourceName: 'Test',
    });

    await client.request('/me');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer refreshed-token' }),
      }),
    );
  });

  it('supports custom rateLimitStatuses (Groove 503)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'Test',
      rateLimitStatuses: [429, 503],
    });

    const result = await client.request<{ ok: boolean }>('/data');
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('passes extra headers on every request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'Test',
      extraHeaders: { 'X-Custom': 'value' },
    });

    await client.request('/data');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom': 'value' }),
      }),
    );
  });

  it('handles 204 No Content responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'Test',
    });

    const result = await client.request('/delete');
    expect(result).toEqual({});
  });

  it('throws on non-OK non-rate-limit responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'TestAPI',
    });

    await expect(client.request('/missing')).rejects.toThrow('TestAPI API error: 404 Not Found');
  });

  it('supports absolute URLs bypassing baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createClient({
      baseUrl: 'https://api.example.com',
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      sourceName: 'Test',
    });

    await client.request('https://other.example.com/path');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://other.example.com/path',
      expect.any(Object),
    );
  });
});
