/**
 * Shared HTTP client with automatic retry on rate-limit responses.
 * Replaces 10 copies of xxxFetch() across connectors.
 */

import type { ClientConfig, RequestOptions } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface ConnectorClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

export function createClient(config: ClientConfig): ConnectorClient {
  const {
    baseUrl,
    authHeaders,
    sourceName,
    maxRetries = 5,
    defaultRetryAfterSeconds = 10,
    preRequestDelayMs,
    extraHeaders = {},
    rateLimitStatuses = [429],
  } = config;

  async function request<T>(path: string, options?: RequestOptions): Promise<T> {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    if (preRequestDelayMs) {
      await sleep(preRequestDelayMs);
    }

    let retries = 0;

    while (true) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(await authHeaders()),
        ...extraHeaders,
        ...options?.headers,
      };

      const res = await fetch(url, {
        method: options?.method ?? 'GET',
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      if (rateLimitStatuses.includes(res.status)) {
        const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? String(defaultRetryAfterSeconds), 10);
        const retryAfter = isNaN(rawRetryAfter) ? defaultRetryAfterSeconds : rawRetryAfter;
        if (retries >= maxRetries) throw new Error(`${sourceName} rate limit exceeded after ${maxRetries} retries`);
        retries++;
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(
          `${sourceName} API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`,
        );
      }

      if (res.status === 204) return {} as T;
      return res.json() as Promise<T>;
    }
  }

  return { request };
}
