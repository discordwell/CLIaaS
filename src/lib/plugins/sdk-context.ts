/**
 * In-sandbox SDK gated by plugin permissions.
 */

import type { PluginPermission } from './types';
import { createLogger } from '../logger';
import { isPrivateUrl, isObviouslyPrivateUrl } from './url-safety';

const logger = createLogger('plugins:sdk');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

async function assertSafeUrl(url: string): Promise<void> {
  // Fast sync check first
  if (isObviouslyPrivateUrl(url)) {
    throw new Error(`Blocked URL: target is not allowed`);
  }
  // Full async check with DNS resolution
  if (await isPrivateUrl(url)) {
    throw new Error(`Blocked URL: target resolves to a private address`);
  }
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Check Content-Length header early
  const cl = res.headers.get('content-length');
  if (cl && parseInt(cl, 10) > MAX_RESPONSE_BYTES) {
    throw new Error('Response too large');
  }
  return res;
}

export interface PluginSDK {
  config: Record<string, unknown>;
  tickets: {
    get: (id: string) => Promise<unknown>;
    list: (opts?: Record<string, unknown>) => Promise<unknown>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  };
  customers: {
    get: (id: string) => Promise<unknown>;
    list: (opts?: Record<string, unknown>) => Promise<unknown>;
  };
  http: {
    get: (url: string, headers?: Record<string, string>) => Promise<unknown>;
    post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<unknown>;
  };
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

function denied(perm: PluginPermission): never {
  throw new Error(`Permission denied: ${perm} not granted`);
}

export function createPluginSDK(
  permissions: PluginPermission[],
  config: Record<string, unknown>,
  workspaceId: string,
): PluginSDK {
  const perms = new Set(permissions);

  return {
    config,

    tickets: {
      async get(id: string) {
        if (!perms.has('tickets:read')) denied('tickets:read');
        const { readJsonlFile } = await import('../jsonl-store');
        const tickets = readJsonlFile<{ id: string }>('tickets.jsonl');
        return tickets.find(t => t.id === id) ?? null;
      },
      async list(opts?: Record<string, unknown>) {
        if (!perms.has('tickets:read')) denied('tickets:read');
        const { readJsonlFile } = await import('../jsonl-store');
        const tickets = readJsonlFile<Record<string, unknown>>('tickets.jsonl');
        const limit = typeof opts?.limit === 'number' ? opts.limit : 25;
        return tickets.slice(0, limit);
      },
      async update(id: string, data: Record<string, unknown>) {
        if (!perms.has('tickets:write')) denied('tickets:write');
        // In production, this would call the ticket store's update method
        return { id, ...data, updated: true };
      },
    },

    customers: {
      async get(id: string) {
        if (!perms.has('customers:read')) denied('customers:read');
        const { readJsonlFile } = await import('../jsonl-store');
        const customers = readJsonlFile<{ id: string }>('customers.jsonl');
        return customers.find(c => c.id === id) ?? null;
      },
      async list(opts?: Record<string, unknown>) {
        if (!perms.has('customers:read')) denied('customers:read');
        const { readJsonlFile } = await import('../jsonl-store');
        const customers = readJsonlFile<Record<string, unknown>>('customers.jsonl');
        const limit = typeof opts?.limit === 'number' ? opts.limit : 25;
        return customers.slice(0, limit);
      },
    },

    http: {
      async get(url: string, headers?: Record<string, string>) {
        if (!perms.has('oauth:external')) denied('oauth:external');
        await assertSafeUrl(url);
        const res = await safeFetch(url, { headers });
        return res.json();
      },
      async post(url: string, body: unknown, headers?: Record<string, string>) {
        if (!perms.has('oauth:external')) denied('oauth:external');
        await assertSafeUrl(url);
        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        return res.json();
      },
    },

    log: {
      info: (...args: unknown[]) => logger.info({ workspaceId }, ...args),
      warn: (...args: unknown[]) => logger.warn({ workspaceId }, ...args),
      error: (...args: unknown[]) => logger.error({ workspaceId }, ...args),
    },
  };
}
