/**
 * In-sandbox SDK gated by plugin permissions.
 */

import type { PluginPermission } from './types';
import { createLogger } from '../logger';

const logger = createLogger('plugins:sdk');

// SSRF prevention for plugin HTTP requests
const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal',
  '169.254.169.254',
]);

function assertSafeUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
      throw new Error(`Blocked URL: ${parsed.hostname} is not allowed`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked URL:')) throw err;
    throw new Error('Invalid URL');
  }
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
        assertSafeUrl(url);
        const res = await fetch(url, { headers });
        return res.json();
      },
      async post(url: string, body: unknown, headers?: Record<string, string>) {
        if (!perms.has('oauth:external')) denied('oauth:external');
        assertSafeUrl(url);
        const res = await fetch(url, {
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
